"""
pubs.api.cache — cache-lookup / sync-budget / EnrichTask-pending logic.

Public surface
--------------
get_or_enrich(pubs, sync_budget) -> list[dict]

    For each pub in *pubs* (list of {"name", "lat", "lng", "city"?}):

    1. Compute the geohash-8 cache_key.
    2. Bulk-load all PubHours rows for those keys.
    3. FRESH row (fetched_at within TTL and status in {ok, unknown}):
         → Return cached data as-is.
    4. Recent ERROR row within FIRMY_ERROR_RETRY_COOLDOWN_MINUTES:
         → Return cached error without spending another Firmy.cz proxy fetch.
    5. STALE or MISSING and sync_budget > 0:
         → Fetch synchronously via FirmyHoursSource, persist result,
           decrement budget.
    6. STALE or MISSING but budget exhausted:
         → Upsert an EnrichTask, return status "pending".

    isOpenNow and nextChange are computed ON READ from opening_hours_raw
    (never stored as stale booleans).
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone as dj_tz

from pubs.enrichment import (
    FirmyHoursSource,
    classify_venue,
    geohash8,
    is_open_now,
    names_match,
    next_change,
)
from pubs.models import EnrichTask, PubCommunityData, PubHours

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FRESH_STATUSES = {PubHours.Status.OK, PubHours.Status.UNKNOWN}


def _is_fresh(row: PubHours, ttl_days: int) -> bool:
    """Return True if *row* was fetched within the TTL and has a good status."""
    if row.status not in _FRESH_STATUSES:
        return False
    if row.fetched_at is None:
        return False
    cutoff = dj_tz.now() - timedelta(days=ttl_days)
    return row.fetched_at >= cutoff


def _is_error_in_cooldown(row: PubHours, cooldown_minutes: int) -> bool:
    """Return True if a transient error row should not be retried yet."""
    if row.status != PubHours.Status.ERROR:
        return False
    if row.fetched_at is None:
        return False
    if cooldown_minutes <= 0:
        return False
    cutoff = dj_tz.now() - timedelta(minutes=cooldown_minutes)
    return row.fetched_at >= cutoff


def _result_from_row(row: PubHours) -> dict[str, Any]:
    """Build the response dict for a single PubHours row."""
    oh = row.opening_hours_raw or None
    is_open = is_open_now(oh) if oh else None
    nc = next_change(oh) if oh else None
    nc_iso: str | None = nc.isoformat() if nc is not None else None

    return {
        "key": row.cache_key,
        "name": row.name,
        "opening_hours": oh,
        "isOpenNow": is_open,
        "nextChange": nc_iso,
        "status": row.status,
        "source": row.source if row.source else None,
        "confidence": row.confidence,
        "venueKind": row.venue_kind,
        "beers": [],
        "hours_json": None,
    }


def _pending_result(cache_key: str, name: str) -> dict[str, Any]:
    return {
        "key": cache_key,
        "name": name,
        "opening_hours": None,
        "isOpenNow": None,
        "nextChange": None,
        "status": PubHours.Status.PENDING,
        "source": None,
        "confidence": None,
        "venueKind": PubHours.VenueKind.UNKNOWN,
        "beers": [],
        "hours_json": None,
    }


def _unknown_result(cache_key: str, name: str) -> dict[str, Any]:
    """A no-data 'unknown' result that is NOT persisted (used for a geohash
    collision where the cached row belongs to a different business)."""
    return {
        "key": cache_key,
        "name": name,
        "opening_hours": None,
        "isOpenNow": None,
        "nextChange": None,
        "status": PubHours.Status.UNKNOWN,
        "source": None,
        "confidence": None,
        "venueKind": PubHours.VenueKind.UNKNOWN,
        "beers": [],
        "hours_json": None,
    }


def _serve_cached_or_unknown(
    row: PubHours,
    key: str,
    name: str,
    *,
    match_log: str | None = None,
    collision_log: str,
) -> dict[str, Any]:
    """Serve the cached row, or _unknown_result on a geohash-8 collision.

    The names_match decision (serve the cached row vs. serve an 'unknown'
    result) is the security-relevant invariant that stops a different business
    in the same ~38 m geohash-8 cell from being served the cached pub's hours.
    It is shared by every cache-read branch so the decision can never diverge.
    """
    if names_match(name, row.name):
        if match_log:
            logger.info(match_log, key)
        return _result_from_row(row)
    logger.info(collision_log, key, row.name, name)
    return _unknown_result(key, name)


def _community_result(row: PubCommunityData, name: str) -> dict[str, Any]:
    """Build a response dict from a community-data row whose hours override firmy.

    isOpenNow / nextChange are computed live from the community
    opening_hours_raw, exactly like the firmy path.
    """
    oh = row.opening_hours_raw or None
    is_open = is_open_now(oh) if oh else None
    nc = next_change(oh) if oh else None
    nc_iso: str | None = nc.isoformat() if nc is not None else None

    # Community hours imply someone has curated this place; if they also listed
    # beers on tap, the community knows it serves draft beer → force 'pub'.
    # Otherwise leave it unknown (community hours alone don't prove a beer pub).
    venue_kind = (
        PubHours.VenueKind.PUB if row.beers else PubHours.VenueKind.UNKNOWN
    )

    return {
        "key": row.cache_key,
        "name": name,
        "opening_hours": oh,
        "isOpenNow": is_open,
        "nextChange": nc_iso,
        "status": PubHours.Status.OK,
        "source": "community",
        "confidence": None,
        "venueKind": venue_kind,
        "beers": row.beers or [],
        "hours_json": row.hours_json,
    }


def _upsert_enrich_task(
    cache_key: str, name: str, lat: float, lng: float, city: str | None
) -> None:
    """Create an EnrichTask for *cache_key* if one doesn't exist (or reset if done)."""
    obj, created = EnrichTask.objects.get_or_create(
        cache_key=cache_key,
        defaults={
            "name": name,
            "lat": lat,
            "lng": lng,
            "city": city or "",
        },
    )
    if not created and obj.done:
        # Task was previously completed but the row is stale — re-queue it.
        obj.done = False
        obj.attempts = 0
        obj.error = None
        obj.last_attempt_at = None
        obj.save(update_fields=["done", "attempts", "error", "last_attempt_at"])


def _close_enrich_task(cache_key: str) -> None:
    """Mark any open EnrichTask for *cache_key* as done.

    Called after a successful synchronous enrich so the background
    refresh_hours command does not re-fetch a pub we just refreshed.
    """
    EnrichTask.objects.filter(cache_key=cache_key, done=False).update(
        done=True,
        last_attempt_at=dj_tz.now(),
    )


def _enrich_sync(
    source: FirmyHoursSource,
    cache_key: str,
    name: str,
    lat: float,
    lng: float,
    city: str | None,
) -> PubHours:
    """
    Fetch from Firmy.cz and upsert the result into PubHours.

    Returns the saved PubHours instance (status will be ok/unknown/error).
    """
    now = dj_tz.now()

    try:
        raw = source.fetch(name, lat, lng, city=city)
    except RuntimeError as exc:
        # Daily cap exceeded — treat as transient error
        logger.warning("firmy: daily cap exceeded for %r: %s", name, exc)
        row, _ = PubHours.objects.update_or_create(
            cache_key=cache_key,
            defaults={
                "name": name,
                "lat": lat,
                "lng": lng,
                "status": PubHours.Status.ERROR,
                "error": str(exc),
                "fetched_at": now,
            },
        )
        return row
    except Exception as exc:  # noqa: BLE001
        logger.error("firmy: unexpected error for %r: %s", name, exc, exc_info=True)
        row, _ = PubHours.objects.update_or_create(
            cache_key=cache_key,
            defaults={
                "name": name,
                "lat": lat,
                "lng": lng,
                "status": PubHours.Status.ERROR,
                "error": str(exc),
                "fetched_at": now,
            },
        )
        return row

    if raw is None:
        # No confident match found
        row, _ = PubHours.objects.update_or_create(
            cache_key=cache_key,
            defaults={
                "name": name,
                "lat": lat,
                "lng": lng,
                "status": PubHours.Status.UNKNOWN,
                "opening_hours_raw": None,
                "source": "firmy",
                "source_ref": None,
                "confidence": None,
                "venue_kind": PubHours.VenueKind.UNKNOWN,
                "venue_categories": [],
                "error": None,
                "fetched_at": now,
            },
        )
        return row

    # Confident match — determine status
    if raw.opening_hours_raw:
        status = PubHours.Status.OK
    else:
        status = PubHours.Status.UNKNOWN

    # Classify the venue (draft beer?) from the scraped Firmy.cz categories/tags.
    venue_kind = classify_venue(raw.categories, raw.tags)

    row, _ = PubHours.objects.update_or_create(
        cache_key=cache_key,
        defaults={
            "name": name,
            "lat": lat,
            "lng": lng,
            "status": status,
            "opening_hours_raw": raw.opening_hours_raw,
            "source": raw.source,
            "source_ref": raw.source_ref,
            "confidence": raw.confidence,
            "venue_kind": venue_kind,
            "venue_categories": raw.categories,
            "error": None,
            "fetched_at": now,
        },
    )
    return row


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_or_enrich(
    pubs: list[dict[str, Any]],
    sync_budget: int | None = None,
) -> list[dict[str, Any]]:
    """
    For each pub in *pubs*, return cached opening hours or fetch synchronously
    within *sync_budget*.  Pubs beyond the budget get an EnrichTask and return
    status "pending".

    Parameters
    ----------
    pubs : list of dicts with keys: name, lat, lng, city (optional)
    sync_budget : max number of synchronous Firmy.cz fetches; defaults to
                  settings.SYNC_ENRICH_BUDGET.

    Returns
    -------
    list of result dicts (one per input pub, same order).
    """
    configured_budget = getattr(settings, "SYNC_ENRICH_BUDGET", 3)
    if sync_budget is None:
        sync_budget = configured_budget
    else:
        # Per-request synchronous fetches must have a small fixed ceiling
        # regardless of client input — never let the client raise the budget
        # above the server-configured cap.
        sync_budget = min(sync_budget, configured_budget)

    ttl_days: int = getattr(settings, "HOURS_TTL_DAYS", 30)
    proxy_url: str | None = getattr(settings, "FIRMY_PROXY_URL", None)
    min_interval: float = float(getattr(settings, "FIRMY_MIN_INTERVAL_SEC", 3.0))
    daily_cap: int = int(getattr(settings, "FIRMY_DAILY_CAP", 2000))
    error_retry_cooldown_minutes: int = int(
        getattr(settings, "FIRMY_ERROR_RETRY_COOLDOWN_MINUTES", 15)
    )

    # Annotate each pub entry with its cache key
    entries: list[dict[str, Any]] = []
    for pub in pubs:
        key = geohash8(pub["lat"], pub["lng"])
        entries.append(
            {
                "cache_key": key,
                "name": pub["name"],
                "lat": pub["lat"],
                "lng": pub["lng"],
                "city": pub.get("city") or None,
            }
        )

    # Bulk-load existing rows
    all_keys = [e["cache_key"] for e in entries]
    existing: dict[str, PubHours] = {
        row.cache_key: row
        for row in PubHours.objects.filter(cache_key__in=all_keys)
    }

    # Bulk-load community-contributed data for the same keys (single batched
    # query, not N+1). Community hours take precedence over firmy data, and
    # community beers are attached to every matching result.
    community: dict[str, PubCommunityData] = {
        row.cache_key: row
        for row in PubCommunityData.objects.filter(cache_key__in=all_keys)
    }

    # Lazy-initialise the scraper only when we actually need a sync fetch
    source: FirmyHoursSource | None = None
    budget_remaining = sync_budget

    results: list[dict[str, Any]] = []

    for entry in entries:
        key = entry["cache_key"]
        name = entry["name"]
        lat = entry["lat"]
        lng = entry["lng"]
        city = entry["city"]

        # --- Community data takes precedence -------------------------------
        # Guard against a geohash-8 collision with names_match, same as the
        # firmy cache read below: a different business in the same ~38 m cell
        # must not be served this pub's community data.
        comm = community.get(key)
        comm_matches = comm is not None and names_match(name, comm.name)

        if comm_matches and comm.hours_json is not None:
            # Community hours satisfy this pub fully — override firmy entirely
            # and do NOT schedule an EnrichTask (it is already satisfied).
            results.append(_community_result(comm, name))
            continue

        # Community beers (but no community hours) are attached to whatever the
        # firmy path produces below. _result_index marks where this entry's
        # result lands so we can patch its `beers` in once built.
        community_beers = comm.beers if comm_matches else None
        _result_index = len(results)

        def _attach_beers() -> None:
            # Non-empty community beers are a definitive draft-beer signal — the
            # community override forces venueKind 'pub' regardless of the stored
            # firmy verdict (the community knows better).
            if community_beers:
                results[_result_index]["beers"] = community_beers
                results[_result_index]["venueKind"] = PubHours.VenueKind.PUB

        row = existing.get(key)

        if row is not None and _is_fresh(row, ttl_days):
            # Cache HIT — return as-is (compute isOpenNow/nextChange live), or
            # serve 'unknown' on a geohash-8 collision (a DIFFERENT business
            # occupies this ~38 m cell). We can't overwrite the shared
            # unique-key row without flip-flopping the cache, so we leave the
            # cached row untouched and report no hours for this pub.
            results.append(
                _serve_cached_or_unknown(
                    row, key, name,
                    collision_log=(
                        "pub-hours: geohash collision at %s — cached %r != requested %r; "
                        "returning unknown"
                    ),
                )
            )
            _attach_beers()
            continue

        if row is not None and _is_error_in_cooldown(
            row, error_retry_cooldown_minutes
        ):
            results.append(
                _serve_cached_or_unknown(
                    row, key, name,
                    match_log=(
                        "pub-hours: transient error for %s is still in retry cooldown; "
                        "returning cached error without Firmy.cz fetch"
                    ),
                    collision_log=(
                        "pub-hours: geohash collision at %s during error cooldown — "
                        "cached %r != requested %r; returning unknown"
                    ),
                )
            )
            _attach_beers()
            continue

        # Cache MISS or stale
        if budget_remaining > 0:
            # Fetch synchronously
            if source is None:
                source = FirmyHoursSource(
                    proxy_url=proxy_url,
                    min_interval=min_interval,
                    daily_cap=daily_cap,
                )
            row = _enrich_sync(source, key, name, lat, lng, city)
            budget_remaining -= 1
            # If the sync fetch succeeded (not a transient error), close any
            # open EnrichTask for this key so refresh_hours won't re-fetch it.
            if row.status != PubHours.Status.ERROR:
                _close_enrich_task(key)
            results.append(_result_from_row(row))
        else:
            # Budget exhausted — queue for background enrichment
            _upsert_enrich_task(key, name, lat, lng, city)
            results.append(_pending_result(key, name))

        _attach_beers()

    return results

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
    5. STALE row with status in {ok, unknown}:
         → Return stale cached data immediately and queue refresh_hours.
    6. MISSING and sync_budget > 0:
         → Fetch synchronously via FirmyHoursSource, persist result,
           decrement budget.
    7. MISSING but budget exhausted:
         → Upsert an EnrichTask, return status "pending".

get_cached_pub_details(pubs) -> list[dict | None]

    Bulk-read already known details without scraping, refreshing, or creating
    enrichment tasks. Used by the nearby map response where a cache miss must
    stay free and silent.

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
    name_similarity,
    names_match,
    next_change,
)
from pubs.identity import normalize_pub_name, resolve_pub_identities
from pubs.models import EnrichTask, PubCommunityData, PubExternalBeerMenu, PubHours

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FRESH_STATUSES = {PubHours.Status.OK, PubHours.Status.UNKNOWN}
_GARDEN_TAG = "se-zahradkou"


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


def _result_from_row(
    row: PubHours,
    *,
    include_next_change: bool = True,
) -> dict[str, Any]:
    """Build the response dict for a single PubHours row."""
    oh = row.opening_hours_raw or None
    is_open = is_open_now(oh) if oh else None
    # OpeningHours.next_change can take tens of milliseconds for a complex
    # schedule. Fine for one selected pub, but not for hundreds of map previews.
    nc = next_change(oh) if oh and include_next_change else None
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
        "rating": row.rating_value,
        "ratingCount": row.rating_count,
        "ratingLabel": row.rating_label or None,
        "hasGarden": row.has_garden,
        "venueKind": row.venue_kind,
        "beers": [],
        "historical_beers": [],
        "beers_updated_at": None,
        "beer_menu_rotates": False,
        "hours_updated_at": None,
        "beers_source": None,
        "beers_source_url": None,
        "hours_json": None,
    }


def _empty_result(cache_key: str, name: str, status: str) -> dict[str, Any]:
    """A no-data result dict carrying only key/name and the given *status*.

    Shared by the pending and 'unknown' (geohash-collision) branches so the two
    no-data shapes can never drift apart.
    """
    return {
        "key": cache_key,
        "name": name,
        "opening_hours": None,
        "isOpenNow": None,
        "nextChange": None,
        "status": status,
        "source": None,
        "confidence": None,
        "rating": None,
        "ratingCount": None,
        "ratingLabel": None,
        "hasGarden": None,
        "venueKind": PubHours.VenueKind.UNKNOWN,
        "beers": [],
        "historical_beers": [],
        "beers_updated_at": None,
        "beer_menu_rotates": False,
        "hours_updated_at": None,
        "beers_source": None,
        "beers_source_url": None,
        "hours_json": None,
    }


def _pending_result(cache_key: str, name: str) -> dict[str, Any]:
    return _empty_result(cache_key, name, PubHours.Status.PENDING)


def _unknown_result(cache_key: str, name: str) -> dict[str, Any]:
    """A no-data 'unknown' result that is NOT persisted (used for a geohash
    collision where the cached row belongs to a different business)."""
    return _empty_result(cache_key, name, PubHours.Status.UNKNOWN)


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


def _community_result(
    row: PubCommunityData,
    name: str,
    hours_row: PubHours | None = None,
    *,
    include_next_change: bool = True,
) -> dict[str, Any]:
    """Build a response dict from a community-data row whose hours override firmy.

    isOpenNow / nextChange are computed live from the community
    opening_hours_raw, exactly like the firmy path.
    """
    oh = row.opening_hours_raw or None
    is_open = is_open_now(oh) if oh else None
    nc = next_change(oh) if oh and include_next_change else None
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
        "rating": hours_row.rating_value if hours_row is not None else None,
        "ratingCount": hours_row.rating_count if hours_row is not None else None,
        "ratingLabel": hours_row.rating_label if hours_row is not None else None,
        "hasGarden": hours_row.has_garden if hours_row is not None else None,
        "venueKind": venue_kind,
        "beers": row.beers or [],
        "historical_beers": row.historical_beers or [],
        "beers_updated_at": row.beers_updated_at,
        "beer_menu_rotates": row.beer_menu_rotates,
        "hours_updated_at": row.hours_updated_at,
        "beers_source": "community" if row.beers_updated_at is not None else None,
        "beers_source_url": None,
        "hours_json": row.hours_json,
    }


def _external_by_key(keys: list[str]) -> dict[str, list[PubExternalBeerMenu]]:
    grouped: dict[str, list[PubExternalBeerMenu]] = {}
    for row in PubExternalBeerMenu.objects.filter(cache_key__in=keys, active=True):
        grouped.setdefault(row.cache_key, []).append(row)
    return grouped


def _matching_external_menu(
    rows: list[PubExternalBeerMenu] | None, name: str
) -> PubExternalBeerMenu | None:
    matching = [row for row in rows or [] if names_match(name, row.name)]
    return max(matching, key=lambda row: name_similarity(name, row.name), default=None)


def _attach_external_menu(result: dict[str, Any], row: PubExternalBeerMenu | None) -> None:
    if row is None or not row.beers:
        return
    result["beers"] = row.beers
    result["beers_updated_at"] = row.verified_at
    result["beers_source"] = row.source
    result["beers_source_url"] = row.source_url
    result["venueKind"] = PubHours.VenueKind.PUB


def _canonical_entries(
    pubs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list]:
    raw_entries = [
        {
            "cache_key": geohash8(pub["lat"], pub["lng"]),
            "name": pub["name"],
            "lat": pub["lat"],
            "lng": pub["lng"],
            "city": pub.get("city") or None,
        }
        for pub in pubs
    ]
    identities = resolve_pub_identities(raw_entries)
    entries = [
        {
            "cache_key": identity.cache_key,
            "name": identity.name,
            "lat": identity.lat,
            "lng": identity.lng,
            "city": identity.city or None,
        }
        for identity in identities
    ]
    return entries, identities


def _merge_unique_beers(*menus: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[tuple[str, int | None]] = set()
    for menu in menus:
        for beer in menu or []:
            identity = (
                str(beer.get("name") or "").strip().casefold(),
                beer.get("volume_ml"),
            )
            if not identity[0] or identity in seen:
                continue
            seen.add(identity)
            merged.append(beer)
    return merged


def _attach_retained_alias_data(
    results: list[dict[str, Any] | None],
    identities: list,
    *,
    include_next_change: bool,
) -> None:
    """Merge read-only facts across aliases without changing their source rows."""
    alias_keys = {
        cache_key
        for identity in identities
        if identity.canonical_id is not None
        for cache_key, _ in identity.aliases
    }
    if not alias_keys:
        return
    community_by_key = {
        row.cache_key: row
        for row in PubCommunityData.objects.filter(cache_key__in=alias_keys)
    }
    external_by_key = _external_by_key(list(alias_keys))

    for index, (result, identity) in enumerate(
        zip(results, identities, strict=True)
    ):
        if identity.canonical_id is None:
            continue
        names_by_key: dict[str, set[str]] = {}
        for cache_key, name_key in identity.aliases:
            names_by_key.setdefault(cache_key, set()).add(name_key)
        community_rows = [
            row
            for cache_key, row in community_by_key.items()
            if cache_key in names_by_key
            and normalize_pub_name(row.name) in names_by_key[cache_key]
        ]
        has_retained_external = any(
            normalize_pub_name(row.name) in names_by_key.get(cache_key, set())
            for cache_key, rows in external_by_key.items()
            for row in rows
        )
        if result is None:
            if not community_rows and not has_retained_external:
                continue
            result = _unknown_result(identity.cache_key, identity.name)
            results[index] = result
        menu_rows = sorted(
            community_rows,
            key=lambda row: row.beers_updated_at or row.created_at,
            reverse=True,
        )
        current_beers = _merge_unique_beers(*(row.beers for row in menu_rows))
        historical_beers = _merge_unique_beers(
            *(row.historical_beers for row in menu_rows)
        )

        matching_external = [
            row
            for cache_key, rows in external_by_key.items()
            if cache_key in names_by_key
            for row in rows
            if normalize_pub_name(row.name) in names_by_key[cache_key]
        ]
        matching_external.sort(
            key=lambda row: row.verified_at or row.fetched_at,
            reverse=True,
        )
        has_community_menu = any(
            row.beers or row.beers_updated_at is not None for row in menu_rows
        )
        if current_beers:
            result["beers"] = current_beers
            result["venueKind"] = PubHours.VenueKind.PUB
        if menu_rows:
            newest_menu = menu_rows[0]
            result["beers_updated_at"] = newest_menu.beers_updated_at
            result["beer_menu_rotates"] = any(
                row.beer_menu_rotates for row in menu_rows
            )
            if has_community_menu:
                result["beers_source"] = "community"
        if has_community_menu:
            # Imported snapshots never become the current menu when a user has
            # confirmed one, but their distinct beers remain discoverable.
            historical_beers = _merge_unique_beers(
                historical_beers,
                *(row.beers for row in matching_external),
            )
        elif matching_external:
            _attach_external_menu(result, matching_external[0])
        if historical_beers:
            current_keys = {
                (
                    str(beer.get("name") or "").strip().casefold(),
                    beer.get("volume_ml"),
                )
                for beer in result.get("beers") or []
            }
            result["historical_beers"] = [
                beer
                for beer in historical_beers
                if (
                    str(beer.get("name") or "").strip().casefold(),
                    beer.get("volume_ml"),
                )
                not in current_keys
            ]

        hours_rows = [row for row in community_rows if row.hours_json is not None]
        if hours_rows:
            newest_hours = max(
                hours_rows,
                key=lambda row: row.hours_updated_at or row.created_at,
            )
            existing_hours_at = result.get("hours_updated_at")
            if (
                existing_hours_at is None
                or newest_hours.hours_updated_at is None
                or newest_hours.hours_updated_at >= existing_hours_at
            ):
                hours_result = _community_result(
                    newest_hours,
                    identity.name,
                    include_next_change=include_next_change,
                )
                for field in (
                    "opening_hours",
                    "isOpenNow",
                    "nextChange",
                    "status",
                    "source",
                    "hours_updated_at",
                    "hours_json",
                ):
                    result[field] = hours_result[field]


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


def _save_error_row(
    cache_key: str, name: str, lat: float, lng: float, exc: Exception, now
) -> PubHours:
    """Upsert a transient-ERROR PubHours row for a failed Firmy.cz fetch."""
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
        return _save_error_row(cache_key, name, lat, lng, exc, now)
    except Exception as exc:  # noqa: BLE001
        logger.error("firmy: unexpected error for %r: %s", name, exc, exc_info=True)
        return _save_error_row(cache_key, name, lat, lng, exc, now)

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
                "rating_value": None,
                "rating_count": None,
                "rating_label": None,
                "has_garden": None,
                "venue_kind": PubHours.VenueKind.UNKNOWN,
                "venue_categories": [],
                "venue_tags": [],
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
    has_garden = _GARDEN_TAG in raw.tags

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
            "rating_value": raw.rating_value,
            "rating_count": raw.rating_count,
            "rating_label": raw.rating_label,
            "has_garden": has_garden,
            "venue_kind": venue_kind,
            "venue_categories": raw.categories,
            "venue_tags": raw.tags,
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

    # Resolve reviewed aliases before any cache read or write. Released clients
    # may still send a hidden source identity from their offline queue.
    entries, identities = _canonical_entries(pubs)

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
    external = _external_by_key(all_keys)

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
        row = existing.get(key)

        # --- Community data takes precedence -------------------------------
        # Guard against a geohash-8 collision with names_match, same as the
        # firmy cache read below: a different business in the same ~38 m cell
        # must not be served this pub's community data.
        comm = community.get(key)
        comm_matches = comm is not None and names_match(name, comm.name)
        external_menu = _matching_external_menu(external.get(key), name)

        if comm_matches and comm.hours_json is not None:
            # Community hours satisfy this pub fully — override firmy entirely
            # and do NOT schedule an EnrichTask (it is already satisfied).
            rating_row = row if row is not None and names_match(name, row.name) else None
            result = _community_result(comm, name, rating_row)
            if not comm.beers and comm.beers_updated_at is None:
                _attach_external_menu(result, external_menu)
            results.append(result)
            continue

        # Community beers (but no community hours) are attached to whatever the
        # firmy path produces below. _result_index marks where this entry's
        # result lands so we can patch its `beers` in once built.
        community_beers = comm.beers if comm_matches else None
        community_historical_beers = comm.historical_beers if comm_matches else None
        community_beers_updated_at = comm.beers_updated_at if comm_matches else None
        community_beer_menu_rotates = comm.beer_menu_rotates if comm_matches else False
        community_hours_updated_at = comm.hours_updated_at if comm_matches else None
        community_has_menu = bool(community_beers) or community_beers_updated_at is not None
        _result_index = len(results)

        def _attach_beers() -> None:
            # Non-empty community beers are a definitive draft-beer signal — the
            # community override forces venueKind 'pub' regardless of the stored
            # firmy verdict (the community knows better).
            if community_beers:
                results[_result_index]["beers"] = community_beers
                results[_result_index]["venueKind"] = PubHours.VenueKind.PUB
            if community_historical_beers:
                results[_result_index]["historical_beers"] = community_historical_beers
            if community_beers_updated_at:
                results[_result_index]["beers_updated_at"] = community_beers_updated_at
                results[_result_index]["beers_source"] = "community"
            results[_result_index]["beer_menu_rotates"] = community_beer_menu_rotates
            if community_hours_updated_at:
                results[_result_index]["hours_updated_at"] = community_hours_updated_at
            if not community_has_menu:
                _attach_external_menu(results[_result_index], external_menu)

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

        if row is not None and row.status in _FRESH_STATUSES:
            # Stale-but-usable data should not make a user-facing detail request
            # wait on Firmy.cz. Serve it immediately and let refresh_hours update
            # the rating/hours in the background. Keep the same collision guard
            # as fresh cache hits; a different business in this cell must not
            # inherit the stale row or cause us to flip-flop the shared key.
            if names_match(name, row.name):
                _upsert_enrich_task(key, name, lat, lng, city)
                results.append(_result_from_row(row))
            else:
                logger.info(
                    "pub-hours: geohash collision at %s during stale read — "
                    "cached %r != requested %r; returning unknown",
                    key,
                    row.name,
                    name,
                )
                results.append(_unknown_result(key, name))
            _attach_beers()
            continue

        # Cache MISS, expired error, or another unusable row status
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

    _attach_retained_alias_data(
        results,
        identities,
        include_next_change=True,
    )
    return results


def get_cached_pub_details(
    pubs: list[dict[str, Any]],
    *,
    include_next_change: bool = True,
) -> list[dict[str, Any] | None]:
    """Return existing hours/rating/community facts in input order.

    Unlike :func:`get_or_enrich`, this read path has no side effects: stale
    cached facts are still useful for the map preview, while missing rows do not
    create ``EnrichTask`` records or spend Firmy.cz proxy traffic. Name matching
    preserves the same geohash-collision boundary as the detail endpoint.
    """
    entries, identities = _canonical_entries(pubs)
    keys = [entry["cache_key"] for entry in entries]
    hours_by_key = {
        row.cache_key: row
        for row in PubHours.objects.filter(cache_key__in=keys)
    }
    community_by_key = {
        row.cache_key: row
        for row in PubCommunityData.objects.filter(cache_key__in=keys)
    }
    external_by_key = _external_by_key(keys)

    results: list[dict[str, Any] | None] = []
    for entry in entries:
        key = entry["cache_key"]
        name = entry["name"]
        hours_row = hours_by_key.get(key)
        matching_hours = (
            hours_row
            if hours_row is not None and names_match(name, hours_row.name)
            else None
        )
        community_row = community_by_key.get(key)
        matching_community = (
            community_row
            if community_row is not None and names_match(name, community_row.name)
            else None
        )
        external_menu = _matching_external_menu(external_by_key.get(key), name)

        if matching_community is not None and matching_community.hours_json is not None:
            result = _community_result(
                matching_community,
                name,
                matching_hours,
                include_next_change=include_next_change,
            )
            if not matching_community.beers and matching_community.beers_updated_at is None:
                _attach_external_menu(result, external_menu)
            results.append(result)
            continue

        if matching_hours is not None:
            result = _result_from_row(
                matching_hours,
                include_next_change=include_next_change,
            )
        elif matching_community is not None or external_menu is not None:
            result = _unknown_result(key, name)
        else:
            results.append(None)
            continue

        if matching_community is not None:
            if matching_community.beers:
                result["beers"] = matching_community.beers
                result["venueKind"] = PubHours.VenueKind.PUB
            if matching_community.historical_beers:
                result["historical_beers"] = matching_community.historical_beers
            if matching_community.beers_updated_at:
                result["beers_updated_at"] = matching_community.beers_updated_at
                result["beers_source"] = "community"
            result["beer_menu_rotates"] = matching_community.beer_menu_rotates
            if matching_community.hours_updated_at:
                result["hours_updated_at"] = matching_community.hours_updated_at
        if matching_community is None or (
            not matching_community.beers and matching_community.beers_updated_at is None
        ):
            _attach_external_menu(result, external_menu)
        results.append(result)

    _attach_retained_alias_data(
        results,
        identities,
        include_next_change=include_next_change,
    )
    return results

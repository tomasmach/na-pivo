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
    4. STALE or MISSING and sync_budget > 0:
         → Fetch synchronously via FirmyHoursSource, persist result,
           decrement budget.
    5. STALE or MISSING but budget exhausted:
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
    geohash8,
    is_open_now,
    names_match,
    next_change,
)
from pubs.models import EnrichTask, PubHours

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

        if row is not None and _is_fresh(row, ttl_days):
            if names_match(name, row.name):
                # Cache HIT — return as-is (compute isOpenNow/nextChange live)
                results.append(_result_from_row(row))
            else:
                # Geohash-8 collision: a DIFFERENT business occupies this ~38 m
                # cell. Serving the cached business's hours would mislabel this
                # pub. We can't overwrite the shared unique-key row without
                # flip-flopping the cache, so report 'unknown' (no hours) for
                # this pub and leave the cached row untouched.
                logger.info(
                    "pub-hours: geohash collision at %s — cached %r != requested %r; "
                    "returning unknown",
                    key, row.name, name,
                )
                results.append(_unknown_result(key, name))
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

    return results

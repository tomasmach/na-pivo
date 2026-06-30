"""Personal beer-stats aggregation for ``GET /v1/me/stats``.

Pure, read-only aggregation of an account's :class:`~pubs.models.DrinkLog`
history into the numbers the mobile "Výkon" screen shows. This is the durable,
server-side mirror of the device-local read model in the app
(``src/stats/statsModel.ts``): an account holder's stats can outlive the app's
50-evening local cap, and the same rules later feed the year-end Pivní Wrapped.

Parity contract with ``statsModel.ts`` / ``eveningModel.ts``
-----------------------------------------------------------
An "evening" = drinks at one pub (geohash-8 ``cache_key``) on one "drinking
day", where the drinking day rolls at 04:00 *local* time. The app buckets by the
device's local clock; our audience is Czech/Slovak, so we bucket every
``drank_at`` in Europe/Prague to line up with what the device shows. Within an
evening, drinks are ordered by ``drank_at``; the evening's duration is
``last − first`` and the smallest gap between consecutive drinks is the
"fastest beer".
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from pubs.models import Account

# The app's drinking day rolls at 04:00 *device-local*. Our users are CZ/SK, so
# we bucket server-side in Europe/Prague to line up with what the device shows
# locally; revisit this assumption if the audience ever spans other zones.
_DRINKING_DAY_TZ = ZoneInfo("Europe/Prague")
_DRINKING_DAY_CUTOFF = timedelta(hours=4)
_TOP_PUBS_LIMIT = 8


def _as_utc(value: datetime) -> datetime:
    """Coerce a stored ``drank_at`` to an aware UTC datetime.

    With ``USE_TZ=True`` values read back from the DB are already aware UTC; the
    naive guard only matters for hand-built rows and keeps bucketing
    deterministic — a naive value is treated as UTC, never as ambiguous
    server-local time.
    """

    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _drinking_day(drank_at: datetime) -> date:
    """The 04:00-rolling drinking day for ``drank_at``, bucketed in Europe/Prague."""

    local = _as_utc(drank_at).astimezone(_DRINKING_DAY_TZ)
    return (local - _DRINKING_DAY_CUTOFF).date()


def _empty_payload() -> dict:
    """The 200 body for an account with no logged drinks (zeroes / nulls)."""

    return {
        "total_beers": 0,
        "total_evenings": 0,
        "distinct_pubs": 0,
        "total_spent_czk": 0,
        "first_drink_at": None,
        "top_pubs": [],
        "records": {
            "most_beers_in_evening": 0,
            "most_beers_pub_name": None,
            "most_beers_date": None,
            "fastest_beer_seconds": None,
            "longest_evening_seconds": None,
        },
    }


def compute_my_stats(account: Account) -> dict:
    """Aggregate ``account``'s drinks into the ``/v1/me/stats`` payload.

    Pure and read-only. Pulls the (small) per-user drink history ascending by
    ``drank_at`` — covered by the ``(account, drank_at)`` index — and folds it in
    Python so the rules stay aligned with the device model. Returns the empty
    payload (200, never 404) when the account has logged nothing.
    """

    drinks = list(
        account.drinks.only("cache_key", "name", "price_czk", "drank_at").order_by("drank_at")
    )
    if not drinks:
        return _empty_payload()

    # Fold the ascending drinks into evenings (cache_key, drinking_day) and
    # per-pub tallies. Insertion order = ascending drank_at, so within each
    # bucket the last appended drink is the most recent one.
    evening_times: OrderedDict[tuple[str, date], list[datetime]] = OrderedDict()
    evening_name: dict[tuple[str, date], str] = {}
    pubs: OrderedDict[str, dict] = OrderedDict()

    total_spent = 0
    for drink in drinks:
        at = _as_utc(drink.drank_at)
        total_spent += drink.price_czk

        ekey = (drink.cache_key, _drinking_day(drink.drank_at))
        evening_times.setdefault(ekey, []).append(at)
        evening_name[ekey] = drink.name  # ascending iteration → newest name wins

        pub = pubs.get(drink.cache_key)
        if pub is None:
            pubs[drink.cache_key] = {
                "cache_key": drink.cache_key,
                "name": drink.name,
                "beers": 1,
                "spent_czk": drink.price_czk,
                "last_drank_at": at,
            }
        else:
            pub["beers"] += 1
            pub["spent_czk"] += drink.price_czk
            pub["name"] = drink.name  # ascending → newest name / timestamp win
            pub["last_drank_at"] = at

    # top_pubs: most beers first, ties broken by the most recent drink, capped.
    top_pubs = sorted(
        pubs.values(),
        key=lambda p: (p["beers"], p["last_drank_at"]),
        reverse=True,
    )[:_TOP_PUBS_LIMIT]
    top_pubs_payload = [
        {
            "cache_key": pub["cache_key"],
            "name": pub["name"],
            "beers": pub["beers"],
            "spent_czk": pub["spent_czk"],
            "last_drank_at": pub["last_drank_at"].isoformat(),
        }
        for pub in top_pubs
    ]

    # records: biggest evening (ties → most recent), fastest beer, longest evening.
    best_key: tuple[str, date] | None = None
    best_size = 0
    best_newest: datetime | None = None
    fastest_gap: timedelta | None = None
    longest_duration: timedelta | None = None

    for ekey, times in evening_times.items():
        size = len(times)
        newest = times[-1]  # ascending → last is most recent
        if (
            best_key is None
            or size > best_size
            or (size == best_size and best_newest is not None and newest > best_newest)
        ):
            best_key, best_size, best_newest = ekey, size, newest

        if size >= 2:
            smallest = min(times[i] - times[i - 1] for i in range(1, size))
            if fastest_gap is None or smallest < fastest_gap:
                fastest_gap = smallest
            # Mirror the app: only a positive span counts as a "longest evening"
            # (two drinks at the same instant don't), while a zero gap still
            # counts as the fastest beer.
            duration = times[-1] - times[0]
            if duration > timedelta(0) and (
                longest_duration is None or duration > longest_duration
            ):
                longest_duration = duration

    records = {
        "most_beers_in_evening": best_size,
        "most_beers_pub_name": evening_name[best_key] if best_key is not None else None,
        "most_beers_date": best_key[1].isoformat() if best_key is not None else None,
        "fastest_beer_seconds": (
            int(fastest_gap.total_seconds()) if fastest_gap is not None else None
        ),
        "longest_evening_seconds": (
            int(longest_duration.total_seconds()) if longest_duration is not None else None
        ),
    }

    return {
        "total_beers": len(drinks),
        "total_evenings": len(evening_times),
        "distinct_pubs": len(pubs),
        "total_spent_czk": total_spent,
        "first_drink_at": _as_utc(drinks[0].drank_at).isoformat(),  # ascending → oldest
        "top_pubs": top_pubs_payload,
        "records": records,
    }

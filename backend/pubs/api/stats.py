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
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pubs.models import Account, DrinkLog

# The app's drinking day rolls at 04:00 device-local. New clients send their
# IANA timezone; older clients and invalid values keep the CZ/SK default.
_DEFAULT_TIMEZONE_NAME = "Europe/Prague"
_DRINKING_DAY_TZ = ZoneInfo(_DEFAULT_TIMEZONE_NAME)
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


def resolve_stats_timezone(timezone_name: str | None) -> tuple[str, ZoneInfo]:
    """Resolve a client IANA zone, falling back to the product's CZ/SK default."""

    candidate = (timezone_name or "").strip()
    if not candidate or len(candidate) > 64:
        return _DEFAULT_TIMEZONE_NAME, _DRINKING_DAY_TZ
    try:
        return candidate, ZoneInfo(candidate)
    except (KeyError, ValueError):
        return _DEFAULT_TIMEZONE_NAME, _DRINKING_DAY_TZ


def drinking_day(drank_at: datetime, tz: ZoneInfo = _DRINKING_DAY_TZ) -> date:
    """The 04:00-rolling drinking day for ``drank_at`` in ``tz``."""

    local = _as_utc(drank_at).astimezone(tz)
    return (local - _DRINKING_DAY_CUTOFF).date()


def drinking_day_bounds(drank_at: datetime) -> tuple[datetime, datetime]:
    """Return the Prague-local 04:00 bounds containing ``drank_at``."""
    day = drinking_day(drank_at)
    start = datetime.combine(day, time(hour=4), tzinfo=_DRINKING_DAY_TZ)
    end = datetime.combine(
        day + timedelta(days=1), time(hour=4), tzinfo=_DRINKING_DAY_TZ
    )
    return start, end


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
        "periods": {
            "timezone": _DEFAULT_TIMEZONE_NAME,
            "months": [],
            "years": [],
        },
    }


def _period_payload(
    period: str,
    *,
    beers: int,
    evening_keys: set[tuple[str | None, date]],
    spent_czk: int,
) -> dict:
    evenings = len(evening_keys)
    return {
        "period": period,
        "beers": beers,
        "evenings": evenings,
        "spent_czk": spent_czk,
        "average_beers_per_evening": round(beers / evenings, 1) if evenings else 0,
    }


def compute_my_stats(account: Account, *, timezone_name: str | None = None) -> dict:
    """Aggregate ``account``'s drinks into the ``/v1/me/stats`` payload.

    Pure and read-only. Pulls the (small) per-user drink history ascending by
    ``drank_at`` — covered by the ``(account, drank_at)`` index — and folds it in
    Python so the rules stay aligned with the device model. ``timezone_name``
    affects drinking-day and period buckets without changing the wire shape for
    older clients. Returns the empty payload (200, never 404) when the account
    has logged nothing.
    """

    resolved_timezone_name, stats_tz = resolve_stats_timezone(timezone_name)
    drinks = list(
        account.drinks.only(
            "cache_key",
            "name",
            "price_czk",
            "drink_type",
            "drank_at",
        ).order_by("drank_at")
    )
    if not drinks:
        payload = _empty_payload()
        payload["periods"]["timezone"] = resolved_timezone_name
        return payload

    # Fold the ascending drinks into evenings (cache_key, drinking_day) and
    # per-pub tallies. Insertion order = ascending drank_at, so within each
    # bucket the last appended drink is the most recent one.
    evening_times: OrderedDict[tuple[str | None, date], list[datetime]] = OrderedDict()
    evening_beer_times: OrderedDict[tuple[str | None, date], list[datetime]] = OrderedDict()
    evening_name: dict[tuple[str | None, date], str | None] = {}
    pubs: OrderedDict[str, dict] = OrderedDict()
    months: OrderedDict[str, dict] = OrderedDict()
    years: OrderedDict[str, dict] = OrderedDict()

    total_spent = 0
    total_beers = 0
    for drink in drinks:
        at = _as_utc(drink.drank_at)
        total_spent += drink.price_czk or 0
        is_beer = drink.drink_type == DrinkLog.DrinkType.BEER
        if is_beer:
            total_beers += 1

        day = drinking_day(drink.drank_at, stats_tz)
        ekey = (drink.cache_key, day)
        evening_times.setdefault(ekey, []).append(at)
        if is_beer:
            evening_beer_times.setdefault(ekey, []).append(at)
        # Non-pub evenings participate in day-based records, but never pretend
        # to have a pub name.
        evening_name[ekey] = drink.name if drink.cache_key is not None else None

        for period_map, period in ((months, day.strftime("%Y-%m")), (years, str(day.year))):
            summary = period_map.setdefault(
                period,
                {"beers": 0, "evening_keys": set(), "spent_czk": 0},
            )
            summary["beers"] += int(is_beer)
            summary["evening_keys"].add(ekey)
            summary["spent_czk"] += drink.price_czk or 0

        if drink.cache_key is None:
            continue
        pub = pubs.get(drink.cache_key)
        if pub is None:
            pubs[drink.cache_key] = {
                "cache_key": drink.cache_key,
                "name": drink.name,
                "beers": int(is_beer),
                "spent_czk": drink.price_czk or 0,
                "last_drank_at": at,
            }
        else:
            pub["beers"] += int(is_beer)
            pub["spent_czk"] += drink.price_czk or 0
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
    best_key: tuple[str | None, date] | None = None
    best_size = 0
    best_newest: datetime | None = None
    fastest_gap: timedelta | None = None
    longest_duration: timedelta | None = None

    for ekey, beer_times in evening_beer_times.items():
        size = len(beer_times)
        newest = beer_times[-1]  # ascending → last is most recent
        if (
            best_key is None
            or size > best_size
            or (size == best_size and best_newest is not None and newest > best_newest)
        ):
            best_key, best_size, best_newest = ekey, size, newest

        if size >= 2:
            smallest = min(
                beer_times[i] - beer_times[i - 1]
                for i in range(1, size)
            )
            if fastest_gap is None or smallest < fastest_gap:
                fastest_gap = smallest

    for times in evening_times.values():
        if len(times) >= 2:
            # Mirror the app: only a positive span counts as a "longest evening".
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

    periods = {
        "timezone": resolved_timezone_name,
        "months": [
            _period_payload(period, **summary) for period, summary in months.items()
        ],
        "years": [
            _period_payload(period, **summary) for period, summary in years.items()
        ],
    }

    return {
        "total_beers": total_beers,
        "total_evenings": len(evening_times),
        "distinct_pubs": len(pubs),
        "total_spent_czk": total_spent,
        "first_drink_at": _as_utc(drinks[0].drank_at).isoformat(),  # ascending → oldest
        "top_pubs": top_pubs_payload,
        "records": records,
        "periods": periods,
    }

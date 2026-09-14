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

from django.conf import settings
from django.db.models import Subquery

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
        # Additive 3.0 count: one 04:00 drinking day, even across several pubs.
        "total_nights": 0,
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
            "longest_evening_pub_name": None,
            "longest_evening_date": None,
        },
        # Whole drinking-day records for the 3.0 recap. Kept separate from the
        # released per-pub ``records`` contract above.
        "night_records": {
            "most_beers": 0,
            "longest_seconds": 0,
            "most_stops": 0,
            "most_beers_date": None,
            "most_beers_pub_names": [],
            "longest_date": None,
            "longest_pub_names": [],
        },
        "periods": {
            "timezone": _DEFAULT_TIMEZONE_NAME,
            "months": [],
            "years": [],
        },
        "timeline": {
            "days": [],
            "weeks": [],
            "months": [],
            "streak": {"current_weeks": 0, "best_weeks": 0},
            "windows": {},
        },
        # Same privacy-safe shape as `timeline`, grouped by drinking day rather
        # than the released per-pub sitting definition.
        "night_timeline": {
            "days": [],
            "weeks": [],
            "months": [],
            "streak": {"current_weeks": 0, "best_weeks": 0},
            "windows": {},
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


def _empty_timeline_bucket(period: str) -> dict:
    """One privacy-safe profile chart bucket.

    These buckets deliberately omit spend, concrete beer names and locations.
    A profile chart needs rhythm, not a second export of somebody's diary.
    """

    return {
        "period": period,
        "beers": 0,
        "evenings": 0,
        "distinct_pubs": 0,
        "longest_evening_seconds": None,
    }


def _timeline_payload(
    *,
    evening_times: OrderedDict[tuple[str | None, date], list[datetime]],
    evening_beer_times: OrderedDict[tuple[str | None, date], list[datetime]],
    stats_tz: ZoneInfo,
    pub_keys_by_evening: dict[tuple[str | None, date], set[str]] | None = None,
) -> dict:
    """Return fixed-width day/week/month series plus the weekly streak.

    Empty buckets are material: omitting a quiet day makes the graph claim a
    busier rhythm than the diary contains.  The windows end today in the
    caller's timezone and stay small (7 + 12 + 12 rows), so the response size
    does not grow with account age.
    """

    today = datetime.now(stats_tz).date()
    day_starts = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    current_monday = today - timedelta(days=today.weekday())
    week_starts = [
        current_monday - timedelta(weeks=offset) for offset in range(11, -1, -1)
    ]

    month_starts: list[date] = []
    year, month = today.year, today.month
    for offset in range(11, -1, -1):
        absolute = year * 12 + (month - 1) - offset
        month_starts.append(date(absolute // 12, absolute % 12 + 1, 1))

    day_rows = {
        start: _empty_timeline_bucket(start.isoformat()) for start in day_starts
    }
    week_rows = {
        start: _empty_timeline_bucket(start.isoformat()) for start in week_starts
    }
    month_rows = {
        start: _empty_timeline_bucket(start.strftime("%Y-%m"))
        for start in month_starts
    }
    day_pub_keys = {start: set() for start in day_starts}
    week_pub_keys = {start: set() for start in week_starts}
    month_pub_keys = {start: set() for start in month_starts}

    active_weeks: set[date] = set()
    for ekey, times in evening_times.items():
        pub_key, day = ekey
        record_pub_keys = (
            pub_keys_by_evening.get(ekey, set())
            if pub_keys_by_evening is not None
            else ({pub_key} if pub_key is not None else set())
        )
        monday = day - timedelta(days=day.weekday())
        month_start = date(day.year, day.month, 1)
        active_weeks.add(monday)
        duration_seconds = None
        if len(times) >= 2:
            duration = times[-1] - times[0]
            if duration > timedelta(0):
                duration_seconds = int(duration.total_seconds())
        beer_count = len(evening_beer_times.get(ekey, ()))

        for key, rows, pub_keys in (
            (day, day_rows, day_pub_keys),
            (monday, week_rows, week_pub_keys),
            (month_start, month_rows, month_pub_keys),
        ):
            row = rows.get(key)
            if row is None:
                continue
            row["beers"] += beer_count
            row["evenings"] += 1
            pub_keys[key].update(record_pub_keys)
            previous = row["longest_evening_seconds"]
            if duration_seconds is not None and (
                previous is None or duration_seconds > previous
            ):
                row["longest_evening_seconds"] = duration_seconds

    for rows, pub_keys in (
        (day_rows, day_pub_keys),
        (week_rows, week_pub_keys),
        (month_rows, month_pub_keys),
    ):
        for key, row in rows.items():
            row["distinct_pubs"] = len(pub_keys[key])

    best_streak = 0
    run = 0
    previous: date | None = None
    for week in sorted(active_weeks):
        if previous is not None and week == previous + timedelta(weeks=1):
            run += 1
        else:
            run = 1
        best_streak = max(best_streak, run)
        previous = week

    current_streak = 0
    cursor = current_monday
    while cursor in active_weeks:
        current_streak += 1
        cursor -= timedelta(weeks=1)

    def window_summary(start: date) -> dict:
        selected = [
            (ekey, times)
            for ekey, times in evening_times.items()
            if start <= ekey[1] <= today
        ]
        selected_pub_keys: set[str] = set()
        for ekey, _ in selected:
            if pub_keys_by_evening is not None:
                selected_pub_keys.update(pub_keys_by_evening.get(ekey, set()))
            elif ekey[0] is not None:
                selected_pub_keys.add(ekey[0])
        longest: int | None = None
        for _, times in selected:
            if len(times) < 2:
                continue
            duration = times[-1] - times[0]
            if duration <= timedelta(0):
                continue
            seconds = int(duration.total_seconds())
            longest = seconds if longest is None else max(longest, seconds)
        return {
            "beers": sum(len(evening_beer_times.get(ekey, ())) for ekey, _ in selected),
            "evenings": len(selected),
            "distinct_pubs": len(selected_pub_keys),
            "longest_evening_seconds": longest,
        }

    return {
        "days": list(day_rows.values()),
        "weeks": list(week_rows.values()),
        "months": list(month_rows.values()),
        "streak": {
            "current_weeks": current_streak,
            "best_weeks": best_streak,
        },
        "windows": {
            "week": window_summary(today - timedelta(days=6)),
            "month": window_summary(today - timedelta(days=29)),
            "year": window_summary(month_starts[0]),
        },
    }


def _night_records_payload(
    *,
    night_times: OrderedDict[date, list[datetime]],
    night_beer_times: OrderedDict[date, list[datetime]],
    night_pub_keys: dict[date, set[str]],
    night_pub_names: dict[date, dict[str, str]],
    exclude_drinking_day: date | None,
) -> dict:
    """Personal bests over whole 04:00 drinking days, never per pub sitting."""

    most_beers = 0
    longest_seconds = 0
    most_stops = 0
    most_beers_day: date | None = None
    longest_day: date | None = None
    for day, times in night_times.items():
        if day == exclude_drinking_day:
            continue
        beer_count = len(night_beer_times.get(day, ()))
        if beer_count > most_beers or (
            beer_count == most_beers and beer_count > 0 and (most_beers_day is None or day > most_beers_day)
        ):
            most_beers = beer_count
            most_beers_day = day
        most_stops = max(most_stops, len(night_pub_keys.get(day, ())))
        if len(times) >= 2:
            duration = max(0, int((times[-1] - times[0]).total_seconds()))
            if duration > longest_seconds or (
                duration == longest_seconds
                and duration > 0
                and (longest_day is None or day > longest_day)
            ):
                longest_seconds = duration
                longest_day = day

    def names_for(day: date | None) -> list[str]:
        if day is None:
            return []
        return list(dict.fromkeys(night_pub_names.get(day, {}).values()))

    return {
        "most_beers": most_beers,
        "longest_seconds": longest_seconds,
        "most_stops": most_stops,
        "most_beers_date": most_beers_day.isoformat() if most_beers_day else None,
        "most_beers_pub_names": names_for(most_beers_day),
        "longest_date": longest_day.isoformat() if longest_day else None,
        "longest_pub_names": names_for(longest_day),
    }


def compute_my_stats(
    account: Account,
    *,
    timezone_name: str | None = None,
    exclude_drinking_day: date | None = None,
) -> dict:
    """Aggregate ``account``'s drinks into the ``/v1/me/stats`` payload.

    Pure and read-only. Streams the supported product-history window ascending
    by ``drank_at`` — covered by the ``(account, drank_at)`` index — and folds it
    in Python so the rules stay aligned with the device model. The explicit
    calendar-year horizon bounds detailed period/record work without affecting
    any real Na Pivo diary. ``timezone_name`` affects drinking-day and period
    buckets without changing the wire shape for older clients. Returns the empty
    payload (200, never 404) when the account has logged nothing.
    """

    resolved_timezone_name, stats_tz = resolve_stats_timezone(timezone_name)
    history_years = max(1, min(int(settings.STATS_HISTORY_YEARS), 50))
    today = datetime.now(stats_tz).date()
    history_start = datetime.combine(
        date(max(1, today.year - history_years + 1), 1, 1),
        time(hour=4),
        tzinfo=stats_tz,
    ).astimezone(UTC)
    max_drink_rows = max(1, min(int(settings.STATS_MAX_DRINK_ROWS), 500_000))
    recent_drink_ids = (
        account.drinks.filter(drank_at__gte=history_start)
        .order_by("-drank_at", "-id")
        .values("id")[:max_drink_rows]
    )
    drinks = (
        account.drinks.filter(id__in=Subquery(recent_drink_ids))
        .only(
            "cache_key",
            "name",
            "price_czk",
            "drink_type",
            "drank_at",
        )
        .order_by("drank_at", "id")
    )

    # Fold the ascending drinks into evenings (cache_key, drinking_day) and
    # per-pub tallies. Insertion order = ascending drank_at, so within each
    # bucket the last appended drink is the most recent one.
    evening_times: OrderedDict[tuple[str | None, date], list[datetime]] = OrderedDict()
    evening_beer_times: OrderedDict[tuple[str | None, date], list[datetime]] = OrderedDict()
    evening_name: dict[tuple[str | None, date], str | None] = {}
    night_times: OrderedDict[date, list[datetime]] = OrderedDict()
    night_beer_times: OrderedDict[date, list[datetime]] = OrderedDict()
    night_pub_keys: dict[date, set[str]] = {}
    night_pub_names: dict[date, dict[str, str]] = {}
    pubs: OrderedDict[str, dict] = OrderedDict()
    months: OrderedDict[str, dict] = OrderedDict()
    years: OrderedDict[str, dict] = OrderedDict()

    total_spent = 0
    total_beers = 0
    first_drink_at: datetime | None = None
    for drink in drinks.iterator(chunk_size=1_000):
        at = _as_utc(drink.drank_at)
        if first_drink_at is None:
            first_drink_at = at
        total_spent += drink.price_czk or 0
        is_beer = drink.drink_type == DrinkLog.DrinkType.BEER
        if is_beer:
            total_beers += 1

        day = drinking_day(drink.drank_at, stats_tz)
        ekey = (drink.cache_key, day)
        evening_times.setdefault(ekey, []).append(at)
        night_times.setdefault(day, []).append(at)
        if is_beer:
            evening_beer_times.setdefault(ekey, []).append(at)
            night_beer_times.setdefault(day, []).append(at)
        if drink.cache_key is not None:
            night_pub_keys.setdefault(day, set()).add(drink.cache_key)
            # Dict order follows the first stop; assigning the latest observed
            # name updates spelling without changing the crawl order.
            night_pub_names.setdefault(day, {})[drink.cache_key] = drink.name
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

    if first_drink_at is None:
        payload = _empty_payload()
        payload["periods"]["timezone"] = resolved_timezone_name
        payload["timeline"] = _timeline_payload(
            evening_times=OrderedDict(),
            evening_beer_times=OrderedDict(),
            stats_tz=stats_tz,
        )
        payload["night_records"] = _night_records_payload(
            night_times=night_times,
            night_beer_times=night_beer_times,
            night_pub_keys=night_pub_keys,
            night_pub_names=night_pub_names,
            exclude_drinking_day=exclude_drinking_day,
        )
        payload["night_timeline"] = _timeline_payload(
            evening_times=OrderedDict(),
            evening_beer_times=OrderedDict(),
            stats_tz=stats_tz,
            pub_keys_by_evening={},
        )
        return payload

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
    longest_key: tuple[str | None, date] | None = None
    longest_newest: datetime | None = None

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

    for ekey, times in evening_times.items():
        if len(times) >= 2:
            # Mirror the app: only a positive span counts as a "longest evening".
            duration = times[-1] - times[0]
            newest = times[-1]
            if duration > timedelta(0) and (
                longest_duration is None
                or duration > longest_duration
                or (
                    duration == longest_duration
                    and longest_newest is not None
                    and newest > longest_newest
                )
            ):
                longest_duration = duration
                longest_key = ekey
                longest_newest = newest

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
        "longest_evening_pub_name": (
            evening_name[longest_key] if longest_key is not None else None
        ),
        "longest_evening_date": (
            longest_key[1].isoformat() if longest_key is not None else None
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
    timeline = _timeline_payload(
        evening_times=evening_times,
        evening_beer_times=evening_beer_times,
        stats_tz=stats_tz,
    )
    # Adapt one drinking day to the existing fixed-width timeline fold. The
    # synthetic key is only an internal grouping identity; the explicit map
    # supplies all pubs visited during that crawl.
    night_timeline_times = OrderedDict(
        ((None, day), times) for day, times in night_times.items()
    )
    night_timeline_beer_times = OrderedDict(
        ((None, day), times) for day, times in night_beer_times.items()
    )
    night_timeline_pub_keys = {
        (None, day): keys for day, keys in night_pub_keys.items()
    }
    night_timeline = _timeline_payload(
        evening_times=night_timeline_times,
        evening_beer_times=night_timeline_beer_times,
        stats_tz=stats_tz,
        pub_keys_by_evening=night_timeline_pub_keys,
    )
    night_records = _night_records_payload(
        night_times=night_times,
        night_beer_times=night_beer_times,
        night_pub_keys=night_pub_keys,
        night_pub_names=night_pub_names,
        exclude_drinking_day=exclude_drinking_day,
    )

    return {
        "total_beers": total_beers,
        "total_evenings": len(evening_times),
        "total_nights": len(night_times),
        "distinct_pubs": len(pubs),
        "total_spent_czk": total_spent,
        "first_drink_at": first_drink_at.isoformat(),
        "top_pubs": top_pubs_payload,
        "records": records,
        "night_records": night_records,
        "periods": periods,
        "timeline": timeline,
        "night_timeline": night_timeline,
    }

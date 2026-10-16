"""Prague public transport (PID GTFS): the daily import and "last direct ride home".

The import keeps a compact copy of the timetable. Trips that stop at the same
stops in the same order share one pattern, so the server stores about 8k
patterns and one row per trip with its departure times instead of 1.8M
stop_times rows. Service days are expanded only around the import day.

Night lines (routes.txt is_night=1) are left out. Prague night trams run until
the morning service starts, so with them "the last ride home" would always be a
night tram just before 04:00 instead of the last regular ride.

The home side of a query arrives as stop ids the app picked near home on the
phone. They are hashed into cache keys and never logged or stored.
"""

from __future__ import annotations

import bisect
import csv
import hashlib
import io
import math
import sys
import zipfile
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from pubs.enrichment.matcher import _haversine_m
from pubs.models import (
    TransitFeed,
    TransitPatternStop,
    TransitServiceDate,
    TransitStop,
    TransitTrip,
)

PRAGUE_TZ = ZoneInfo("Europe/Prague")
# A pub night ends at this local hour; from then on "tonight" is the next night.
NIGHT_END_HOUR = 4
# How far from the pub a boarding stop may be.
BOARDING_RADIUS_M = 500
# Service days expanded around the import day. A query reads the two days before
# its night as well, because a GTFS day runs past midnight.
WINDOW_DAYS_BEFORE = 2
WINDOW_DAYS_AFTER = 8
LAST_DIRECT_CACHE_TTL = 60 * 60
STOPS_CACHE_TTL = 24 * 60 * 60
_BATCH = 5000
_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


class GtfsError(Exception):
    """The feed lacks a required file or column, or a value cannot be read."""


@dataclass(frozen=True)
class ImportResult:
    feed: TransitFeed
    stops: int
    patterns: int
    pattern_stops: int
    trips: int
    service_dates: int
    skipped_trips: int


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def _cell(row: list[str], index: int | None) -> str:
    if index is None or index >= len(row):
        return ""
    return row[index].strip()


def _open_csv(
    zf: zipfile.ZipFile, name: str, required: tuple[str, ...], *, optional: bool = False
) -> tuple[Iterator[list[str]], dict[str, int]] | None:
    try:
        raw = zf.open(name)
    except KeyError:
        if optional:
            return None
        raise GtfsError(f"{name} is missing") from None
    reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
    header = next(reader, None)
    if not header:
        raise GtfsError(f"{name} is empty")
    columns = {column.strip(): index for index, column in enumerate(header)}
    missing = [column for column in required if column not in columns]
    if missing:
        raise GtfsError(f"{name} lacks column(s): {', '.join(missing)}")
    return reader, columns


def _date(value: str, where: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError:
        raise GtfsError(f"{where}: bad date {value!r}") from None


def _seconds(value: str, where: str) -> int:
    """GTFS H:MM:SS after the service day start, -1 when empty. Can exceed 24 h."""

    if not value:
        return -1
    try:
        hours, minutes, seconds = (int(part) for part in value.split(":"))
    except ValueError:
        raise GtfsError(f"{where}: bad time {value!r}") from None
    return hours * 3600 + minutes * 60 + seconds


def _service_dates(zf: zipfile.ZipFile, first: date, last: date) -> dict[str, set[date]]:
    calendar = _open_csv(
        zf, "calendar.txt", ("service_id", *_WEEKDAYS, "start_date", "end_date"), optional=True
    )
    exceptions = _open_csv(
        zf, "calendar_dates.txt", ("service_id", "date", "exception_type"), optional=True
    )
    if calendar is None and exceptions is None:
        raise GtfsError("calendar.txt and calendar_dates.txt are both missing")

    days: dict[str, set[date]] = defaultdict(set)
    if calendar is not None:
        reader, col = calendar
        for line, row in enumerate(reader, start=2):
            if not row:
                continue
            where = f"calendar.txt line {line}"
            day = max(first, _date(_cell(row, col["start_date"]), where))
            end = min(last, _date(_cell(row, col["end_date"]), where))
            while day <= end:
                if _cell(row, col[_WEEKDAYS[day.weekday()]]) == "1":
                    days[_cell(row, col["service_id"])].add(day)
                day += timedelta(days=1)
    if exceptions is not None:
        reader, col = exceptions
        for line, row in enumerate(reader, start=2):
            if not row:
                continue
            where = f"calendar_dates.txt line {line}"
            day = _date(_cell(row, col["date"]), where)
            if not first <= day <= last:
                continue
            service_id = _cell(row, col["service_id"])
            kind = _cell(row, col["exception_type"])
            if kind == "1":
                days[service_id].add(day)
            elif kind == "2":
                days[service_id].discard(day)
            else:
                raise GtfsError(f"{where}: bad exception_type {kind!r}")
    return {service_id: dates for service_id, dates in days.items() if dates}


def _stops(zf: zipfile.ZipFile) -> dict[str, tuple[str, float, float]]:
    reader, col = _open_csv(zf, "stops.txt", ("stop_id", "stop_name", "stop_lat", "stop_lon"))
    stops = {}
    for line, row in enumerate(reader, start=2):
        if not row or _cell(row, col.get("location_type")) not in ("", "0"):
            continue
        try:
            lat = float(_cell(row, col["stop_lat"]))
            lng = float(_cell(row, col["stop_lon"]))
        except ValueError:
            raise GtfsError(f"stops.txt line {line}: bad coordinates") from None
        stops[_cell(row, col["stop_id"])] = (_cell(row, col["stop_name"]), lat, lng)
    return stops


def _routes(zf: zipfile.ZipFile) -> dict[str, tuple[str, int]]:
    """Day routes by id; night lines are skipped (see the module docstring)."""

    reader, col = _open_csv(zf, "routes.txt", ("route_id", "route_type"))
    routes = {}
    for line, row in enumerate(reader, start=2):
        if not row or _cell(row, col.get("is_night")) == "1":
            continue
        try:
            route_type = int(_cell(row, col["route_type"]))
        except ValueError:
            raise GtfsError(f"routes.txt line {line}: bad route_type") from None
        name = _cell(row, col.get("route_short_name")) or _cell(row, col.get("route_long_name"))
        routes[_cell(row, col["route_id"])] = (name[:32], route_type)
    return routes


def _feed_dates(zf: zipfile.ZipFile) -> tuple[date | None, date | None]:
    opened = _open_csv(zf, "feed_info.txt", (), optional=True)
    if opened is None:
        return None, None
    reader, col = opened
    row = next(reader, None) or []
    start = _cell(row, col.get("feed_start_date"))
    end = _cell(row, col.get("feed_end_date"))
    return (
        _date(start, "feed_info.txt") if start else None,
        _date(end, "feed_info.txt") if end else None,
    )


def _trip_stop_times(zf: zipfile.ZipFile) -> Iterator[tuple[str, list[tuple]]]:
    """Yield each trip's (sequence, stop_id, can_board, can_alight, seconds) rows.

    The file is read once, row by row. A trip has to be one consecutive block;
    otherwise its pattern would silently split in two, so the import fails.
    """

    reader, col = _open_csv(
        zf, "stop_times.txt", ("trip_id", "stop_id", "stop_sequence", "departure_time")
    )
    trip_i, stop_i, seq_i = col["trip_id"], col["stop_id"], col["stop_sequence"]
    dep_i, arr_i = col["departure_time"], col.get("arrival_time")
    pickup_i, drop_i = col.get("pickup_type"), col.get("drop_off_type")
    seen: set[str] = set()
    current: str | None = None
    rows: list[tuple] = []
    for line, row in enumerate(reader, start=2):
        if not row:
            continue
        trip_id = _cell(row, trip_i)
        if trip_id != current:
            if current is not None:
                yield current, rows
            if trip_id in seen:
                raise GtfsError(
                    f"stop_times.txt line {line}: trip {trip_id} is split into several blocks"
                )
            seen.add(trip_id)
            current, rows = trip_id, []
        where = f"stop_times.txt line {line}"
        try:
            sequence = int(_cell(row, seq_i))
        except ValueError:
            raise GtfsError(f"{where}: bad stop_sequence") from None
        seconds = _seconds(_cell(row, dep_i) or _cell(row, arr_i), where)
        rows.append(
            (
                sequence,
                sys.intern(_cell(row, stop_i)),
                _cell(row, pickup_i) != "1",
                _cell(row, drop_i) != "1",
                seconds,
            )
        )
    if current is not None:
        yield current, rows


def import_feed(
    path: str,
    *,
    source: str,
    sha256: str,
    etag: str = "",
    last_modified: str = "",
    now: datetime | None = None,
) -> ImportResult:
    """Build a feed from a GTFS zip and make it the only one, in one transaction."""

    now = now or timezone.now()
    today = timezone.localtime(now, PRAGUE_TZ).date()
    first = today - timedelta(days=WINDOW_DAYS_BEFORE)
    last = today + timedelta(days=WINDOW_DAYS_AFTER)
    try:
        zf = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise GtfsError(f"cannot open the zip: {exc}") from None

    with zf:
        services = _service_dates(zf, first, last)
        stops = _stops(zf)
        routes = _routes(zf)
        feed_start, feed_end = _feed_dates(zf)

        reader, col = _open_csv(zf, "trips.txt", ("route_id", "service_id", "trip_id"))
        trips: dict[str, tuple[str, int, str, str]] = {}
        skipped = 0
        for row in reader:
            if not row:
                continue
            route = routes.get(_cell(row, col["route_id"]))
            service_id = _cell(row, col["service_id"])
            if route is None or service_id not in services:
                skipped += 1
                continue
            # Interned: thousands of trips share each headsign and service id.
            headsign = sys.intern(_cell(row, col.get("trip_headsign"))[:255])
            trips[_cell(row, col["trip_id"])] = (route[0], route[1], headsign, sys.intern(service_id))

        with transaction.atomic():
            feed = TransitFeed.objects.create(
                source=source[:500],
                sha256=sha256,
                version=f"{today:%Y%m%d}-{sha256[:12]}",
                etag=etag[:255],
                last_modified=last_modified[:64],
                feed_start=feed_start,
                feed_end=feed_end,
                window_start=first,
                window_end=last,
                imported_at=now,
                checked_at=now,
                active=False,
            )
            patterns: dict[tuple, int] = {}
            used_stops: set[str] = set()
            used_services: set[str] = set()
            pattern_rows: list[TransitPatternStop] = []
            trip_rows: list[TransitTrip] = []
            pattern_stop_count = trip_count = 0

            for trip_id, stop_rows in _trip_stop_times(zf):
                info = trips.get(trip_id)
                if info is None:
                    continue
                stop_rows.sort()
                key = tuple((stop_id, board, alight) for _, stop_id, board, alight, _ in stop_rows)
                pattern = patterns.get(key)
                if pattern is None:
                    pattern = patterns[key] = len(patterns)
                    for idx, (stop_id, board, alight) in enumerate(key):
                        pattern_rows.append(
                            TransitPatternStop(
                                feed=feed,
                                pattern=pattern,
                                idx=idx,
                                stop_id=stop_id,
                                can_board=board,
                                can_alight=alight,
                            )
                        )
                        used_stops.add(stop_id)
                line, route_type, headsign, service_id = info
                used_services.add(service_id)
                trip_rows.append(
                    TransitTrip(
                        feed=feed,
                        pattern=pattern,
                        route_short_name=line,
                        route_type=route_type,
                        headsign=headsign,
                        service_id=service_id,
                        departures=[row[4] for row in stop_rows],
                    )
                )
                if len(pattern_rows) >= _BATCH:
                    pattern_stop_count += len(TransitPatternStop.objects.bulk_create(pattern_rows))
                    pattern_rows = []
                if len(trip_rows) >= _BATCH:
                    trip_count += len(TransitTrip.objects.bulk_create(trip_rows))
                    trip_rows = []
            pattern_stop_count += len(TransitPatternStop.objects.bulk_create(pattern_rows))
            trip_count += len(TransitTrip.objects.bulk_create(trip_rows))
            skipped += len(trips) - trip_count
            if not trip_count:
                raise GtfsError("no trip runs in the import window")
            # A trip through a stop stops.txt does not know is a broken feed;
            # keep yesterday's timetable rather than one without stops.
            unknown = used_stops - stops.keys()
            if unknown:
                raise GtfsError(f"stop_times.txt uses {len(unknown)} stops missing from stops.txt")

            service_rows = TransitServiceDate.objects.bulk_create(
                (
                    TransitServiceDate(feed=feed, service_id=service_id, date=day)
                    for service_id in sorted(used_services)
                    for day in sorted(services[service_id])
                ),
                batch_size=_BATCH,
            )
            # Every platform, not just those of the stored days: the app keeps
            # the list for weeks, longer than the import window.
            created_stops = TransitStop.objects.bulk_create(
                (
                    TransitStop(feed=feed, stop_id=stop_id, name=name[:255], lat=lat, lng=lng)
                    for stop_id, (name, lat, lng) in sorted(stops.items())
                ),
                batch_size=_BATCH,
            )

            # Child tables first, so each is one DELETE without loading rows.
            old = list(TransitFeed.objects.exclude(pk=feed.pk).values_list("pk", flat=True))
            for model in (TransitTrip, TransitPatternStop, TransitServiceDate, TransitStop):
                model.objects.filter(feed_id__in=old).delete()
            TransitFeed.objects.filter(pk__in=old).delete()
            feed.active = True
            feed.save(update_fields=["active"])

    return ImportResult(
        feed=feed,
        stops=len(created_stops),
        patterns=len(patterns),
        pattern_stops=pattern_stop_count,
        trips=trip_count,
        service_dates=len(service_rows),
        skipped_trips=skipped,
    )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def active_feed() -> TransitFeed | None:
    return TransitFeed.objects.filter(active=True).order_by("-imported_at").first()


def stops_payload(feed: TransitFeed) -> dict:
    """Every platform of the feed, the same body for everyone."""

    key = f"transit:stops:{feed.version}"
    payload = cache.get(key)
    if payload is None:
        stops = (
            TransitStop.objects.filter(feed=feed)
            .order_by("stop_id")
            .values_list("stop_id", "lat", "lng")
        )
        payload = {
            "feed_version": feed.version,
            "stops": [[stop_id, round(lat, 5), round(lng, 5)] for stop_id, lat, lng in stops],
        }
        cache.set(key, payload, STOPS_CACHE_TTL)
    return payload


def night_end(now: datetime) -> datetime:
    """The next local 04:00 strictly after now."""

    local = timezone.localtime(now, PRAGUE_TZ)
    day = local.date() if local.hour < NIGHT_END_HOUR else local.date() + timedelta(days=1)
    return datetime.combine(day, time(NIGHT_END_HOUR), tzinfo=PRAGUE_TZ)


def feed_covers(feed: TransitFeed, end: datetime) -> bool:
    """Whether every service day a query ending at ``end`` reads was imported."""

    return feed.window_start <= end.date() - timedelta(days=2) and end.date() <= feed.window_end


def _service_day_start(day: date) -> datetime:
    # GTFS times count from noon minus 12 h, which differs from midnight on DST days.
    return datetime.combine(day, time(12), tzinfo=PRAGUE_TZ).astimezone(UTC) - timedelta(hours=12)


def _stops_near(feed: TransitFeed, lat: float, lng: float) -> dict[str, tuple[float, str]]:
    dlat = BOARDING_RADIUS_M / 111_320
    dlng = BOARDING_RADIUS_M / (111_320 * max(math.cos(math.radians(lat)), 0.01))
    rows = TransitStop.objects.filter(
        feed=feed,
        lat__range=(lat - dlat, lat + dlat),
        lng__range=(lng - dlng, lng + dlng),
    ).values_list("stop_id", "name", "lat", "lng")
    near = {}
    for stop_id, name, stop_lat, stop_lng in rows:
        distance = _haversine_m(lat, lng, stop_lat, stop_lng)
        if distance <= BOARDING_RADIUS_M:
            near[stop_id] = (distance, name)
    return near


def _best_connection(
    feed: TransitFeed, lat: float, lng: float, home_ids: set[str], end: datetime
) -> dict | None:
    # Already standing at a home stop is not a ride home.
    near = {stop_id: v for stop_id, v in _stops_near(feed, lat, lng).items() if stop_id not in home_ids}
    if not near:
        return None

    boards: dict[int, list[tuple[int, str]]] = defaultdict(list)
    exits: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for pattern, idx, stop_id, can_board, can_alight in TransitPatternStop.objects.filter(
        Q(stop_id__in=list(near), can_board=True) | Q(stop_id__in=list(home_ids), can_alight=True),
        feed=feed,
    ).values_list("pattern", "idx", "stop_id", "can_board", "can_alight"):
        if can_board and stop_id in near:
            boards[pattern].append((idx, stop_id))
        if can_alight and stop_id in home_ids:
            exits[pattern].append((idx, stop_id))

    # Per pattern: board at i, get off at the first home stop after it.
    rides: dict[int, list[tuple[int, str, str]]] = {}
    for pattern, entries in boards.items():
        pattern_exits = sorted(exits.get(pattern, ()))
        exit_idx = [idx for idx, _ in pattern_exits]
        for idx, from_stop in entries:
            k = bisect.bisect_right(exit_idx, idx)
            if k < len(pattern_exits):
                rides.setdefault(pattern, []).append((idx, from_stop, pattern_exits[k][1]))
    if not rides:
        return None

    first_day = end.date() - timedelta(days=2)
    service_days = TransitServiceDate.objects.filter(feed=feed, date__range=(first_day, end.date()))
    days_by_service: dict[str, list[datetime]] = defaultdict(list)
    for service_id, day in service_days.values_list("service_id", "date"):
        days_by_service[service_id].append(_service_day_start(day))

    best = None
    best_key = None
    trips = TransitTrip.objects.filter(
        feed=feed, pattern__in=list(rides), service_id__in=service_days.values("service_id")
    ).values_list("pattern", "route_short_name", "route_type", "headsign", "service_id", "departures")
    for pattern, line, route_type, headsign, service_id, departures in trips:
        for day_start in days_by_service.get(service_id, ()):
            for idx, from_stop, to_stop in rides[pattern]:
                seconds = departures[idx] if idx < len(departures) else -1
                if seconds < 0:
                    continue
                departs_at = day_start + timedelta(seconds=seconds)
                if departs_at > end:
                    continue
                distance = near[from_stop][0]
                key = (-departs_at.timestamp(), distance, line, headsign, from_stop, to_stop)
                if best_key is None or key < best_key:
                    best_key = key
                    best = {
                        "line": line,
                        "headsign": headsign,
                        "route_type": route_type,
                        "from_stop_id": from_stop,
                        "from_stop_name": near[from_stop][1],
                        "to_stop_id": to_stop,
                        "departs_at": departs_at,
                    }
    if best is not None:
        name = (
            TransitStop.objects.filter(feed=feed, stop_id=best["to_stop_id"])
            .values_list("name", flat=True)
            .first()
        )
        best["to_stop_name"] = name or ""
    return best


def last_direct(
    feed: TransitFeed, lat: float, lng: float, home_ids: list[str], now: datetime
) -> dict | None:
    """The last direct ride tonight from near the point to a home stop, if not gone yet."""

    lat, lng = round(lat, 4), round(lng, 4)
    end = night_end(now)
    ids = sorted(set(home_ids))
    raw = "|".join((feed.version, f"{lat:.4f}", f"{lng:.4f}", ",".join(ids), end.isoformat()))
    key = "transit:last-direct:" + hashlib.sha256(raw.encode()).hexdigest()
    cached = cache.get(key)
    if cached is None:
        cached = {"best": _best_connection(feed, lat, lng, set(ids), end)}
        cache.set(key, cached, LAST_DIRECT_CACHE_TTL)
    best = cached["best"]
    if best is None or best["departs_at"] < now:
        return None
    return {**best, "departs_at": timezone.localtime(best["departs_at"], PRAGUE_TZ).isoformat()}

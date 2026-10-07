from __future__ import annotations

import uuid
import zipfile
from datetime import datetime, timedelta
from io import StringIO
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.management import CommandError, call_command
from rest_framework import status
from rest_framework.test import APIClient

from pubs import transit
from pubs.models import (
    TransitFeed,
    TransitPatternStop,
    TransitServiceDate,
    TransitStop,
    TransitTrip,
)

PRAGUE = ZoneInfo("Europe/Prague")
# Wednesday morning: the import day. Its window is 5. – 15. 10. 2026.
IMPORTED = datetime(2026, 10, 7, 9, 0, tzinfo=PRAGUE)
STOPS_URL = "/v1/transit/stops"
LAST_URL = "/v1/transit/last-direct"
# The pub. PUB1 is ~13 m away, PUB2 ~200 m, FAR ~600 m.
FROM = (50.0001, 14.0001)
STOPS = {
    "PUB1": ("U Pubu", 50.0, 14.0),
    "PUB2": ("Druhá zastávka", 50.0018, 14.0),
    "FAR": ("Daleko", 50.0054, 14.0),
    "MID": ("Mezi", 50.05, 14.05),
    "HOME1": ("Domov", 50.1, 14.1),
    "HOME2": ("Domov 2", 50.1005, 14.1),
    "UNUSED": ("Nikdo", 49.0, 13.0),
}
HOME = "HOME1,HOME2"


def _csv(header: str, rows: list[str]) -> str:
    return "\n".join([header, *rows]) + "\n"


def _trip(trip_id, departs, *, service="WK", stops=("PUB1", "MID", "HOME1"), route="R9",
          pickup=None, drop=None, headsign="Domov"):
    """A trip whose first stop departs at ``departs``; later stops 5 min apart."""

    hours, minutes, _ = (int(part) for part in departs.split(":"))
    start = hours * 3600 + minutes * 60
    times = []
    for index, stop_id in enumerate(stops):
        seconds = start + index * 300
        clock = f"{seconds // 3600:02}:{seconds % 3600 // 60:02}:00"
        times.append(
            (stop_id, clock, (pickup or {}).get(stop_id, "0"), (drop or {}).get(stop_id, "0"))
        )
    return (trip_id, route, service, headsign, times)


def _gtfs(path, trips, *, calendar=None, calendar_dates=(), stop_times_rows=None):
    calendar = calendar or ["WK,1,1,1,1,1,1,1,20261001,20261031"]
    stop_times = []
    for trip_id, _, _, _, times in trips:
        for seq, (stop_id, clock, pickup, drop) in enumerate(times, start=1):
            stop_times.append(f"{trip_id},{clock},{clock},{stop_id},{seq},{pickup},{drop}")
    files = {
        "agency.txt": _csv("agency_id,agency_name,agency_url,agency_timezone", ["99,PID,https://pid.cz,Europe/Prague"]),
        "feed_info.txt": _csv("feed_publisher_name,feed_start_date,feed_end_date", ["ROPID,20261007,20261020"]),
        "stops.txt": _csv(
            "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
            [f'{sid},"{name}",{lat},{lng},0,' for sid, (name, lat, lng) in STOPS.items()]
            + ["STATION,Stanice,50.0,14.0,1,"],
        ),
        "routes.txt": _csv(
            "route_id,agency_id,route_short_name,route_long_name,route_type,is_night",
            ["R9,99,9,Tramvaj,0,0", "R136,99,136,Autobus,3,0", "R98,99,98,Noční tramvaj,0,1"],
        ),
        "trips.txt": _csv(
            "route_id,service_id,trip_id,trip_headsign",
            [f"{route},{service},{trip_id},{headsign}" for trip_id, route, service, headsign, _ in trips],
        ),
        "stop_times.txt": _csv(
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type",
            stop_times_rows if stop_times_rows is not None else stop_times,
        ),
        "calendar.txt": _csv(
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
            calendar,
        ),
        "calendar_dates.txt": _csv("service_id,date,exception_type", list(calendar_dates)),
    }
    with zipfile.ZipFile(path, "w") as zf:
        for name, body in files.items():
            zf.writestr(name, body)
    return str(path)


def _import(tmp_path, trips, name="feed.zip", **kwargs):
    path = _gtfs(tmp_path / name, trips, **kwargs)
    return transit.import_feed(path, source="test", sha256=uuid.uuid4().hex * 2, now=IMPORTED).feed


def _last(feed, now, home=HOME):
    return transit.last_direct(feed, *FROM, home.split(","), now)


def _at(day, hour, minute=0):
    return datetime(2026, 10, day, hour, minute, tzinfo=PRAGUE)


# ---------------------------------------------------------------------------
# Which connection is the last one
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_after_midnight_the_last_ride_can_be_a_24h_time_of_the_previous_service_day(tmp_path):
    feed = _import(tmp_path, [_trip("late", "24:40:00"), _trip("evening", "23:00:00")])

    departure = _last(feed, _at(8, 0, 10))

    assert departure == {
        "line": "9",
        "headsign": "Domov",
        "route_type": 0,
        "from_stop_id": "PUB1",
        "from_stop_name": "U Pubu",
        "to_stop_id": "HOME1",
        "to_stop_name": "Domov",
        "departs_at": "2026-10-08T00:40:00+02:00",
    }


@pytest.mark.django_db
def test_an_early_morning_trip_of_the_next_service_day_counts(tmp_path):
    feed = _import(tmp_path, [_trip("before", "23:50:00"), _trip("after", "01:15:00")])

    assert _last(feed, _at(7, 23, 30))["departs_at"] == "2026-10-08T01:15:00+02:00"


@pytest.mark.django_db
def test_night_lines_do_not_count_as_the_last_ride(tmp_path):
    feed = _import(tmp_path, [_trip("day", "00:20:00"), _trip("night", "03:30:00", route="R98")])

    assert _last(feed, _at(7, 23, 0))["departs_at"] == "2026-10-08T00:20:00+02:00"
    assert not TransitTrip.objects.filter(route_short_name="98").exists()


@pytest.mark.django_db
def test_departures_after_the_04_00_night_end_are_left_out(tmp_path):
    feed = _import(tmp_path, [_trip("edge", "04:00:00"), _trip("morning", "04:01:00")])

    assert _last(feed, _at(7, 23, 30))["departs_at"] == "2026-10-08T04:00:00+02:00"
    # From 04:00 on, tonight is the next night.
    assert transit.night_end(_at(8, 3, 59)) == _at(8, 4)
    assert transit.night_end(_at(8, 4)) == _at(9, 4)


@pytest.mark.django_db
def test_calendar_dates_add_and_remove_service_days(tmp_path):
    feed = _import(
        tmp_path,
        [
            _trip("removed", "23:58:00", service="GONE"),
            _trip("added", "23:55:00", service="EXTRA"),
            _trip("regular", "23:40:00"),
        ],
        calendar=[
            "WK,1,1,1,1,1,1,1,20261001,20261031",
            "GONE,1,1,1,1,1,1,1,20261001,20261031",
            "EXTRA,0,0,0,0,0,0,0,20261001,20261031",
        ],
        calendar_dates=["GONE,20261007,2", "EXTRA,20261007,1"],
    )

    assert _last(feed, _at(7, 23, 30))["departs_at"] == "2026-10-07T23:55:00+02:00"
    assert set(
        TransitServiceDate.objects.filter(service_id="EXTRA").values_list("date", flat=True)
    ) == {_at(7, 0).date()}


@pytest.mark.django_db
def test_a_trip_that_passes_home_before_the_pub_is_not_a_ride_home(tmp_path):
    feed = _import(
        tmp_path,
        [
            _trip("wrong-way", "23:59:00", stops=("HOME1", "MID", "PUB1")),
            _trip("right-way", "23:40:00", stops=("PUB1", "MID", "HOME2")),
        ],
    )

    departure = _last(feed, _at(7, 23, 30))

    assert departure["departs_at"] == "2026-10-07T23:40:00+02:00"
    assert departure["to_stop_id"] == "HOME2"


@pytest.mark.django_db
def test_no_boarding_and_no_alighting_stops_are_respected(tmp_path):
    feed = _import(
        tmp_path,
        [
            _trip("no-boarding", "23:59:00", pickup={"PUB1": "1"}),
            _trip("no-alighting", "23:58:00", drop={"HOME1": "1"}),
            # Request stops (3) still let people on and off.
            _trip("request-stop", "23:45:00", pickup={"PUB1": "3"}, drop={"HOME1": "3"}),
        ],
    )

    assert _last(feed, _at(7, 23, 30))["departs_at"] == "2026-10-07T23:45:00+02:00"


@pytest.mark.django_db
def test_stops_further_than_500_m_are_not_boarding_stops_and_closer_wins_ties(tmp_path):
    feed = _import(
        tmp_path,
        [
            _trip("far", "23:59:00", stops=("FAR", "HOME1")),
            _trip("second", "23:50:00", stops=("PUB2", "HOME1"), route="R136"),
            _trip("closest", "23:50:00", stops=("PUB1", "HOME1")),
        ],
    )

    departure = _last(feed, _at(7, 23, 30))

    assert departure["from_stop_id"] == "PUB1"
    assert departure["departs_at"] == "2026-10-07T23:50:00+02:00"


@pytest.mark.django_db
def test_a_departed_last_ride_is_null(tmp_path):
    feed = _import(tmp_path, [_trip("gone", "23:20:00")])

    assert _last(feed, _at(7, 23, 30)) is None


@pytest.mark.django_db
def test_a_cached_answer_never_returns_a_ride_that_already_left(tmp_path):
    feed = _import(tmp_path, [_trip("last", "23:40:00")])
    assert _last(feed, _at(7, 23, 30))["departs_at"] == "2026-10-07T23:40:00+02:00"

    # The answer is cached for the night, so the timetable is not read again...
    TransitTrip.objects.all().delete()
    assert _last(feed, _at(7, 23, 35))["departs_at"] == "2026-10-07T23:40:00+02:00"
    # ...but it is still checked against the clock.
    assert _last(feed, _at(7, 23, 45)) is None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return APIClient()


def _token(client: APIClient) -> str:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _get(client, token, url, now=None, **params):
    with mock.patch("pubs.api.transit_views.timezone.now", return_value=now or _at(7, 23, 30)):
        return client.get(url, params, HTTP_AUTHORIZATION=f"Bearer {token}")


def _query(**overrides):
    return {"from_lat": FROM[0], "from_lng": FROM[1], "to_stop_ids": HOME, **overrides}


@pytest.mark.django_db
def test_endpoints_require_an_account_token(client):
    assert client.get(STOPS_URL).status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get(LAST_URL, _query()).status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_endpoints_answer_503_without_a_timetable(client):
    token = _token(client)

    for url, params in ((STOPS_URL, {}), (LAST_URL, _query())):
        resp = _get(client, token, url, **params)
        assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert resp.json() == {"detail": "transit_unavailable"}


@pytest.mark.django_db
def test_last_direct_answers_503_when_the_timetable_does_not_cover_tonight(client, tmp_path):
    _import(tmp_path, [_trip("last", "23:40:00")])
    token = _token(client)

    resp = _get(client, token, LAST_URL, now=_at(20, 22), **_query())

    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides",
    [
        {"from_lat": "91"},
        {"from_lng": "-181"},
        {"from_lat": "pivo"},
        {"to_stop_ids": ""},
        {"to_stop_ids": " , ,"},
        {"to_stop_ids": "HOME1,DROP TABLE"},
        {"to_stop_ids": "X" * 33},
        {"to_stop_ids": ",".join(f"S{i}" for i in range(81))},
    ],
)
def test_last_direct_validates_the_query(client, tmp_path, overrides):
    _import(tmp_path, [_trip("last", "23:40:00")])
    token = _token(client)

    resp = _get(client, token, LAST_URL, **_query(**overrides))

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert set(resp.json()) <= {"from_lat", "from_lng", "to_stop_ids"}


@pytest.mark.django_db
def test_last_direct_response_shape(client, tmp_path):
    _import(tmp_path, [_trip("last", "23:40:00")])
    token = _token(client)

    # Duplicates and 80 unique ids are fine.
    ids = ",".join(["HOME1", "HOME1", *(f"S{i}" for i in range(79))])
    resp = _get(client, token, LAST_URL, **_query(to_stop_ids=ids))
    gone = _get(client, token, LAST_URL, now=_at(7, 23, 50), **_query())

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {
        "departure": {
            "line": "9",
            "headsign": "Domov",
            "route_type": 0,
            "from_stop_id": "PUB1",
            "from_stop_name": "U Pubu",
            "to_stop_id": "HOME1",
            "to_stop_name": "Domov",
            "departs_at": "2026-10-07T23:40:00+02:00",
        }
    }
    assert gone.status_code == status.HTTP_200_OK
    assert gone.json() == {"departure": None}


@pytest.mark.django_db
def test_stops_lists_every_stop_a_stored_trip_uses(client, tmp_path):
    feed = _import(
        tmp_path,
        [
            _trip("used", "23:40:00", stops=("PUB1", "HOME1")),
            # Runs only outside the import window, so it is not stored.
            _trip("outside", "23:40:00", stops=("FAR", "HOME2"), service="LATER"),
        ],
        calendar=["WK,1,1,1,1,1,1,1,20261001,20261031", "LATER,1,1,1,1,1,1,1,20261025,20261031"],
    )
    token = _token(client)

    resp = _get(client, token, STOPS_URL)

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {
        "feed_version": feed.version,
        "stops": [["HOME1", 50.1, 14.1], ["PUB1", 50.0, 14.0]],
    }


# ---------------------------------------------------------------------------
# Import command
# ---------------------------------------------------------------------------


def _run(*args, now=IMPORTED):
    out = StringIO()
    with mock.patch("pubs.management.commands.import_pid_gtfs.timezone.now", return_value=now):
        call_command("import_pid_gtfs", *args, stdout=out)
    return out.getvalue()


@pytest.mark.django_db
def test_import_command_swaps_in_the_new_feed_and_skips_inside_the_interval(tmp_path):
    first = _gtfs(tmp_path / "first.zip", [_trip("a", "23:40:00")])
    second = _gtfs(tmp_path / "second.zip", [_trip("b", "23:50:00", stops=("PUB2", "HOME2"))])

    assert "Imported PID GTFS" in _run("--source", first)
    old = TransitFeed.objects.get()
    # Inside the interval nothing happens, even with a new file.
    assert _run("--source", second, now=IMPORTED + timedelta(hours=19)) == ""
    assert TransitFeed.objects.get() == old

    assert "Imported PID GTFS" in _run("--source", second, now=IMPORTED + timedelta(hours=21))

    new = TransitFeed.objects.get()
    assert new.pk != old.pk and new.active
    for model in (TransitTrip, TransitPatternStop, TransitServiceDate, TransitStop):
        assert not model.objects.filter(feed_id=old.pk).exists()
    assert list(TransitStop.objects.values_list("stop_id", flat=True).order_by("stop_id")) == [
        "HOME2",
        "PUB2",
    ]
    assert list(TransitTrip.objects.values_list("departures", flat=True)) == [[85800, 86100]]


@pytest.mark.django_db
def test_import_command_keeps_an_unchanged_file_and_rebuilds_it_once_the_window_ages(tmp_path):
    path = _gtfs(tmp_path / "feed.zip", [_trip("a", "23:40:00")])
    _run("--source", path)
    feed = TransitFeed.objects.get()

    assert "unchanged" in _run("--source", path, now=IMPORTED + timedelta(days=1))
    feed.refresh_from_db()
    assert TransitFeed.objects.get() == feed
    assert feed.checked_at == IMPORTED + timedelta(days=1)

    assert "Imported" in _run("--source", path, now=IMPORTED + timedelta(days=4))
    assert TransitFeed.objects.get().window_end == (IMPORTED + timedelta(days=12)).date()


@pytest.mark.django_db
def test_a_feed_whose_trips_use_unknown_stops_keeps_the_old_timetable(tmp_path):
    old = _import(tmp_path, [_trip("ok", "23:00:00")])
    path = _gtfs(tmp_path / "broken.zip", [_trip("ghost", "23:00:00", stops=("PUB1", "NOWHERE", "HOME1"))])

    with pytest.raises(transit.GtfsError, match="missing from stops.txt"):
        transit.import_feed(path, source="test", sha256="b" * 64, now=IMPORTED)

    assert list(TransitFeed.objects.values_list("pk", "active")) == [(old.pk, True)]
    assert TransitStop.objects.filter(feed=old).count() > 0


@pytest.mark.django_db
def test_a_broken_feed_fails_loudly_and_leaves_the_old_one_active(tmp_path):
    _run("--source", _gtfs(tmp_path / "good.zip", [_trip("a", "23:40:00")]))
    good = TransitFeed.objects.get()
    split = _gtfs(
        tmp_path / "split.zip",
        [_trip("a", "23:40:00"), _trip("b", "23:50:00")],
        stop_times_rows=[
            "a,23:40:00,23:40:00,PUB1,1,0,0",
            "b,23:50:00,23:50:00,PUB1,1,0,0",
            "a,23:45:00,23:45:00,HOME1,2,0,0",
        ],
    )
    missing = tmp_path / "missing.zip"
    with zipfile.ZipFile(missing, "w") as zf:
        zf.writestr("stops.txt", "stop_id,stop_name,stop_lat,stop_lon\n")

    with pytest.raises(CommandError, match="split into several blocks"):
        _run("--source", split, "--force")
    with pytest.raises(CommandError, match="missing"):
        _run("--source", str(missing), "--force")

    assert TransitFeed.objects.get() == good
    assert TransitTrip.objects.filter(feed=good).count() == 1


class _NotModified:
    status_code = 304
    headers: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.mark.django_db
def test_a_304_only_marks_the_feed_checked(tmp_path):
    _run("--source", _gtfs(tmp_path / "feed.zip", [_trip("a", "23:40:00")]))
    TransitFeed.objects.update(etag='"abc"')
    later = IMPORTED + timedelta(days=1)

    with mock.patch(
        "pubs.management.commands.import_pid_gtfs.requests.get", return_value=_NotModified()
    ) as get:
        assert "304" in _run("--source", "https://example.test/PID_GTFS.zip", now=later)

    assert get.call_args.kwargs["headers"]["If-None-Match"] == '"abc"'
    assert TransitFeed.objects.get().checked_at == later

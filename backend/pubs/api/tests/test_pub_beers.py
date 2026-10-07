from __future__ import annotations

import uuid
from datetime import datetime
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.pub_beers_views import city_name, last_week_bounds
from pubs.enrichment.matcher import geohash8
from pubs.models import (
    Account,
    CanonicalPub,
    DrinkLog,
    PubAlias,
    PubDirectory,
    PubHours,
    PubNameCorrection,
)

PRAGUE = ZoneInfo("Europe/Prague")
# Wednesday; "last week" is Monday 14. 9. – Sunday 20. 9. 2026.
NOW = datetime(2026, 9, 23, 12, 0, tzinfo=PRAGUE)
URL = "/v1/pubs/beers-last-week"
BOARD_URL = "/v1/pubs/beer-board"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _catalog(*cache_keys: str, city: str = "Praha") -> None:
    for key in cache_keys:
        row = PubDirectory.objects.create(
            name=f"Hospoda {key}",
            lat=50.0876,
            lng=14.4214,
            city=city,
            country="cz",
            venue_kind=PubHours.VenueKind.PUB,
            discovery_kind=PubDirectory.DiscoveryKind.PUB,
            has_beer_signal=True,
            source="test",
            active=True,
            refreshed_at=timezone.now(),
        )
        # save() derives the key from coordinates; pin the cell the visits use.
        PubDirectory.objects.filter(pk=row.pk).update(cache_key=key)


def _register(client: APIClient) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"], Account.objects.get(public_id=resp.json()["id"])


def _beer(account: Account, drank_at: datetime, cache_key: str = "u2fkbn1z", **fields) -> None:
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        drank_at=drank_at,
        **{"beer_name": "Plzeň", "price_czk": 62, **fields},
    )


def _get(client: APIClient, token: str, url: str = URL, **params):
    with mock.patch("pubs.api.pub_beers_views.timezone.now", return_value=NOW):
        return client.get(url, params, HTTP_AUTHORIZATION=f"Bearer {token}")


def _board(client: APIClient, token: str, **params) -> dict:
    return _get(client, token, BOARD_URL, **params).json()


def test_last_week_bounds_follow_prague_calendar_week():
    monday, start, end = last_week_bounds(NOW)
    assert monday.isoformat() == "2026-09-14"
    assert start == datetime(2026, 9, 14, tzinfo=PRAGUE)
    assert end == datetime(2026, 9, 21, tzinfo=PRAGUE)


@pytest.mark.django_db
def test_counts_beers_per_pub_last_week(client):
    token, me = _register(client)
    _, friend = _register(client)
    _, pal = _register(client)
    _, ghost = _register(client)
    Account.objects.filter(pk=ghost.pk).update(ghost_mode=True)
    _catalog("u2fkbn1z", "u2fkbq00", "u2fkbzzz")

    tuesday = datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE)
    _beer(me, tuesday)
    _beer(me, datetime(2026, 9, 18, 21, 0, tzinfo=PRAGUE))
    _beer(friend, tuesday)
    _beer(pal, tuesday)
    _beer(friend, datetime(2026, 9, 20, 23, 30, tzinfo=PRAGUE), cache_key="u2fkbq00")
    _beer(me, datetime(2026, 9, 20, 22, 0, tzinfo=PRAGUE), cache_key="u2fkbq00")
    _beer(pal, datetime(2026, 9, 20, 22, 0, tzinfo=PRAGUE), cache_key="u2fkbq00")
    # Two people are too few: either could subtract their own beers.
    _beer(me, tuesday, cache_key="u2fkbzzz")
    _beer(friend, tuesday, cache_key="u2fkbzzz")
    # A ghost is not counted, so it does not make a third person either.
    _beer(ghost, tuesday, cache_key="u2fkbzzz")
    # Only beers count, and only the ones the public boards trust.
    _beer(friend, tuesday, drink_type=DrinkLog.DrinkType.SOFT_DRINK, beer_name="Kofola")
    _beer(friend, tuesday, is_suspect=True, suspect_reason="burst")
    # Outside the week on both sides.
    _beer(friend, datetime(2026, 9, 13, 23, 59, tzinfo=PRAGUE), cache_key="u2fkbzzz")
    _beer(friend, datetime(2026, 9, 21, 0, 0, tzinfo=PRAGUE), cache_key="u2fkbzzz")
    # A cell no public pub occupies is never published.
    _beer(friend, tuesday, cache_key="u2fkbhom")

    resp = _get(client, token)

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["week_start"] == "2026-09-14"
    assert body["week_end"] == "2026-09-20"
    assert body["next_week_starts_at"] == "2026-09-28T00:00:00+02:00"
    assert body["pubs"] == {"u2fkbn1z": 4, "u2fkbq00": 3}


@pytest.mark.django_db
def test_board_lists_pubs_where_at_least_three_people_drank(client):
    token, me = _register(client)
    _, friend = _register(client)
    _, pal = _register(client)
    _catalog("u2fkbn1z", "u2fkbq00", "u2fkbzzz")
    tuesday = datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE)
    _beer(me, tuesday)
    _beer(friend, tuesday)
    _beer(pal, tuesday)
    for account in (me, friend):
        _beer(account, tuesday, cache_key="u2fkbq00")
    _beer(pal, tuesday, cache_key="u2fkbq00")
    _beer(me, tuesday, cache_key="u2fkbq00")
    # Drinking alone in one place never puts it on the board or the map.
    for _ in range(5):
        _beer(me, tuesday, cache_key="u2fkbzzz")

    assert _get(client, token).json()["pubs"] == {"u2fkbn1z": 3, "u2fkbq00": 4}
    board = _board(client, token)
    assert board["period"] == "week"
    assert (board["period_start"], board["period_end"]) == ("2026-09-14", "2026-09-20")
    assert board["total_ranked"] == 2
    assert board["entries"] == [
        {
            "rank": 1,
            "cache_key": "u2fkbq00",
            "beers": 4,
            "name": "Hospoda u2fkbq00",
            "city": "Praha",
            "lat": 50.0876,
            "lng": 14.4214,
        },
        {
            "rank": 2,
            "cache_key": "u2fkbn1z",
            "beers": 3,
            "name": "Hospoda u2fkbn1z",
            "city": "Praha",
            "lat": 50.0876,
            "lng": 14.4214,
        },
    ]


@pytest.mark.django_db
def test_board_windows_and_cities(client):
    token, me = _register(client)
    _, friend = _register(client)
    _, pal = _register(client)
    _catalog("u2fkbn1z")
    _catalog("u2cvp000", city="Brno-střed")
    _catalog("u2cvp111", city="Brno")
    for account in (me, friend, pal):
        # Last week in Prague, February in Brno, and last year in Brno.
        _beer(account, datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE))
        _beer(account, datetime(2026, 2, 3, 20, 0, tzinfo=PRAGUE), cache_key="u2cvp000")
        _beer(account, datetime(2025, 6, 3, 20, 0, tzinfo=PRAGUE), cache_key="u2cvp111")
        _beer(account, datetime(2025, 6, 4, 20, 0, tzinfo=PRAGUE), cache_key="u2cvp111")

    def keys(board):
        return [entry["cache_key"] for entry in board["entries"]]

    assert keys(_board(client, token, period="week")) == ["u2fkbn1z"]
    year = _board(client, token, period="year")
    assert keys(year) == ["u2cvp000", "u2fkbn1z"]
    assert (year["period_start"], year["period_end"]) == ("2026-01-01", "2026-09-23")
    everything = _board(client, token, period="all")
    assert keys(everything) == ["u2cvp111", "u2cvp000", "u2fkbn1z"]
    assert everything["cities"] == [{"name": "Brno", "beers": 9}, {"name": "Praha", "beers": 3}]
    in_brno = _board(client, token, period="all", city="Brno")
    assert in_brno["city"] == "Brno"
    assert keys(in_brno) == ["u2cvp111", "u2cvp000"]
    assert [entry["rank"] for entry in in_brno["entries"]] == [1, 2]
    # An unknown window falls back to last week instead of failing.
    assert _board(client, token, period="decade")["period"] == "week"


@pytest.mark.django_db
def test_an_implausible_beer_day_does_not_count(client, settings):
    settings.LEADERBOARD_BEER_RED_DAY = 5
    token, me = _register(client)
    _, friend = _register(client)
    _, pal = _register(client)
    _catalog("u2fkbn1z")
    tuesday = datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE)
    _beer(friend, tuesday)
    _beer(pal, tuesday)
    for minute in range(5):
        _beer(me, tuesday.replace(minute=minute))
    _beer(me, datetime(2026, 9, 17, 20, 0, tzinfo=PRAGUE))

    assert _get(client, token).json()["pubs"] == {"u2fkbn1z": 3}
    assert [entry["beers"] for entry in _board(client, token)["entries"]] == [3]


@pytest.mark.django_db
def test_a_merged_duplicate_counts_toward_its_pub_under_the_corrected_name(client):
    token, me = _register(client)
    _, friend = _register(client)
    _, pal = _register(client)
    _catalog("u2fkbn1z", "u2fkbq00")
    PubDirectory.objects.filter(cache_key="u2fkbq00").update(active=False)
    canonical = CanonicalPub.objects.create(
        cache_key="u2fkbn1z", name="Hospoda u2fkbn1z", name_key="hospoda u2fkbn1z",
        lat=50.0876, lng=14.4214, city="Praha",
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key="u2fkbq00", name="Hospoda u2fkbq00",
        name_key="hospoda u2fkbq00", lat=50.0876, lng=14.4214,
    )
    PubNameCorrection.objects.create(
        client_id=uuid.uuid4(), cache_key=geohash8(50.0876, 14.4214),
        original_name="Hospoda u2fkbn1z", suggested_name="U Tygra", lat=50.0876, lng=14.4214,
    )
    tuesday = datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE)
    for account in (me, friend):
        _beer(account, tuesday)
        _beer(account, tuesday, cache_key="u2fkbq00")

    # The same two people at both cells are still two people.
    assert _get(client, token).json()["pubs"] == {}

    cache.clear()
    _beer(pal, tuesday, cache_key="u2fkbq00")
    assert _get(client, token).json()["pubs"] == {"u2fkbn1z": 5}
    [entry] = _board(client, token)["entries"]
    assert (entry["cache_key"], entry["name"], entry["beers"]) == ("u2fkbn1z", "U Tygra", 5)


def test_city_name_merges_districts_only():
    assert city_name("Praha 2") == "Praha"
    assert city_name(" Brno-střed ") == "Brno"
    assert city_name("Ostrava – Poruba") == "Ostrava"
    assert city_name("Praha-východ") == "Praha-východ"
    assert city_name("Brno-venkov") == "Brno-venkov"
    assert city_name("Frýdek-Místek") == "Frýdek-Místek"
    assert city_name("Plzeňská Lhota") == "Plzeňská Lhota"


@pytest.mark.django_db
def test_accounts_pending_deletion_or_off_the_boards_are_not_counted(client):
    token, _ = _register(client)
    _, gone = _register(client)
    _, cheat = _register(client)
    Account.objects.filter(pk=gone.pk).update(status=Account.Status.PENDING_DELETION)
    Account.objects.filter(pk=cheat.pk).update(excluded_from_leaderboards=True)
    _catalog("u2fkbn1z")
    _beer(gone, datetime(2026, 9, 16, 20, 0, tzinfo=PRAGUE))
    _beer(cheat, datetime(2026, 9, 16, 20, 0, tzinfo=PRAGUE))

    assert _get(client, token).json()["pubs"] == {}
    assert _board(client, token, period="all")["entries"] == []


def test_requires_account_token(client):
    assert client.get(URL).status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get(BOARD_URL).status_code == status.HTTP_401_UNAUTHORIZED

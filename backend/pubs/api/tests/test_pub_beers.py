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

from pubs.api.pub_beers_views import last_week_bounds
from pubs.models import Account, DrinkLog, PubDirectory, PubHours

PRAGUE = ZoneInfo("Europe/Prague")
# Wednesday; "last week" is Monday 14. 9. – Sunday 20. 9. 2026.
NOW = datetime(2026, 9, 23, 12, 0, tzinfo=PRAGUE)
URL = "/v1/pubs/beers-last-week"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _catalog(*cache_keys: str) -> None:
    for key in cache_keys:
        row = PubDirectory.objects.create(
            name=f"Hospoda {key}",
            lat=50.0876,
            lng=14.4214,
            city="Praha",
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


def _get(client: APIClient, token: str):
    with mock.patch("pubs.api.pub_beers_views.timezone.now", return_value=NOW):
        return client.get(URL, HTTP_AUTHORIZATION=f"Bearer {token}")


def test_last_week_bounds_follow_prague_calendar_week():
    monday, start, end = last_week_bounds(NOW)
    assert monday.isoformat() == "2026-09-14"
    assert start == datetime(2026, 9, 14, tzinfo=PRAGUE)
    assert end == datetime(2026, 9, 21, tzinfo=PRAGUE)


@pytest.mark.django_db
def test_counts_beers_per_pub_last_week(client):
    token, me = _register(client)
    _, friend = _register(client)
    _, ghost = _register(client)
    Account.objects.filter(pk=ghost.pk).update(ghost_mode=True)
    _catalog("u2fkbn1z", "u2fkbq00", "u2fkbzzz")

    tuesday = datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE)
    _beer(me, tuesday)
    _beer(me, datetime(2026, 9, 18, 21, 0, tzinfo=PRAGUE))
    _beer(friend, tuesday)
    _beer(ghost, tuesday)
    _beer(friend, datetime(2026, 9, 20, 23, 30, tzinfo=PRAGUE), cache_key="u2fkbq00")
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
    assert body["pubs"] == {"u2fkbn1z": 3, "u2fkbq00": 1}


@pytest.mark.django_db
def test_top_lists_pubs_where_at_least_two_people_drank(client):
    token, me = _register(client)
    _, friend = _register(client)
    _catalog("u2fkbn1z", "u2fkbq00", "u2fkbzzz")
    tuesday = datetime(2026, 9, 15, 20, 0, tzinfo=PRAGUE)
    for _ in range(2):
        _beer(me, tuesday)
    _beer(friend, tuesday)
    _beer(me, tuesday, cache_key="u2fkbq00")
    _beer(friend, tuesday, cache_key="u2fkbq00")
    # Drinking alone in one place never puts it on the board.
    for _ in range(5):
        _beer(me, tuesday, cache_key="u2fkbzzz")

    body = _get(client, token).json()

    assert body["pubs"] == {"u2fkbn1z": 3, "u2fkbq00": 2, "u2fkbzzz": 5}
    assert body["top"] == [
        {
            "cache_key": "u2fkbn1z",
            "beers": 3,
            "name": "Hospoda u2fkbn1z",
            "city": "Praha",
            "lat": 50.0876,
            "lng": 14.4214,
        },
        {
            "cache_key": "u2fkbq00",
            "beers": 2,
            "name": "Hospoda u2fkbq00",
            "city": "Praha",
            "lat": 50.0876,
            "lng": 14.4214,
        },
    ]


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

    body = _get(client, token).json()
    assert body["pubs"] == {}
    assert body["top"] == []


def test_requires_account_token(client):
    assert client.get(URL).status_code == status.HTTP_401_UNAUTHORIZED

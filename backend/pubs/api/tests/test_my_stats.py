"""
Tests for GET /v1/me/stats — the read-only personal beer-stats endpoint that
aggregates an account's DrinkLog history into the mobile "Výkon" numbers.

The rules mirror the device-local model in the app (src/stats/statsModel.ts):
an "evening" = drinks at one pub (cache_key) on one drinking day, where the
drinking day rolls at 04:00 Europe/Prague.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, DrinkLog

PRAGUE = ZoneInfo("Europe/Prague")

_KEY_TYGR = "u2mqr8vd"
_KEY_LOKAL = "u2mqr8ab"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # Mirror the other API tests: clear DRF's cache around each test so any
    # shared 127.0.0.1 throttle history never bleeds across cases.
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient) -> str:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _drink(
    account: Account,
    *,
    cache_key: str,
    name: str,
    price_czk: int,
    drank_at: datetime,
) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name=name,
        lat=50.0876,
        lng=14.4214,
        city="Praha",
        external_id="",
        beer_name="Pilsner Urquell",
        price_czk=price_czk,
        volume_ml=500,
        drank_at=drank_at,
    )


# ---------------------------------------------------------------------------
# Empty state + auth
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_empty_stats_returns_zeroes_not_404(client):
    token = _register(client)

    resp = client.get("/v1/me/stats", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json() == {
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


@pytest.mark.django_db
def test_requires_auth(client):
    resp = client.get("/v1/me/stats")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_single_evening_one_pub(client):
    token = _register(client)
    account = Account.objects.latest("created_at")

    # One pub, one drinking day: 19:00, 19:10, 19:25 Prague.
    t0 = datetime(2026, 6, 12, 19, 0, tzinfo=PRAGUE)
    t1 = datetime(2026, 6, 12, 19, 10, tzinfo=PRAGUE)
    t2 = datetime(2026, 6, 12, 19, 25, tzinfo=PRAGUE)
    _drink(account, cache_key=_KEY_TYGR, name="U Zlatého tygra", price_czk=50, drank_at=t0)
    _drink(account, cache_key=_KEY_TYGR, name="U Zlatého tygra", price_czk=55, drank_at=t1)
    _drink(account, cache_key=_KEY_TYGR, name="U Zlatého tygra", price_czk=60, drank_at=t2)

    body = client.get("/v1/me/stats", **_auth(token)).json()

    assert body["total_beers"] == 3
    assert body["total_evenings"] == 1
    assert body["distinct_pubs"] == 1
    assert body["total_spent_czk"] == 165
    assert body["first_drink_at"] == t0.astimezone(UTC).isoformat()

    assert body["top_pubs"] == [
        {
            "cache_key": _KEY_TYGR,
            "name": "U Zlatého tygra",
            "beers": 3,
            "spent_czk": 165,
            "last_drank_at": t2.astimezone(UTC).isoformat(),
        }
    ]

    # gaps: 600s and 900s → fastest 600; span 19:00→19:25 = 1500s.
    assert body["records"] == {
        "most_beers_in_evening": 3,
        "most_beers_pub_name": "U Zlatého tygra",
        "most_beers_date": "2026-06-12",
        "fastest_beer_seconds": 600,
        "longest_evening_seconds": 1500,
    }


@pytest.mark.django_db
def test_personal_stats_still_include_suspect_drinks(client):
    token = _register(client)
    account = Account.objects.latest("created_at")
    drink = _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=65,
        drank_at=datetime(2026, 6, 12, 19, 0, tzinfo=PRAGUE),
    )
    drink.is_suspect = True
    drink.suspect_reason = "manual"
    drink.save(update_fields=["is_suspect", "suspect_reason"])

    response = client.get("/v1/me/stats", **_auth(token))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["total_beers"] == 1
    assert response.json()["total_spent_czk"] == 65


@pytest.mark.django_db
def test_two_evenings_two_pubs_ordering_and_records(client):
    token = _register(client)
    account = Account.objects.latest("created_at")

    # Pub A (Tygr): 3 beers on June 11; the newest drink carries a renamed pub
    # label, which top_pubs / records must follow.
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="Stará hospoda",
        price_czk=40,
        drank_at=datetime(2026, 6, 11, 18, 0, tzinfo=PRAGUE),
    )
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="Stará hospoda",
        price_czk=40,
        drank_at=datetime(2026, 6, 11, 18, 30, tzinfo=PRAGUE),
    )
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=40,
        drank_at=datetime(2026, 6, 11, 19, 0, tzinfo=PRAGUE),
    )

    # Pub B (Lokál): 5 beers on June 12 — more beers in one evening, so it wins
    # both the top_pubs ordering and the most_beers record.
    for i in range(5):
        _drink(
            account,
            cache_key=_KEY_LOKAL,
            name="Lokál",
            price_czk=50,
            drank_at=datetime(2026, 6, 12, 20, 0 + i, tzinfo=PRAGUE),
        )

    body = client.get("/v1/me/stats", **_auth(token)).json()

    assert body["total_beers"] == 8
    assert body["total_evenings"] == 2
    assert body["distinct_pubs"] == 2
    assert body["total_spent_czk"] == 3 * 40 + 5 * 50

    # Ordering: most beers first (Lokál 5, then Tygr 3).
    assert [p["cache_key"] for p in body["top_pubs"]] == [_KEY_LOKAL, _KEY_TYGR]
    assert body["top_pubs"][0]["beers"] == 5
    assert body["top_pubs"][1]["beers"] == 3
    # Tygr's display name follows its newest drink, not the first one.
    assert body["top_pubs"][1]["name"] == "U Zlatého tygra"

    assert body["records"]["most_beers_in_evening"] == 5
    assert body["records"]["most_beers_pub_name"] == "Lokál"
    assert body["records"]["most_beers_date"] == "2026-06-12"


@pytest.mark.django_db
def test_drinking_day_cutoff_rolls_at_4am_prague(client):
    token = _register(client)
    account = Account.objects.latest("created_at")

    # Same pub, three drinks:
    #   23:00 June 12  → drinking day June 12
    #   01:30 June 13  → after midnight but before 04:00 → still June 12's night
    #   23:00 June 13  → drinking day June 13
    # So the 01:30 and 23:00 of June 13 (same calendar day) land in DIFFERENT
    # evenings, while the 23:00 June 12 + 01:30 June 13 share one evening.
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=50,
        drank_at=datetime(2026, 6, 12, 23, 0, tzinfo=PRAGUE),
    )
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=50,
        drank_at=datetime(2026, 6, 13, 1, 30, tzinfo=PRAGUE),
    )
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=50,
        drank_at=datetime(2026, 6, 13, 23, 0, tzinfo=PRAGUE),
    )

    body = client.get("/v1/me/stats", **_auth(token)).json()

    assert body["total_beers"] == 3
    assert body["distinct_pubs"] == 1
    # Two evenings: {June 12 night = 23:00 + 01:30}, {June 13 night = 23:00}.
    assert body["total_evenings"] == 2
    # The bigger evening is the June 12 night (2 beers).
    assert body["records"]["most_beers_in_evening"] == 2
    assert body["records"]["most_beers_date"] == "2026-06-12"

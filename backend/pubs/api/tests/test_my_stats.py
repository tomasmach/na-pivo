"""
Tests for GET /v1/me/stats — the read-only personal beer-stats endpoint that
aggregates an account's DrinkLog history into the mobile "Výkon" numbers.

The rules mirror the device-local model in the app (src/stats/statsModel.ts):
an "evening" = drinks at one pub (cache_key) on one drinking day, where the
drinking day rolls at 04:00 Europe/Prague.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta
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
    cache_key: str | None,
    name: str,
    price_czk: int | None,
    drank_at: datetime,
    drink_type: str = DrinkLog.DrinkType.BEER,
) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name=name,
        lat=50.0876 if cache_key is not None else None,
        lng=14.4214 if cache_key is not None else None,
        city="Praha" if cache_key is not None else "",
        external_id="",
        place_context=(
            DrinkLog.PlaceContext.PUB
            if cache_key is not None
            else DrinkLog.PlaceContext.PRIVATE
        ),
        drink_type=drink_type,
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
    body = resp.json()
    assert {key: value for key, value in body.items() if key != "timeline"} == {
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
            "timezone": "Europe/Prague",
            "months": [],
            "years": [],
        },
    }
    assert len(body["timeline"]["days"]) == 7
    assert len(body["timeline"]["weeks"]) == 12
    assert len(body["timeline"]["months"]) == 12
    assert body["timeline"]["streak"] == {
        "current_weeks": 0,
        "best_weeks": 0,
    }
    assert all(row["beers"] == 0 for row in body["timeline"]["days"])


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
def test_non_pub_and_non_beer_rows_follow_stats_contract(client):
    token = _register(client)
    account = Account.objects.latest("created_at")
    pub_time = datetime(2026, 6, 12, 19, 0, tzinfo=PRAGUE)
    outside_time = datetime(2026, 6, 13, 19, 0, tzinfo=PRAGUE)
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=60,
        drank_at=pub_time,
    )
    _drink(
        account,
        cache_key=None,
        name="",
        price_czk=None,
        drank_at=outside_time,
    )
    for drink_type, price in (
        (DrinkLog.DrinkType.WINE, 80),
        (DrinkLog.DrinkType.SHOT, 55),
        (DrinkLog.DrinkType.SOFT_DRINK, 45),
    ):
        _drink(
            account,
            cache_key=_KEY_TYGR,
            name="U Zlatého tygra",
            price_czk=price,
            drank_at=pub_time,
            drink_type=drink_type,
        )

    response = client.get("/v1/me/stats", **_auth(token))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["total_beers"] == 2
    assert body["total_evenings"] == 2
    assert body["distinct_pubs"] == 1
    assert body["total_spent_czk"] == 240
    assert body["top_pubs"] == [
        {
            "cache_key": _KEY_TYGR,
            "name": "U Zlatého tygra",
            "beers": 1,
            "spent_czk": 240,
            "last_drank_at": pub_time.astimezone(UTC).isoformat(),
        }
    ]
    assert body["records"]["most_beers_in_evening"] == 1


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


@pytest.mark.django_db
def test_monthly_and_yearly_periods_include_zero_safe_averages(client):
    token = _register(client)
    account = Account.objects.latest("created_at")

    for drank_at, price in (
        (datetime(2025, 12, 31, 20, 0, tzinfo=PRAGUE), 55),
        (datetime(2026, 1, 2, 1, 0, tzinfo=PRAGUE), 60),
        (datetime(2026, 1, 2, 1, 30, tzinfo=PRAGUE), 65),
    ):
        _drink(
            account,
            cache_key=_KEY_TYGR,
            name="U Zlatého tygra",
            price_czk=price,
            drank_at=drank_at,
        )

    body = client.get("/v1/me/stats", **_auth(token)).json()

    assert body["periods"] == {
        "timezone": "Europe/Prague",
        "months": [
            {
                "period": "2025-12",
                "beers": 1,
                "evenings": 1,
                "spent_czk": 55,
                "average_beers_per_evening": 1.0,
            },
            {
                "period": "2026-01",
                "beers": 2,
                "evenings": 1,
                "spent_czk": 125,
                "average_beers_per_evening": 2.0,
            },
        ],
        "years": [
            {
                "period": "2025",
                "beers": 1,
                "evenings": 1,
                "spent_czk": 55,
                "average_beers_per_evening": 1.0,
            },
            {
                "period": "2026",
                "beers": 2,
                "evenings": 1,
                "spent_czk": 125,
                "average_beers_per_evening": 2.0,
            },
        ],
    }


@pytest.mark.django_db
def test_profile_timeline_keeps_empty_buckets_and_derives_weekly_streak(client):
    token = _register(client)
    account = Account.objects.latest("created_at")
    today = datetime.now(PRAGUE).date()
    current_monday = today - timedelta(days=today.weekday())
    current_at = datetime.combine(today, time(hour=19), tzinfo=PRAGUE)
    previous_at = datetime.combine(
        current_monday - timedelta(days=2),
        time(hour=20),
        tzinfo=PRAGUE,
    )

    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=60,
        drank_at=current_at,
    )
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=60,
        drank_at=current_at + timedelta(minutes=45),
    )
    _drink(
        account,
        cache_key=_KEY_LOKAL,
        name="Lokál",
        price_czk=58,
        drank_at=previous_at,
    )

    timeline = client.get("/v1/me/stats", **_auth(token)).json()["timeline"]

    assert len(timeline["days"]) == 7
    assert timeline["days"][-1] == {
        "period": today.isoformat(),
        "beers": 2,
        "evenings": 1,
        "distinct_pubs": 1,
        "longest_evening_seconds": 45 * 60,
    }
    assert timeline["weeks"][-1]["beers"] == 2
    assert timeline["weeks"][-1]["evenings"] == 1
    assert timeline["weeks"][-2]["beers"] == 1
    assert timeline["streak"] == {"current_weeks": 2, "best_weeks": 2}


@pytest.mark.django_db
def test_requested_timezone_controls_period_and_drinking_day_buckets(client):
    token = _register(client)
    account = Account.objects.latest("created_at")
    # 03:30 UTC is already after the 04:00 cutoff in Prague, but still belongs
    # to the previous drinking day in UTC.
    _drink(
        account,
        cache_key=_KEY_TYGR,
        name="U Zlatého tygra",
        price_czk=50,
        drank_at=datetime(2026, 2, 1, 3, 30, tzinfo=UTC),
    )

    utc_body = client.get("/v1/me/stats?timezone=UTC", **_auth(token)).json()
    prague_body = client.get(
        "/v1/me/stats?timezone=Europe%2FPrague", **_auth(token)
    ).json()

    assert utc_body["periods"]["timezone"] == "UTC"
    assert utc_body["periods"]["months"][0]["period"] == "2026-01"
    assert utc_body["records"]["most_beers_date"] == "2026-01-31"
    assert prague_body["periods"]["timezone"] == "Europe/Prague"
    assert prague_body["periods"]["months"][0]["period"] == "2026-02"
    assert prague_body["records"]["most_beers_date"] == "2026-02-01"


@pytest.mark.django_db
def test_invalid_requested_timezone_falls_back_to_prague(client):
    token = _register(client)

    body = client.get(
        "/v1/me/stats?timezone=Not%2FA-Timezone", **_auth(token)
    ).json()

    assert body["periods"]["timezone"] == "Europe/Prague"

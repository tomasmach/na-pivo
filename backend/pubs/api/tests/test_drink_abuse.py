from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, DrinkLog


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient) -> tuple[str, Account]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["token"], Account.objects.get(public_id=response.json()["id"])


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(*, drank_at, client_id=None) -> dict:
    return {
        "client_id": str(client_id or uuid.uuid4()),
        "name": "U Zlatého tygra",
        "lat": 50.0876,
        "lng": 14.4214,
        "drink_type": "soft_drink",
        "beer": {"name": "Kofola", "price_czk": 49, "volume_ml": 400},
        "drank_at": drank_at.isoformat(),
    }


def _drink(account: Account, drank_at, *, is_suspect=False, suspect_reason="") -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        drink_type=DrinkLog.DrinkType.SOFT_DRINK,
        beer_name="Kofola",
        price_czk=49,
        volume_ml=400,
        drank_at=drank_at,
        is_suspect=is_suspect,
        suspect_reason=suspect_reason,
    )


def _yesterday_noon():
    local_now = timezone.localtime(timezone.now())
    return (local_now - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)


@pytest.mark.django_db
def test_future_drank_at_is_clamped_to_now(client, monkeypatch):
    fixed_now = timezone.now().replace(microsecond=0)
    token, _account = _register(client)
    monkeypatch.setattr("pubs.api.views.dj_timezone.now", lambda: fixed_now)

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=fixed_now + timedelta(minutes=11)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    drink = DrinkLog.objects.get()
    assert drink.drank_at == fixed_now
    assert drink.is_suspect is False


@pytest.mark.django_db
def test_drink_older_than_backdate_window_is_flagged(client):
    token, _account = _register(client)

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=timezone.now() - timedelta(days=61)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    drink = DrinkLog.objects.get()
    assert drink.is_suspect is True
    assert drink.suspect_reason == "backdated"


@pytest.mark.django_db
def test_fifteenth_drink_is_daily_cap_but_fourteenth_is_not(client):
    token, account = _register(client)
    start = _yesterday_noon() - timedelta(hours=12)
    for index in range(13):
        _drink(account, start + timedelta(minutes=50 * index))

    fourteenth = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=50 * 13)),
        format="json",
        **_auth(token),
    )
    fifteenth = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=50 * 14)),
        format="json",
        **_auth(token),
    )

    assert fourteenth.status_code == status.HTTP_201_CREATED
    assert fifteenth.status_code == status.HTTP_201_CREATED
    newest = list(DrinkLog.objects.order_by("drank_at"))[13:]
    assert [(row.is_suspect, row.suspect_reason) for row in newest] == [
        (False, ""),
        (True, "daily_cap"),
    ]


@pytest.mark.django_db
def test_thirteenth_drink_in_burst_is_flagged_but_spread_drinks_are_not(client):
    token, account = _register(client)
    base = _yesterday_noon()
    for index in range(12):
        _drink(account, base + timedelta(seconds=index))
    burst_response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=base + timedelta(seconds=12)),
        format="json",
        **_auth(token),
    )
    assert burst_response.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.latest("drank_at").suspect_reason == "burst"

    other_token, other = _register(client)
    for index in range(12):
        _drink(other, base + timedelta(minutes=11 * index))
    spread_response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=base + timedelta(minutes=11 * 12)),
        format="json",
        **_auth(other_token),
    )
    assert spread_response.status_code == status.HTTP_201_CREATED
    spread_drink = DrinkLog.objects.filter(account=other).latest("drank_at")
    assert spread_drink.is_suspect is False
    assert spread_drink.suspect_reason == ""


@pytest.mark.django_db
def test_twenty_first_drink_is_hard_limited_and_existing_rows_remain(client):
    token, account = _register(client)
    start = _yesterday_noon() - timedelta(hours=10)
    for index in range(20):
        _drink(account, start + timedelta(minutes=25 * index))

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=25 * 20)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert response.json() == {
        "code": "drink_limited",
        "detail": "daily drink limit reached",
    }
    assert DrinkLog.objects.filter(account=account).count() == 20


@pytest.mark.django_db
def test_duplicate_retry_does_not_recompute_or_change_flags(client):
    token, account = _register(client)
    client_id = uuid.uuid4()
    old_time = timezone.now() - timedelta(days=61)
    first = client.post(
        "/v1/drinks",
        data=_payload(drank_at=old_time, client_id=client_id),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_201_CREATED
    DrinkLog.objects.filter(account=account).update(is_suspect=True, suspect_reason="manual")

    retry = client.post(
        "/v1/drinks",
        data=_payload(drank_at=timezone.now(), client_id=client_id),
        format="json",
        **_auth(token),
    )

    assert retry.status_code == status.HTTP_200_OK
    assert retry.json()["duplicate"] is True
    assert DrinkLog.objects.filter(account=account).count() == 1
    drink = DrinkLog.objects.get(account=account)
    assert drink.is_suspect is True
    assert drink.suspect_reason == "manual"

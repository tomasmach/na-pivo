"""GET /v1/friends/<id>/duel — the Souboj, one friend against me.

What these pin down, in order of what would hurt most if it broke:
consent (a friend who does not share their feed exposes no numbers, and spend
needs a separate opt-in from both sides), the evening definition (same triple as
the Výkon screen), and the chart's trailing months.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, DrinkLog, Friendship

_LAT = 50.0876
_LNG = 14.4214
_PRAGUE = ZoneInfo("Europe/Prague")


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=resp.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.save(update_fields=["nickname", "display_name"])
    return resp.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _befriend(a: Account, b: Account) -> Friendship:
    return Friendship.objects.create(
        requester=a, recipient=b, status=Friendship.Status.ACCEPTED
    )


def _drink(
    account: Account,
    *,
    drank_at,
    cache_key: str | None = "u2fkbn1z",
    price_czk: int | None = 65,
    drink_type: str = DrinkLog.DrinkType.BEER,
    is_suspect: bool = False,
) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra" if cache_key else "",
        lat=_LAT if cache_key else None,
        lng=_LNG if cache_key else None,
        beer_name="Plzeň",
        drink_type=drink_type,
        is_suspect=is_suspect,
        price_czk=price_czk,
        drank_at=drank_at,
    )


def _evening(day: str, hour: int = 20) -> datetime:
    """A drink time inside the Prague drinking day starting on ``day``."""
    return datetime.fromisoformat(f"{day}T{hour:02d}:00:00").replace(tzinfo=_PRAGUE)


def _duel(client: APIClient, token: str, friend: Account, window: str = "all"):
    return client.get(
        f"/v1/friends/{friend.public_id}/duel?window={window}",
        **_auth(token),
    )


@pytest.mark.django_db
def test_duel_counts_evenings_beers_and_pubs(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)

    # Me: two pubs on one night, then one more night. Three evenings, five beers.
    _drink(me, drank_at=_evening("2026-09-05"), cache_key="u2fkbn1z")
    _drink(me, drank_at=_evening("2026-09-05", 21), cache_key="u2fkbn1z")
    _drink(me, drank_at=_evening("2026-09-05", 23), cache_key="u2fkbn20")
    _drink(me, drank_at=_evening("2026-09-07"), cache_key="u2fkbn1z")
    _drink(me, drank_at=_evening("2026-09-07", 22), cache_key="u2fkbn1z")
    # Friend: one evening, one beer.
    _drink(friend, drank_at=_evening("2026-09-06"), cache_key="u2fkbn21")

    body = _duel(client, token_me, friend).json()

    assert body["available"] is True
    assert body["me"] == {
        "beers": 5,
        "evenings": 3,
        "pubs": 2,
        "beers_per_evening": 1.7,
    }
    assert body["them"]["beers"] == 1
    assert body["them"]["evenings"] == 1


@pytest.mark.django_db
def test_duel_rolls_the_drinking_day_at_four(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)

    # 02:00 belongs to the night before, 05:00 starts a new one.
    _drink(me, drank_at=_evening("2026-09-05", 23))
    _drink(me, drank_at=_evening("2026-09-06", 2))
    _drink(me, drank_at=_evening("2026-09-06", 5))

    body = _duel(client, token_me, friend).json()

    assert body["me"]["beers"] == 3
    assert body["me"]["evenings"] == 2


@pytest.mark.django_db
def test_duel_ignores_non_beer_and_suspect_rows(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)

    _drink(me, drank_at=_evening("2026-09-05"))
    _drink(me, drank_at=_evening("2026-09-05", 21), drink_type=DrinkLog.DrinkType.WINE)
    _drink(me, drank_at=_evening("2026-09-05", 22), is_suspect=True)

    assert _duel(client, token_me, friend).json()["me"]["beers"] == 1


@pytest.mark.django_db
def test_duel_hides_numbers_when_the_friend_does_not_share(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)
    _drink(friend, drank_at=_evening("2026-09-05"))

    friend.share_drinks_with_parta = False
    friend.save(update_fields=["share_drinks_with_parta"])

    body = _duel(client, token_me, friend).json()

    assert body["available"] is False
    assert body["unavailable_reason"] == "not_sharing"
    assert body["me"] is None and body["them"] is None
    assert body["series"] == []


@pytest.mark.django_db
def test_duel_hides_numbers_in_ghost_mode(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)

    friend.ghost_mode = True
    friend.save(update_fields=["ghost_mode"])

    assert _duel(client, token_me, friend).json()["available"] is False


@pytest.mark.django_db
def test_duel_needs_spend_consent_from_both_sides(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)
    _drink(me, drank_at=_evening("2026-09-05"), price_czk=65)
    _drink(friend, drank_at=_evening("2026-09-05"), price_czk=55)

    # Nobody opted in.
    body = _duel(client, token_me, friend).json()
    assert body["spend_available"] is False
    assert "spend_czk" not in body["me"]

    # Only I did — still nothing, and the app is told it is the friend's call.
    me.share_spend_with_parta = True
    me.save(update_fields=["share_spend_with_parta"])
    body = _duel(client, token_me, friend).json()
    assert body["spend_available"] is False
    assert body["spend_blocked_by_me"] is False

    # Both did.
    friend.share_spend_with_parta = True
    friend.save(update_fields=["share_spend_with_parta"])
    body = _duel(client, token_me, friend).json()
    assert body["spend_available"] is True
    assert body["me"]["spend_czk"] == 65
    assert body["them"]["spend_czk"] == 55


@pytest.mark.django_db
def test_duel_reports_how_many_beers_carry_a_price(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)
    for account in (me, friend):
        account.share_spend_with_parta = True
        account.save(update_fields=["share_spend_with_parta"])

    _drink(me, drank_at=_evening("2026-09-05"), price_czk=60)
    _drink(me, drank_at=_evening("2026-09-05", 21), price_czk=None)

    body = _duel(client, token_me, friend).json()

    assert body["me"]["beers"] == 2
    assert body["me"]["spend_czk"] == 60
    assert body["me"]["priced_beers"] == 1


@pytest.mark.django_db
def test_duel_series_has_six_months_including_empty_ones(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)
    _drink(me, drank_at=timezone.now() - timedelta(days=1))

    body = _duel(client, token_me, friend).json()
    series = body["series"]

    assert len(series) == 6
    assert [row["month"] for row in series] == sorted(row["month"] for row in series)
    assert sum(row["me"] for row in series) == 1
    assert all(row["friend"] == 0 for row in series)


@pytest.mark.django_db
def test_duel_window_bounds_the_totals(client):
    token_me, me = _register(client, "radek")
    _, friend = _register(client, "pepa")
    _befriend(me, friend)
    _drink(me, drank_at=timezone.now() - timedelta(days=2))
    _drink(me, drank_at=timezone.now() - timedelta(days=200))

    assert _duel(client, token_me, friend, "30d").json()["me"]["beers"] == 1
    assert _duel(client, token_me, friend, "all").json()["me"]["beers"] == 2


@pytest.mark.django_db
def test_duel_is_closed_to_strangers(client):
    token_me, _me = _register(client, "radek")
    _, stranger = _register(client, "pepa")

    resp = _duel(client, token_me, stranger)

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "friend_not_found"


@pytest.mark.django_db
def test_duel_requires_authentication(client):
    _, friend = _register(client, "pepa")

    resp = client.get(f"/v1/friends/{friend.public_id}/duel")

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_spend_consent_round_trips_through_friend_settings(client):
    token, account = _register(client, "radek")

    assert client.get("/v1/friends/settings", **_auth(token)).json()[
        "share_spend_with_parta"
    ] is False

    resp = client.patch(
        "/v1/friends/settings",
        data={"share_spend_with_parta": True},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["share_spend_with_parta"] is True
    account.refresh_from_db()
    assert account.share_spend_with_parta is True

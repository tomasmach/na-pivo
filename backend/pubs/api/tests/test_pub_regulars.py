from __future__ import annotations

from datetime import datetime
from unittest import mock

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.tests.test_pub_beers import PRAGUE, _beer, _catalog, _register
from pubs.models import Account, FriendBlock

# Wednesday noon; the counted beers end with Tuesday's drinking day at 04:00 today.
NOW = datetime(2026, 9, 23, 12, 0, tzinfo=PRAGUE)
URL = "/v1/pubs/regulars"
PUB = "u2fkbn1z"
TUESDAY = datetime(2026, 9, 22, 20, 0, tzinfo=PRAGUE)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _regular(client, nickname: str, *, listed: bool = True) -> tuple[str, Account]:
    token, account = _register(client)
    Account.objects.filter(pk=account.pk).update(nickname=nickname, is_public=True, show_as_pub_regular=listed)
    account.refresh_from_db()
    return token, account


def _beers(account: Account, count: int, at: datetime = TUESDAY, cache_key: str = PUB) -> None:
    for _ in range(count):
        _beer(account, at, cache_key=cache_key)


def _get(client, token: str, **params):
    with mock.patch("pubs.api.pub_regulars_views.timezone.now", return_value=NOW):
        return client.get(URL, {"cache_key": PUB, **params}, HTTP_AUTHORIZATION=f"Bearer {token}")


def _names(body: dict) -> list[tuple[str, int]]:
    return [(entry["account"]["nickname"], entry["beers"]) for entry in body["entries"]]


@pytest.mark.django_db
def test_lists_only_people_who_chose_to_be_listed(client):
    _catalog(PUB)
    token, me = _regular(client, "ja", listed=False)
    _, pepa = _regular(client, "pepa")
    _, majda = _regular(client, "majda")
    _, kuba = _regular(client, "kuba")
    _, quiet = _regular(client, "tichy", listed=False)
    _, ghost = _regular(client, "duch")
    Account.objects.filter(pk=ghost.pk).update(ghost_mode=True)
    _, private = _regular(client, "skryty")
    Account.objects.filter(pk=private.pk).update(is_public=False)
    _beers(pepa, 5)
    _beers(majda, 3)
    _beers(kuba, 2)
    _beers(me, 4)
    _beers(quiet, 9)
    _beers(ghost, 9)
    _beers(private, 9)

    resp = _get(client, token)

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert _names(body) == [("pepa", 5), ("majda", 3), ("kuba", 2)]
    assert [entry["rank"] for entry in body["entries"]] == [1, 2, 3]
    assert body["total_ranked"] == 3
    assert body["me"] == {"beers": 4, "rank": 2, "listed": False, "opted_in": False, "eligible": True, "ghost": False}


@pytest.mark.django_db
def test_today_never_counts_and_the_window_moves(client):
    _catalog(PUB)
    token, me = _regular(client, "ja")
    others = [_regular(client, name)[1] for name in ("a", "b", "c")]
    for account in others:
        _beers(account, 1)
    _beers(me, 2)
    # Still Tuesday's drinking day, so it counts.
    _beers(me, 1, datetime(2026, 9, 23, 1, 0, tzinfo=PRAGUE))
    # Today: whoever reads the board must not learn I am sitting there now.
    _beers(me, 5, datetime(2026, 9, 23, 10, 0, tzinfo=PRAGUE))
    _beers(me, 4, datetime(2026, 7, 1, 20, 0, tzinfo=PRAGUE))

    recent = _get(client, token).json()
    assert recent["entries"][0]["account"]["nickname"] == "ja"
    assert recent["entries"][0]["beers"] == 3
    assert recent["entries"][0]["is_me"] is True
    assert recent["period_end"] == "2026-09-22"
    assert recent["me"]["listed"] is True

    assert _get(client, token, period="year").json()["entries"][0]["beers"] == 7
    assert _get(client, token, period="nonsense").json()["period"] == "30d"


@pytest.mark.django_db
def test_fewer_than_three_listed_people_show_nobody(client):
    _catalog(PUB)
    token, me = _regular(client, "ja")
    _, pepa = _regular(client, "pepa")
    _beers(me, 2)
    _beers(pepa, 4)

    body = _get(client, token).json()

    assert body["entries"] == []
    assert body["total_ranked"] == 0
    assert body["me"]["beers"] == 2


@pytest.mark.django_db
def test_turning_the_listing_off_or_going_ghost_hides_at_once(client):
    _catalog(PUB)
    token, viewer = _regular(client, "ja", listed=False)
    people = [_regular(client, name)[1] for name in ("a", "b", "c", "d")]
    for index, account in enumerate(people):
        _beers(account, index + 1)
    assert len(_get(client, token).json()["entries"]) == 4

    Account.objects.filter(pk=people[3].pk).update(show_as_pub_regular=False)
    Account.objects.filter(pk=people[2].pk).update(ghost_mode=True)

    assert _get(client, token).json()["entries"] == []


@pytest.mark.django_db
def test_blocked_people_are_left_out_for_the_viewer(client):
    _catalog(PUB)
    token, viewer = _regular(client, "ja", listed=False)
    people = [_regular(client, name)[1] for name in ("a", "b", "c", "d")]
    for index, account in enumerate(people):
        _beers(account, index + 1)
    FriendBlock.objects.create(blocker=people[3], blocked=viewer)

    body = _get(client, token).json()

    assert _names(body) == [("c", 3), ("b", 2), ("a", 1)]
    assert [entry["rank"] for entry in body["entries"]] == [1, 2, 3]

    # With the blocked one gone only two are left, too few to show anybody.
    FriendBlock.objects.create(blocker=viewer, blocked=people[2])
    assert _get(client, token).json()["entries"] == []


@pytest.mark.django_db
def test_a_cell_without_a_public_pub_lists_nobody(client):
    token, _ = _regular(client, "ja")
    for name in ("a", "b", "c"):
        _beers(_regular(client, name)[1], 2)

    assert _get(client, token).json()["entries"] == []
    assert _get(client, token, cache_key="nope").status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_requires_account_token(client):
    assert client.get(URL, {"cache_key": PUB}).status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_listing_is_off_by_default_and_profile_patch_turns_it_on(client):
    token, account = _register(client)
    me = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {token}").json()
    assert me["show_as_pub_regular"] is False

    # A released app's profile save without the new field keeps it as it was.
    resp = client.patch("/v1/account/me", {"display_name": "Pepa"}, format="json", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["show_as_pub_regular"] is False

    resp = client.patch("/v1/account/me", {"show_as_pub_regular": True}, format="json", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["show_as_pub_regular"] is True
    account.refresh_from_db()
    assert account.show_as_pub_regular is True


@pytest.mark.django_db
def test_turning_the_listing_on_shows_me_before_the_cache_expires(client):
    _catalog(PUB)
    token, me = _regular(client, "ja", listed=False)
    for index, name in enumerate(("a", "b", "c")):
        _beers(_regular(client, name)[1], index + 1)
    _beers(me, 5)
    assert [entry["is_me"] for entry in _get(client, token).json()["entries"]] == [False, False, False]

    Account.objects.filter(pk=me.pk).update(show_as_pub_regular=True)

    body = _get(client, token).json()
    assert body["entries"][0]["is_me"] is True
    assert body["me"]["listed"] is True
    assert body["me"]["rank"] == 1

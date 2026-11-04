"""A "Na zdraví" to a friend sitting out without a broadcast (Parta "Teď venku").

What hurts most if it breaks, first: a released client's dashboard must keep its
presence rows, a cheer must never reach someone outside the party or hidden from
it, and an offline replay must stay harmless.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    FriendBlock,
    FriendNotification,
    Friendship,
    PubVisit,
    PubVisitReaction,
)

RELEASED_PRESENCE_KEYS = {
    "account",
    "pub_name",
    "pub_city",
    "cache_key",
    "lat",
    "lng",
    "since",
    "last_seen_at",
    "beers",
    "last_drink_name",
    "activity_id",
}


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
    account.save(update_fields=["nickname"])
    return resp.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _out(account: Account, *, minutes_ago: int = 30, name: str = "U Pinkasů") -> PubVisit:
    started = timezone.now() - timedelta(minutes=minutes_ago)
    return PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbjnq",
        name=name,
        lat=50.0835,
        lng=14.4226,
        started_at=started,
        ended_at=started + timedelta(minutes=10),
        client_updated_at=started,
    )


@pytest.fixture
def party(client):
    me_token, me = _register(client, "marek")
    friend_token, friend = _register(client, "klara")
    Friendship.objects.create(requester=me, recipient=friend, status=Friendship.Status.ACCEPTED)
    return me_token, me, friend_token, friend


def _cheer(client, token, account: Account, method: str = "post"):
    call = client.post if method == "post" else client.delete
    return call(f"/v1/friends/{account.public_id}/cheer", data={"reaction": "cheers"}, format="json", **_auth(token))


def _presence_of(client, token, account: Account) -> dict:
    body = client.get("/v1/friends", **_auth(token)).json()
    rows = [row for row in body["presence"] if row["account"]["id"] == str(account.public_id)]
    return rows[0] if rows else body["my_presence"]


@pytest.mark.django_db
def test_cheer_a_friend_who_never_broadcast_notifies_once_and_undoes(client, party):
    me_token, me, friend_token, friend = party
    _out(friend)

    resp = _cheer(client, me_token, friend)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"reactions": {"cheers": 1}, "my_reaction": "cheers"}

    note = FriendNotification.objects.get(recipient=friend, kind=FriendNotification.Kind.FRIEND_CHEERS)
    assert note.actor == me
    assert note.title == "Na zdraví!"
    assert note.body == "@marek ti připil. Na zdraví!"

    # The friend sees the count on their own row; I see mine is given.
    assert _presence_of(client, friend_token, friend)["reactions"] == {"cheers": 1}
    row = _presence_of(client, me_token, friend)
    assert row["reactions"] == {"cheers": 1}
    assert row["my_reaction"] == "cheers"
    assert RELEASED_PRESENCE_KEYS <= set(row)

    # An offline replay of the same cheer neither duplicates nor re-notifies.
    assert _cheer(client, me_token, friend).json()["reactions"] == {"cheers": 1}
    undo = _cheer(client, me_token, friend, "delete")
    assert undo.status_code == status.HTTP_200_OK
    assert undo.json() == {"reactions": {"cheers": 0}, "my_reaction": None}
    assert _cheer(client, me_token, friend, "delete").status_code == status.HTTP_200_OK
    # Undo and redo within one sitting does not spam the friend.
    _cheer(client, me_token, friend)
    assert FriendNotification.objects.filter(recipient=friend, kind=FriendNotification.Kind.FRIEND_CHEERS).count() == 1


@pytest.mark.django_db
def test_cheer_only_reaches_a_friend_the_party_can_see_out(client, party):
    me_token, me, _, friend = party
    _, stranger = _register(client, "cizi")
    _out(stranger)
    assert _cheer(client, me_token, stranger).json()["code"] == "friend_not_found"

    # Not out at all, then gone home.
    assert _cheer(client, me_token, friend).json()["code"] == "not_out"
    visit = _out(friend)
    visit.closed_at = timezone.now()
    visit.save(update_fields=["closed_at"])
    assert _cheer(client, me_token, friend).json()["code"] == "not_out"

    _out(friend)
    for field in ("ghost_mode", "share_drinks_with_parta"):
        setattr(friend, field, field == "ghost_mode")
        friend.save(update_fields=[field])
        assert _cheer(client, me_token, friend).json()["code"] == "not_out"
        setattr(friend, field, field != "ghost_mode")
        friend.save(update_fields=[field])

    FriendBlock.objects.create(blocker=friend, blocked=me)
    assert _cheer(client, me_token, friend).status_code == status.HTTP_404_NOT_FOUND
    assert not PubVisitReaction.objects.exists()
    assert not FriendNotification.objects.filter(kind=FriendNotification.Kind.FRIEND_CHEERS).exists()


@pytest.mark.django_db
def test_ghost_sender_sends_nothing(client, party):
    me_token, me, _, friend = party
    _out(friend)
    me.ghost_mode = True
    me.save(update_fields=["ghost_mode"])

    resp = _cheer(client, me_token, friend)
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "ghost_mode"
    assert not PubVisitReaction.objects.exists()


@pytest.mark.django_db
def test_unknown_reaction_and_missing_auth_are_refused(client, party):
    me_token, _, _, friend = party
    _out(friend)
    bad = client.post(f"/v1/friends/{friend.public_id}/cheer", data={"reaction": "beer"}, format="json", **_auth(me_token))
    assert bad.status_code == status.HTTP_400_BAD_REQUEST
    anonymous = client.post(f"/v1/friends/{friend.public_id}/cheer", data={"reaction": "cheers"}, format="json")
    assert anonymous.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


@pytest.mark.django_db
def test_export_lists_the_cheers_i_gave(client, party):
    me_token, _, _, friend = party
    _out(friend)
    _cheer(client, me_token, friend)

    reactions = client.get("/v1/account/export", **_auth(me_token)).json()["social"]["reactions"]

    assert [r for r in reactions if r["target"] == "friend_presence"] == [
        {
            "target": "friend_presence",
            "friend_id": str(friend.public_id),
            "pub_name": "U Pinkasů",
            "kind": "cheers",
            "created_at": reactions[-1]["created_at"],
            "updated_at": reactions[-1]["updated_at"],
        }
    ]

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    BeerCheckIn,
    BeerCheckInReaction,
    FriendBlock,
    Friendship,
)


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
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    token = resp.json()["token"]
    account = Account.objects.get(public_id=resp.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.is_public = True
    account.save(update_fields=["nickname", "display_name", "is_public"])
    return token, account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _make_friends(a: Account, b: Account) -> None:
    Friendship.objects.create(
        requester=a,
        recipient=b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )


def _payload(client_id: uuid.UUID | None = None, *, visibility: str = "friends") -> dict:
    return {
        "client_id": str(client_id or uuid.uuid4()),
        "beer_name": "Plzeň 12",
        "brewery_name": "Pilsner Urquell",
        "beer_style": "Ležák",
        "abv": "4.40",
        "rating": "4.5",
        "note": "Hořký tak akorát.",
        "pub_cache_key": "u2fkbn1z",
        "pub_name": "U Zlatého tygra",
        "pub_city": "Praha",
        "visibility": visibility,
        "checked_in_at": timezone.now().isoformat(),
    }


@pytest.mark.django_db
def test_private_checkin_is_not_in_friend_feed(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    resp = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="private"),
        format="json",
        **_auth(token_owner),
    )
    assert resp.status_code == status.HTTP_201_CREATED, resp.content

    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))

    assert feed.status_code == status.HTTP_200_OK, feed.content
    assert feed.json()["checkins"] == []


@pytest.mark.django_db
def test_accepted_friend_sees_friends_checkin(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )

    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))

    assert feed.status_code == status.HTTP_200_OK, feed.content
    body = feed.json()["checkins"]
    assert len(body) == 1
    assert body[0]["account"]["nickname"] == "janek"
    assert body[0]["beer_name"] == "Plzeň 12"
    assert body[0]["rating"] == "4.5"


@pytest.mark.django_db
def test_block_hides_checkins_and_rejects_reaction(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    create = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )
    checkin_id = create.json()["id"]
    FriendBlock.objects.create(blocker=friend, blocked=owner)

    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))
    react = client.post(
        f"/v1/beer-checkins/{checkin_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )

    assert feed.status_code == status.HTTP_200_OK, feed.content
    assert feed.json()["checkins"] == []
    assert react.status_code == status.HTTP_403_FORBIDDEN, react.content
    assert react.json()["code"] == "blocked"


@pytest.mark.django_db
def test_client_id_upsert_is_idempotent(client):
    token, _account = _register(client, "janek")
    client_id = uuid.uuid4()
    first = client.post(
        "/v1/beer-checkins",
        data=_payload(client_id, visibility="private"),
        format="json",
        **_auth(token),
    )
    second_payload = _payload(client_id, visibility="private")
    second_payload["rating"] = "3.5"
    second_payload["note"] = "Druhá úprava."
    second = client.post(
        "/v1/beer-checkins",
        data=second_payload,
        format="json",
        **_auth(token),
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert second.status_code == status.HTTP_200_OK, second.content
    assert BeerCheckIn.objects.count() == 1
    row = BeerCheckIn.objects.get()
    assert str(row.rating) == "3.5"
    assert row.note == "Druhá úprava."


@pytest.mark.django_db
def test_checkin_cheers_reaction_upserts_and_unreacts(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    create = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )
    checkin_id = create.json()["id"]

    first = client.post(
        f"/v1/beer-checkins/{checkin_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )
    second = client.post(
        f"/v1/beer-checkins/{checkin_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    assert first.json()["reactions"]["cheers"] == 1
    assert second.status_code == status.HTTP_200_OK, second.content
    assert BeerCheckInReaction.objects.count() == 1

    removed = client.delete(f"/v1/beer-checkins/{checkin_id}/react", **_auth(token_friend))

    assert removed.status_code == status.HTTP_200_OK, removed.content
    assert removed.json()["removed"] is True
    assert BeerCheckInReaction.objects.count() == 0


@pytest.mark.django_db
def test_beer_detail_aggregates_mine_and_party(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="private"),
        format="json",
        **_auth(token_friend),
    )
    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )

    detail = client.get(
        "/v1/beers/detail?beer_name=Plze%C5%88%2012&brewery_name=Pilsner%20Urquell",
        **_auth(token_friend),
    )

    assert detail.status_code == status.HTTP_200_OK, detail.content
    body = detail.json()
    assert body["my_count"] == 1
    assert body["party_count"] == 1
    assert [profile["nickname"] for profile in body["party_drinkers"]] == ["janek"]
    assert len(body["my_history"]) == 1
    assert len(body["recent_checkins"]) == 2


@pytest.mark.django_db
def test_beer_detail_hides_ghost_mode_friend_checkins(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])
    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )

    detail = client.get(
        "/v1/beers/detail?beer_name=Plze%C5%88%2012&brewery_name=Pilsner%20Urquell",
        **_auth(token_friend),
    )

    assert detail.status_code == status.HTTP_200_OK, detail.content
    body = detail.json()
    assert body["party_count"] == 0
    assert body["party_drinkers"] == []
    assert body["recent_checkins"] == []


@pytest.mark.django_db
def test_account_export_includes_social_and_beer_checkins(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    checkin = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )
    client.post(
        f"/v1/beer-checkins/{checkin.json()['id']}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )

    export = client.get("/v1/account/export", **_auth(token_owner))

    assert export.status_code == status.HTTP_200_OK, export.content
    body = export.json()
    assert body["beer_checkins"][0]["beer_name"] == "Plzeň 12"
    assert body["social"]["friendships"][0]["status"] == Friendship.Status.ACCEPTED
    assert body["social"]["reactions"] == []

    friend_export = client.get("/v1/account/export", **_auth(token_friend))
    assert friend_export.status_code == status.HTTP_200_OK, friend_export.content
    friend_body = friend_export.json()
    assert friend_body["social"]["reactions"][0]["target"] == "beer_checkin"
    assert friend_body["social"]["blocks"] == []

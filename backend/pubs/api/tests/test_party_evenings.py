from __future__ import annotations

import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.party_views import _serialize_evening
from pubs.models import (
    Account,
    DrinkLog,
    FriendBlock,
    Friendship,
    PartyEvening,
    PartyEveningDrink,
    PartyEveningMember,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _generous_throttle(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "account": "10000/min",
            "friends": "10000/min",
        },
    }


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    response = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=response.json()["id"])
    account.nickname = nickname
    account.save(update_fields=["nickname"])
    return response.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _friend(left: Account, right: Account) -> None:
    Friendship.objects.create(
        requester=left,
        recipient=right,
        status=Friendship.Status.ACCEPTED,
    )


def _create(client: APIClient, token: str, code: str = "STUL24"):
    return client.post(
        "/v1/party-evenings",
        data={
            "client_id": str(uuid.uuid4()),
            "join_code": code,
            "pub_name": "U Zlatého tygra",
            "pub_city": "Praha",
        },
        format="json",
        **_auth(token),
    )


@pytest.mark.django_db
def test_friends_join_explicit_evening_share_drink_and_see_chronological_feed(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)

    created = _create(client, host_token)
    assert created.status_code == status.HTTP_201_CREATED
    assert created.json()["is_host"] is True
    assert created.json()["host"]["nickname"] == "host"
    assert created.json()["join_url"].endswith("/STUL24")
    assert "lat" not in created.json()

    joined = client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token))
    assert joined.status_code == status.HTTP_200_OK
    assert [member["nickname"] for member in joined.json()["members"]] == ["host", "kamos"]

    drink_client_id = str(uuid.uuid4())
    shared = client.post(
        "/v1/party-evenings/STUL24/drinks",
        data={"client_id": drink_client_id, "beer_name": "Plzeň", "quantity": 2},
        format="json",
        **_auth(friend_token),
    )
    assert shared.status_code == status.HTTP_201_CREATED

    detail = client.get("/v1/party-evenings/STUL24", **_auth(friend_token))
    assert detail.status_code == status.HTTP_200_OK
    events = detail.json()["events"]
    assert [event["at"] for event in events] == sorted(event["at"] for event in events)
    assert [event["kind"] for event in events].count("joined") == 2
    assert events[-1]["kind"] == "drink"
    assert events[-1]["beer_name"] == "Plzeň"
    assert events[-1]["quantity"] == 2
    assert PartyEveningDrink.objects.count() == 1

    # Retrying an offline write is idempotent and does not duplicate the shared drink.
    retry = client.post(
        "/v1/party-evenings/STUL24/drinks",
        data={"client_id": drink_client_id, "beer_name": "Plzeň", "quantity": 2},
        format="json",
        **_auth(friend_token),
    )
    assert retry.status_code == status.HTTP_200_OK
    assert retry.json()["created"] is False
    assert PartyEveningDrink.objects.count() == 1


@pytest.mark.django_db
def test_only_friends_can_join_and_only_host_can_end(client):
    host_token, _host = _register(client, "host")
    stranger_token, _stranger = _register(client, "cizi")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED

    denied = client.post("/v1/party-evenings/STUL24/join", **_auth(stranger_token))
    assert denied.status_code == status.HTTP_403_FORBIDDEN
    assert denied.json()["code"] == "not_friends"

    foreign_end = client.post("/v1/party-evenings/STUL24/end", **_auth(stranger_token))
    assert foreign_end.status_code == status.HTTP_404_NOT_FOUND
    assert PartyEvening.objects.get().active is True

    ended = client.post("/v1/party-evenings/STUL24/end", **_auth(host_token))
    assert ended.status_code == status.HTTP_200_OK
    assert ended.json()["active"] is False
    assert ended.json()["ended_at"] is not None
    assert client.get("/v1/party-evenings", **_auth(host_token)).json()["evening"] is None


@pytest.mark.django_db
def test_member_can_leave_without_ending_evening(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token)).status_code == 200

    left = client.delete("/v1/party-evenings/STUL24/join", **_auth(friend_token))
    assert left.status_code == status.HTTP_200_OK
    assert left.json() == {"left": True}
    assert PartyEvening.objects.get().active is True
    assert client.get("/v1/party-evenings/STUL24", **_auth(friend_token)).status_code == 404


@pytest.mark.django_db
def test_ghost_mode_blocks_create_join_and_explicit_drink_share(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)

    host.ghost_mode = True
    host.save(update_fields=["ghost_mode"])
    denied_create = _create(client, host_token)
    assert denied_create.status_code == status.HTTP_409_CONFLICT
    assert denied_create.json()["code"] == "ghost_mode"

    host.ghost_mode = False
    host.save(update_fields=["ghost_mode"])
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED

    friend.ghost_mode = True
    friend.save(update_fields=["ghost_mode"])
    denied_join = client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token))
    assert denied_join.status_code == status.HTTP_409_CONFLICT
    assert denied_join.json()["code"] == "ghost_mode"

    friend.ghost_mode = False
    friend.save(update_fields=["ghost_mode"])
    assert client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token)).status_code == 200
    friend.ghost_mode = True
    friend.save(update_fields=["ghost_mode"])
    denied_drink = client.post(
        "/v1/party-evenings/STUL24/drinks",
        data={"client_id": str(uuid.uuid4()), "beer_name": "Kozel"},
        format="json",
        **_auth(friend_token),
    )
    assert denied_drink.status_code == status.HTTP_409_CONFLICT
    assert denied_drink.json()["code"] == "party_not_active"
    assert client.get("/v1/party-evenings/STUL24", **_auth(friend_token)).status_code == 404

    host_view = client.get("/v1/party-evenings/STUL24", **_auth(host_token))
    assert [member["nickname"] for member in host_view.json()["members"]] == ["host"]


@pytest.mark.django_db
def test_member_loses_evening_access_after_block_or_friendship_removal(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    friendship = Friendship.objects.create(
        requester=host,
        recipient=friend,
        status=Friendship.Status.ACCEPTED,
    )
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token)).status_code == 200

    FriendBlock.objects.create(blocker=host, blocked=friend)
    assert client.get("/v1/party-evenings/STUL24", **_auth(friend_token)).status_code == 404
    denied_share = client.post(
        "/v1/party-evenings/STUL24/drinks",
        data={"client_id": str(uuid.uuid4()), "beer_name": "Kozel"},
        format="json",
        **_auth(friend_token),
    )
    assert denied_share.status_code == status.HTTP_409_CONFLICT
    assert [
        member["nickname"]
        for member in client.get("/v1/party-evenings/STUL24", **_auth(host_token)).json()["members"]
    ] == ["host"]

    FriendBlock.objects.all().delete()
    friendship.status = Friendship.Status.DECLINED
    friendship.save(update_fields=["status"])
    assert client.get("/v1/party-evenings/STUL24", **_auth(friend_token)).status_code == 404


@pytest.mark.django_db
def test_host_cannot_start_two_active_evenings(client):
    token, _host = _register(client, "host")
    assert _create(client, token, code="STUL24").status_code == status.HTTP_201_CREATED

    second = _create(client, token, code="DRUHY2")
    assert second.status_code == status.HTTP_409_CONFLICT
    assert second.json()["code"] == "active_party_exists"
    assert PartyEvening.objects.count() == 1


@pytest.mark.django_db
def test_member_cannot_join_or_host_two_active_evenings(client):
    first_host_token, first_host = _register(client, "first-host")
    second_host_token, second_host = _register(client, "second-host")
    member_token, member = _register(client, "member")
    _friend(first_host, member)
    _friend(second_host, member)
    assert _create(client, first_host_token, code="PRVNI2").status_code == 201
    assert _create(client, second_host_token, code="DRUHY2").status_code == 201
    assert client.post("/v1/party-evenings/PRVNI2/join", **_auth(member_token)).status_code == 200

    second_join = client.post("/v1/party-evenings/DRUHY2/join", **_auth(member_token))
    assert second_join.status_code == status.HTTP_409_CONFLICT
    assert second_join.json()["code"] == "active_party_membership_exists"
    assert PartyEveningMember.objects.filter(account=member, active=True).count() == 1

    hosted = _create(client, member_token, code="HOST33")
    assert hosted.status_code == status.HTTP_409_CONFLICT
    assert hosted.json()["code"] == "active_party_membership_exists"


@pytest.mark.django_db
def test_evening_serialization_query_count_does_not_scale_with_members(client):
    host_token, host = _register(client, "host")
    assert _create(client, host_token).status_code == 201
    evening = PartyEvening.objects.select_related("host").get()
    for index in range(8):
        _token, friend = _register(client, f"friend-{index}")
        _friend(host, friend)
        PartyEveningMember.objects.create(evening=evening, account=friend)

    with CaptureQueriesContext(connection) as queries:
        payload = _serialize_evening(evening, host)

    assert len(payload["members"]) == 9
    # Five, not four: the evening reads drinks from two sources now — the shared
    # table released apps write to, and the diary rows the current app tags.
    # Constant either way, which is what this test is about.
    assert len(queries) <= 5


@pytest.mark.django_db
def test_create_is_idempotent_and_current_endpoint_restores_evening(client):
    token, _host = _register(client, "host")
    client_id = str(uuid.uuid4())
    payload = {
        "client_id": client_id,
        "join_code": "STUL24",
        "pub_name": "U Zlatého tygra",
    }
    first = client.post("/v1/party-evenings", data=payload, format="json", **_auth(token))
    second = client.post("/v1/party-evenings", data=payload, format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_200_OK
    assert PartyEvening.objects.count() == 1

    current = client.get("/v1/party-evenings", **_auth(token))
    assert current.status_code == status.HTTP_200_OK
    assert current.json()["evening"]["join_code"] == "STUL24"


def _log_drink(client: APIClient, token: str, name: str, **extra):
    """A beer through the diary — the one place a beer is written."""
    return client.post(
        "/v1/drinks",
        data={
            "client_id": str(uuid.uuid4()),
            "name": "U Zlatého tygra",
            "lat": 50.0865,
            "lng": 14.4192,
            "beer": {"name": name, "price_czk": 55},
            **extra,
        },
        format="json",
        **_auth(token),
    )


@pytest.mark.django_db
def test_a_beer_logged_during_an_evening_shows_up_in_it_without_a_second_write(client):
    """
    One write, two readers.

    The beer goes into the diary exactly once, as it always has. The evening is
    a lens over that row — no `PartyEveningDrink`, which is what made the old
    version ask people to log every beer twice.
    """
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)
    _create(client, host_token)
    client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token))

    logged = _log_drink(client, friend_token, "Plzeň", party_code="STUL24")
    assert logged.status_code == status.HTTP_201_CREATED

    detail = client.get("/v1/party-evenings/STUL24", **_auth(host_token)).json()
    drinks = [event for event in detail["events"] if event["kind"] == "drink"]
    assert [event["beer_name"] for event in drinks] == ["Pilsner Urquell"]
    assert drinks[0]["account"]["nickname"] == "kamos"
    # The shared table is a lens, not a second table.
    assert PartyEveningDrink.objects.count() == 0
    assert DrinkLog.objects.filter(account=friend).count() == 1


@pytest.mark.django_db
def test_a_code_that_no_longer_works_never_costs_you_the_beer(client):
    """
    The queue flushes when the signal comes back, which may be after closing
    time. A stale code must be ignored, never rejected — otherwise one ended
    evening jams every drink behind it.
    """
    host_token, host = _register(client, "host")
    _create(client, host_token)
    client.post("/v1/party-evenings/STUL24/end", **_auth(host_token))

    logged = _log_drink(client, host_token, "Kozel", party_code="STUL24")
    assert logged.status_code == status.HTTP_201_CREATED
    # By account, not by name: the server canonicalises a beer name against the
    # brand catalogue, so "Kozel" comes back as "Velkopopovický Kozel".
    assert DrinkLog.objects.get(account=host).party_evening is None

    # And a code belonging to somebody else's table is the same non-event.
    stranger_token, stranger = _register(client, "cizi")
    other = _log_drink(client, stranger_token, "Radegast", party_code="STUL24")
    assert other.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.get(account=stranger).party_evening is None


@pytest.mark.django_db
def test_the_drink_feed_toggle_keeps_the_glass_private(client):
    """
    Joining a table shares that you are there, not what is in your glass.

    `share_drinks_with_parta` says "friends may see my automatic drink feed", and
    tagging every beer with an evening is exactly that feed. Off means the beer
    is logged and simply never linked.
    """
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)
    _create(client, host_token)
    client.post("/v1/party-evenings/STUL24/join", **_auth(friend_token))
    friend.share_drinks_with_parta = False
    friend.save(update_fields=["share_drinks_with_parta"])

    _log_drink(client, friend_token, "Plzeň", party_code="STUL24")

    detail = client.get("/v1/party-evenings/STUL24", **_auth(host_token)).json()
    assert [event for event in detail["events"] if event["kind"] == "drink"] == []
    assert DrinkLog.objects.filter(account=friend).count() == 1

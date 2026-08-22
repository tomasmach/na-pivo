from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.db import connection
from django.db.models import Q
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api import party_views
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
            "friends_dashboard": "10000/min",
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


def _create(client: APIClient, token: str, code: str = "PRAH24"):
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
def test_ended_history_is_recent_bounded_and_requires_explicit_membership(client, monkeypatch):
    host_token, _host = _register(client, "host")
    member_token, _member = _register(client, "member")
    stranger_token, _stranger = _register(client, "stranger")

    assert _create(client, host_token, code="PRVA24").status_code == 201
    assert client.post("/v1/party-evenings/PRVA24/join", **_auth(member_token)).status_code == 200
    assert client.delete("/v1/party-evenings/PRVA24/join", **_auth(member_token)).status_code == 200
    assert client.post("/v1/party-evenings/PRVA24/end", **_auth(host_token)).status_code == 200

    assert _create(client, host_token, code="DRUHY2").status_code == 201
    assert client.post("/v1/party-evenings/DRUHY2/join", **_auth(member_token)).status_code == 200
    assert client.post("/v1/party-evenings/DRUHY2/end", **_auth(host_token)).status_code == 200

    # A currently running table is never part of recap history.
    assert _create(client, host_token, code="AKTYV2").status_code == 201
    assert client.post("/v1/party-evenings/AKTYV2/join", **_auth(member_token)).status_code == 200

    monkeypatch.setattr(party_views, "PARTY_HISTORY_MAX_EVENINGS", 1)
    response = client.get("/v1/party-evenings/history", **_auth(member_token))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "evenings": [
            {
                "id": str(PartyEvening.objects.get(join_code="DRUHY2").public_id),
                "join_code": "DRUHY2",
                "pub_name": "U Zlatého tygra",
                "pub_city": "Praha",
                "started_at": PartyEvening.objects.get(join_code="DRUHY2").started_at.isoformat(),
                "ended_at": PartyEvening.objects.get(join_code="DRUHY2").ended_at.isoformat(),
                "is_host": False,
            }
        ],
        "truncated": True,
    }
    assert client.get("/v1/party-evenings/history", **_auth(stranger_token)).json() == {
        "evenings": [],
        "truncated": False,
    }


@pytest.mark.django_db
@pytest.mark.parametrize("guard", ["member_ghost", "host_ghost", "blocked", "host_inactive"])
def test_ended_history_honours_current_privacy_guards(client, guard):
    host_token, host = _register(client, "host")
    member_token, member = _register(client, "member")
    assert _create(client, host_token).status_code == 201
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200
    assert client.post("/v1/party-evenings/PRAH24/end", **_auth(host_token)).status_code == 200

    if guard == "member_ghost":
        member.ghost_mode = True
        member.save(update_fields=["ghost_mode"])
    elif guard == "host_ghost":
        host.ghost_mode = True
        host.save(update_fields=["ghost_mode"])
    elif guard == "blocked":
        FriendBlock.objects.create(blocker=member, blocked=host)
    else:
        host.status = Account.Status.PENDING_DELETION
        host.save(update_fields=["status"])

    response = client.get("/v1/party-evenings/history", **_auth(member_token))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"evenings": [], "truncated": False}


@pytest.mark.django_db
def test_friends_join_explicit_evening_share_drink_and_see_chronological_feed(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)

    created = _create(client, host_token)
    assert created.status_code == status.HTTP_201_CREATED
    assert created.json()["is_host"] is True
    assert created.json()["host"]["nickname"] == "host"
    assert created.json()["join_url"].endswith("/PRAH24")
    assert "lat" not in created.json()

    joined = client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token))
    assert joined.status_code == status.HTTP_200_OK
    assert [member["nickname"] for member in joined.json()["members"]] == ["host", "kamos"]

    drink_client_id = str(uuid.uuid4())
    shared = client.post(
        "/v1/party-evenings/PRAH24/drinks",
        data={"client_id": drink_client_id, "beer_name": "Plzeň", "quantity": 2},
        format="json",
        **_auth(friend_token),
    )
    assert shared.status_code == status.HTTP_201_CREATED

    detail = client.get("/v1/party-evenings/PRAH24", **_auth(friend_token))
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
        "/v1/party-evenings/PRAH24/drinks",
        data={"client_id": drink_client_id, "beer_name": "Plzeň", "quantity": 2},
        format="json",
        **_auth(friend_token),
    )
    assert retry.status_code == status.HTTP_200_OK
    assert retry.json()["created"] is False
    assert PartyEveningDrink.objects.count() == 1


@pytest.mark.django_db
def test_drink_sharing_disabled_blocks_legacy_write_without_blocking_membership(client):
    host_token, _host = _register(client, "host")
    member_token, member = _register(client, "soukromy")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED

    member.share_drinks_with_parta = False
    member.save(update_fields=["share_drinks_with_parta"])
    joined = client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token))
    assert joined.status_code == status.HTTP_200_OK
    assert [item["nickname"] for item in joined.json()["members"]] == [
        "host",
        "soukromy",
    ]

    denied = client.post(
        "/v1/party-evenings/PRAH24/drinks",
        data={
            "client_id": str(uuid.uuid4()),
            "beer_name": "Soukromá Plzeň",
            "quantity": 2,
        },
        format="json",
        **_auth(member_token),
    )

    assert denied.status_code == status.HTTP_409_CONFLICT
    assert denied.json() == {
        "detail": "Turn on drink sharing before sharing a drink.",
        "code": "drink_sharing_disabled",
    }
    assert PartyEveningDrink.objects.filter(account=member).count() == 0


@pytest.mark.django_db
def test_opt_out_hides_preexisting_legacy_and_diary_drinks_from_other_members(client):
    host_token, host = _register(client, "host")
    member_token, member = _register(client, "soukromy")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200
    evening = PartyEvening.objects.get(join_code="PRAH24")
    PartyEveningDrink.objects.create(
        evening=evening,
        account=member,
        client_id=uuid.uuid4(),
        beer_name="Legacy Plzeň",
    )
    DrinkLog.objects.create(
        party_evening=evening,
        account=member,
        client_id=uuid.uuid4(),
        beer_name="Deníkový Kozel",
        drank_at=timezone.now(),
    )

    before = client.get("/v1/party-evenings/PRAH24", **_auth(host_token)).json()
    assert [event["beer_name"] for event in before["events"] if event["kind"] == "drink"] == [
        "Legacy Plzeň",
        "Deníkový Kozel",
    ]

    member.share_drinks_with_parta = False
    member.save(update_fields=["share_drinks_with_parta"])

    host_detail = client.get("/v1/party-evenings/PRAH24", **_auth(host_token)).json()
    assert [event for event in host_detail["events"] if event["kind"] == "drink"] == []
    owner_detail = client.get("/v1/party-evenings/PRAH24", **_auth(member_token)).json()
    assert {
        event["beer_name"] for event in owner_detail["events"] if event["kind"] == "drink"
    } == {"Legacy Plzeň", "Deníkový Kozel"}
    assert PartyEveningDrink.objects.filter(account=member).count() == 1
    assert DrinkLog.objects.filter(account=member, party_evening=evening).count() == 1


@pytest.mark.django_db
def test_valid_code_creates_membership_and_friendship(client):
    host_token, host = _register(client, "host")
    stranger_token, stranger = _register(client, "cizi")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED

    joined = client.post("/v1/party-evenings/PRAH24/join", **_auth(stranger_token))
    assert joined.status_code == status.HTTP_200_OK
    assert [member["nickname"] for member in joined.json()["members"]] == ["host", "cizi"]
    friendship = Friendship.objects.get(
        requester__in=(host, stranger), recipient__in=(host, stranger)
    )
    assert friendship.status == Friendship.Status.ACCEPTED
    assert friendship.responded_at is not None

    foreign_end = client.post("/v1/party-evenings/PRAH24/end", **_auth(stranger_token))
    assert foreign_end.status_code == status.HTTP_404_NOT_FOUND
    assert PartyEvening.objects.get().active is True

    ended = client.post("/v1/party-evenings/PRAH24/end", **_auth(host_token))
    assert ended.status_code == status.HTTP_200_OK
    assert ended.json()["active"] is False
    assert ended.json()["ended_at"] is not None
    assert client.get("/v1/party-evenings", **_auth(host_token)).json()["evening"] is None


@pytest.mark.django_db
def test_join_connects_three_people_once(client):
    host_token, host = _register(client, "host")
    first_token, first = _register(client, "prvni")
    second_token, second = _register(client, "druhy")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    pending = Friendship.objects.create(
        requester=host,
        recipient=first,
        status=Friendship.Status.PENDING,
    )
    old_requested_at = timezone.now() - timedelta(days=1)
    Friendship.objects.filter(pk=pending.pk).update(requested_at=old_requested_at)

    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(first_token)).status_code == 200
    pending.refresh_from_db()
    assert pending.status == Friendship.Status.ACCEPTED
    assert pending.requested_at > old_requested_at
    assert pending.responded_at is not None
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(second_token)).status_code == 200

    rows = Friendship.objects.filter(status=Friendship.Status.ACCEPTED)
    assert rows.count() == 3
    pairs = {
        frozenset((row.requester_id, row.recipient_id))
        for row in rows
    }
    assert pairs == {
        frozenset((host.id, first.id)),
        frozenset((host.id, second.id)),
        frozenset((first.id, second.id)),
    }
    assert all(row.responded_at is not None for row in rows)

    replayed = client.post("/v1/party-evenings/PRAH24/join", **_auth(second_token))
    assert replayed.status_code == status.HTTP_200_OK
    assert Friendship.objects.filter(status=Friendship.Status.ACCEPTED).count() == 3


@pytest.mark.django_db
def test_join_is_bounded_and_friendship_sync_has_constant_query_growth(client, monkeypatch):
    host_token, host = _register(client, "host")
    first_token, _first = _register(client, "first")
    second_token, _second = _register(client, "second")
    overflow_token, overflow = _register(client, "overflow")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(first_token)).status_code == 200
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(second_token)).status_code == 200

    monkeypatch.setattr(party_views, "PARTY_EVENING_MAX_MEMBERS", 3)
    with CaptureQueriesContext(connection) as captured:
        response = client.post(
            "/v1/party-evenings/PRAH24/join",
            **_auth(overflow_token),
        )

    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["code"] == "party_full"
    assert not PartyEveningMember.objects.filter(account=overflow).exists()
    assert len(captured) <= 15
    assert Friendship.objects.filter(
        Q(requester=overflow, recipient=host) | Q(requester=host, recipient=overflow)
    ).count() == 0


@pytest.mark.django_db
def test_join_preserves_declines_and_skips_blocked_members(client):
    host_token, host = _register(client, "host")
    declined_token, declined_peer = _register(client, "odmitnuty")
    blocked_token, blocked_peer = _register(client, "blokovany")
    joiner_token, joiner = _register(client, "novy")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(declined_token)).status_code == 200
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(blocked_token)).status_code == 200

    declined = Friendship.objects.create(
        requester=joiner,
        recipient=declined_peer,
        status=Friendship.Status.DECLINED,
        responded_at=timezone.now(),
    )
    FriendBlock.objects.create(blocker=blocked_peer, blocked=joiner)

    joined = client.post("/v1/party-evenings/PRAH24/join", **_auth(joiner_token))

    assert joined.status_code == status.HTTP_200_OK
    declined.refresh_from_db()
    assert declined.status == Friendship.Status.DECLINED
    assert not Friendship.objects.filter(
        Q(requester=joiner, recipient=blocked_peer)
        | Q(requester=blocked_peer, recipient=joiner)
    ).exists()
    assert Friendship.objects.filter(
        Q(requester=joiner, recipient=host)
        | Q(requester=host, recipient=joiner),
        status=Friendship.Status.ACCEPTED,
    ).count() == 1


@pytest.mark.django_db
def test_friendship_sync_failure_does_not_fail_join(client, monkeypatch):
    host_token, _host = _register(client, "host")
    member_token, member = _register(client, "kamos")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED

    def fail_sync(*_args, **_kwargs):
        raise RuntimeError("friendship sync failed")

    monkeypatch.setattr(party_views, "_accept_evening_friendships", fail_sync)
    joined = client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token))

    assert joined.status_code == status.HTTP_200_OK
    assert PartyEveningMember.objects.filter(account=member, active=True).exists()


@pytest.mark.django_db
def test_create_accepts_join_code_from_released_clients(client):
    host_token, _host = _register(client, "host")

    response = _create(client, host_token, code="STUL24")

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["join_code"] == "STUL24"
    assert PartyEvening.objects.filter(join_code="STUL24").exists()


@pytest.mark.django_db
@pytest.mark.parametrize("forbidden", ["0", "1"])
def test_create_still_rejects_characters_outside_legacy_alphabet(client, forbidden):
    host_token, _host = _register(client, "host")

    response = _create(client, host_token, code=f"{forbidden}ABCDE")

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "join_code" in response.json()
    assert PartyEvening.objects.count() == 0


@pytest.mark.django_db
def test_member_can_leave_without_ending_evening(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    _friend(host, friend)
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token)).status_code == 200
    logged = _log_drink(client, friend_token, "Plzeň", party_code="PRAH24")
    assert logged.status_code == status.HTTP_201_CREATED

    left = client.delete("/v1/party-evenings/PRAH24/join", **_auth(friend_token))
    assert left.status_code == status.HTTP_200_OK
    assert left.json() == {"left": True}
    assert PartyEvening.objects.get().active is True
    assert client.get("/v1/party-evenings/PRAH24", **_auth(friend_token)).status_code == 404

    # Released `members` remains the active roster, while the additive history
    # keeps the departed person's signed rows for everybody still at the table.
    host_detail = client.get("/v1/party-evenings/PRAH24", **_auth(host_token)).json()
    assert [member["nickname"] for member in host_detail["members"]] == ["host"]
    departed = next(
        participant
        for participant in host_detail["participants"]
        if participant["nickname"] == "kamos"
    )
    assert departed["active"] is False
    assert departed["left_at"] is not None
    assert [
        event["account"]["nickname"] for event in host_detail["events"] if event["kind"] == "drink"
    ] == ["kamos"]
    # `left` lives in the new forward-compatible record timeline; old clients
    # only know joined|drink and would otherwise parse it as another join.
    record = client.get("/v1/party-evenings/PRAH24/record", **_auth(host_token)).json()
    assert any(
        event["kind"] == "left" and event["account"]["nickname"] == "kamos"
        for event in record["events"]
    )


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
    denied_join = client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token))
    assert denied_join.status_code == status.HTTP_409_CONFLICT
    assert denied_join.json()["code"] == "ghost_mode"

    friend.ghost_mode = False
    friend.save(update_fields=["ghost_mode"])
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token)).status_code == 200
    friend.ghost_mode = True
    friend.save(update_fields=["ghost_mode"])
    denied_drink = client.post(
        "/v1/party-evenings/PRAH24/drinks",
        data={"client_id": str(uuid.uuid4()), "beer_name": "Kozel"},
        format="json",
        **_auth(friend_token),
    )
    assert denied_drink.status_code == status.HTTP_409_CONFLICT
    assert denied_drink.json()["code"] == "party_not_active"
    assert client.get("/v1/party-evenings/PRAH24", **_auth(friend_token)).status_code == 404

    host_view = client.get("/v1/party-evenings/PRAH24", **_auth(host_token))
    assert [member["nickname"] for member in host_view.json()["members"]] == ["host"]


@pytest.mark.django_db
def test_block_revokes_access_but_friendship_is_not_required(client):
    host_token, host = _register(client, "host")
    friend_token, friend = _register(client, "kamos")
    friendship = Friendship.objects.create(
        requester=host,
        recipient=friend,
        status=Friendship.Status.ACCEPTED,
    )
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token)).status_code == 200

    FriendBlock.objects.create(blocker=host, blocked=friend)
    assert client.get("/v1/party-evenings/PRAH24", **_auth(friend_token)).status_code == 404
    denied_share = client.post(
        "/v1/party-evenings/PRAH24/drinks",
        data={"client_id": str(uuid.uuid4()), "beer_name": "Kozel"},
        format="json",
        **_auth(friend_token),
    )
    assert denied_share.status_code == status.HTTP_409_CONFLICT
    assert [
        member["nickname"]
        for member in client.get("/v1/party-evenings/PRAH24", **_auth(host_token)).json()["members"]
    ] == ["host"]

    FriendBlock.objects.all().delete()
    friendship.status = Friendship.Status.DECLINED
    friendship.save(update_fields=["status"])
    restored = client.get("/v1/party-evenings/PRAH24", **_auth(friend_token))
    assert restored.status_code == status.HTTP_200_OK
    assert [member["nickname"] for member in restored.json()["members"]] == ["host", "kamos"]


@pytest.mark.django_db
def test_blocked_account_cannot_join_but_can_leave_an_existing_membership(client):
    host_token, host = _register(client, "host")
    member_token, member = _register(client, "member")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200

    FriendBlock.objects.create(blocker=member, blocked=host)
    assert client.get("/v1/party-evenings/PRAH24", **_auth(member_token)).status_code == 404

    left = client.delete("/v1/party-evenings/PRAH24/join", **_auth(member_token))
    assert left.status_code == status.HTTP_200_OK
    assert left.json() == {"left": True}
    assert PartyEveningMember.objects.get(account=member).active is False

    FriendBlock.objects.all().delete()
    denied_host_token, denied_host = _register(client, "denied-host")
    assert _create(client, denied_host_token, code="DRUH24").status_code == 201
    FriendBlock.objects.create(blocker=denied_host, blocked=member)
    denied = client.post("/v1/party-evenings/DRUH24/join", **_auth(member_token))
    assert denied.status_code == status.HTTP_403_FORBIDDEN
    assert denied.json()["code"] == "party_blocked"


@pytest.mark.django_db
def test_pending_deletion_host_revokes_access_to_an_active_evening(client):
    host_token, host = _register(client, "host")
    member_token, _member = _register(client, "member")
    stranger_token, _stranger = _register(client, "stranger")
    assert _create(client, host_token).status_code == status.HTTP_201_CREATED
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200

    Account.objects.filter(pk=host.pk).update(status=Account.Status.PENDING_DELETION)

    assert PartyEvening.objects.get(join_code="PRAH24").active is True
    assert client.get("/v1/party-evenings/PRAH24", **_auth(member_token)).status_code == 404
    assert client.get("/v1/party-evenings/PRAH24/record", **_auth(member_token)).status_code == 404
    assert client.get("/v1/party-evenings/PRAH24/games", **_auth(member_token)).status_code == 404
    assert client.get("/v1/party-evenings", **_auth(member_token)).json()["evening"] is None
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(stranger_token)).status_code == 404


@pytest.mark.django_db
def test_host_cannot_start_two_active_evenings(client):
    token, _host = _register(client, "host")
    assert _create(client, token, code="PRAH24").status_code == status.HTTP_201_CREATED

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
    assert _create(client, first_host_token, code="PRVA24").status_code == 201
    assert _create(client, second_host_token, code="DRUHY2").status_code == 201
    assert client.post("/v1/party-evenings/PRVA24/join", **_auth(member_token)).status_code == 200

    second_join = client.post("/v1/party-evenings/DRUHY2/join", **_auth(member_token))
    assert second_join.status_code == status.HTTP_409_CONFLICT
    assert second_join.json()["code"] == "active_party_membership_exists"
    assert PartyEveningMember.objects.filter(account=member, active=True).count() == 1

    hosted = _create(client, member_token, code="HRAJ33")
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
        "join_code": "PRAH24",
        "pub_name": "U Zlatého tygra",
    }
    first = client.post("/v1/party-evenings", data=payload, format="json", **_auth(token))
    second = client.post("/v1/party-evenings", data=payload, format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_200_OK
    assert PartyEvening.objects.count() == 1

    current = client.get("/v1/party-evenings", **_auth(token))
    assert current.status_code == status.HTTP_200_OK
    assert current.json()["evening"]["join_code"] == "PRAH24"


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
    client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token))

    logged = _log_drink(client, friend_token, "Plzeň", party_code="PRAH24")
    assert logged.status_code == status.HTTP_201_CREATED

    detail = client.get("/v1/party-evenings/PRAH24", **_auth(host_token)).json()
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
    client.post("/v1/party-evenings/PRAH24/end", **_auth(host_token))
    evening = PartyEvening.objects.get()
    evening.ended_at = timezone.now() - timedelta(minutes=20)
    evening.started_at = evening.ended_at - timedelta(hours=2)
    evening.save(update_fields=["started_at", "ended_at"])
    PartyEveningMember.objects.filter(evening=evening, account=host).update(
        joined_at=evening.started_at
    )

    logged = _log_drink(client, host_token, "Kozel", party_code="PRAH24")
    assert logged.status_code == status.HTTP_201_CREATED
    # By account, not by name: the server canonicalises a beer name against the
    # brand catalogue, so "Kozel" comes back as "Velkopopovický Kozel".
    assert DrinkLog.objects.get(account=host).party_evening is None

    # And a code belonging to somebody else's table is the same non-event.
    stranger_token, stranger = _register(client, "cizi")
    other = _log_drink(client, stranger_token, "Radegast", party_code="PRAH24")
    assert other.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.get(account=stranger).party_evening is None


@pytest.mark.django_db
def test_offline_drink_links_to_ended_evening_by_occurrence_time(client):
    host_token, _host = _register(client, "host")
    member_token, member = _register(client, "kamos")
    _create(client, host_token)
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200
    evening = PartyEvening.objects.get()
    evening.started_at = timezone.now() - timedelta(hours=2)
    evening.save(update_fields=["started_at"])
    membership = PartyEveningMember.objects.get(evening=evening, account=member)
    membership.joined_at = timezone.now() - timedelta(hours=1)
    membership.save(update_fields=["joined_at"])
    captured_at = timezone.now() - timedelta(minutes=30)

    assert client.post("/v1/party-evenings/PRAH24/end", **_auth(host_token)).status_code == 200
    logged = _log_drink(
        client,
        member_token,
        "Kozel",
        party_code="PRAH24",
        drank_at=captured_at.isoformat(),
    )

    assert logged.status_code == status.HTTP_201_CREATED, logged.content
    assert DrinkLog.objects.get(account=member).party_evening == evening
    evening.refresh_from_db()
    membership.refresh_from_db()
    assert evening.active is False
    assert membership.active is True


@pytest.mark.django_db
@pytest.mark.parametrize("guard", ["blocked", "member_ghost", "host_ghost", "host_deleted"])
def test_offline_party_link_honours_current_privacy_guards(client, guard):
    host_token, host = _register(client, "host")
    member_token, member = _register(client, "kamos")
    _create(client, host_token)
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200
    evening = PartyEvening.objects.get()
    evening.started_at = timezone.now() - timedelta(hours=2)
    evening.save(update_fields=["started_at"])
    PartyEveningMember.objects.filter(evening=evening).update(joined_at=evening.started_at)
    captured_at = timezone.now() - timedelta(minutes=30)
    assert client.post("/v1/party-evenings/PRAH24/end", **_auth(host_token)).status_code == 200

    if guard == "blocked":
        FriendBlock.objects.create(blocker=host, blocked=member)
    elif guard == "member_ghost":
        member.ghost_mode = True
        member.save(update_fields=["ghost_mode"])
    elif guard == "host_ghost":
        host.ghost_mode = True
        host.save(update_fields=["ghost_mode"])
    else:
        host.status = Account.Status.PENDING_DELETION
        host.save(update_fields=["status"])

    logged = _log_drink(
        client,
        member_token,
        "Kozel",
        party_code="PRAH24",
        drank_at=captured_at.isoformat(),
    )

    assert logged.status_code == status.HTTP_201_CREATED, logged.content
    assert DrinkLog.objects.get(account=member).party_evening is None


@pytest.mark.django_db
def test_departed_member_cannot_back_link_new_drink(client):
    host_token, _host = _register(client, "host")
    member_token, member = _register(client, "odesel")
    _create(client, host_token)
    assert client.post("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200
    evening = PartyEvening.objects.get()
    evening.started_at = timezone.now() - timedelta(hours=1)
    evening.save(update_fields=["started_at"])
    membership = PartyEveningMember.objects.get(evening=evening, account=member)
    membership.joined_at = evening.started_at
    membership.save(update_fields=["joined_at"])
    assert client.delete("/v1/party-evenings/PRAH24/join", **_auth(member_token)).status_code == 200
    membership.refresh_from_db()

    logged = _log_drink(
        client,
        member_token,
        "Radegast",
        party_code="PRAH24",
        drank_at=(membership.left_at + timedelta(seconds=1)).isoformat(),
    )

    assert logged.status_code == status.HTTP_201_CREATED, logged.content
    assert DrinkLog.objects.get(account=member).party_evening is None
    membership.refresh_from_db()
    assert membership.active is False
    assert membership.left_at is not None


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
    client.post("/v1/party-evenings/PRAH24/join", **_auth(friend_token))
    friend.share_drinks_with_parta = False
    friend.save(update_fields=["share_drinks_with_parta"])

    _log_drink(client, friend_token, "Plzeň", party_code="PRAH24")

    detail = client.get("/v1/party-evenings/PRAH24", **_auth(host_token)).json()
    assert [event for event in detail["events"] if event["kind"] == "drink"] == []
    assert DrinkLog.objects.filter(account=friend).count() == 1

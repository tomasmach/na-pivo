from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    AccountUsageStats,
    DrinkLog,
    FriendActivityReaction,
    FriendActivityResponse,
    FriendBlock,
    FriendInviteCode,
    FriendNotification,
    FriendPubActivity,
    Friendship,
    PublishedNight,
    PubVisit,
    PushDevice,
)

_LAT = 50.0876
_LNG = 14.4214
_PUB_NAME = "U Zlatého tygra"
_PRAGUE = ZoneInfo("Europe/Prague")


def _prague_hour() -> int:
    """Current Europe/Prague wall-clock hour — quiet-hours tests pin windows to it."""
    return timezone.localtime(timezone.now(), _PRAGUE).hour


def _set_quiet_window(account: Account, *, contains_now: bool) -> None:
    """Pin an account's quiet window to (not) include the current Prague hour.

    A one-hour window starting at the current hour is always quiet now; one
    starting next hour is never quiet now. Keeps the time-dependent push tests
    deterministic regardless of when the suite runs.
    """
    hour = _prague_hour()
    start = hour if contains_now else (hour + 1) % 24
    account.quiet_hours_enabled = True
    account.quiet_hours_start = start
    account.quiet_hours_end = (start + 1) % 24
    account.save(
        update_fields=["quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end"]
    )


class _FakeExpoResponse:
    def raise_for_status(self) -> None:
        return None


def _push_recorder(sent_payloads: list):
    """A fake requests.post that records Expo push batches without delivering."""

    def _fake_post(url, *, json, timeout):  # noqa: ANN001
        assert url == "https://exp.host/--/api/v2/push/send"
        assert timeout == 3
        sent_payloads.append(json)
        return _FakeExpoResponse()

    return _fake_post


def _flatten_push(sent_payloads: list) -> list[dict]:
    """All individual Expo messages across recorded batches."""
    return [message for batch in sent_payloads for message in batch]


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache(settings):
    # Endpoint tests assert exact push payloads. Keep delivery deterministic;
    # async dispatch itself has a focused test below.
    settings.FRIEND_PUSH_ASYNC = False
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str, *, is_public: bool = True) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    token = resp.json()["token"]
    account = Account.objects.get(public_id=resp.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.is_public = is_public
    account.save(update_fields=["nickname", "display_name", "is_public"])
    return token, account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _visit(account: Account, *, day: str = "2026-06-12", pub_name: str = _PUB_NAME) -> PubVisit:
    return PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=pub_name,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        external_id="mapy:test",
        started_at=datetime.fromisoformat(f"{day}T19:00:00+00:00"),
        client_updated_at=datetime.fromisoformat(f"{day}T19:00:00+00:00"),
    )


def _drink(account: Account, *, drank_at=None, cache_key: str = "u2fkbn1z") -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name=_PUB_NAME,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        external_id="mapy:test",
        beer_name="Plzeň",
        price_czk=65,
        drank_at=drank_at or timezone.now(),
    )


@pytest.mark.django_db
def test_friend_request_accept_and_remove(client):
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")

    request_resp = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert request_resp.status_code == status.HTTP_201_CREATED
    friendship_id = request_resp.json()["id"]
    assert Friendship.objects.get().status == Friendship.Status.PENDING
    assert FriendNotification.objects.filter(
        recipient=account_b,
        kind=FriendNotification.Kind.FRIEND_REQUEST,
    ).exists()

    accept_resp = client.post(
        f"/v1/friends/requests/{friendship_id}/accept",
        format="json",
        **_auth(token_b),
    )
    assert accept_resp.status_code == status.HTTP_200_OK
    assert accept_resp.json()["status"] == Friendship.Status.ACCEPTED
    assert FriendNotification.objects.filter(
        recipient=account_a,
        kind=FriendNotification.Kind.FRIEND_ACCEPTED,
    ).exists()

    dashboard = client.get("/v1/friends", **_auth(token_a))
    assert dashboard.status_code == status.HTTP_200_OK
    assert [friend["nickname"] for friend in dashboard.json()["friends"]] == ["petr"]

    remove = client.delete(f"/v1/friends/{account_b.public_id}", **_auth(token_a))
    assert remove.status_code == status.HTTP_200_OK
    assert remove.json() == {"removed": True}
    assert Friendship.objects.count() == 0


@pytest.mark.django_db
def test_friend_request_and_accept_queue_push_without_waiting(client, monkeypatch, settings):
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")
    account_a.quiet_hours_enabled = False
    account_b.quiet_hours_enabled = False
    account_a.save(update_fields=["quiet_hours_enabled"])
    account_b.save(update_fields=["quiet_hours_enabled"])
    _grant_push(account_a, "ExponentPushToken[janek_async]")
    _grant_push(account_b, "ExponentPushToken[petr_async]")

    queued: list[tuple[object, tuple]] = []

    class FakeExecutor:
        def submit(self, fn, *args):  # noqa: ANN001
            queued.append((fn, args))

    settings.FRIEND_PUSH_ASYNC = True
    monkeypatch.setattr("pubs.api.views._friend_push_executor", FakeExecutor())
    monkeypatch.setattr(
        "pubs.api.views.requests.post",
        lambda *args, **kwargs: pytest.fail("push delivery ran in the API request"),
    )

    request_resp = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert request_resp.status_code == status.HTTP_201_CREATED
    assert len(queued) == 1
    assert FriendNotification.objects.filter(recipient=account_b).exists()

    accept_resp = client.post(
        f"/v1/friends/requests/{request_resp.json()['id']}/accept",
        format="json",
        **_auth(token_b),
    )
    assert accept_resp.status_code == status.HTTP_200_OK
    assert len(queued) == 2
    assert FriendNotification.objects.filter(recipient=account_a).exists()


@pytest.mark.django_db
def test_accepted_private_friend_is_visible_even_when_not_public(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "tajny", is_public=False)
    Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )

    search = client.get("/v1/friends/search?q=taj", **_auth(token_a))
    assert search.status_code == status.HTTP_200_OK
    assert search.json()["results"] == []

    dashboard = client.get("/v1/friends", **_auth(token_a))
    assert dashboard.status_code == status.HTTP_200_OK
    assert dashboard.json()["friends"][0]["nickname"] == "tajny"


@pytest.mark.django_db
def test_friend_suggestions_are_public_unrelated_and_privacy_filtered(client):
    viewer_token, viewer = _register(client, "divak")
    _public_token, public = _register(client, "novy")
    _friend_token, friend = _register(client, "kamos")
    _ghost_token, ghost = _register(client, "duch")
    _private_token, private = _register(client, "tajny", is_public=False)
    _blocked_token, blocked = _register(client, "blok")
    ghost.ghost_mode = True
    ghost.save(update_fields=["ghost_mode"])
    _make_friends(viewer, friend)
    _make_friends(public, friend)
    _make_friends(ghost, friend)
    _make_friends(private, friend)
    _make_friends(blocked, friend)
    FriendBlock.objects.create(blocker=blocked, blocked=viewer)

    response = client.get("/v1/friends/search?suggest=true", **_auth(viewer_token))

    assert response.status_code == status.HTTP_200_OK, response.content
    assert response.json()["results"] == [
        {
            "id": str(public.public_id),
            "nickname": "novy",
            "display_name": "Novy",
            "avatar_url": None,
            "is_public": True,
            "suggestion_reason": {"kind": "mutual_friends", "count": 1},
        }
    ]


@pytest.mark.django_db
def test_friend_suggestions_never_use_private_pub_overlap_for_non_friends(client):
    viewer_token, viewer = _register(client, "divak")
    _bridge_token, bridge = _register(client, "spojka")
    _shared_token, shared = _register(client, "stejnastamgast")
    _mutual_token, mutual = _register(client, "preskamarada")
    _private_diary_token, private_diary = _register(client, "skrytypijan")
    _unrelated_token, unrelated = _register(client, "nahodny")
    _make_friends(viewer, bridge)
    _make_friends(mutual, bridge)
    _visit(viewer, pub_name="Tajná společná hospoda")
    _visit(shared, pub_name="Jiné jméno stejného místa")
    _visit(private_diary, pub_name="Ještě jiné jméno")
    shared.share_drinks_with_parta = True
    shared.save(update_fields=["share_drinks_with_parta"])
    private_diary.share_drinks_with_parta = False
    private_diary.save(update_fields=["share_drinks_with_parta"])

    with CaptureQueriesContext(connection) as queries:
        response = client.get("/v1/friends/search?suggest=true", **_auth(viewer_token))

    assert response.status_code == status.HTTP_200_OK, response.content
    results = response.json()["results"]
    assert [item["id"] for item in results] == [str(mutual.public_id)]
    assert results[0]["suggestion_reason"] == {"kind": "mutual_friends", "count": 1}
    assert str(shared.public_id) not in {item["id"] for item in results}
    assert str(private_diary.public_id) not in {item["id"] for item in results}
    assert str(unrelated.public_id) not in {item["id"] for item in results}
    assert "Tajná společná hospoda" not in str(results)
    assert "u2fkbn1z" not in str(results)
    assert str(_LAT) not in str(results)
    assert len(queries) <= 10


@pytest.mark.django_db
def test_ghost_profile_is_hidden_from_direct_friend_search(client):
    viewer_token, _viewer = _register(client, "divak")
    _ghost_token, ghost = _register(client, "duch")
    ghost.ghost_mode = True
    ghost.save(update_fields=["ghost_mode"])

    response = client.get("/v1/friends/search?q=duch", **_auth(viewer_token))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_friend_pub_activity_notifies_friends_and_returns_active_status(client, monkeypatch):
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")
    # Keep this fanout test independent of the wall-clock: quiet hours are
    # covered by their own test below.
    account_b.quiet_hours_enabled = False
    account_b.save(update_fields=["quiet_hours_enabled"])
    Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )
    PushDevice.objects.create(
        account=account_b,
        push_token="ExponentPushToken[petr123]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )
    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))
    started_at = timezone.now()
    expires_at = started_at + timezone.timedelta(hours=3)

    resp = client.post(
        "/v1/friends/pub-activity",
        data={
            "client_id": str(uuid.uuid4()),
            "name": _PUB_NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "message": "Máme tu volno u stolu.",
            "started_at": started_at.isoformat(),
            "expires_at": expires_at.isoformat(),
        },
        format="json",
        **_auth(token_a),
    )

    assert resp.status_code == status.HTTP_201_CREATED
    assert FriendPubActivity.objects.filter(account=account_a, active=True).count() == 1
    note = FriendNotification.objects.get(recipient=account_b)
    assert note.kind == FriendNotification.Kind.FRIEND_AT_PUB
    assert note.pub_name == _PUB_NAME
    assert sent_payloads[0][0]["to"] == "ExponentPushToken[petr123]"

    dashboard = client.get("/v1/friends", **_auth(token_b))
    assert dashboard.status_code == status.HTTP_200_OK
    body = dashboard.json()
    assert body["active_friends"][0]["account"]["nickname"] == "janek"
    assert body["active_friends"][0]["message"] == "Máme tu volno u stolu."
    assert body["notifications"][0]["kind"] == "friend_at_pub"


@pytest.mark.django_db
def test_friend_pub_activity_targets_selected_recipients_only(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_petr, petr = _register(client, "petr")
    token_karel, karel = _register(client, "karel")
    _make_friends(owner, petr)
    _make_friends(owner, karel)
    _no_quiet(petr)
    _no_quiet(karel)
    _grant_push(petr, "ExponentPushToken[petr_targeted]")
    _grant_push(karel, "ExponentPushToken[karel_targeted]")
    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    started_at = timezone.now()
    expires_at = started_at + timezone.timedelta(hours=3)
    resp = client.post(
        "/v1/friends/pub-activity",
        data={
            "client_id": str(uuid.uuid4()),
            "name": _PUB_NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "message": "Jen pracovní stůl.",
            "started_at": started_at.isoformat(),
            "expires_at": expires_at.isoformat(),
            "recipient_ids": [str(petr.public_id)],
        },
        format="json",
        **_auth(token_owner),
    )

    assert resp.status_code == status.HTTP_201_CREATED
    activity_id = resp.json()["id"]
    assert FriendNotification.objects.filter(recipient=petr).count() == 1
    assert not FriendNotification.objects.filter(recipient=karel).exists()
    assert [item["to"] for item in _flatten_push(sent_payloads)] == [
        "ExponentPushToken[petr_targeted]"
    ]

    petr_dash = client.get("/v1/friends", **_auth(token_petr)).json()
    assert [row["id"] for row in petr_dash["active_friends"]] == [activity_id]

    karel_dash = client.get("/v1/friends", **_auth(token_karel)).json()
    assert karel_dash["active_friends"] == []

    blocked_rsvp = client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_karel),
    )
    assert blocked_rsvp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_repeated_pub_activity_reuses_live_card_without_spamming_friends(client, monkeypatch):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    account_b.quiet_hours_enabled = False
    account_b.save(update_fields=["quiet_hours_enabled"])
    Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )
    _grant_push(account_b, "ExponentPushToken[petr_repeat]")
    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    first = _broadcast(client, token_a, message="První cinknutí.")
    second = _broadcast(client, token_a, message="Druhé cinknutí.")

    assert second["id"] == first["id"]
    assert second["message"] == "Druhé cinknutí."
    assert FriendPubActivity.objects.filter(account=account_a, active=True).count() == 1
    assert FriendNotification.objects.filter(
        recipient=account_b,
        kind=FriendNotification.Kind.FRIEND_AT_PUB,
    ).count() == 1
    assert len(
        [
            message
            for message in _flatten_push(sent_payloads)
            if message["data"].get("kind") == "friend_at_pub"
        ]
    ) == 1


@pytest.mark.django_db
def test_dashboard_returns_shared_pub_count_and_rituals(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )
    for day in ("2026-06-12", "2026-06-13", "2026-06-14"):
        _visit(account_a, day=day)
        _visit(account_b, day=day)

    resp = client.get("/v1/friends", **_auth(token_a))
    assert resp.status_code == status.HTTP_200_OK
    stats = resp.json()["friend_stats"][str(account_b.public_id)]
    assert stats["shared_pub_count"] == 3
    assert stats["last_pub_name"] == _PUB_NAME
    assert [ritual["key"] for ritual in stats["rituals"]] == ["first_round", "regular_table"]


@pytest.mark.django_db
def test_dashboard_shared_stats_ignore_old_history(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )
    old_day = (timezone.localtime(timezone.now(), _PRAGUE).date() - timedelta(days=400)).isoformat()
    _visit(account_a, day=old_day)
    _visit(account_b, day=old_day)

    resp = client.get("/v1/friends", **_auth(token_a))

    assert resp.status_code == status.HTTP_200_OK
    stats = resp.json()["friend_stats"][str(account_b.public_id)]
    assert stats["shared_pub_count"] == 0
    assert stats["rituals"] == []


# ---------------------------------------------------------------------------
# Parta 2.0 — RSVP loop, ghost mode, quiet hours, settings, streak, leaderboard
# ---------------------------------------------------------------------------


def _make_friends(account_a: Account, account_b: Account) -> None:
    Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )


def _broadcast(client: APIClient, token: str, *, message: str = "Jsme tu u stolu.") -> dict:
    started_at = timezone.now()
    expires_at = started_at + timedelta(hours=3)
    resp = client.post(
        "/v1/friends/pub-activity",
        data={
            "client_id": str(uuid.uuid4()),
            "name": _PUB_NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "message": message,
            "started_at": started_at.isoformat(),
            "expires_at": expires_at.isoformat(),
        },
        format="json",
        **_auth(token),
    )
    assert resp.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)
    return resp.json()


def _grant_push(account: Account, token: str) -> None:
    PushDevice.objects.create(
        account=account,
        push_token=token,
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )


@pytest.mark.django_db
def test_respond_going_notifies_and_pushes_owner(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    owner.quiet_hours_enabled = False
    owner.save(update_fields=["quiet_hours_enabled"])
    _make_friends(owner, friend)
    _grant_push(owner, "ExponentPushToken[owner_janek]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    activity = _broadcast(client, token_owner)
    activity_id = activity["id"]

    respond = client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_friend),
    )
    assert respond.status_code == status.HTTP_200_OK
    body = respond.json()
    assert body["responses"]["going"] == 1
    assert body["responses"]["maybe"] == 0
    assert body["responses"]["going_profiles"][0]["nickname"] == "petr"
    assert body["my_response"] == "going"

    note = FriendNotification.objects.get(
        recipient=owner, kind=FriendNotification.Kind.FRIEND_RSVP
    )
    assert note.actor_id == friend.id
    assert note.pub_name == _PUB_NAME

    rsvp_pushes = [
        message
        for message in _flatten_push(sent_payloads)
        if message["data"].get("kind") == "friend_rsvp"
    ]
    assert rsvp_pushes
    assert rsvp_pushes[0]["to"] == "ExponentPushToken[owner_janek]"
    assert rsvp_pushes[0]["data"]["activity_id"] == activity_id


@pytest.mark.django_db
def test_respond_going_is_idempotent_for_owner_notification(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    owner.quiet_hours_enabled = False
    owner.save(update_fields=["quiet_hours_enabled"])
    _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    path = f"/v1/friends/pub-activity/{activity_id}/respond"
    client.post(path, data={"response": "going"}, format="json", **_auth(token_friend))
    # Re-confirming "going" must not spam a second owner notification.
    client.post(path, data={"response": "going"}, format="json", **_auth(token_friend))
    assert (
        FriendNotification.objects.filter(
            recipient=owner, kind=FriendNotification.Kind.FRIEND_RSVP
        ).count()
        == 1
    )
    assert FriendActivityResponse.objects.filter(activity__public_id=activity_id).count() == 1


@pytest.mark.django_db
def test_respond_to_own_activity_rejected(client):
    token_owner, owner = _register(client, "janek")
    activity_id = _broadcast(client, token_owner)["id"]
    resp = client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_owner),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "self_rsvp"


@pytest.mark.django_db
def test_respond_as_non_friend_forbidden(client):
    token_owner, owner = _register(client, "janek")
    token_stranger, _stranger = _register(client, "cizinec")
    activity_id = _broadcast(client, token_owner)["id"]
    resp = client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "maybe"},
        format="json",
        **_auth(token_stranger),
    )
    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert resp.json()["code"] == "not_friends"
    assert FriendActivityResponse.objects.count() == 0


@pytest.mark.django_db
def test_respond_to_expired_activity_404(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    # Build an already-expired activity directly (expires_at in the past).
    now = timezone.now()
    activity = FriendPubActivity.objects.create(
        account=owner,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=_PUB_NAME,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        started_at=now - timedelta(hours=5),
        expires_at=now - timedelta(hours=1),
        active=True,
    )
    resp = client.post(
        f"/v1/friends/pub-activity/{activity.public_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_friend),
    )
    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "activity_not_found"


@pytest.mark.django_db
def test_delete_response_clears_rsvp(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    owner.quiet_hours_enabled = False
    owner.save(update_fields=["quiet_hours_enabled"])
    _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    path = f"/v1/friends/pub-activity/{activity_id}/respond"
    client.post(path, data={"response": "going"}, format="json", **_auth(token_friend))
    assert FriendActivityResponse.objects.count() == 1

    removed = client.delete(path, **_auth(token_friend))
    assert removed.status_code == status.HTTP_200_OK
    assert removed.json() == {"removed": True}
    assert FriendActivityResponse.objects.count() == 0

    # Idempotent: a second delete is still a success, not a 404.
    again = client.delete(path, **_auth(token_friend))
    assert again.status_code == status.HTTP_200_OK
    assert again.json() == {"removed": False}


@pytest.mark.django_db
def test_my_active_activity_carries_roster(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    owner.quiet_hours_enabled = False
    owner.save(update_fields=["quiet_hours_enabled"])
    _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_friend),
    )

    dashboard = client.get("/v1/friends", **_auth(token_owner))
    assert dashboard.status_code == status.HTTP_200_OK
    mine = dashboard.json()["my_active_activity"]
    assert mine is not None
    assert mine["id"] == activity_id
    assert mine["responses"]["going"] == 1
    assert mine["responses"]["going_profiles"][0]["nickname"] == "petr"
    # The owner did not RSVP to their own broadcast.
    assert mine["my_response"] is None


@pytest.mark.django_db
def test_going_roster_hides_ghost_and_pending_deletion_responders(client, monkeypatch):
    """Privacy: ghost-mode / pending-deletion GOING responders stay out of
    going_profiles, while counts remain aggregate (the going total still counts
    every RSVP)."""
    token_owner, owner = _register(client, "janek")
    token_active, active = _register(client, "petr")
    token_ghost, ghost = _register(client, "karel")
    token_pending, pending = _register(client, "honza")
    owner.quiet_hours_enabled = False
    owner.save(update_fields=["quiet_hours_enabled"])
    for friend in (active, ghost, pending):
        _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    path = f"/v1/friends/pub-activity/{activity_id}/respond"
    for token in (token_active, token_ghost, token_pending):
        resp = client.post(path, data={"response": "going"}, format="json", **_auth(token))
        assert resp.status_code == status.HTTP_200_OK

    # Two responders go private after the fact: one ghosts, one schedules deletion.
    ghost.ghost_mode = True
    ghost.save(update_fields=["ghost_mode"])
    pending.status = Account.Status.PENDING_DELETION
    pending.save(update_fields=["status"])

    dashboard = client.get("/v1/friends", **_auth(token_owner))
    assert dashboard.status_code == status.HTTP_200_OK
    responses = dashboard.json()["my_active_activity"]["responses"]
    # Count stays accurate (aggregate, not PII): all three GOING RSVPs counted.
    assert responses["going"] == 3
    # Only the active public responder is exposed.
    nicknames = [profile["nickname"] for profile in responses["going_profiles"]]
    assert nicknames == ["petr"]


@pytest.mark.django_db
def test_going_roster_hides_blocked_responder(client, monkeypatch):
    """A responder the viewer has blocked (after they RSVP'd GOING) stays out of
    going_profiles the viewer sees, while the aggregate count still counts them —
    mirroring the ghost / pending-deletion roster privacy."""
    token_owner, owner = _register(client, "janek")
    token_ok, _ok = _register(client, "petr")
    token_blocked, blocked = _register(client, "karel")
    owner.quiet_hours_enabled = False
    owner.save(update_fields=["quiet_hours_enabled"])
    for friend in (_ok, blocked):
        _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    path = f"/v1/friends/pub-activity/{activity_id}/respond"
    for token in (token_ok, token_blocked):
        resp = client.post(path, data={"response": "going"}, format="json", **_auth(token))
        assert resp.status_code == status.HTTP_200_OK

    # Owner blocks karel after the RSVP; the RSVP row itself is left intact.
    block = client.post(
        "/v1/friends/blocks",
        data={"account_id": str(blocked.public_id)},
        format="json",
        **_auth(token_owner),
    )
    assert block.status_code == status.HTTP_200_OK

    dashboard = client.get("/v1/friends", **_auth(token_owner))
    assert dashboard.status_code == status.HTTP_200_OK
    responses = dashboard.json()["my_active_activity"]["responses"]
    # Count stays aggregate: both GOING RSVPs are still counted.
    assert responses["going"] == 2
    # But the blocked responder's profile is never exposed to the blocker.
    nicknames = [profile["nickname"] for profile in responses["going_profiles"]]
    assert nicknames == ["petr"]


@pytest.mark.django_db
def test_ghost_mode_hides_activity_and_suppresses_fanout(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])
    friend.quiet_hours_enabled = False
    friend.save(update_fields=["quiet_hours_enabled"])
    _make_friends(owner, friend)
    _grant_push(friend, "ExponentPushToken[friend_petr]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    activity = _broadcast(client, token_owner)
    # Ghost broadcast fans out nothing: no notification rows, no push.
    assert FriendNotification.objects.filter(recipient=friend).count() == 0
    assert _flatten_push(sent_payloads) == []

    # The friend's dashboard does not show the ghost's activity.
    friend_dash = client.get("/v1/friends", **_auth(token_friend))
    assert friend_dash.json()["active_friends"] == []

    # The owner still keeps their own record (so they can track their own roster).
    owner_dash = client.get("/v1/friends", **_auth(token_owner))
    assert owner_dash.json()["my_active_activity"]["id"] == activity["id"]


@pytest.mark.django_db
def test_ghost_mode_blocks_direct_rsvp_to_existing_activity(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])

    respond = client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_friend),
    )

    assert respond.status_code == status.HTTP_404_NOT_FOUND
    assert respond.json()["code"] == "activity_not_found"
    assert FriendActivityResponse.objects.count() == 0
    assert not FriendNotification.objects.filter(
        recipient=owner,
        actor=friend,
        kind=FriendNotification.Kind.FRIEND_RSVP,
    ).exists()


@pytest.mark.django_db
def test_quiet_hours_drops_push_keeps_notification(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _set_quiet_window(friend, contains_now=True)
    _grant_push(friend, "ExponentPushToken[friend_petr]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    _broadcast(client, token_owner)

    # Push to the quiet friend is dropped...
    assert all(
        message["to"] != "ExponentPushToken[friend_petr]"
        for message in _flatten_push(sent_payloads)
    )
    # ...but the durable in-app notification row is still created.
    assert FriendNotification.objects.filter(
        recipient=friend, kind=FriendNotification.Kind.FRIEND_AT_PUB
    ).exists()


@pytest.mark.django_db
def test_friend_settings_get_and_patch(client):
    token, _account = _register(client, "janek")

    initial = client.get("/v1/friends/settings", **_auth(token))
    assert initial.status_code == status.HTTP_200_OK
    assert initial.json() == {
        "ghost_mode": False,
        "share_drinks_with_parta": True,
        "quiet_hours_enabled": True,
        "quiet_hours_start": 23,
        "quiet_hours_end": 9,
    }

    patched = client.patch(
        "/v1/friends/settings",
        data={"ghost_mode": True, "quiet_hours_start": 22, "quiet_hours_end": 7},
        format="json",
        **_auth(token),
    )
    assert patched.status_code == status.HTTP_200_OK
    assert patched.json() == {
        "ghost_mode": True,
        "share_drinks_with_parta": True,
        "quiet_hours_enabled": True,
        "quiet_hours_start": 22,
        "quiet_hours_end": 7,
    }

    # Persisted + surfaced in the dashboard too.
    dash = client.get("/v1/friends", **_auth(token))
    assert dash.json()["settings"]["ghost_mode"] is True
    assert dash.json()["settings"]["quiet_hours_start"] == 22

    invalid = client.patch(
        "/v1/friends/settings",
        data={"quiet_hours_start": 25},
        format="json",
        **_auth(token),
    )
    assert invalid.status_code == status.HTTP_400_BAD_REQUEST
    assert invalid.json()["code"] == "invalid_hour"


@pytest.mark.django_db
def test_friend_settings_patch_parses_string_booleans(client):
    token, _account = _register(client, "janek")

    patched = client.patch(
        "/v1/friends/settings",
        data={"ghost_mode": "false", "quiet_hours_enabled": "false"},
        format="json",
        **_auth(token),
    )

    assert patched.status_code == status.HTTP_200_OK
    assert patched.json()["ghost_mode"] is False
    assert patched.json()["quiet_hours_enabled"] is False


@pytest.mark.django_db
def test_dashboard_streak_counts_two_week_run(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    _make_friends(account_a, account_b)

    today = timezone.localtime(timezone.now(), _PRAGUE).date()
    last_week = today - timedelta(days=7)
    for day in (today.isoformat(), last_week.isoformat()):
        _visit(account_a, day=day)
        _visit(account_b, day=day)

    resp = client.get("/v1/friends", **_auth(token_a))
    assert resp.status_code == status.HTTP_200_OK
    streak = resp.json()["streak"]
    assert streak["current_weeks"] == 2
    assert streak["this_week_lit"] is True


@pytest.mark.django_db
def test_dashboard_leaderboard_ranks_by_visits(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    _token_c, account_c = _register(client, "karel")
    _make_friends(account_a, account_b)
    _make_friends(account_a, account_c)

    today = timezone.localtime(timezone.now(), _PRAGUE).date().isoformat()
    for _ in range(3):
        _visit(account_b, day=today)
    for _ in range(2):
        _visit(account_a, day=today)
    _visit(account_c, day=today)

    resp = client.get("/v1/friends", **_auth(token_a))
    assert resp.status_code == status.HTTP_200_OK
    leaderboard = resp.json()["leaderboard"]
    order = [(row["account"]["nickname"], row["visits_30d"], row["is_me"]) for row in leaderboard]
    assert order == [
        ("petr", 3, False),
        ("janek", 2, True),
        ("karel", 1, False),
    ]


@pytest.mark.django_db
def test_leaderboard_excludes_pending_deletion_member(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    _make_friends(account_a, account_b)
    account_b.status = Account.Status.PENDING_DELETION
    account_b.save(update_fields=["status"])

    resp = client.get("/v1/friends", **_auth(token_a))
    nicknames = [row["account"]["nickname"] for row in resp.json()["leaderboard"]]
    assert nicknames == ["janek"]
    assert resp.json()["leaderboard"][0]["is_me"] is True


@pytest.mark.django_db
def test_pending_deletion_friend_hidden_from_dashboard_and_rsvp(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    owner.status = Account.Status.PENDING_DELETION
    owner.save(update_fields=["status"])

    dashboard = client.get("/v1/friends", **_auth(token_friend))
    assert dashboard.status_code == status.HTTP_200_OK
    body = dashboard.json()
    assert body["friends"] == []
    assert body["friend_stats"] == {}
    assert body["active_friends"] == []
    assert body["notifications"] == []
    assert body["unread_count"] == 0
    assert [row["account"]["nickname"] for row in body["leaderboard"]] == ["petr"]

    respond = client.post(
        f"/v1/friends/pub-activity/{activity_id}/respond",
        data={"response": "going"},
        format="json",
        **_auth(token_friend),
    )
    assert respond.status_code == status.HTTP_404_NOT_FOUND
    assert respond.json()["code"] == "activity_not_found"
    assert FriendActivityResponse.objects.count() == 0


@pytest.mark.django_db
def test_ghost_mode_actor_hidden_from_notification_feed(client):
    # FriendNotificationSerializer exposes the actor's public profile, so an
    # actor who later enables ghost mode must drop out of old notifications too.
    _token_actor, actor = _register(client, "duch")
    token_recipient, recipient = _register(client, "petr")
    _make_friends(actor, recipient)

    FriendNotification.objects.create(
        recipient=recipient,
        actor=actor,
        kind=FriendNotification.Kind.FRIEND_ACCEPTED,
        title="Žádost přijata",
        body="duch si tě přidal mezi kamarády.",
    )

    visible = client.get("/v1/friends", **_auth(token_recipient))
    assert visible.status_code == status.HTTP_200_OK
    visible_body = visible.json()
    assert [n["kind"] for n in visible_body["notifications"]] == [
        FriendNotification.Kind.FRIEND_ACCEPTED
    ]
    assert visible_body["unread_count"] == 1

    actor.ghost_mode = True
    actor.save(update_fields=["ghost_mode"])

    hidden = client.get("/v1/friends", **_auth(token_recipient))
    assert hidden.status_code == status.HTTP_200_OK
    hidden_body = hidden.json()
    assert hidden_body["notifications"] == []
    assert hidden_body["unread_count"] == 0


# ---------------------------------------------------------------------------
# Parta 3.0 — happy-path coverage for the new endpoints (§2 A–G, §6 push).
# ---------------------------------------------------------------------------


class _FakeExpoJsonResponse:
    """Fake Expo response that also exposes ticket JSON for dead-token tests."""

    def __init__(self, tickets: list):
        self._tickets = tickets

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"data": self._tickets}


def _device_not_registered_post(sent_payloads: list):
    """Fake post returning a DeviceNotRegistered ticket for every message sent."""

    def _fake_post(url, *, json, timeout):  # noqa: ANN001
        sent_payloads.append(json)
        tickets = [
            {"status": "error", "message": "x", "details": {"error": "DeviceNotRegistered"}}
            for _ in json
        ]
        return _FakeExpoJsonResponse(tickets)

    return _fake_post


def _no_quiet(account: Account) -> None:
    account.quiet_hours_enabled = False
    account.save(update_fields=["quiet_hours_enabled"])


def _plan_scheduled_for() -> datetime:
    """A future time guaranteed to fall inside the current Prague day."""
    prague_now = timezone.localtime(timezone.now(), _PRAGUE)
    day_end = prague_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return min(timezone.now() + timedelta(hours=2), day_end - timedelta(minutes=1))


@pytest.mark.django_db
def test_invite_code_created_and_reused(client):
    token, account = _register(client, "janek")

    first = client.get("/v1/friends/invite", **_auth(token))
    assert first.status_code == status.HTTP_200_OK
    body = first.json()
    assert body["code"]
    assert body["url"] == f"napivo://parta/pozvanka?code={body['code']}"
    assert body["web_url"] == f"https://na-pivo.cz/p/{body['code']}"
    assert body["expires_at"]

    second = client.get("/v1/friends/invite", **_auth(token))
    assert second.json()["code"] == body["code"]
    assert FriendInviteCode.objects.filter(account=account).count() == 1


@pytest.mark.django_db
def test_invite_resolve_returns_inviter_and_rejects_unknown(client):
    token_a, _account_a = _register(client, "janek")
    token_b, _account_b = _register(client, "petr")
    code = client.get("/v1/friends/invite", **_auth(token_a)).json()["code"]

    resolved = client.get(f"/v1/friends/invite/{code}", **_auth(token_b))
    assert resolved.status_code == status.HTTP_200_OK
    body = resolved.json()
    assert body["valid"] is True
    assert body["expired"] is False
    assert body["inviter"]["nickname"] == "janek"

    unknown = client.get("/v1/friends/invite/does-not-exist", **_auth(token_b))
    assert unknown.status_code == status.HTTP_404_NOT_FOUND
    assert unknown.json()["code"] == "invite_invalid"


@pytest.mark.django_db
def test_request_via_invite_code_bypasses_public_gate(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_a, account_a = _register(client, "janek")
    # A private inviter can still be added through their own code.
    _token_b, account_b = _register(client, "petr", is_public=False)
    code = client.get("/v1/friends/invite", **_auth(_token_b)).json()["code"]

    resp = client.post(
        "/v1/friends/requests",
        data={"invite_code": code},
        format="json",
        **_auth(token_a),
    )
    assert resp.status_code == status.HTTP_201_CREATED
    friendship = Friendship.objects.get()
    assert friendship.requester_id == account_a.id
    assert friendship.recipient_id == account_b.id
    assert friendship.status == Friendship.Status.PENDING


@pytest.mark.django_db
def test_create_plan_appears_in_dashboard_and_notifies_friends(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(friend)
    _grant_push(friend, "ExponentPushToken[petr_plan]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    scheduled_for = _plan_scheduled_for()
    resp = client.post(
        "/v1/friends/pub-activity",
        data={
            "client_id": str(uuid.uuid4()),
            "name": _PUB_NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "message": "Držím stůl.",
            "scheduled_for": scheduled_for.isoformat(),
        },
        format="json",
        **_auth(token_owner),
    )
    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["kind"] == "plan"
    assert body["scheduled_for"] is not None

    # The plan lives in the new keys, never in the live-now list.
    owner_dash = client.get("/v1/friends", **_auth(token_owner)).json()
    assert owner_dash["my_plan"] is not None
    assert owner_dash["my_active_activity"] is None
    friend_dash = client.get("/v1/friends", **_auth(token_friend)).json()
    assert [p["id"] for p in friend_dash["plans"]] == [body["id"]]
    assert friend_dash["active_friends"] == []

    note = FriendNotification.objects.get(
        recipient=friend, kind=FriendNotification.Kind.FRIEND_PLAN
    )
    assert note.actor_id == owner.id
    plan_pushes = [
        m for m in _flatten_push(sent_payloads) if m["data"].get("kind") == "friend_plan"
    ]
    assert plan_pushes and plan_pushes[0]["to"] == "ExponentPushToken[petr_plan]"


@pytest.mark.django_db
def test_live_broadcast_and_plan_coexist(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    _broadcast(client, token_owner)
    client.post(
        "/v1/friends/pub-activity",
        data={
            "client_id": str(uuid.uuid4()),
            "name": _PUB_NAME,
            "lat": _LAT,
            "lng": _LNG,
            "scheduled_for": _plan_scheduled_for().isoformat(),
        },
        format="json",
        **_auth(token_owner),
    )

    dash = client.get("/v1/friends", **_auth(token_owner)).json()
    assert dash["my_active_activity"] is not None
    assert dash["my_plan"] is not None
    assert (
        FriendPubActivity.objects.filter(account=owner, active=True).count() == 2
    )


@pytest.mark.django_db
def test_react_cheers_toggles_and_notifies_owner(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(owner)
    _grant_push(owner, "ExponentPushToken[owner_cheers]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    activity_id = _broadcast(client, token_owner)["id"]

    react = client.post(
        f"/v1/friends/pub-activity/{activity_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )
    assert react.status_code == status.HTTP_200_OK
    body = react.json()
    assert body["reactions"]["cheers"] == 1
    assert body["my_reaction"] == "cheers"

    note = FriendNotification.objects.get(
        recipient=owner, kind=FriendNotification.Kind.FRIEND_CHEERS
    )
    assert note.actor_id == friend.id
    cheers_pushes = [
        m for m in _flatten_push(sent_payloads) if m["data"].get("kind") == "friend_cheers"
    ]
    assert cheers_pushes and cheers_pushes[0]["to"] == "ExponentPushToken[owner_cheers]"

    cleared = client.delete(
        f"/v1/friends/pub-activity/{activity_id}/react", **_auth(token_friend)
    )
    assert cleared.status_code == status.HTTP_200_OK
    assert cleared.json()["reactions"]["cheers"] == 0
    assert cleared.json()["my_reaction"] is None
    assert FriendActivityReaction.objects.count() == 0


@pytest.mark.django_db
def test_react_allowed_on_expired_activity(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    past = timezone.now() - timedelta(hours=6)
    activity = FriendPubActivity.objects.create(
        account=owner,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=_PUB_NAME,
        lat=_LAT,
        lng=_LNG,
        started_at=past,
        expires_at=past + timedelta(hours=1),
        active=False,
    )
    react = client.post(
        f"/v1/friends/pub-activity/{activity.public_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )
    assert react.status_code == status.HTTP_200_OK
    assert react.json()["reactions"]["cheers"] == 1


@pytest.mark.django_db
def test_react_to_self_or_stranger_rejected(client):
    token_owner, _owner = _register(client, "janek")
    token_stranger, _stranger = _register(client, "cizinec")
    activity_id = _broadcast(client, token_owner)["id"]

    own = client.post(
        f"/v1/friends/pub-activity/{activity_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_owner),
    )
    assert own.status_code == status.HTTP_400_BAD_REQUEST
    assert own.json()["code"] == "self_reaction"

    stranger = client.post(
        f"/v1/friends/pub-activity/{activity_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_stranger),
    )
    assert stranger.status_code == status.HTTP_403_FORBIDDEN
    assert stranger.json()["code"] == "not_friends"


@pytest.mark.django_db
def test_friends_live_slice(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _broadcast(client, token_friend)

    live = client.get("/v1/friends/live", **_auth(token_owner))
    assert live.status_code == status.HTTP_200_OK
    body = live.json()
    assert [a["account"]["nickname"] for a in body["active_friends"]] == ["petr"]
    assert body["plans"] == []
    assert body["incoming_count"] == 0
    assert body["unread_count"] >= 1
    assert body["server_time"]


@pytest.mark.django_db
def test_friend_profile_detail(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    _make_friends(account_a, account_b)
    _visit(account_a, day="2026-06-12")
    _visit(account_b, day="2026-06-12")
    AccountUsageStats.objects.create(account=account_b, mapper_xp=1450)
    _drink(account_b)

    resp = client.get(f"/v1/friends/{account_b.public_id}", **_auth(token_a))
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["is_friend"] is True
    assert body["friendship_status"] == "accepted"
    assert body["incoming_request_id"] is None
    assert body["profile"]["nickname"] == "petr"
    assert body["public_stats"]["total_beers"] == 0
    assert body["public_stats"]["mapper_level"] == 3
    assert body["achievements"]["first_beer"] is False
    assert body["stats"]["shared_pub_count"] == 1
    assert body["stats"]["nights_together"] == 1
    assert len(body["recent_together"]) == 1
    assert body["recent_together"][0]["cache_key"] == "u2fkbn1z"
    assert "lat" not in body["recent_together"][0]
    assert body["blocked"] is False


@pytest.mark.django_db
def test_public_non_friend_profile_is_visible_without_private_activity_leaks(client):
    token_a, _account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    now = timezone.now()
    FriendPubActivity.objects.create(
        account=account_b,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=_PUB_NAME,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        message="Jsme tu.",
        started_at=now,
        expires_at=now + timedelta(hours=2),
    )
    _drink(account_b)
    local_today = timezone.localtime(now, _PRAGUE).date()
    PublishedNight.objects.create(
        account=account_b,
        client_id="public-today",
        drinking_day=local_today,
        started_at=now - timedelta(hours=2),
        ended_at=now,
        beer_count=2,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=["Veřejná hospoda"],
        city="Praha",
        duration_minutes=120,
        visibility=PublishedNight.Visibility.PUBLIC,
        updated_at=now,
    )
    PublishedNight.objects.create(
        account=account_b,
        client_id="friends-yesterday",
        drinking_day=local_today - timedelta(days=1),
        started_at=now - timedelta(days=1, hours=3),
        ended_at=now - timedelta(days=1),
        beer_count=7,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=["Tajná hospoda"],
        city="Praha",
        duration_minutes=180,
        visibility=PublishedNight.Visibility.FRIENDS,
        updated_at=now,
    )

    resp = client.get(f"/v1/friends/{account_b.public_id}", **_auth(token_a))
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["profile"]["nickname"] == "petr"
    assert body["is_friend"] is False
    assert body["friendship_id"] is None
    assert body["friendship_status"] == "none"
    assert body["incoming_request_id"] is None
    assert body["stats"] == {
        "shared_pub_count": 0,
        "nights_together": 0,
        "last_shared_at": None,
        "last_pub_name": "",
        "streak_weeks": 0,
        "rituals": [],
    }
    assert body["live_activity"] is None
    assert body["plan"] is None
    assert body["recent_together"] == []
    assert body["latest_beers"] == []
    assert body["public_stats"]["total_beers"] == 2
    assert body["achievements"]["first_beer"] is True
    assert body["published_timeline"]["windows"]["week"]["beers"] == 2
    assert "Veřejná hospoda" not in str(body["published_timeline"])
    assert "Tajná hospoda" not in str(body["published_timeline"])


@pytest.mark.django_db
def test_private_non_friend_profile_returns_404(client):
    token_a, _account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr", is_public=False)

    resp = client.get(f"/v1/friends/{account_b.public_id}", **_auth(token_a))

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "friend_not_found"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "direction,expected_status",
    [
        ("outgoing", "outgoing_pending"),
        ("incoming", "incoming_pending"),
    ],
)
def test_public_friend_profile_reports_pending_friendship_status(
    client,
    direction,
    expected_status,
):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    if direction == "outgoing":
        friendship = Friendship.objects.create(
            requester=account_a,
            recipient=account_b,
            status=Friendship.Status.PENDING,
        )
    else:
        friendship = Friendship.objects.create(
            requester=account_b,
            recipient=account_a,
            status=Friendship.Status.PENDING,
        )

    resp = client.get(f"/v1/friends/{account_b.public_id}", **_auth(token_a))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["friendship_status"] == expected_status
    assert body["incoming_request_id"] == (
        str(friendship.public_id) if direction == "incoming" else None
    )


@pytest.mark.django_db
def test_block_removes_friendship_and_hides_from_search(client):
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")
    _make_friends(account_a, account_b)

    blocked = client.post(
        "/v1/friends/blocks",
        data={"account_id": str(account_b.public_id)},
        format="json",
        **_auth(token_a),
    )
    assert blocked.status_code == status.HTTP_200_OK
    assert blocked.json()["blocked"] is True
    assert FriendBlock.objects.filter(blocker=account_a, blocked=account_b).exists()
    assert Friendship.objects.count() == 0

    # Bidirectional: the blocked user can no longer find the blocker in search.
    search = client.get("/v1/friends/search", {"q": "janek"}, **_auth(token_b))
    assert search.json()["results"] == []

    # And a fresh request to the blocked account is rejected as not-found.
    req = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert req.status_code == status.HTTP_404_NOT_FOUND
    assert req.json()["code"] == "profile_not_found"

    dash = client.get("/v1/friends", **_auth(token_a)).json()
    assert dash["blocked_ids"] == [str(account_b.public_id)]

    unblocked = client.delete(
        f"/v1/friends/blocks/{account_b.public_id}", **_auth(token_a)
    )
    assert unblocked.status_code == status.HTTP_200_OK
    assert unblocked.json()["unblocked"] is True
    assert not FriendBlock.objects.exists()


@pytest.mark.django_db
def test_cancel_outgoing_request(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_a, _account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")

    client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert Friendship.objects.filter(status=Friendship.Status.PENDING).count() == 1

    cancel = client.delete(f"/v1/friends/{account_b.public_id}", **_auth(token_a))
    assert cancel.status_code == status.HTTP_200_OK
    assert cancel.json()["removed"] is True
    assert Friendship.objects.count() == 0


@pytest.mark.django_db
def test_declined_request_cooldown_no_silent_reopen(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")

    request_id = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    ).json()["id"]
    client.post(f"/v1/friends/requests/{request_id}/decline", **_auth(token_b))
    FriendNotification.objects.all().delete()

    # Re-requesting during the cooldown returns 2xx but does NOT re-open or notify.
    again = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert again.status_code == status.HTTP_200_OK
    assert again.json()["status"] == Friendship.Status.DECLINED
    assert again.json()["cooldown_until"]
    assert not FriendNotification.objects.filter(
        recipient=account_b, kind=FriendNotification.Kind.FRIEND_REQUEST
    ).exists()

    # After the cooldown the request re-opens and notifies afresh.
    friendship = Friendship.objects.get(requester=account_a, recipient=account_b)
    friendship.responded_at = timezone.now() - timedelta(days=90)
    friendship.save(update_fields=["responded_at"])
    reopened = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert reopened.status_code == status.HTTP_201_CREATED
    assert reopened.json()["status"] == Friendship.Status.PENDING
    assert FriendNotification.objects.filter(
        recipient=account_b, kind=FriendNotification.Kind.FRIEND_REQUEST
    ).exists()


@pytest.mark.django_db
def test_block_then_unblock_preserves_decline_cooldown(client, monkeypatch):
    """Blocking a declined requester must not wipe the decline cooldown: after
    unblock, a fresh request is still cooldown-gated (2xx-but-DECLINED, no
    re-notification) instead of re-opening and re-pinging the decliner."""
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")

    request_id = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    ).json()["id"]
    client.post(f"/v1/friends/requests/{request_id}/decline", **_auth(token_b))
    FriendNotification.objects.all().delete()

    # A blocks B then unblocks — the DECLINED row (and its cooldown) must survive.
    block = client.post(
        "/v1/friends/blocks",
        data={"account_id": str(account_b.public_id)},
        format="json",
        **_auth(token_a),
    )
    assert block.status_code == status.HTTP_200_OK
    assert (
        Friendship.objects.get(requester=account_a, recipient=account_b).status
        == Friendship.Status.DECLINED
    )
    client.delete(f"/v1/friends/blocks/{account_b.public_id}", **_auth(token_a))

    # Re-requesting after unblock is still cooldown-gated, not a brand-new request.
    again = client.post(
        "/v1/friends/requests",
        data={"nickname": "petr"},
        format="json",
        **_auth(token_a),
    )
    assert again.status_code == status.HTTP_200_OK
    assert again.json()["status"] == Friendship.Status.DECLINED
    assert again.json()["cooldown_until"]
    assert not FriendNotification.objects.filter(
        recipient=account_b, kind=FriendNotification.Kind.FRIEND_REQUEST
    ).exists()


@pytest.mark.django_db
def test_push_disables_device_not_registered_token(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(friend)
    _grant_push(friend, "ExponentPushToken[dead_petr]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr(
        "pubs.api.views.requests.post", _device_not_registered_post(sent_payloads)
    )

    _broadcast(client, token_owner)

    device = PushDevice.objects.get(account=friend)
    assert device.enabled is False
    assert device.permission_status == PushDevice.PermissionStatus.DENIED


@pytest.mark.django_db
def test_push_fanout_chunks_by_configured_size(client, monkeypatch, settings):
    settings.EXPO_PUSH_CHUNK_SIZE = 1
    token_owner, owner = _register(client, "janek")
    _token_b, friend_b = _register(client, "petr")
    _token_c, friend_c = _register(client, "karel")
    _make_friends(owner, friend_b)
    _make_friends(owner, friend_c)
    _no_quiet(friend_b)
    _no_quiet(friend_c)
    _grant_push(friend_b, "ExponentPushToken[petr_chunk]")
    _grant_push(friend_c, "ExponentPushToken[karel_chunk]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    _broadcast(client, token_owner)

    # Chunk size 1 with two grantees → two separate POST batches of one message.
    assert len(sent_payloads) == 2
    assert all(len(batch) == 1 for batch in sent_payloads)


# ---------------------------------------------------------------------------
# Jobs: advance_friend_plans + prune_friend_data (worker cron commands)
# ---------------------------------------------------------------------------


def _make_plan_row(
    account: Account,
    *,
    scheduled_for: datetime,
    active: bool = True,
    reminder_sent_at: datetime | None = None,
    name: str = _PUB_NAME,
) -> FriendPubActivity:
    """A kind=plan row with started_at/expires_at derived from scheduled_for."""
    return FriendPubActivity.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=name,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        message="Držím stůl.",
        kind=FriendPubActivity.Kind.PLAN,
        scheduled_for=scheduled_for,
        started_at=scheduled_for,
        expires_at=scheduled_for + timedelta(hours=4),
        active=active,
        reminder_sent_at=reminder_sent_at,
    )


def _make_live_row(
    account: Account,
    *,
    active: bool = True,
    name: str = _PUB_NAME,
) -> FriendPubActivity:
    now = timezone.now()
    return FriendPubActivity.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=name,
        lat=_LAT,
        lng=_LNG,
        city="Praha",
        kind=FriendPubActivity.Kind.LIVE,
        started_at=now - timedelta(hours=1),
        expires_at=now + timedelta(hours=3),
        active=active,
    )


@pytest.mark.django_db
def test_advance_converts_due_plan_to_live_and_broadcasts(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(friend)
    _grant_push(friend, "ExponentPushToken[petr_conv]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    plan = _make_plan_row(owner, scheduled_for=timezone.now() - timedelta(minutes=5))

    call_command("advance_friend_plans")

    plan.refresh_from_db()
    assert plan.kind == FriendPubActivity.Kind.LIVE
    assert plan.active is True
    # A converted row is a live row → carries no scheduled_for anymore.
    assert plan.scheduled_for is None

    # Conversion reuses the live kind so old clients see an ordinary live card.
    note = FriendNotification.objects.get(
        recipient=friend, kind=FriendNotification.Kind.FRIEND_AT_PUB
    )
    assert note.activity_id == plan.pk
    at_pub_pushes = [
        m for m in _flatten_push(sent_payloads) if m["data"].get("kind") == "friend_at_pub"
    ]
    assert at_pub_pushes and at_pub_pushes[0]["to"] == "ExponentPushToken[petr_conv]"

    # The friend now sees it live, never as a plan.
    dash = client.get("/v1/friends", **_auth(token_friend)).json()
    assert [a["id"] for a in dash["active_friends"]] == [str(plan.public_id)]
    assert dash["plans"] == []


@pytest.mark.django_db
def test_advance_conversion_deactivates_other_live_row(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    _token_owner, owner = _register(client, "janek")

    stale_live = _make_live_row(owner)
    plan = _make_plan_row(owner, scheduled_for=timezone.now() - timedelta(minutes=5))

    call_command("advance_friend_plans")

    plan.refresh_from_db()
    stale_live.refresh_from_db()
    assert plan.kind == FriendPubActivity.Kind.LIVE
    assert plan.active is True
    # The per-kind single-active-row invariant retires the pre-existing live row.
    assert stale_live.active is False
    assert FriendPubActivity.objects.filter(account=owner, active=True).count() == 1


@pytest.mark.django_db
def test_advance_conversion_skips_fanout_for_ghost_owner(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(friend)
    _grant_push(friend, "ExponentPushToken[petr_ghost]")
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    plan = _make_plan_row(owner, scheduled_for=timezone.now() - timedelta(minutes=5))

    call_command("advance_friend_plans")

    plan.refresh_from_db()
    # The ghost owner's own row still goes live so they can track their roster...
    assert plan.kind == FriendPubActivity.Kind.LIVE
    assert plan.active is True
    # ...but nothing is broadcast.
    assert not FriendNotification.objects.filter(recipient=friend).exists()
    assert _flatten_push(sent_payloads) == []


@pytest.mark.django_db
def test_advance_deactivates_fully_elapsed_plan_without_fanout(client, monkeypatch):
    """A plan whose whole window elapsed during a long worker outage is pruned
    quietly, never resurrected as a stale live broadcast + fanout."""
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(friend)
    _grant_push(friend, "ExponentPushToken[petr_stale]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    # scheduled 6h ago → expires_at = scheduled + 4h = 2h ago (window fully over).
    plan = _make_plan_row(owner, scheduled_for=timezone.now() - timedelta(hours=6))

    call_command("advance_friend_plans")

    plan.refresh_from_db()
    # Stays a (now inactive) plan; never flips to a live broadcast.
    assert plan.kind == FriendPubActivity.Kind.PLAN
    assert plan.active is False
    # No fanout: no notification rows, no push.
    assert not FriendNotification.objects.filter(recipient=friend).exists()
    assert _flatten_push(sent_payloads) == []


@pytest.mark.django_db
def test_advance_reminder_pushes_creator_once(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    _no_quiet(owner)
    _grant_push(owner, "ExponentPushToken[owner_remind]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    plan = _make_plan_row(owner, scheduled_for=_plan_scheduled_for())

    call_command("advance_friend_plans")

    plan.refresh_from_db()
    assert plan.reminder_sent_at is not None
    # A future plan is reminded, not yet converted.
    assert plan.kind == FriendPubActivity.Kind.PLAN
    reminder_pushes = [
        m for m in _flatten_push(sent_payloads) if m["data"].get("kind") == "friend_plan"
    ]
    assert reminder_pushes and reminder_pushes[0]["to"] == "ExponentPushToken[owner_remind]"

    # A second tick must not re-remind (reminder_sent_at gates it).
    sent_payloads.clear()
    call_command("advance_friend_plans")
    assert _flatten_push(sent_payloads) == []


@pytest.mark.django_db
def test_advance_reminder_respects_quiet_hours_but_marks_sent(client, monkeypatch):
    _token_owner, owner = _register(client, "janek")
    _set_quiet_window(owner, contains_now=True)
    _grant_push(owner, "ExponentPushToken[owner_quiet]")

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    plan = _make_plan_row(owner, scheduled_for=_plan_scheduled_for())

    call_command("advance_friend_plans")

    plan.refresh_from_db()
    # Push is dropped during the creator's quiet hours, but the row is stamped so
    # the reminder is never retried on later ticks.
    assert plan.reminder_sent_at is not None
    assert _flatten_push(sent_payloads) == []


@pytest.mark.django_db
def test_prune_deactivates_expired_straggler(client):
    _token, account = _register(client, "janek")
    row = _make_live_row(account)
    row.expires_at = timezone.now() - timedelta(hours=1)
    row.save(update_fields=["expires_at"])

    call_command("prune_friend_data")

    row.refresh_from_db()
    assert row.active is False
    # Still within the hard-delete retention window → deactivated, not deleted.
    assert FriendPubActivity.objects.filter(pk=row.pk).exists()


@pytest.mark.django_db
def test_prune_hard_deletes_old_activity_and_cascades(client, settings):
    settings.FRIEND_ACTIVITY_RETENTION_DAYS = 7
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    old = timezone.now() - timedelta(days=8)
    activity = FriendPubActivity.objects.create(
        account=owner,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name=_PUB_NAME,
        lat=_LAT,
        lng=_LNG,
        started_at=old,
        expires_at=old + timedelta(hours=1),
        active=False,
    )
    response = FriendActivityResponse.objects.create(
        activity=activity, account=friend, response=FriendActivityResponse.Response.GOING
    )
    reaction = FriendActivityReaction.objects.create(activity=activity, account=friend)
    note = FriendNotification.objects.create(
        recipient=friend,
        actor=owner,
        kind=FriendNotification.Kind.FRIEND_AT_PUB,
        title="Kamarád je na pivu",
        body="x",
        activity=activity,
    )

    call_command("prune_friend_data")

    # The activity and everything hanging off it (privacy: name/lat/lng go too).
    assert not FriendPubActivity.objects.filter(pk=activity.pk).exists()
    assert not FriendActivityResponse.objects.filter(pk=response.pk).exists()
    assert not FriendActivityReaction.objects.filter(pk=reaction.pk).exists()
    assert not FriendNotification.objects.filter(pk=note.pk).exists()


@pytest.mark.django_db
def test_prune_deletes_old_notifications(client, settings):
    settings.FRIEND_NOTIFICATION_RETENTION_DAYS = 45
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")

    old_note = FriendNotification.objects.create(
        recipient=friend,
        actor=owner,
        kind=FriendNotification.Kind.FRIEND_REQUEST,
        title="Stará",
        body="x",
    )
    # created_at is auto_now_add — backdate it past the retention window.
    FriendNotification.objects.filter(pk=old_note.pk).update(
        created_at=timezone.now() - timedelta(days=46)
    )
    recent_note = FriendNotification.objects.create(
        recipient=friend,
        actor=owner,
        kind=FriendNotification.Kind.FRIEND_REQUEST,
        title="Čerstvá",
        body="y",
    )

    call_command("prune_friend_data")

    assert not FriendNotification.objects.filter(pk=old_note.pk).exists()
    assert FriendNotification.objects.filter(pk=recent_note.pk).exists()


@pytest.mark.django_db
def test_prune_deletes_expired_and_revoked_invite_codes(client):
    _token, account = _register(client, "janek")
    now = timezone.now()
    FriendInviteCode.objects.create(
        account=account, code="expired-code", expires_at=now - timedelta(days=1)
    )
    FriendInviteCode.objects.create(
        account=account, code="revoked-code", expires_at=now + timedelta(days=1), revoked=True
    )
    FriendInviteCode.objects.create(
        account=account, code="active-code", expires_at=now + timedelta(days=1)
    )

    call_command("prune_friend_data")

    assert set(FriendInviteCode.objects.values_list("code", flat=True)) == {"active-code"}


@pytest.mark.django_db
def test_prune_deletes_stale_declined_friendships(client, settings):
    settings.FRIEND_DECLINE_COOLDOWN_DAYS = 14
    _token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    _token_c, account_c = _register(client, "karel")
    now = timezone.now()

    stale = Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.DECLINED,
        responded_at=now - timedelta(days=20),
    )
    fresh_declined = Friendship.objects.create(
        requester=account_a,
        recipient=account_c,
        status=Friendship.Status.DECLINED,
        responded_at=now - timedelta(days=1),
    )
    # An old but ACCEPTED friendship must survive (status gate, not just age).
    accepted = Friendship.objects.create(
        requester=account_b,
        recipient=account_c,
        status=Friendship.Status.ACCEPTED,
        responded_at=now - timedelta(days=20),
    )

    call_command("prune_friend_data")

    assert not Friendship.objects.filter(pk=stale.pk).exists()
    assert Friendship.objects.filter(pk=fresh_declined.pk).exists()
    assert Friendship.objects.filter(pk=accepted.pk).exists()


# ---------------------------------------------------------------------------
# Invite: expiry / self-claim / blocked-claim
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_invite_resolve_expired_returns_invite_expired(client):
    token_a, account_a = _register(client, "janek")
    token_b, _account_b = _register(client, "petr")
    code = client.get("/v1/friends/invite", **_auth(token_a)).json()["code"]
    FriendInviteCode.objects.filter(account=account_a).update(
        expires_at=timezone.now() - timedelta(days=1)
    )

    resolved = client.get(f"/v1/friends/invite/{code}", **_auth(token_b))
    assert resolved.status_code == status.HTTP_404_NOT_FOUND
    assert resolved.json()["code"] == "invite_expired"


@pytest.mark.django_db
def test_invite_self_claim_rejected(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token, _account = _register(client, "janek")
    code = client.get("/v1/friends/invite", **_auth(token)).json()["code"]

    resp = client.post(
        "/v1/friends/requests",
        data={"invite_code": code},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "self_request"


@pytest.mark.django_db
def test_invite_claim_via_expired_code_rejected(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_a, account_a = _register(client, "janek")
    token_b, _account_b = _register(client, "petr")
    code = client.get("/v1/friends/invite", **_auth(token_a)).json()["code"]
    FriendInviteCode.objects.filter(account=account_a).update(
        expires_at=timezone.now() - timedelta(days=1)
    )

    resp = client.post(
        "/v1/friends/requests",
        data={"invite_code": code},
        format="json",
        **_auth(token_b),
    )
    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "invite_expired"


@pytest.mark.django_db
def test_invite_blocked_claim_rejected(client, monkeypatch):
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))
    token_a, account_a = _register(client, "janek")
    token_b, account_b = _register(client, "petr")
    code = client.get("/v1/friends/invite", **_auth(token_a)).json()["code"]
    FriendBlock.objects.create(blocker=account_a, blocked=account_b)

    # Resolve leaks nothing: a valid-but-blocked code reads as invalid.
    resolved = client.get(f"/v1/friends/invite/{code}", **_auth(token_b))
    assert resolved.status_code == status.HTTP_404_NOT_FOUND
    assert resolved.json()["code"] == "invite_invalid"

    # And claiming it is a plain profile_not_found (bidirectional block).
    claim = client.post(
        "/v1/friends/requests",
        data={"invite_code": code},
        format="json",
        **_auth(token_b),
    )
    assert claim.status_code == status.HTTP_404_NOT_FOUND
    assert claim.json()["code"] == "profile_not_found"


# ---------------------------------------------------------------------------
# Reactions: dedup within the notify cooldown
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_react_notification_deduped_within_cooldown(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(owner)
    _grant_push(owner, "ExponentPushToken[owner_dedup]")
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    activity_id = _broadcast(client, token_owner)["id"]
    react_url = f"/v1/friends/pub-activity/{activity_id}/react"

    client.post(react_url, data={"reaction": "cheers"}, format="json", **_auth(token_friend))
    client.delete(react_url, **_auth(token_friend))
    client.post(react_url, data={"reaction": "cheers"}, format="json", **_auth(token_friend))

    # Undo/redo within the cooldown must not spam the owner with a second cheer.
    assert (
        FriendNotification.objects.filter(
            recipient=owner, kind=FriendNotification.Kind.FRIEND_CHEERS
        ).count()
        == 1
    )


# ---------------------------------------------------------------------------
# Block gating: fanout + profile
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_block_gate_excludes_blocked_friend_from_fanout(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    _token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(friend)
    _grant_push(friend, "ExponentPushToken[blocked_petr]")
    # Defensive gate: a block still suppresses fanout even if a friendship row
    # lingers (the block endpoint would normally also delete the friendship).
    FriendBlock.objects.create(blocker=owner, blocked=friend)

    sent_payloads: list[list[dict]] = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent_payloads))

    _broadcast(client, token_owner)

    assert not FriendNotification.objects.filter(recipient=friend).exists()
    assert _flatten_push(sent_payloads) == []


@pytest.mark.django_db
def test_friend_profile_blocked_returns_404(client):
    token_a, account_a = _register(client, "janek")
    _token_b, account_b = _register(client, "petr")
    _make_friends(account_a, account_b)
    FriendBlock.objects.create(blocker=account_a, blocked=account_b)

    resp = client.get(f"/v1/friends/{account_b.public_id}", **_auth(token_a))
    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "friend_not_found"


# ---------------------------------------------------------------------------
# Old-client compat: new notification kinds still carry title + body
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_new_notification_kinds_carry_title_and_body_for_old_clients(client, monkeypatch):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    _no_quiet(owner)
    _no_quiet(friend)
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder([]))

    # friend_plan lands in the friend's feed.
    client.post(
        "/v1/friends/pub-activity",
        data={
            "client_id": str(uuid.uuid4()),
            "name": _PUB_NAME,
            "lat": _LAT,
            "lng": _LNG,
            "city": "Praha",
            "scheduled_for": _plan_scheduled_for().isoformat(),
        },
        format="json",
        **_auth(token_owner),
    )
    # friend_cheers lands in the friend's feed (owner cheers the friend's activity).
    friend_activity_id = _broadcast(client, token_friend)["id"]
    client.post(
        f"/v1/friends/pub-activity/{friend_activity_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_owner),
    )

    dash = client.get("/v1/friends", **_auth(token_friend)).json()
    notes = {n["kind"]: n for n in dash["notifications"]}
    assert "friend_plan" in notes
    assert "friend_cheers" in notes
    # Old clients render any feed row as icon + title + body regardless of kind,
    # so the new kinds must still ship non-empty Czech title/body.
    for kind in ("friend_plan", "friend_cheers"):
        assert notes[kind]["title"]
        assert notes[kind]["body"]

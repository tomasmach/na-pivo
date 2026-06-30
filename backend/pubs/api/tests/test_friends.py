from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    FriendActivityResponse,
    FriendNotification,
    FriendPubActivity,
    Friendship,
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
def _clear_throttle_cache():
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

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, FriendNotification, FriendPubActivity, Friendship, PubVisit, PushDevice

_LAT = 50.0876
_LNG = 14.4214
_PUB_NAME = "U Zlatého tygra"


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

    class _FakeExpoResponse:
        def raise_for_status(self) -> None:
            return None

    def _fake_post(url, *, json, timeout):  # noqa: ANN001
        assert url == "https://exp.host/--/api/v2/push/send"
        assert timeout == 3
        sent_payloads.append(json)
        return _FakeExpoResponse()

    monkeypatch.setattr("pubs.api.views.requests.post", _fake_post)
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

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.accounts import issue_token
from pubs.api import challenge_views
from pubs.api.challenge_views import derive_challenges
from pubs.models import Account, DrinkLog, FriendBlock, Friendship, PubVisit


def _account() -> Account:
    return Account.objects.create(
        device_id=uuid.uuid4(),
        token_hash=uuid.uuid4().hex,
    )


def _visit(account: Account, cache_key: str, at: datetime) -> None:
    PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="Hospoda",
        lat=50.0,
        lng=14.0,
        started_at=at,
        client_updated_at=at,
    )


def _beer(account: Account, brand: str, at: datetime, *, suspect: bool = False) -> None:
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2mqr8vd",
        name="Hospoda",
        lat=50.0,
        lng=14.0,
        drink_type=DrinkLog.DrinkType.BEER,
        beer_name=brand,
        beer_brand_key=brand.lower(),
        beer_brand_name=brand,
        price_czk=None,
        drank_at=at,
        is_suspect=suspect,
        suspect_reason="manual" if suspect else "",
    )


@pytest.mark.django_db
def test_challenges_are_derived_from_visits_and_non_suspect_beers():
    account = _account()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)  # Thursday
    _visit(account, "old", datetime(2026, 7, 3, 18, tzinfo=UTC))
    _visit(account, "old", datetime(2026, 8, 6, 18, tzinfo=UTC))
    _visit(account, "new-a", datetime(2026, 8, 13, 18, tzinfo=UTC))
    _visit(account, "new-b", datetime(2026, 8, 20, 18, tzinfo=UTC))
    _beer(account, "Old", datetime(2026, 7, 10, 18, tzinfo=UTC))
    _beer(account, "Old", datetime(2026, 8, 10, 18, tzinfo=UTC))
    _beer(account, "Fresh", datetime(2026, 8, 11, 18, tzinfo=UTC))
    _beer(account, "Ignored", datetime(2026, 8, 12, 18, tzinfo=UTC), suspect=True)

    rows = {row["id"]: row for row in derive_challenges(account, now=now)}

    assert rows["new-pubs-month"]["done"] == 2
    assert rows["thursday-streak"]["done"] == 3
    assert rows["new-breweries-month"]["done"] == 1
    assert rows["new-breweries-month"]["progress"] == pytest.approx(0.2)


@pytest.mark.django_db
def test_challenges_endpoint_requires_auth_and_returns_no_private_rows():
    client = APIClient()
    assert client.get("/v1/challenges").status_code == 401


@pytest.mark.django_db
def test_thursday_streak_materialization_has_a_fixed_lookback(monkeypatch):
    account = _account()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)  # Thursday
    monkeypatch.setattr(challenge_views, "_THURSDAY_STREAK_LOOKBACK_WEEKS", 3)
    for weeks_ago in range(4):
        _visit(
            account,
            f"pub-{weeks_ago}",
            datetime(2026, 8, 20, 18, tzinfo=UTC)
            - timedelta(weeks=weeks_ago),
        )

    rows = {row["id"]: row for row in derive_challenges(account, now=now)}

    assert rows["thursday-streak"]["done"] == 3


@pytest.mark.django_db
def test_challenges_endpoint_uses_its_own_scoped_throttle(monkeypatch):
    client = APIClient()
    registered = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    token = registered.json()["token"]
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["challenges"] = "1/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)
    cache.clear()

    first = client.get(
        "/v1/challenges",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    second = client.get(
        "/v1/challenges",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert first.status_code == status.HTTP_200_OK
    assert second.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_challenge_friend_progress_does_not_expose_private_diary_aggregates():
    client = APIClient()
    viewer = _account()
    viewer.nickname = "viewer"
    viewer.save(update_fields=["nickname"])
    visible = _account()
    visible.nickname = "visible"
    visible.is_public = False  # accepted friendship, not public discovery, grants profile access
    visible.save(update_fields=["nickname", "is_public"])
    visible.share_drinks_with_parta = True
    visible.save(update_fields=["share_drinks_with_parta"])
    Friendship.objects.create(
        requester=viewer,
        recipient=visible,
        status=Friendship.Status.ACCEPTED,
    )

    now = timezone.now()
    visible.last_seen_at = now + timedelta(minutes=1)
    visible.save(update_fields=["last_seen_at"])
    _visit(visible, "visible-pub", now - timedelta(days=1))
    _beer(visible, "Visible Brewery", now - timedelta(hours=2))
    token = issue_token(viewer)
    cache.clear()

    response = client.get(
        "/v1/challenges",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert response.status_code == status.HTTP_200_OK
    rows = {row["id"]: row for row in response.json()["challenges"]}
    assert all(row["friends"] == [] for row in rows.values())


@pytest.mark.django_db
def test_challenge_friend_progress_includes_public_accepted_friend_with_absolute_avatar():
    client = APIClient()
    viewer = _account()
    friend = _account()
    friend.nickname = "verejny"
    friend.display_name = "Veřejný kamarád"
    friend.is_public = True
    friend.avatar.name = "avatars/challenge-friend.jpg"
    friend.save(update_fields=["nickname", "display_name", "is_public", "avatar"])
    Friendship.objects.create(
        requester=viewer,
        recipient=friend,
        status=Friendship.Status.ACCEPTED,
    )
    now = timezone.now()
    _visit(friend, "new-pub", now - timedelta(days=1))
    _beer(friend, "New Brewery", now - timedelta(hours=2))

    response = client.get(
        "/v1/challenges",
        HTTP_AUTHORIZATION=f"Bearer {issue_token(viewer)}",
    )

    assert response.status_code == status.HTTP_200_OK
    rows = {row["id"]: row for row in response.json()["challenges"]}
    pub_friend = rows["new-pubs-month"]["friends"][0]
    beer_friend = rows["new-breweries-month"]["friends"][0]
    assert pub_friend["account"] == {
        "id": str(friend.public_id),
        "nickname": "verejny",
        "display_name": "Veřejný kamarád",
        "avatar_url": "http://testserver/media/avatars/challenge-friend.jpg",
        "is_public": True,
    }
    assert pub_friend["done"] == 1
    assert pub_friend["progress"] == pytest.approx(0.1)
    assert beer_friend["done"] == 1
    assert beer_friend["progress"] == pytest.approx(0.2)


@pytest.mark.django_db
def test_challenge_friend_progress_is_block_filtered_and_bounded(monkeypatch):
    client = APIClient()
    viewer = _account()
    friends = [_account() for _ in range(4)]
    for friend in friends:
        friend.is_public = True
        friend.save(update_fields=["is_public"])
        Friendship.objects.create(
            requester=viewer,
            recipient=friend,
            status=Friendship.Status.ACCEPTED,
        )
    FriendBlock.objects.create(blocker=friends[0], blocked=viewer)
    monkeypatch.setattr(challenge_views, "CHALLENGE_FRIEND_LIMIT", 2)

    response = client.get(
        "/v1/challenges",
        HTTP_AUTHORIZATION=f"Bearer {issue_token(viewer)}",
    )

    assert response.status_code == status.HTTP_200_OK
    for challenge in response.json()["challenges"]:
        assert len(challenge["friends"]) == 2
        assert str(friends[0].public_id) not in {
            row["account"]["id"] for row in challenge["friends"]
        }

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import issue_token
from pubs.models import (
    Account,
    BeerPhoto,
    Challenge,
    DrinkLog,
    FriendBlock,
    Friendship,
    PubVisit,
)


@pytest.fixture
def client():
    return APIClient()


def _account(nickname: str) -> tuple[Account, str]:
    account = Account.objects.create(
        device_id=f"challenge-{uuid.uuid4()}",
        nickname=nickname,
        display_name=nickname.capitalize(),
        is_public=True,
    )
    return account, issue_token(account)


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _challenge(metric_rule: str, **overrides) -> Challenge:
    now = timezone.now()
    values = {
        "slug": f"test-{metric_rule}-{uuid.uuid4()}",
        "title": "Testovací výzva",
        "glyph_key": Challenge.GlyphKey.PLACES,
        "metric_rule": metric_rule,
        "target": 3,
        "unit": "zářezů",
        "blurb": "Jen pro test.",
        "reward": "Odznak Test",
        "rules": ["Počítají se jen řádky v okně."],
        "window_start": now - timedelta(days=1),
        "window_end": now + timedelta(days=1),
        "active": True,
    }
    values.update(overrides)
    return Challenge.objects.create(**values)


def _drink(account: Account, cache_key: str, *, suspect: bool = False) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Testu",
        lat=50.08,
        lng=14.42,
        city="Praha",
        external_id="mapy:test",
        place_context=DrinkLog.PlaceContext.PUB,
        drink_type=DrinkLog.DrinkType.BEER,
        beer_name="Testovací ležák",
        price_czk=60,
        drank_at=timezone.now(),
        is_suspect=suspect,
    )


def _visit(account: Account, cache_key: str) -> PubVisit:
    now = timezone.now()
    return PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Testu",
        lat=50.08,
        lng=14.42,
        city="Praha",
        external_id="mapy:test",
        started_at=now,
        client_updated_at=now,
    )


def _photo(account: Account) -> BeerPhoto:
    return BeerPhoto.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        image=f"beer-photos/test/{uuid.uuid4()}.webp",
        taken_at=timezone.now(),
    )


@pytest.mark.django_db
def test_challenges_require_authentication(client):
    response = client.get("/v1/challenges")

    assert response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


@pytest.mark.django_db
def test_challenges_return_only_current_active_definitions(client):
    _account_row, token = _account("janek")
    current = _challenge(Challenge.MetricRule.BEER_COUNT)
    inactive = _challenge(Challenge.MetricRule.PHOTO_COUNT, active=False)
    expired = _challenge(
        Challenge.MetricRule.DISTINCT_PUBS,
        window_start=timezone.now() - timedelta(days=3),
        window_end=timezone.now() - timedelta(days=2),
    )

    response = client.get("/v1/challenges", **_auth(token))

    assert response.status_code == status.HTTP_200_OK
    rows = {row["id"]: row for row in response.json()["challenges"]}
    assert current.slug in rows
    assert inactive.slug not in rows
    assert expired.slug not in rows
    assert rows[current.slug]["progress"] == {"current": 0, "target": 3, "ratio": 0.0}
    assert all(row["id"] == row["slug"] for row in rows.values())


@pytest.mark.django_db
def test_progress_is_computed_on_read_from_diary_rows(client):
    account, token = _account("janek")
    beers = _challenge(Challenge.MetricRule.BEER_COUNT, target=2)
    pubs = _challenge(Challenge.MetricRule.DISTINCT_PUBS, target=3)
    photos = _challenge(Challenge.MetricRule.PHOTO_COUNT, target=1)
    first = _drink(account, "pub-one")
    _drink(account, "pub-two")
    _drink(account, "ignored", suspect=True)
    _visit(account, "pub-one")
    _visit(account, "pub-three")
    photo = _photo(account)

    response = client.get("/v1/challenges", **_auth(token))
    rows = {row["id"]: row for row in response.json()["challenges"]}

    assert rows[beers.slug]["progress"] == {"current": 2, "target": 2, "ratio": 1.0}
    assert rows[pubs.slug]["progress"] == {"current": 3, "target": 3, "ratio": 1.0}
    assert rows[photos.slug]["progress"] == {"current": 1, "target": 1, "ratio": 1.0}

    first.delete()
    photo.delete()
    updated = client.get("/v1/challenges", **_auth(token))
    updated_rows = {row["id"]: row for row in updated.json()["challenges"]}
    assert updated_rows[beers.slug]["progress"]["current"] == 1
    assert updated_rows[photos.slug]["progress"]["current"] == 0


@pytest.mark.django_db
def test_rivals_include_only_eligible_friends(client):
    me, token = _account("janek")
    friend, _ = _account("kamarad")
    stranger, _ = _account("cizi")
    blocked, _ = _account("blokovany")
    ghost, _ = _account("duch")
    private_sharing, _ = _account("nesdili")
    private_sharing.share_drinks_with_parta = False
    private_sharing.save(update_fields=["share_drinks_with_parta"])
    ghost.ghost_mode = True
    ghost.save(update_fields=["ghost_mode"])
    for account in (friend, blocked, ghost, private_sharing):
        Friendship.objects.create(
            requester=me,
            recipient=account,
            status=Friendship.Status.ACCEPTED,
            responded_at=timezone.now(),
        )
        _drink(account, f"pub-{account.nickname}")
    _drink(stranger, "pub-stranger")
    FriendBlock.objects.create(blocker=blocked, blocked=me)
    challenge = _challenge(Challenge.MetricRule.BEER_COUNT)

    response = client.get("/v1/challenges", **_auth(token))
    row = next(item for item in response.json()["challenges"] if item["id"] == challenge.slug)

    assert [(rival["account"]["nickname"], rival["progress"]) for rival in row["rivals"]] == [
        ("kamarad", 1)
    ]

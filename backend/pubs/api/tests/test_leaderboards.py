from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, AccountUsageStats, DrinkLog, FriendBlock, Friendship, PubVisit


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_cache():
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


def _drink(
    account: Account,
    *,
    cache_key: str | None = "u2fkbn1z",
    drank_at=None,
    name: str = "Plzeň",
    drink_type: str = DrinkLog.DrinkType.BEER,
    is_suspect: bool = False,
    suspect_reason: str = "",
) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra" if cache_key is not None else "",
        lat=50.0876 if cache_key is not None else None,
        lng=14.4214 if cache_key is not None else None,
        city="Praha" if cache_key is not None else "",
        external_id="mapy:test" if cache_key is not None else "",
        place_context=(
            DrinkLog.PlaceContext.PUB
            if cache_key is not None
            else DrinkLog.PlaceContext.OUTDOORS
        ),
        drink_type=drink_type,
        beer_name=name,
        price_czk=65,
        drank_at=drank_at or timezone.now(),
        is_suspect=is_suspect,
        suspect_reason=suspect_reason,
    )


def _visit(account: Account, *, cache_key: str = "u2fkbn1z", started_at=None) -> PubVisit:
    return PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        city="Praha",
        external_id="mapy:test",
        started_at=started_at or timezone.now(),
        client_updated_at=started_at or timezone.now(),
    )


def _set_created(account: Account, offset_days: int) -> None:
    Account.objects.filter(pk=account.pk).update(
        created_at=timezone.now() + timedelta(days=offset_days)
    )
    account.refresh_from_db(fields=["created_at"])


@pytest.mark.django_db
def test_beers_leaderboard_orders_by_score_tiebreak_and_marks_friend(client):
    token, me = _register(client, "janek")
    _token_old, older = _register(client, "oldrich")
    _token_new, newer = _register(client, "novak")
    _set_created(older, -3)
    _set_created(newer, -1)
    Friendship.objects.create(
        requester=me,
        recipient=older,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )
    _drink(older)
    _drink(older)
    _drink(newer)
    _drink(newer)
    _drink(me)

    resp = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["category"] == "beers"
    assert body["period"] == "week"
    assert body["period_start"]
    assert body["total_ranked"] == 3
    assert [entry["account"]["nickname"] for entry in body["entries"]] == [
        "oldrich",
        "novak",
        "janek",
    ]
    assert [entry["rank"] for entry in body["entries"]] == [1, 2, 3]
    assert body["entries"][0]["is_friend"] is True
    assert body["entries"][2]["is_me"] is True
    assert body["me"] == {"rank": 3, "score": 1, "listed": True, "eligible": True}


@pytest.mark.django_db
def test_leaderboard_avatar_url_is_absolute_per_request(client):
    token, account = _register(client, "janek")
    account.avatar.name = "avatars/janek.webp"
    account.save(update_fields=["avatar"])
    _drink(account)

    first = client.get(
        "/v1/leaderboards?category=beers&period=week",
        HTTP_HOST="first.test",
        **_auth(token),
    )
    second = client.get(
        "/v1/leaderboards?category=beers&period=week",
        HTTP_HOST="second.test",
        **_auth(token),
    )

    assert first.status_code == status.HTTP_200_OK
    assert second.status_code == status.HTTP_200_OK
    assert first.json()["entries"][0]["account"]["avatar_url"].startswith(
        "http://first.test/media/avatars/janek.webp"
    )
    assert second.json()["entries"][0]["account"]["avatar_url"].startswith(
        "http://second.test/media/avatars/janek.webp"
    )


@pytest.mark.django_db
def test_pubs_leaderboard_counts_distinct_visit_and_drink_union(client):
    token, me = _register(client, "janek")
    _token_a, account_a = _register(client, "anna")
    _visit(account_a, cache_key="same")
    _drink(account_a, cache_key="same")
    _drink(account_a, cache_key="other")
    _visit(me, cache_key="mine")

    resp = client.get("/v1/leaderboards?category=pubs&period=week", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert [(e["account"]["nickname"], e["score"]) for e in body["entries"]] == [
        ("anna", 2),
        ("janek", 1),
    ]


@pytest.mark.django_db
def test_non_pub_beer_counts_only_in_beer_leaderboard_and_non_beers_do_not(client):
    token, me = _register(client, "janek")
    _drink(me, cache_key="pub-one")
    _drink(me, cache_key=None)
    _drink(me, cache_key="wine-pub", drink_type=DrinkLog.DrinkType.WINE, name="Víno")
    _drink(me, cache_key="shot-pub", drink_type=DrinkLog.DrinkType.SHOT, name="Panák")
    _drink(
        me,
        cache_key="soft-pub",
        drink_type=DrinkLog.DrinkType.SOFT_DRINK,
        name="Kofola",
    )

    beers = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))
    pubs = client.get("/v1/leaderboards?category=pubs&period=week", **_auth(token))

    assert beers.status_code == status.HTTP_200_OK
    assert beers.json()["me"]["score"] == 2
    assert beers.json()["entries"][0]["score"] == 2
    assert pubs.status_code == status.HTTP_200_OK
    assert pubs.json()["me"]["score"] == 4
    assert pubs.json()["entries"][0]["score"] == 4


@pytest.mark.django_db
def test_leaderboards_exclude_suspect_drinks_and_excluded_accounts(client):
    token, me = _register(client, "janek")
    _token_visible, visible = _register(client, "anna")
    _drink(visible, cache_key="clean")
    _drink(visible, cache_key="suspect", is_suspect=True, suspect_reason="burst")
    _visit(visible, cache_key="visited")
    _drink(me, cache_key="mine")
    _visit(me, cache_key="mine-visit")
    me.excluded_from_leaderboards = True
    me.save(update_fields=["excluded_from_leaderboards"])

    beers = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))
    assert beers.status_code == status.HTTP_200_OK
    assert [(row["account"]["nickname"], row["score"]) for row in beers.json()["entries"]] == [
        ("anna", 1)
    ]
    assert beers.json()["me"] == {
        "rank": None,
        "score": 0,
        "listed": False,
        "eligible": False,
    }

    pubs = client.get("/v1/leaderboards?category=pubs&period=week", **_auth(token))
    assert pubs.status_code == status.HTTP_200_OK
    assert [(row["account"]["nickname"], row["score"]) for row in pubs.json()["entries"]] == [
        ("anna", 2)
    ]
    assert pubs.json()["me"] == {
        "rank": None,
        "score": 0,
        "listed": False,
        "eligible": False,
    }


@pytest.mark.django_db
def test_mapper_leaderboard_coerces_period_to_all(client):
    token, me = _register(client, "janek")
    _token_a, account_a = _register(client, "anna")
    AccountUsageStats.objects.create(account=me, mapper_xp=25)
    AccountUsageStats.objects.create(account=account_a, mapper_xp=120)

    resp = client.get("/v1/leaderboards?category=mapper&period=week", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["period"] == "all"
    assert body["period_start"] is None
    assert [(e["account"]["nickname"], e["score"]) for e in body["entries"]] == [
        ("anna", 120),
        ("janek", 25),
    ]


@pytest.mark.django_db
def test_private_accounts_are_not_listed_but_me_rank_is_computed(client):
    token, me = _register(client, "janek", is_public=False)
    _token_a, account_a = _register(client, "anna")
    _token_private, private = _register(client, "tajny", is_public=False)
    for _ in range(3):
        _drink(account_a)
    for _ in range(2):
        _drink(me)
    for _ in range(10):
        _drink(private)

    resp = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert [entry["account"]["nickname"] for entry in body["entries"]] == ["anna"]
    assert body["total_ranked"] == 1
    assert body["me"] == {"rank": 2, "score": 2, "listed": False, "eligible": False}


@pytest.mark.django_db
def test_blocks_filter_warm_cache_without_reranking(client):
    token, me = _register(client, "janek")
    _token_blocked, blocked = _register(client, "blocked")
    _token_visible, visible = _register(client, "visible")
    _drink(blocked)
    _drink(blocked)
    _drink(visible)

    first = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))
    assert first.status_code == status.HTTP_200_OK
    assert [entry["rank"] for entry in first.json()["entries"]] == [1, 2]

    FriendBlock.objects.create(blocker=me, blocked=blocked)
    _drink(visible)
    second = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))

    assert second.status_code == status.HTTP_200_OK
    body = second.json()
    assert [(e["rank"], e["account"]["nickname"], e["score"]) for e in body["entries"]] == [
        (2, "visible", 1)
    ]


@pytest.mark.django_db
def test_leaderboard_rejects_invalid_params(client):
    token, _me = _register(client, "janek")

    resp = client.get("/v1/leaderboards?category=wine&period=week", **_auth(token))

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "invalid_params"

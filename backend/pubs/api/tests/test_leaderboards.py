from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.views import _leaderboard_drinking_day
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
            DrinkLog.PlaceContext.PUB if cache_key is not None else DrinkLog.PlaceContext.OUTDOORS
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
def test_red_only_account_has_no_score_but_remains_eligible(client):
    token, me = _register(client, "janek")
    red_token, red = _register(client, "extrem")
    base = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
    _drink(me, cache_key="mine", drank_at=base)
    for index in range(25):
        _drink(red, cache_key="red-pub", drank_at=base + timedelta(minutes=index))

    beers = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))
    assert beers.status_code == status.HTTP_200_OK
    assert [row["account"]["nickname"] for row in beers.json()["entries"]] == ["janek"]
    assert beers.json()["total_ranked"] == 1

    red_view = client.get(
        "/v1/leaderboards?category=beers&period=week",
        **_auth(red_token),
    )
    assert red_view.json()["me"] == {
        "rank": None,
        "score": 0,
        "listed": False,
        "eligible": True,
    }

    pubs = client.get("/v1/leaderboards?category=pubs&period=week", **_auth(token))
    assert pubs.status_code == status.HTTP_200_OK
    assert {row["account"]["nickname"] for row in pubs.json()["entries"]} == {
        "extrem",
        "janek",
    }


@pytest.mark.django_db
def test_repeated_burst_flags_can_hide_account_below_red_day_count(client, settings):
    settings.LEADERBOARD_BEER_RED_DAY = 25
    settings.LEADERBOARD_BEER_RED_BURSTS = 12
    token, me = _register(client, "janek")
    _other_token, red = _register(client, "bulk")
    base = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
    _drink(me, drank_at=base)
    for index in range(8):
        _drink(red, drank_at=base + timedelta(seconds=index))
    for index in range(12):
        _drink(
            red,
            drank_at=base + timedelta(seconds=8 + index),
            is_suspect=True,
            suspect_reason="burst",
        )

    response = client.get(
        "/v1/leaderboards?category=beers&period=week",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_200_OK
    assert [row["account"]["nickname"] for row in response.json()["entries"]] == ["janek"]


@pytest.mark.django_db
@pytest.mark.parametrize("period", ["week", "year", "all"])
@pytest.mark.parametrize("red_reason", ["raw_count", "burst"])
def test_red_day_preserves_other_days_and_consistent_ranks(
    client, monkeypatch, period, red_reason,
):
    prague = ZoneInfo("Europe/Prague")
    now = datetime(2026, 9, 16, 12, tzinfo=prague)
    monkeypatch.setattr("pubs.api.views.dj_timezone.now", lambda: now)
    token, me = _register(client, "janek")
    _older_token, older = _register(client, "oldrich")
    _newer_token, newer = _register(client, "novak")
    _set_created(older, -3)
    _set_created(me, -2)
    _set_created(newer, -1)
    red_start = {
        "week": datetime(2026, 9, 14, 12, tzinfo=prague),
        "year": datetime(2026, 2, 10, 12, tzinfo=prague),
        "all": datetime(2025, 2, 10, 12, tzinfo=prague),
    }[period]
    red_count = 25 if red_reason == "raw_count" else 20
    for index in range(red_count):
        burst = red_reason == "burst" and index >= 8
        _drink(
            me,
            drank_at=red_start + timedelta(seconds=index),
            is_suspect=burst,
            suspect_reason="burst" if burst else "",
        )
    clean_start = now - timedelta(days=1)
    for account in (me, older, newer):
        for index in range(3):
            _drink(account, drank_at=clean_start + timedelta(hours=index))
    _drink(me, drank_at=clean_start, is_suspect=True, suspect_reason="manual")
    # A different account's beer on the red day must remain countable.
    _drink(older, drank_at=red_start)

    response = client.get(
        f"/v1/leaderboards?category=beers&period={period}", **_auth(token),
    )
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["total_ranked"] == 3
    assert [(row["rank"], row["account"]["nickname"], row["score"]) for row in body["entries"]] == [
        (1, "oldrich", 4), (2, "janek", 3), (3, "novak", 3),
    ]
    assert body["me"] == {"rank": 2, "score": 3, "listed": True, "eligible": True}
    # Cached rows and the live own score use the same day exclusion.
    assert client.get(
        f"/v1/leaderboards?category=beers&period={period}", **_auth(token),
    ).json() == body


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("period", "start"),
    [("week", "2026-09-14T00:00:00"), ("year", "2026-01-01T00:00:00")],
)
def test_red_day_crossing_period_start_excludes_only_until_four_am(
    client, monkeypatch, period, start,
):
    boundary = datetime.fromisoformat(start).replace(tzinfo=ZoneInfo("Europe/Prague"))
    monkeypatch.setattr("pubs.api.views.dj_timezone.now", lambda: boundary + timedelta(days=2))
    token, me = _register(client, "janek")
    _other_token, other = _register(client, "anna")
    # Most of this red drinking day precedes the requested week/year.
    for index in range(24):
        _drink(me, drank_at=boundary - timedelta(hours=6) + timedelta(minutes=15 * index))
    _drink(me, drank_at=boundary + timedelta(hours=3, minutes=59))
    _drink(me, drank_at=boundary + timedelta(hours=4))
    _drink(me, drank_at=boundary + timedelta(hours=5))
    _drink(other, drank_at=boundary + timedelta(hours=3))

    response = client.get(
        f"/v1/leaderboards?category=beers&period={period}", **_auth(token),
    )
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["total_ranked"] == 2
    assert [(row["account"]["nickname"], row["score"]) for row in body["entries"]] == [
        ("janek", 2), ("anna", 1),
    ]
    assert body["me"] == {"rank": 1, "score": 2, "listed": True, "eligible": True}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("timestamp", "expected_day"),
    [("2026-03-29T04:30:00", "2026-03-29"), ("2026-10-25T03:30:00", "2026-10-24")],
)
def test_red_day_keeps_four_am_boundary_across_dst(
    client, monkeypatch, timestamp, expected_day,
):
    point = datetime.fromisoformat(timestamp).replace(tzinfo=ZoneInfo("Europe/Prague"))
    monkeypatch.setattr("pubs.api.views.dj_timezone.now", lambda: point + timedelta(days=1))
    token, me = _register(client, "janek")
    previous_noon = (point - timedelta(days=1)).replace(hour=12, minute=0)
    for index in range(25):
        _drink(me, drank_at=previous_noon + timedelta(seconds=index))
    boundary_drink = _drink(me, drank_at=point)
    # In autumn, 03:30 still belongs to the red day; 04:00 starts a clean day.
    if point.hour < 4:
        _drink(me, drank_at=point.replace(hour=4, minute=0))

    response = client.get("/v1/leaderboards?category=beers&period=all", **_auth(token))
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["me"] == {"rank": 1, "score": 1, "listed": True, "eligible": True}
    assert [(row["account"]["nickname"], row["score"]) for row in body["entries"]] == [
        ("janek", 1),
    ]
    actual_day = (
        DrinkLog.objects.filter(pk=boundary_drink.pk)
        .annotate(drinking_day=_leaderboard_drinking_day())
        .values_list("drinking_day", flat=True)
        .get()
    )
    assert actual_day == date.fromisoformat(expected_day)


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
def test_blocked_accounts_ahead_are_removed_from_cached_me_rank(client):
    token, me = _register(client, "janek")
    _token_blocked, blocked = _register(client, "blocked")
    _drink(me)
    _drink(blocked)
    _drink(blocked)

    first = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))
    assert first.status_code == status.HTTP_200_OK
    assert first.json()["me"]["rank"] == 2

    FriendBlock.objects.create(blocker=me, blocked=blocked)
    second = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))

    assert second.status_code == status.HTTP_200_OK
    assert second.json()["me"]["rank"] == 1


@pytest.mark.django_db
def test_warm_leaderboard_cache_reuses_full_ranking(client, monkeypatch):
    token, me = _register(client, "janek")
    _token_other, other = _register(client, "anna")
    _drink(me)
    _drink(other)
    _drink(other)

    first = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))
    assert first.status_code == status.HTTP_200_OK

    def fail_score_rebuild(*args, **kwargs):
        raise AssertionError("warm cache rebuilt the global score map")

    monkeypatch.setattr("pubs.api.views._leaderboard_score_map", fail_score_rebuild)
    second = client.get("/v1/leaderboards?category=beers&period=week", **_auth(token))

    assert second.status_code == status.HTTP_200_OK
    assert second.json() == first.json()


@pytest.mark.django_db
def test_leaderboard_rejects_invalid_params(client):
    token, _me = _register(client, "janek")

    resp = client.get("/v1/leaderboards?category=wine&period=week", **_auth(token))

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "invalid_params"


@pytest.mark.django_db
def test_leaderboard_supports_additive_rank_cursor_pagination(client):
    token, me = _register(client, "janek")
    _other_token, other = _register(client, "anna")
    _drink(other)
    _drink(other)
    _drink(me)

    first = client.get(
        "/v1/leaderboards?category=beers&period=week&limit=1",
        **_auth(token),
    )
    second = client.get(
        "/v1/leaderboards?category=beers&period=week&limit=1&cursor=1",
        **_auth(token),
    )

    assert [row["rank"] for row in first.json()["entries"]] == [1]
    assert first.json()["next_cursor"] == 1
    assert [row["rank"] for row in second.json()["entries"]] == [2]
    assert second.json()["next_cursor"] is None

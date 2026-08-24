from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    DrinkLog,
    FriendBlock,
    FriendPubActivity,
    Friendship,
    PubVisit,
)

_CACHE_KEY = "u2fkbfvz"
_OTHER_CACHE_KEY = "u2fkbn1z"
_LAT = 50.56
_LNG = 15.91


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=response.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.save(update_fields=["nickname", "display_name"])
    return response.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _make_friends(account_a: Account, account_b: Account) -> Friendship:
    return Friendship.objects.create(
        requester=account_a,
        recipient=account_b,
        status=Friendship.Status.ACCEPTED,
    )


def _visit(
    account: Account,
    *,
    started_at,
    ended_at=None,
    closed_at=None,
    cache_key: str = _CACHE_KEY,
    name: str = "Bar Na Pile",
) -> PubVisit:
    return PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name=name,
        lat=_LAT,
        lng=_LNG,
        city="Trutnov",
        external_id="mapy:test",
        started_at=started_at,
        ended_at=ended_at,
        closed_at=closed_at,
        client_updated_at=ended_at or started_at,
    )


def _drink(
    account: Account,
    *,
    drank_at,
    cache_key: str | None = _CACHE_KEY,
    pub_name: str = "Restaurace Cisterna",
    drink_type: str = DrinkLog.DrinkType.BEER,
    serving_type: str = DrinkLog.ServingType.DRAFT,
    beer_name: str = "Původní název",
    beer_brand_name: str = "",
    beer_product_name: str = "",
    place_context: str = DrinkLog.PlaceContext.PUB,
    is_suspect: bool = False,
    price_czk: int | None = 65,
) -> DrinkLog:
    is_pub = place_context == DrinkLog.PlaceContext.PUB
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key if is_pub else None,
        name=pub_name if is_pub else "",
        lat=_LAT if is_pub else None,
        lng=_LNG if is_pub else None,
        city="Trutnov" if is_pub else "",
        external_id="mapy:test" if is_pub else "",
        place_context=place_context,
        serving_type=serving_type,
        drink_type=drink_type,
        beer_name=beer_name,
        beer_brand_name=beer_brand_name,
        beer_product_name=beer_product_name,
        price_czk=price_czk,
        is_suspect=is_suspect,
        drank_at=drank_at,
    )


@pytest.mark.django_db
def test_presence_uses_recent_visit_without_manual_activity(client):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    now = timezone.now()
    visit = _visit(
        friend,
        started_at=now - timedelta(hours=2),
        ended_at=now - timedelta(minutes=10),
    )
    _drink(
        friend,
        drank_at=now - timedelta(minutes=30),
        beer_name="Fallback",
        beer_brand_name="Pilsner",
        beer_product_name="Pilsner Urquell",
    )
    _drink(
        friend,
        drank_at=now - timedelta(minutes=20),
        beer_name="Pilsner Urquell",
    )

    for endpoint in ("/v1/friends", "/v1/friends/live"):
        response = client.get(endpoint, **_auth(token_owner))
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert len(body["presence"]) == 1
        presence = body["presence"][0]
        assert presence["account"]["nickname"] == "jarek"
        assert presence["pub_name"] == "Bar Na Pile"
        assert presence["pub_city"] == "Trutnov"
        assert presence["cache_key"] == _CACHE_KEY
        assert presence["lat"] == _LAT
        assert presence["lng"] == _LNG
        assert presence["beers"] == 2
        assert presence["last_drink_name"] == "Pilsner Urquell"
        assert presence["activity_id"] is None
        assert presence["since"] == visit.started_at.isoformat().replace("+00:00", "Z")


@pytest.mark.django_db
def test_presence_expires_after_configured_window(client, settings):
    settings.FRIEND_PRESENCE_WINDOW_MINUTES = 180
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    now = timezone.now()
    _visit(
        friend,
        started_at=now - timedelta(hours=4),
        ended_at=now - timedelta(hours=3, minutes=1),
    )

    response = client.get("/v1/friends/live", **_auth(token_owner))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["presence"] == []


@pytest.mark.django_db
def test_explicitly_closed_visit_disappears_from_presence_immediately(client):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    now = timezone.now()
    _visit(
        friend,
        started_at=now - timedelta(hours=1),
        ended_at=now - timedelta(minutes=5),
        closed_at=now,
    )

    response = client.get("/v1/friends/live", **_auth(token_owner))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["presence"] == []


@pytest.mark.django_db
def test_presence_includes_recent_open_visit(client, settings):
    settings.FRIEND_PRESENCE_WINDOW_MINUTES = 180
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    _visit(
        friend,
        started_at=timezone.now() - timedelta(hours=2, minutes=59),
        ended_at=None,
    )

    response = client.get("/v1/friends/live", **_auth(token_owner))

    assert response.status_code == status.HTTP_200_OK
    assert [row["account"]["nickname"] for row in response.json()["presence"]] == [
        "jarek"
    ]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("field", "value"),
    [("ghost_mode", True), ("share_drinks_with_parta", False)],
)
def test_privacy_switches_hide_friend_from_presence_and_feed(
    client,
    field,
    value,
):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    setattr(friend, field, value)
    friend.save(update_fields=[field])
    now = timezone.now()
    _visit(friend, started_at=now - timedelta(hours=1), ended_at=now)
    _drink(friend, drank_at=now - timedelta(minutes=10))

    live = client.get("/v1/friends/live", **_auth(token_owner))
    feed = client.get("/v1/friends/drink-feed", **_auth(token_owner))

    assert live.status_code == status.HTTP_200_OK
    assert live.json()["presence"] == []
    assert feed.status_code == status.HTTP_200_OK
    assert feed.json()["results"] == []


@pytest.mark.django_db
def test_blocked_friend_is_absent_from_presence_and_feed(client):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    FriendBlock.objects.create(blocker=friend, blocked=owner)
    now = timezone.now()
    _visit(friend, started_at=now - timedelta(hours=1), ended_at=now)
    _drink(friend, drank_at=now - timedelta(minutes=10))

    live = client.get("/v1/friends/live", **_auth(token_owner))
    feed = client.get("/v1/friends/drink-feed", **_auth(token_owner))

    assert live.status_code == status.HTTP_200_OK
    assert live.json()["presence"] == []
    assert feed.status_code == status.HTTP_200_OK
    assert feed.json()["results"] == []


@pytest.mark.django_db
def test_my_presence_reports_visibility_but_remains_visible_to_me(client):
    token, account = _register(client, "jarek")
    now = timezone.now()
    _visit(account, started_at=now - timedelta(hours=1), ended_at=now)
    _drink(account, drank_at=now - timedelta(minutes=10))

    visible = client.get("/v1/friends/live", **_auth(token))
    assert visible.status_code == status.HTTP_200_OK
    assert visible.json()["my_presence"]["visible_to_parta"] is True

    account.ghost_mode = True
    account.save(update_fields=["ghost_mode"])
    hidden = client.get("/v1/friends/live", **_auth(token))
    assert hidden.status_code == status.HTTP_200_OK
    assert hidden.json()["my_presence"]["account"]["nickname"] == "jarek"
    assert hidden.json()["my_presence"]["visible_to_parta"] is False

    own_feed = client.get("/v1/friends/drink-feed", **_auth(token))
    assert own_feed.status_code == status.HTTP_200_OK
    assert own_feed.json()["results"][0]["is_mine"] is True


@pytest.mark.django_db
def test_presence_includes_visible_live_activity_id(client):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    now = timezone.now()
    _visit(friend, started_at=now - timedelta(hours=1), ended_at=now)
    activity = FriendPubActivity.objects.create(
        account=friend,
        client_id=uuid.uuid4(),
        cache_key=_CACHE_KEY,
        name="Bar Na Pile",
        lat=_LAT,
        lng=_LNG,
        city="Trutnov",
        kind=FriendPubActivity.Kind.LIVE,
        started_at=now - timedelta(minutes=30),
        expires_at=now + timedelta(hours=2),
        active=True,
    )

    response = client.get("/v1/friends/live", **_auth(token_owner))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["presence"][0]["activity_id"] == str(activity.public_id)


@pytest.mark.django_db
def test_drink_feed_groups_session_items_omits_suspect_and_prices(client):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    base = timezone.now().replace(hour=18, minute=0, second=0, microsecond=0)
    for offset in range(3):
        _drink(
            friend,
            drank_at=base + timedelta(minutes=offset * 30),
            beer_name="Fallback",
            beer_brand_name="Pilsner",
            beer_product_name="Pilsner Urquell",
            price_czk=72,
        )
    _drink(
        friend,
        drank_at=base + timedelta(hours=2),
        drink_type=DrinkLog.DrinkType.SHOT,
        serving_type=DrinkLog.ServingType.UNKNOWN,
        beer_name="Fernet",
        price_czk=80,
    )
    _drink(
        friend,
        drank_at=base + timedelta(hours=3),
        beer_name="Podezřelé",
        is_suspect=True,
    )

    response = client.get("/v1/friends/drink-feed", **_auth(token_owner))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["next_cursor"] is None
    assert len(body["results"]) == 1
    session = body["results"][0]
    assert session["account"]["nickname"] == "jarek"
    assert session["is_mine"] is False
    assert session["place_context"] == DrinkLog.PlaceContext.PUB
    assert session["pub_name"] == "Restaurace Cisterna"
    assert session["pub_city"] == "Trutnov"
    assert session["cache_key"] == _CACHE_KEY
    assert session["total"] == 4
    assert session["beer_count"] == 3
    assert session["wine_count"] == 0
    assert session["soft_drink_count"] == 0
    assert session["shot_count"] == 1
    assert session["items"] == [
        {
            "drink_type": DrinkLog.DrinkType.BEER,
            "serving_type": DrinkLog.ServingType.DRAFT,
            "name": "Pilsner Urquell",
            "count": 3,
        },
        {
            "drink_type": DrinkLog.DrinkType.SHOT,
            "serving_type": DrinkLog.ServingType.UNKNOWN,
            "name": "Fernet",
            "count": 1,
        },
    ]
    assert "price_czk" not in str(body)
    assert "price" not in session


@pytest.mark.django_db
def test_drink_feed_splits_two_pubs_on_same_drinking_day(client):
    token_owner, owner = _register(client, "majitel")
    _token_friend, friend = _register(client, "jarek")
    _make_friends(owner, friend)
    base = timezone.now().replace(hour=18, minute=0, second=0, microsecond=0)
    _drink(friend, drank_at=base, cache_key=_CACHE_KEY, pub_name="Cisterna")
    _drink(
        friend,
        drank_at=base + timedelta(hours=1),
        cache_key=_OTHER_CACHE_KEY,
        pub_name="Na Pile",
    )

    response = client.get("/v1/friends/drink-feed", **_auth(token_owner))

    assert response.status_code == status.HTTP_200_OK
    assert len(response.json()["results"]) == 2
    assert {item["pub_name"] for item in response.json()["results"]} == {
        "Cisterna",
        "Na Pile",
    }


@pytest.mark.django_db
def test_drink_feed_cursor_pages_are_disjoint_and_terminate(client):
    token, account = _register(client, "jarek")
    base = timezone.now().replace(hour=18, minute=0, second=0, microsecond=0)
    for days_ago in range(3):
        _drink(
            account,
            drank_at=base - timedelta(days=days_ago),
            cache_key=f"u2fkbfv{days_ago}",
            pub_name=f"Hospoda {days_ago}",
        )

    seen_ids: set[str] = set()
    cursor = None
    for _ in range(4):
        query = "?limit=1"
        if cursor:
            query += f"&cursor={cursor}"
        response = client.get(
            f"/v1/friends/drink-feed{query}",
            **_auth(token),
        )
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        page_ids = {item["id"] for item in body["results"]}
        assert page_ids.isdisjoint(seen_ids)
        seen_ids.update(page_ids)
        cursor = body["next_cursor"]
        if cursor is None:
            break
    else:
        pytest.fail("Drink feed cursor did not terminate.")

    assert len(seen_ids) == 3
    assert cursor is None


@pytest.mark.django_db
def test_friend_endpoints_keep_existing_contract_keys(client):
    token, _account = _register(client, "jarek")

    dashboard = client.get("/v1/friends", **_auth(token))
    live = client.get("/v1/friends/live", **_auth(token))

    assert dashboard.status_code == status.HTTP_200_OK
    assert set(dashboard.json()) >= {
        "friends",
        "friend_stats",
        "incoming_requests",
        "outgoing_requests",
        "active_friends",
        "my_active_activity",
        "plans",
        "my_plan",
        "notifications",
        "unread_count",
        "settings",
        "streak",
        "leaderboard",
        "blocked_ids",
        "presence",
        "my_presence",
    }
    assert set(live.json()) >= {
        "active_friends",
        "my_active_activity",
        "plans",
        "my_plan",
        "incoming_count",
        "unread_count",
        "server_time",
        "presence",
        "my_presence",
    }
    assert dashboard.json()["settings"]["share_drinks_with_parta"] is True


@pytest.mark.django_db
def test_friend_settings_can_patch_drink_sharing(client):
    token, _account = _register(client, "jarek")

    response = client.patch(
        "/v1/friends/settings",
        data={"share_drinks_with_parta": False},
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["share_drinks_with_parta"] is False
    assert Account.objects.get(nickname="jarek").share_drinks_with_parta is False

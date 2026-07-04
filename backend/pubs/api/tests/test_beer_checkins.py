from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    BeerCheckIn,
    BeerCheckInReaction,
    FriendBlock,
    Friendship,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    token = resp.json()["token"]
    account = Account.objects.get(public_id=resp.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.is_public = True
    account.save(update_fields=["nickname", "display_name", "is_public"])
    return token, account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _make_friends(a: Account, b: Account) -> None:
    Friendship.objects.create(
        requester=a,
        recipient=b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )


def _payload(client_id: uuid.UUID | None = None, *, visibility: str = "friends") -> dict:
    return {
        "client_id": str(client_id or uuid.uuid4()),
        "beer_name": "Plzeň 12",
        "brewery_name": "Pilsner Urquell",
        "beer_style": "Ležák",
        "abv": "4.40",
        "rating": "4.5",
        "note": "Hořký tak akorát.",
        "pub_cache_key": "u2fkbn1z",
        "pub_name": "U Zlatého tygra",
        "pub_city": "Praha",
        "visibility": visibility,
        "checked_in_at": timezone.now().isoformat(),
    }


def _post_checkin(
    client: APIClient,
    token: str,
    *,
    client_id: uuid.UUID | None = None,
    **overrides,
):
    payload = _payload(client_id, visibility=overrides.pop("visibility", "friends"))
    payload.update(overrides)
    return client.post("/v1/beer-checkins", data=payload, format="json", **_auth(token))


@pytest.mark.django_db
def test_private_checkin_is_not_in_friend_feed(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    resp = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="private"),
        format="json",
        **_auth(token_owner),
    )
    assert resp.status_code == status.HTTP_201_CREATED, resp.content

    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))

    assert feed.status_code == status.HTTP_200_OK, feed.content
    assert feed.json()["checkins"] == []


@pytest.mark.django_db
def test_accepted_friend_sees_friends_checkin(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)

    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )

    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))

    assert feed.status_code == status.HTTP_200_OK, feed.content
    body = feed.json()["checkins"]
    assert len(body) == 1
    assert body[0]["account"]["nickname"] == "janek"
    assert body[0]["beer_name"] == "Plzeň 12"
    assert body[0]["rating"] == "4.5"


@pytest.mark.django_db
def test_block_hides_checkins_and_rejects_reaction(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    create = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )
    checkin_id = create.json()["id"]
    FriendBlock.objects.create(blocker=friend, blocked=owner)

    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))
    react = client.post(
        f"/v1/beer-checkins/{checkin_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )

    assert feed.status_code == status.HTTP_200_OK, feed.content
    assert feed.json()["checkins"] == []
    assert react.status_code == status.HTTP_403_FORBIDDEN, react.content
    assert react.json()["code"] == "blocked"


@pytest.mark.django_db
def test_client_id_upsert_is_idempotent(client):
    token, _account = _register(client, "janek")
    client_id = uuid.uuid4()
    first = client.post(
        "/v1/beer-checkins",
        data=_payload(client_id, visibility="private"),
        format="json",
        **_auth(token),
    )
    second_payload = _payload(client_id, visibility="private")
    second_payload["rating"] = "3.5"
    second_payload["note"] = "Druhá úprava."
    second = client.post(
        "/v1/beer-checkins",
        data=second_payload,
        format="json",
        **_auth(token),
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert second.status_code == status.HTTP_200_OK, second.content
    assert BeerCheckIn.objects.count() == 1
    row = BeerCheckIn.objects.get()
    assert str(row.rating) == "3.5"
    assert row.note == "Druhá úprava."


@pytest.mark.django_db
def test_checkin_accepts_historical_checked_in_at(client):
    token, _account = _register(client, "janek")
    historical = (timezone.now() - timedelta(days=420)).replace(microsecond=0)
    payload = _payload(visibility="private")
    payload["checked_in_at"] = historical.isoformat()

    response = client.post(
        "/v1/beer-checkins",
        data=payload,
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert parse_datetime(response.json()["checked_in_at"]) == historical
    assert BeerCheckIn.objects.get().checked_in_at == historical


@pytest.mark.django_db
def test_checkin_accepts_occurred_at_alias_for_historical_entries(client):
    token, _account = _register(client, "janek")
    historical = (timezone.now() - timedelta(days=365)).replace(microsecond=0)
    payload = _payload(visibility="private")
    payload.pop("checked_in_at")
    payload["occurred_at"] = historical.isoformat()

    response = client.post(
        "/v1/beer-checkins",
        data=payload,
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    body = response.json()
    assert "occurred_at" not in body
    assert parse_datetime(body["checked_in_at"]) == historical
    assert BeerCheckIn.objects.get().checked_in_at == historical


@pytest.mark.django_db
def test_checkin_historical_replay_preserves_diary_fields(client):
    token, _account = _register(client, "janek")
    client_id = uuid.uuid4()
    historical = (timezone.now() - timedelta(days=90)).replace(microsecond=0)
    payload = _payload(client_id, visibility="friends")
    payload.pop("checked_in_at")
    payload.update(
        {
            "occurred_at": historical.isoformat(),
            "rating": "4.0",
            "tags": ["crisp", "one_more", "unknown_new_tag"],
            "note": "Zapsáno zpětně po výletu.",
            "pub_cache_key": "u2fkbn1z",
            "pub_name": "U Zlatého tygra",
            "pub_city": "Praha",
        }
    )

    first = client.post("/v1/beer-checkins", data=payload, format="json", **_auth(token))
    replay = client.post("/v1/beer-checkins", data=payload, format="json", **_auth(token))

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert replay.status_code == status.HTTP_200_OK, replay.content
    assert BeerCheckIn.objects.count() == 1
    assert replay.json()["id"] == first.json()["id"]
    assert parse_datetime(replay.json()["checked_in_at"]) == historical
    assert replay.json()["rating"] == "4.0"
    assert replay.json()["tags"] == ["crisp", "one_more"]
    assert replay.json()["note"] == "Zapsáno zpětně po výletu."
    assert replay.json()["pub_cache_key"] == "u2fkbn1z"
    assert replay.json()["pub_name"] == "U Zlatého tygra"
    assert replay.json()["pub_city"] == "Praha"
    assert replay.json()["visibility"] == "friends"

    row = BeerCheckIn.objects.get(client_id=client_id)
    assert row.checked_in_at == historical
    assert str(row.rating) == "4.0"
    assert row.tags == ["crisp", "one_more"]
    assert row.note == "Zapsáno zpětně po výletu."
    assert row.pub_cache_key == "u2fkbn1z"
    assert row.pub_name == "U Zlatého tygra"
    assert row.pub_city == "Praha"
    assert row.visibility == BeerCheckIn.Visibility.FRIENDS


@pytest.mark.django_db
def test_checkin_tags_are_lenient_truncated_and_upserted(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    client_id = uuid.uuid4()

    first_payload = _payload(client_id, visibility="friends")
    first_payload["tags"] = [
        "crisp",
        "unknown_new_tag",
        "one_more",
        "smooth",
        "watery",
    ]
    first = client.post(
        "/v1/beer-checkins",
        data=first_payload,
        format="json",
        **_auth(token_owner),
    )
    second_payload = _payload(client_id, visibility="friends")
    second_payload["tags"] = [
        "never_again",
        "unknown_new_tag",
        "great_foam",
        "overpriced",
        "smooth",
    ]
    second = client.post(
        "/v1/beer-checkins",
        data=second_payload,
        format="json",
        **_auth(token_owner),
    )
    bad_shape = _payload(visibility="private")
    bad_shape["tags"] = {"not": "a-list"}
    bad_shape_response = client.post(
        "/v1/beer-checkins",
        data=bad_shape,
        format="json",
        **_auth(token_owner),
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert first.json()["tags"] == ["crisp", "one_more", "smooth"]
    assert second.status_code == status.HTTP_200_OK, second.content
    assert second.json()["tags"] == ["never_again", "great_foam", "overpriced"]
    assert bad_shape_response.status_code == status.HTTP_201_CREATED, bad_shape_response.content
    assert bad_shape_response.json()["tags"] == []
    row = BeerCheckIn.objects.get(client_id=client_id)
    assert row.tags == ["never_again", "great_foam", "overpriced"]

    mine = client.get("/v1/beer-checkins", **_auth(token_owner))
    feed = client.get("/v1/beer-checkins/feed", **_auth(token_friend))

    assert mine.status_code == status.HTTP_200_OK, mine.content
    assert mine.json()["checkins"][0]["tags"] == []
    assert mine.json()["checkins"][1]["tags"] == ["never_again", "great_foam", "overpriced"]
    assert feed.status_code == status.HTTP_200_OK, feed.content
    assert feed.json()["checkins"][0]["tags"] == ["never_again", "great_foam", "overpriced"]


@pytest.mark.django_db
def test_checkin_tags_dedupe_before_truncating(client):
    token, _account = _register(client, "janek")

    response = _post_checkin(
        client,
        token,
        tags=["crisp", "crisp", "crisp", "smooth", "one_more", "watery"],
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert response.json()["tags"] == ["crisp", "smooth", "one_more"]
    assert BeerCheckIn.objects.get().tags == ["crisp", "smooth", "one_more"]


@pytest.mark.django_db
def test_checkin_cheers_reaction_upserts_and_unreacts(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    create = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )
    checkin_id = create.json()["id"]

    first = client.post(
        f"/v1/beer-checkins/{checkin_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )
    second = client.post(
        f"/v1/beer-checkins/{checkin_id}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    assert first.json()["reactions"]["cheers"] == 1
    assert second.status_code == status.HTTP_200_OK, second.content
    assert BeerCheckInReaction.objects.count() == 1

    removed = client.delete(f"/v1/beer-checkins/{checkin_id}/react", **_auth(token_friend))

    assert removed.status_code == status.HTTP_200_OK, removed.content
    assert removed.json()["removed"] is True
    assert BeerCheckInReaction.objects.count() == 0


@pytest.mark.django_db
def test_beer_detail_aggregates_mine_and_party(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    mine_payload = _payload(visibility="private")
    mine_payload["tags"] = ["crisp", "one_more"]
    client.post(
        "/v1/beer-checkins",
        data=mine_payload,
        format="json",
        **_auth(token_friend),
    )
    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )

    detail = client.get(
        "/v1/beers/detail?beer_name=Plze%C5%88%2012&brewery_name=Pilsner%20Urquell",
        **_auth(token_friend),
    )

    assert detail.status_code == status.HTTP_200_OK, detail.content
    body = detail.json()
    assert body["my_count"] == 1
    assert body["party_count"] == 1
    assert body["my_tags"] == {"crisp": 1, "one_more": 1}
    assert [profile["nickname"] for profile in body["party_drinkers"]] == ["janek"]
    assert len(body["my_history"]) == 1
    assert body["my_history"][0]["tags"] == ["crisp", "one_more"]
    assert len(body["recent_checkins"]) == 2
    assert all("tags" in checkin for checkin in body["recent_checkins"])


@pytest.mark.django_db
def test_beer_detail_returns_first_checked_in_at_for_caller(client):
    token, _account = _register(client, "janek")
    base = timezone.now() - timedelta(days=2)

    first = _post_checkin(
        client,
        token,
        checked_in_at=base.isoformat(),
    )
    second = _post_checkin(
        client,
        token,
        checked_in_at=(base + timedelta(hours=3)).isoformat(),
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert second.status_code == status.HTTP_201_CREATED, second.content

    detail = client.get(
        "/v1/beers/detail?beer_name=Plze%C5%88%2012&brewery_name=Pilsner%20Urquell",
        **_auth(token),
    )
    unseen = client.get(
        "/v1/beers/detail?beer_name=Excelent%2011&brewery_name=Gambrinus",
        **_auth(token),
    )

    assert detail.status_code == status.HTTP_200_OK, detail.content
    assert parse_datetime(detail.json()["first_checked_in_at"]) == base
    assert unseen.status_code == status.HTTP_200_OK, unseen.content
    assert unseen.json()["my_count"] == 0
    assert unseen.json()["first_checked_in_at"] is None


@pytest.mark.django_db
def test_beer_detail_without_brewery_matches_only_empty_brewery_checkins(client):
    token, _account = _register(client, "janek")
    base = timezone.now() - timedelta(days=1)

    empty_brewery = _post_checkin(
        client,
        token,
        brewery_name="",
        pub_name="Bez pivovaru",
        checked_in_at=base.isoformat(),
    )
    named_brewery = _post_checkin(
        client,
        token,
        brewery_name="Pilsner Urquell",
        pub_name="S pivovarem",
        checked_in_at=(base + timedelta(hours=1)).isoformat(),
    )

    assert empty_brewery.status_code == status.HTTP_201_CREATED, empty_brewery.content
    assert named_brewery.status_code == status.HTTP_201_CREATED, named_brewery.content

    detail = client.get("/v1/beers/detail?beer_name=Plze%C5%88%2012", **_auth(token))

    assert detail.status_code == status.HTTP_200_OK, detail.content
    body = detail.json()
    assert body["my_count"] == 1
    assert body["party_count"] == 0
    assert [row["brewery_name"] for row in body["my_history"]] == [""]
    assert [row["pub_name"] for row in body["recent_checkins"]] == ["Bez pivovaru"]


@pytest.mark.django_db
def test_beer_detail_hides_ghost_mode_friend_checkins(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])
    client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )

    detail = client.get(
        "/v1/beers/detail?beer_name=Plze%C5%88%2012&brewery_name=Pilsner%20Urquell",
        **_auth(token_friend),
    )

    assert detail.status_code == status.HTTP_200_OK, detail.content
    body = detail.json()
    assert body["party_count"] == 0
    assert body["party_drinkers"] == []
    assert body["recent_checkins"] == []


@pytest.mark.django_db
def test_beer_memory_requires_auth_and_returns_unseen_zeros(client):
    token, _account = _register(client, "janek")

    missing_auth = client.get("/v1/beers/memory?beer_name=Plze%C5%88%2012")
    unseen = client.get("/v1/beers/memory?beer_name=Plze%C5%88%2012", **_auth(token))

    assert missing_auth.status_code == status.HTTP_401_UNAUTHORIZED
    assert unseen.status_code == status.HTTP_200_OK, unseen.content
    assert unseen.json() == {
        "beer_name": "Plzeň 12",
        "brewery_name": "",
        "my_count": 0,
        "first_checked_in_at": None,
        "last_checked_in_at": None,
        "last_pub_name": "",
        "last_rating": None,
        "my_average_rating": None,
        "top_tags": [],
    }


@pytest.mark.django_db
def test_beer_memory_aggregates_own_data_with_brewery_matching(client):
    token_owner, _owner = _register(client, "janek")
    token_other, _other = _register(client, "petr")
    base = timezone.now() - timedelta(days=4)

    first = _post_checkin(
        client,
        token_owner,
        beer_name="Plzeň   12",
        brewery_name="Pilsner Urquell",
        rating="4.0",
        tags=["crisp", "one_more"],
        pub_name="U Prvního",
        checked_in_at=base.isoformat(),
    )
    other_brewery = _post_checkin(
        client,
        token_owner,
        beer_name="Plzeň 12",
        brewery_name="Jiný pivovar",
        rating="3.0",
        tags=["one_more", "great_foam", "smooth"],
        pub_name="U Prostředního",
        checked_in_at=(base + timedelta(days=1)).isoformat(),
    )
    latest = _post_checkin(
        client,
        token_owner,
        beer_name="plzeň 12",
        brewery_name="Pilsner Urquell",
        rating="5.0",
        tags=["crisp", "great_foam"],
        pub_name="U Tygra",
        checked_in_at=(base + timedelta(days=2)).isoformat(),
    )
    no_brewery = _post_checkin(
        client,
        token_owner,
        beer_name="Plzeň 12",
        brewery_name="",
        rating="2.0",
        tags=["watery"],
        pub_name="U Neznámého",
        checked_in_at=(base + timedelta(days=3)).isoformat(),
    )
    other_user = _post_checkin(
        client,
        token_other,
        beer_name="Plzeň 12",
        brewery_name="Pilsner Urquell",
        rating="1.0",
        tags=["never_again"],
        checked_in_at=(base + timedelta(days=4)).isoformat(),
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert other_brewery.status_code == status.HTTP_201_CREATED, other_brewery.content
    assert latest.status_code == status.HTTP_201_CREATED, latest.content
    assert no_brewery.status_code == status.HTTP_201_CREATED, no_brewery.content
    assert other_user.status_code == status.HTTP_201_CREATED, other_user.content

    exact = client.get(
        "/v1/beers/memory?beer_name=PLZE%C5%87%2012&brewery_name=Pilsner%20Urquell",
        **_auth(token_owner),
    )
    across_breweries = client.get(
        "/v1/beers/memory?beer_name=PLZE%C5%87%2012",
        **_auth(token_owner),
    )

    assert exact.status_code == status.HTTP_200_OK, exact.content
    exact_body = exact.json()
    assert exact_body["my_count"] == 2
    assert exact_body["last_pub_name"] == "U Tygra"
    assert exact_body["last_rating"] == 5.0
    assert exact_body["my_average_rating"] == 4.5
    assert exact_body["top_tags"] == ["crisp", "great_foam", "one_more"]

    assert across_breweries.status_code == status.HTTP_200_OK, across_breweries.content
    all_body = across_breweries.json()
    assert all_body["my_count"] == 4
    assert all_body["my_average_rating"] == 3.5
    assert all_body["top_tags"] == ["crisp", "great_foam", "one_more"]


@pytest.mark.django_db
def test_account_export_includes_social_and_beer_checkins(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    _make_friends(owner, friend)
    checkin = client.post(
        "/v1/beer-checkins",
        data=_payload(visibility="friends"),
        format="json",
        **_auth(token_owner),
    )
    client.post(
        f"/v1/beer-checkins/{checkin.json()['id']}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(token_friend),
    )

    export = client.get("/v1/account/export", **_auth(token_owner))

    assert export.status_code == status.HTTP_200_OK, export.content
    body = export.json()
    assert body["beer_checkins"][0]["beer_name"] == "Plzeň 12"
    assert body["social"]["friendships"][0]["status"] == Friendship.Status.ACCEPTED
    assert body["social"]["reactions"] == []

    friend_export = client.get("/v1/account/export", **_auth(token_friend))
    assert friend_export.status_code == status.HTTP_200_OK, friend_export.content
    friend_body = friend_export.json()
    assert friend_body["social"]["reactions"][0]["target"] == "beer_checkin"
    assert friend_body["social"]["blocks"] == []

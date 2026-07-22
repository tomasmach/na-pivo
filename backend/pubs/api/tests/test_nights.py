from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import _merge_anonymous_account
from pubs.models import (
    Account,
    ContentReport,
    FriendBlock,
    Friendship,
    NightRound,
    PublishedNight,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(
    client: APIClient,
    nickname: str | None,
    *,
    is_public: bool = True,
) -> tuple[str, Account]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    account = Account.objects.get(public_id=response.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize() if nickname else "Bezejmenný"
    account.is_public = is_public
    account.save(update_fields=["nickname", "display_name", "is_public"])
    return response.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _make_friends(a: Account, b: Account) -> None:
    Friendship.objects.create(
        requester=a,
        recipient=b,
        status=Friendship.Status.ACCEPTED,
        responded_at=timezone.now(),
    )


def _payload(client_id: str | None = None, **overrides) -> dict:
    payload = {
        "client_id": client_id or f"night-{uuid.uuid4()}",
        "drinking_day": "2026-07-21",
        "started_at": "2026-07-21T18:00:00+02:00",
        "ended_at": "2026-07-21T23:30:00+02:00",
        "beer_count": 4,
        "wine_count": 0,
        "soft_drink_count": 1,
        "shot_count": 1,
        "pub_names": ["U Zlatého tygra", "Lokál"],
        "city": "Praha",
        "duration_minutes": 330,
        "visibility": "public",
        "updated_at": "2026-07-22T00:00:00+02:00",
    }
    payload.update(overrides)
    return payload


def _publish(client: APIClient, token: str, **overrides):
    return client.post(
        "/v1/nights",
        data=_payload(**overrides),
        format="json",
        **_auth(token),
    )


@pytest.mark.django_db
def test_publish_and_last_write_wins_upsert(client):
    token, account = _register(client, "janek")
    client_id = "night-2026-07-21"

    created = _publish(client, token, client_id=client_id)
    newer = _publish(
        client,
        token,
        client_id=client_id,
        beer_count=7,
        pub_names=["U Pinkasů"],
        updated_at="2026-07-22T01:00:00+02:00",
    )
    stale = _publish(
        client,
        token,
        client_id=client_id,
        beer_count=2,
        updated_at="2026-07-21T23:00:00+02:00",
    )

    assert created.status_code == status.HTTP_201_CREATED, created.content
    assert newer.status_code == status.HTTP_200_OK, newer.content
    assert stale.status_code == status.HTTP_200_OK, stale.content
    assert PublishedNight.objects.count() == 1
    night = PublishedNight.objects.get()
    assert night.account == account
    assert night.beer_count == 7
    assert night.pub_names == ["U Pinkasů"]
    body = stale.json()["night"]
    assert body["id"] == str(night.public_id)
    assert body["client_id"] == client_id
    assert body["author"] == {
        "id": str(account.public_id),
        "nickname": "janek",
        "display_name": "Janek",
        "avatar_url": None,
        "is_public": True,
    }
    assert body["beer_count"] == 7
    assert body["rounds"] == 0
    assert body["my_round"] is False
    assert body["is_mine"] is True


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides",
    [
        {"beer_count": 100},
        {"pub_names": ["A", "B", "C", "D", "E", "F"]},
        {
            "beer_count": 0,
            "wine_count": 0,
            "soft_drink_count": 0,
            "shot_count": 0,
        },
        {"visibility": "private"},
    ],
)
def test_publish_validation(client, overrides):
    token, _account = _register(client, "janek")

    response = _publish(client, token, **overrides)

    assert response.status_code == status.HTTP_400_BAD_REQUEST, response.content
    assert PublishedNight.objects.count() == 0


@pytest.mark.django_db
def test_delete_is_idempotent_and_scoped_to_owner(client):
    token, _account = _register(client, "janek")
    other_token, _other = _register(client, "petr")
    client_id = "night-2026-07-21"
    assert _publish(client, token, client_id=client_id).status_code == status.HTTP_201_CREATED

    foreign = client.delete(f"/v1/nights/{client_id}", **_auth(other_token))
    deleted = client.delete(f"/v1/nights/{client_id}", **_auth(token))
    again = client.delete(f"/v1/nights/{client_id}", **_auth(token))

    assert foreign.status_code == status.HTTP_200_OK
    assert deleted.status_code == status.HTTP_200_OK
    assert again.status_code == status.HTTP_200_OK
    assert PublishedNight.objects.count() == 0


@pytest.mark.django_db
def test_feed_scopes_and_global_nickname_rule(client):
    viewer_token, viewer = _register(client, "divak")
    private_token, private_author = _register(client, "tajny", is_public=False)
    nameless_token, nameless = _register(client, None)
    stranger_token, _stranger = _register(client, "cizi")
    _make_friends(viewer, nameless)

    own = _publish(client, viewer_token, visibility="friends")
    private_public = _publish(client, private_token, visibility="public")
    nameless_public = _publish(client, nameless_token, visibility="public")
    _publish(client, stranger_token, visibility="friends")
    assert all(
        response.status_code == status.HTTP_201_CREATED
        for response in (own, private_public, nameless_public)
    )

    global_feed = client.get("/v1/nights/feed?scope=global", **_auth(viewer_token))
    friends_feed = client.get("/v1/nights/feed?scope=friends", **_auth(viewer_token))

    assert global_feed.status_code == status.HTTP_200_OK, global_feed.content
    global_nights = global_feed.json()["nights"]
    assert [item["author"]["nickname"] for item in global_nights] == ["tajny"]
    assert global_nights[0]["author"]["is_public"] is False
    assert "client_id" not in global_nights[0]

    friend_items = friends_feed.json()["nights"]
    assert {item["author"]["id"] for item in friend_items} == {
        str(viewer.public_id),
        str(nameless.public_id),
    }
    own_item = next(item for item in friend_items if item["is_mine"])
    assert "client_id" in own_item


@pytest.mark.django_db
@pytest.mark.parametrize("viewer_blocks", [True, False])
def test_feed_excludes_blocks_in_both_directions(client, viewer_blocks):
    viewer_token, viewer = _register(client, "divak")
    owner_token, owner = _register(client, "autor")
    assert _publish(client, owner_token).status_code == status.HTTP_201_CREATED
    if viewer_blocks:
        FriendBlock.objects.create(blocker=viewer, blocked=owner)
    else:
        FriendBlock.objects.create(blocker=owner, blocked=viewer)

    global_feed = client.get("/v1/nights/feed?scope=global", **_auth(viewer_token))

    assert global_feed.status_code == status.HTTP_200_OK
    assert global_feed.json()["nights"] == []


@pytest.mark.django_db
def test_friends_feed_hides_ghost_author_without_hiding_explicit_global_post(client):
    viewer_token, viewer = _register(client, "divak")
    owner_token, owner = _register(client, "duch")
    _make_friends(viewer, owner)
    created = _publish(client, owner_token, visibility="public")
    assert created.status_code == status.HTTP_201_CREATED, created.content
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])

    friends_feed = client.get("/v1/nights/feed?scope=friends", **_auth(viewer_token))
    global_feed = client.get("/v1/nights/feed?scope=global", **_auth(viewer_token))

    assert friends_feed.json()["nights"] == []
    assert [item["id"] for item in global_feed.json()["nights"]] == [
        created.json()["night"]["id"]
    ]


@pytest.mark.django_db
def test_cursor_pagination_has_no_duplicates(client):
    token, _account = _register(client, "janek")
    created_ids = []
    for beer_count in (1, 2, 3):
        response = _publish(client, token, beer_count=beer_count)
        assert response.status_code == status.HTTP_201_CREATED, response.content
        created_ids.append(response.json()["night"]["id"])

    page_one = client.get("/v1/nights/feed?scope=global&limit=2", **_auth(token))
    cursor = page_one.json()["next_cursor"]
    page_two = client.get(
        f"/v1/nights/feed?scope=global&limit=2&cursor={cursor}",
        **_auth(token),
    )

    assert page_one.status_code == status.HTTP_200_OK, page_one.content
    assert cursor
    assert page_two.status_code == status.HTTP_200_OK, page_two.content
    first_ids = [night["id"] for night in page_one.json()["nights"]]
    second_ids = [night["id"] for night in page_two.json()["nights"]]
    assert len(first_ids) == 2
    assert len(second_ids) == 1
    assert set(first_ids).isdisjoint(second_ids)
    assert set(first_ids + second_ids) == set(created_ids)
    assert page_two.json()["next_cursor"] is None


@pytest.mark.django_db
def test_round_reaction_upserts_unreacts_and_rejects_self_or_invisible(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, _viewer = _register(client, "divak")
    stranger_token, _stranger = _register(client, "cizi")
    public = _publish(client, owner_token, visibility="public").json()["night"]
    hidden = _publish(client, owner_token, visibility="friends").json()["night"]

    first = client.post(f"/v1/nights/{public['id']}/react", **_auth(viewer_token))
    second = client.post(f"/v1/nights/{public['id']}/react", **_auth(viewer_token))
    removed = client.delete(f"/v1/nights/{public['id']}/react", **_auth(viewer_token))
    removed_again = client.delete(f"/v1/nights/{public['id']}/react", **_auth(viewer_token))
    self_reaction = client.post(f"/v1/nights/{public['id']}/react", **_auth(owner_token))
    invisible = client.post(f"/v1/nights/{hidden['id']}/react", **_auth(stranger_token))

    assert first.json() == {"rounds": 1, "my_round": True}
    assert second.json() == {"rounds": 1, "my_round": True}
    assert removed.json() == {"rounds": 0, "my_round": False}
    assert removed_again.json() == {"rounds": 0, "my_round": False}
    assert NightRound.objects.count() == 0
    assert self_reaction.status_code == status.HTTP_400_BAD_REQUEST
    assert self_reaction.json()["code"] == "self_reaction"
    assert invisible.status_code == status.HTTP_404_NOT_FOUND
    assert invisible.json()["code"] == "night_not_found"


@pytest.mark.django_db
def test_anonymous_merge_removes_rounds_that_become_self_reactions(client):
    source_token, source = _register(client, "zdroj")
    target_token, target = _register(client, "cil")
    other_token, other = _register(client, "jiny")
    source_night_id = _publish(client, source_token).json()["night"]["id"]
    target_night_id = _publish(client, target_token).json()["night"]["id"]
    source_night = PublishedNight.objects.get(public_id=source_night_id)
    target_night = PublishedNight.objects.get(public_id=target_night_id)

    NightRound.objects.create(night=target_night, account=source)
    NightRound.objects.create(night=source_night, account=target)
    NightRound.objects.create(night=source_night, account=other)
    NightRound.objects.create(night=target_night, account=other)

    _merge_anonymous_account(source, target)

    source_night.refresh_from_db()
    target_night.refresh_from_db()
    assert source_night.account == target
    assert target_night.account == target
    assert not NightRound.objects.filter(account=target, night__account=target).exists()
    assert source_night.rounds.count() == 1
    assert target_night.rounds.count() == 1
    assert NightRound.objects.filter(account=other).count() == 2


@pytest.mark.django_db
def test_removed_night_is_hidden_and_rejects_reactions(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, _viewer = _register(client, "divak")
    created = _publish(client, owner_token).json()["night"]
    PublishedNight.objects.filter(public_id=created["id"]).update(is_removed=True)

    feed = client.get("/v1/nights/feed?scope=global", **_auth(viewer_token))
    reaction = client.post(f"/v1/nights/{created['id']}/react", **_auth(viewer_token))

    assert feed.json()["nights"] == []
    assert reaction.status_code == status.HTTP_404_NOT_FOUND
    assert NightRound.objects.count() == 0


@pytest.mark.django_db
def test_content_report_accepts_visible_night_target(client):
    owner_token, owner = _register(client, "autor", is_public=False)
    reporter_token, _reporter = _register(client, "hlasatel")
    night_id = _publish(client, owner_token, visibility="public").json()["night"]["id"]

    response = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": str(owner.public_id),
            "reason": ContentReport.Reason.OTHER,
            "comment": "Tohle je přes čáru.",
            "night_id": night_id,
        },
        format="json",
        **_auth(reporter_token),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    report = ContentReport.objects.get()
    assert report.target_account == owner
    assert report.target_snapshot["night_id"] == night_id
    assert report.target_snapshot["night"]["beer_count"] == 4
    assert report.target_snapshot["night"]["pub_names"] == ["U Zlatého tygra", "Lokál"]

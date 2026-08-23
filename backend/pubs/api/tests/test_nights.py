from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import _merge_anonymous_account
from pubs.api.ugc_consent import UGC_POLICY_HEADER
from pubs.models import (
    Account,
    BeerPhoto,
    ContentReport,
    FriendBlock,
    Friendship,
    NightRound,
    PartyEvening,
    PartyEveningMember,
    PartyGame,
    PublishedNight,
    PublishedNightComment,
    PublishedNightPubReference,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def _restore_latest_schema():
    """Migration regression cases must not leave later tests on an old schema."""

    yield
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


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


def _ugc(version: str | None = settings.UGC_POLICY_VERSION) -> dict[str, str]:
    if version is None:
        return {}
    return {f"HTTP_{UGC_POLICY_HEADER.replace('-', '_').upper()}": version}


def _accept(account: Account, version: str = settings.UGC_POLICY_VERSION) -> None:
    account.ugc_terms_version = version
    account.ugc_terms_accepted_at = timezone.now()
    account.save(update_fields=["ugc_terms_version", "ugc_terms_accepted_at"])


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
    assert set(
        PublishedNightPubReference.objects.filter(night=night).values_list(
            "name_key", flat=True
        )
    ) == {"u pinkasů"}
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
def test_publish_indexes_casefold_expanding_unicode_pub_name(client):
    token, _account = _register(client, "janek")
    display_name = "ß" * 80

    created = _publish(client, token, pub_names=[display_name])

    assert created.status_code == status.HTTP_201_CREATED, created.content
    reference = PublishedNightPubReference.objects.get()
    assert reference.name_key == "ss" * 80
    assert len(reference.name_key) == 160
    assert (
        PublishedNightPubReference._meta.get_field("name_key").max_length
        >= len(reference.name_key)
    )


@pytest.mark.django_db
def test_story_contract_is_additive_and_legacy_update_preserves_it(client):
    token, _account = _register(client, "janek")
    created = _publish(
        client,
        token,
        title="Poslední nás vyhodil až smeták",
        roast_line="Tři hospody a ani jedna fotka",
        roast_basis="Zítra si z toho nebudeš pamatovat nic",
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content

    # A released client knows none of the optional fields. Its newer counts
    # update must not erase presentation created by a 3.0 client.
    legacy = _publish(
        client,
        token,
        client_id="legacy-surface",
        beer_count=6,
        updated_at="2026-07-22T02:00:00+02:00",
    )

    assert legacy.status_code == status.HTTP_200_OK, legacy.content
    body = legacy.json()["night"]
    assert body["beer_count"] == 6
    assert body["title"] == "Poslední nás vyhodil až smeták"
    assert body["roast_line"] == "Tři hospody a ani jedna fotka"
    assert body["roast_basis"] == "Zítra si z toho nebudeš pamatovat nic"
    assert body["participants"] == []
    assert body["hero_photos"] == []
    assert body["hero_games"] == []
    assert body["comment_count"] == 0


@pytest.mark.django_db
def test_story_snapshot_only_exposes_consent_filtered_real_rows(client):
    owner_token, owner = _register(client, "autor")
    friend_token, friend = _register(client, "kamos")
    other_token, other = _register(client, "cizi")
    stranger_token, _stranger = _register(client, "divak")
    _make_friends(owner, friend)
    _make_friends(owner, other)
    evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="PIVOXY",
        host=owner,
        pub_name="U Tygra",
        started_at=datetime(2026, 7, 21, 16, tzinfo=UTC),
        ended_at=datetime(2026, 7, 21, 23, 30, tzinfo=UTC),
        active=False,
    )
    PartyEveningMember.objects.create(
        evening=evening,
        account=owner,
        active=False,
        joined_at=evening.started_at,
    )
    PartyEveningMember.objects.create(
        evening=evening,
        account=friend,
        active=False,
        joined_at=datetime(2026, 7, 21, 18, tzinfo=UTC),
    )
    # An accepted friend who never joined is not publishable as a participant.
    photo = BeerPhoto.objects.create(
        account=owner,
        party_evening=evening,
        client_id=uuid.uuid4(),
        image="beer-photos/story.webp",
        caption="Pěna držela",
        visibility=BeerPhoto.Visibility.FRIENDS,
        taken_at=datetime(2026, 7, 21, 20, tzinfo=UTC),
    )
    game = PartyGame.objects.create(
        client_id=uuid.uuid4(),
        evening=evening,
        started_by=owner,
        catalog_key="pub-quiz",
        name="Pub kvíz",
        scoring=PartyGame.Scoring.POINTS,
        started_at=datetime(2026, 7, 21, 21, tzinfo=UTC),
    )

    published = _publish(
        client,
        owner_token,
        visibility="public",
        party_code=evening.join_code,
        participant_ids=[str(friend.public_id), str(other.public_id)],
        photo_ids=[str(photo.public_id)],
        game_ids=[str(game.public_id)],
    )
    assert published.status_code == status.HTTP_201_CREATED, published.content

    friend_feed = client.get("/v1/nights/feed?scope=friends", **_auth(friend_token))
    friend_story = friend_feed.json()["nights"][0]
    assert [row["id"] for row in friend_story["participants"]] == [str(friend.public_id)]
    assert friend_story["hero_photos"] == [
        {
            "id": str(photo.public_id),
            "image_url": f"http://testserver/media/{photo.image.name}",
            "caption": "Pěna držela",
        }
    ]
    assert friend_story["hero_games"] == [
        {
            "id": str(game.public_id),
            "catalog_key": "pub-quiz",
            "name": "Pub kvíz",
            "scoring": "points",
        }
    ]

    # Being the author's friend does not reveal another participant's face;
    # the viewer must also be that participant or their accepted friend.
    other_feed = client.get("/v1/nights/feed?scope=friends", **_auth(other_token))
    assert other_feed.json()["nights"][0]["participants"] == []

    # The same public post remains globally visible, but friends-only faces and
    # photos do not become public merely because the post itself is public.
    global_feed = client.get("/v1/nights/feed?scope=global", **_auth(stranger_token))
    global_story = global_feed.json()["nights"][0]
    assert global_story["participants"] == []
    assert global_story["hero_photos"] == []
    assert global_story["hero_games"] == friend_story["hero_games"]


@pytest.mark.django_db
def test_story_snapshot_excludes_friend_who_joined_after_author_left(client):
    owner_token, owner = _register(client, "autor")
    _overlap_token, overlap = _register(client, "spolustolovnik")
    _late_token, late = _register(client, "pozdejsi")
    _make_friends(owner, overlap)
    _make_friends(owner, late)
    evening = PartyEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="CASOVE",
        host=owner,
        pub_name="U Tygra",
        started_at=datetime(2026, 7, 21, 16, tzinfo=UTC),
        ended_at=datetime(2026, 7, 21, 22, tzinfo=UTC),
        active=False,
    )
    PartyEveningMember.objects.create(
        evening=evening,
        account=owner,
        active=False,
        joined_at=evening.started_at,
        left_at=datetime(2026, 7, 21, 18, tzinfo=UTC),
    )
    PartyEveningMember.objects.create(
        evening=evening,
        account=overlap,
        active=False,
        joined_at=datetime(2026, 7, 21, 17, tzinfo=UTC),
        left_at=datetime(2026, 7, 21, 20, tzinfo=UTC),
    )
    PartyEveningMember.objects.create(
        evening=evening,
        account=late,
        active=False,
        joined_at=datetime(2026, 7, 21, 19, tzinfo=UTC),
        left_at=evening.ended_at,
    )

    published = _publish(
        client,
        owner_token,
        party_code=evening.join_code,
        participant_ids=[str(overlap.public_id), str(late.public_id)],
    )

    assert published.status_code == status.HTTP_201_CREATED, published.content
    assert [
        row["id"] for row in published.json()["night"]["participants"]
    ] == [str(overlap.public_id)]
    night = PublishedNight.objects.get(account=owner)
    assert night.participant_ids == [str(overlap.public_id)]
    assert str(late.public_id) not in str(published.json())


@pytest.mark.django_db
def test_pending_photo_client_reference_resolves_after_offline_upload(client):
    owner_token, owner = _register(client, "autor")
    friend_token, friend = _register(client, "kamos")
    stranger_token, _stranger = _register(client, "divak")
    _make_friends(owner, friend)
    photo_client_id = uuid.uuid4()

    published = _publish(
        client,
        owner_token,
        visibility="public",
        photo_ids=[str(photo_client_id)],
    )
    assert published.status_code == status.HTTP_201_CREATED, published.content
    assert published.json()["night"]["hero_photos"] == []

    photo = BeerPhoto.objects.create(
        account=owner,
        client_id=photo_client_id,
        image="beer-photos/offline-story.webp",
        caption="Doraženo ze sklepa",
        visibility=BeerPhoto.Visibility.FRIENDS,
        taken_at=datetime(2026, 7, 21, 20, tzinfo=UTC),
    )

    friend_story = client.get("/v1/nights/feed?scope=friends", **_auth(friend_token)).json()[
        "nights"
    ][0]
    assert friend_story["hero_photos"] == [
        {
            "id": str(photo.public_id),
            "image_url": f"http://testserver/media/{photo.image.name}",
            "caption": "Doraženo ze sklepa",
        }
    ]
    # The post is public; its friends-only photo is not.
    stranger_story = client.get(
        "/v1/nights/feed?scope=global", **_auth(stranger_token)
    ).json()["nights"][0]
    assert stranger_story["hero_photos"] == []


@pytest.mark.django_db
def test_invalid_party_proof_drops_snapshot_without_blocking_publish(client):
    token, _owner = _register(client, "autor")
    _friend_token, friend = _register(client, "kamos")

    response = _publish(
        client,
        token,
        party_code="WRONGX",
        participant_ids=[str(friend.public_id)],
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert response.json()["night"]["participants"] == []


@pytest.mark.django_db
def test_publish_upserts_by_drinking_day_across_publish_surfaces(client):
    token, account = _register(client, "janek")

    first = _publish(client, token, client_id="recap-1", beer_count=3)
    updated = _publish(
        client,
        token,
        client_id="vycep-1",
        beer_count=6,
        updated_at="2026-07-22T02:00:00+02:00",
    )
    stale = _publish(
        client,
        token,
        client_id="recap-1",
        beer_count=1,
        updated_at="2026-07-21T22:00:00+02:00",
    )

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert updated.status_code == status.HTTP_200_OK, updated.content
    assert stale.status_code == status.HTTP_200_OK, stale.content
    assert PublishedNight.objects.filter(account=account).count() == 1
    night = PublishedNight.objects.get(account=account)
    # The first released client id remains immutable; every later publishing
    # surface becomes an alias so either app can still retry or unpublish it.
    assert night.client_id == "recap-1"
    assert night.client_aliases == ["recap-1", "vycep-1"]
    assert night.beer_count == 6
    assert stale.json()["night"]["id"] == updated.json()["night"]["id"]

    deleted_by_old_surface = client.delete("/v1/nights/vycep-1", **_auth(token))
    assert deleted_by_old_surface.status_code == status.HTTP_200_OK
    assert deleted_by_old_surface.json()["deleted"] is True
    assert not PublishedNight.objects.filter(account=account).exists()


@pytest.mark.django_db(transaction=True)
def test_migrations_preserve_released_ids_and_backfill_expanded_pub_keys(
    _restore_latest_schema,
):
    executor = MigrationExecutor(connection)
    app_label = "pubs"
    executor.migrate([(app_label, "0097_party_evening_photos_visits")])
    executor.loader.build_graph()
    before_apps = executor.loader.project_state(
        [(app_label, "0097_party_evening_photos_visits")]
    ).apps
    HistoricalAccount = before_apps.get_model(app_label, "Account")
    HistoricalNight = before_apps.get_model(app_label, "PublishedNight")
    account = HistoricalAccount.objects.create(device_id="night-alias-migration")
    common = {
        "account_id": account.pk,
        "drinking_day": date(2026, 7, 21),
        "started_at": datetime(2026, 7, 21, 18, tzinfo=UTC),
        "ended_at": datetime(2026, 7, 21, 22, tzinfo=UTC),
        "beer_count": 2,
        "wine_count": 0,
        "soft_drink_count": 0,
        "shot_count": 0,
        "pub_names": ["ß" * 80],
        "city": "Praha",
        "duration_minutes": 240,
        "visibility": "friends",
    }
    HistoricalNight.objects.create(
        client_id="released-vycep-id",
        updated_at=datetime(2026, 7, 21, 22, tzinfo=UTC),
        **common,
    )
    HistoricalNight.objects.create(
        client_id="released-recap-id",
        updated_at=datetime(2026, 7, 21, 23, tzinfo=UTC),
        **common,
    )

    executor.migrate([(app_label, "0098_unique_published_night_drinking_day")])
    executor.loader.build_graph()
    after_apps = executor.loader.project_state(
        [(app_label, "0098_unique_published_night_drinking_day")]
    ).apps
    MigratedNight = after_apps.get_model(app_label, "PublishedNight")
    migrated = MigratedNight.objects.get(account_id=account.pk)
    assert migrated.client_id == "released-recap-id"
    assert set(migrated.client_aliases) == {
        "released-vycep-id",
        "released-recap-id",
    }

    executor.migrate([(app_label, "0103_repair_published_night_client_aliases")])
    executor.loader.build_graph()
    current_apps = executor.loader.project_state(
        [(app_label, "0103_repair_published_night_client_aliases")]
    ).apps
    MigratedPubReference = current_apps.get_model(
        app_label, "PublishedNightPubReference"
    )
    reference = MigratedPubReference.objects.get(night_id=migrated.pk)
    assert reference.name_key == "ss" * 80
    assert len(reference.name_key) == 160
    assert MigratedPubReference._meta.get_field("name_key").max_length == 255


@pytest.mark.django_db(transaction=True)
def test_client_alias_repair_heals_database_that_applied_old_0098_revision(
    _restore_latest_schema,
):
    executor = MigrationExecutor(connection)
    app_label = "pubs"
    executor.migrate([(app_label, "0102_published_night_pub_references")])
    executor.loader.build_graph()
    apps_0102 = executor.loader.project_state(
        [(app_label, "0102_published_night_pub_references")]
    ).apps
    HistoricalAccount = apps_0102.get_model(app_label, "Account")
    HistoricalNight = apps_0102.get_model(app_label, "PublishedNight")
    account = HistoricalAccount.objects.create(device_id="night-alias-repair")
    night = HistoricalNight.objects.create(
        account_id=account.pk,
        client_id="released-night-id",
        client_aliases=["released-night-id"],
        drinking_day=date(2026, 7, 22),
        started_at=datetime(2026, 7, 22, 18, tzinfo=UTC),
        ended_at=datetime(2026, 7, 22, 22, tzinfo=UTC),
        beer_count=1,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=[],
        city="",
        visibility="friends",
        updated_at=datetime(2026, 7, 22, 22, tzinfo=UTC),
    )

    # Simulate a feature/dev database that had marked the original 0098 as
    # applied before that unreleased migration gained the new column.
    with connection.schema_editor() as schema_editor:
        schema_editor.remove_field(
            HistoricalNight,
            HistoricalNight._meta.get_field("client_aliases"),
        )

    executor = MigrationExecutor(connection)
    executor.migrate([(app_label, "0103_repair_published_night_client_aliases")])
    executor.loader.build_graph()
    repaired_apps = executor.loader.project_state(
        [(app_label, "0103_repair_published_night_client_aliases")]
    ).apps
    RepairedNight = repaired_apps.get_model(app_label, "PublishedNight")
    repaired = RepairedNight.objects.get(pk=night.pk)
    assert repaired.client_aliases == ["released-night-id"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides",
    [
        {"beer_count": 65_536},
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
def test_publish_preserves_a_three_digit_offline_drink_count(client):
    token, _account = _register(client, "janek")

    response = _publish(client, token, beer_count=100)

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert response.json()["night"]["beer_count"] == 100
    assert PublishedNight.objects.get().beer_count == 100


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
def test_mine_feed_returns_all_of_the_viewers_nights_only(client):
    viewer_token, viewer = _register(client, None)
    stranger_token, _stranger = _register(client, "cizi")
    friends_night = _publish(client, viewer_token, visibility="friends")
    public_night = _publish(
        client,
        viewer_token,
        client_id="viewer-public",
        visibility="public",
    )
    _publish(client, stranger_token, client_id="stranger-public", visibility="public")

    response = client.get(
        "/v1/nights/feed?scope=global&mine=true",
        **_auth(viewer_token),
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    items = response.json()["nights"]
    assert {item["id"] for item in items} == {
        friends_night.json()["night"]["id"],
        public_night.json()["night"]["id"],
    }
    assert {item["author"]["id"] for item in items} == {str(viewer.public_id)}
    assert all(item["is_mine"] for item in items)
    assert all("client_id" in item for item in items)


@pytest.mark.django_db
def test_author_feed_keeps_normal_visibility_rules(client):
    viewer_token, viewer = _register(client, "divak")
    owner_token, owner = _register(client, "autor")
    _make_friends(viewer, owner)
    public = _publish(client, owner_token, client_id="public", visibility="public")
    friends = _publish(
        client,
        owner_token,
        client_id="friends",
        drinking_day="2026-07-22",
        visibility="friends",
    )

    response = client.get(
        f"/v1/nights/feed?scope=friends&author={owner.public_id}",
        **_auth(viewer_token),
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert {item["id"] for item in response.json()["nights"]} == {
        public.json()["night"]["id"],
        friends.json()["night"]["id"],
    }


@pytest.mark.django_db
def test_public_author_feed_never_exposes_friends_only_nights(client):
    viewer_token, viewer = _register(client, "divak")
    owner_token, owner = _register(client, "autor")
    _make_friends(viewer, owner)
    public = _publish(client, owner_token, client_id="public", visibility="public")
    _publish(
        client,
        owner_token,
        client_id="friends",
        drinking_day="2026-07-22",
        visibility="friends",
    )

    # Deliberately ask for the broader friends scope. The explicit public-profile
    # contract must still return public posts only, even to an accepted friend.
    response = client.get(
        f"/v1/nights/feed?scope=friends&public_author={owner.public_id}",
        **_auth(viewer_token),
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert [item["id"] for item in response.json()["nights"]] == [
        public.json()["night"]["id"]
    ]


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
    for offset, beer_count in enumerate((1, 2, 3), start=21):
        response = _publish(
            client,
            token,
            beer_count=beer_count,
            drinking_day=f"2026-07-{offset}",
        )
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
def test_pub_activity_filter_is_normalized_private_and_cursor_paginated(client):
    token, _account = _register(client, "janek")
    matching_ids = []
    entries = [
        ("2026-07-21", ["U Zlatého tygra"]),
        ("2026-07-22", ["Jiná hospoda"]),
        ("2026-07-23", ["U   Zlatého Tygra"]),
        ("2026-07-24", ["U Zlatého tygra", "Lokál"]),
    ]
    for drinking_day, pub_names in entries:
        response = _publish(
            client,
            token,
            client_id=f"pub-filter-{drinking_day}",
            drinking_day=drinking_day,
            pub_names=pub_names,
            updated_at=f"{drinking_day}T23:59:00+02:00",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        if "jiná hospoda" not in {name.casefold() for name in pub_names}:
            matching_ids.append(response.json()["night"]["id"])

    first = client.get(
        "/v1/nights/feed",
        data={
            "scope": "friends",
            "pub": "  u zlatého   TYGRA ",
            "limit": 2,
        },
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK, first.content
    assert len(first.json()["nights"]) == 2
    assert first.json()["next_cursor"]

    second = client.get(
        "/v1/nights/feed",
        data={
            "scope": "friends",
            "pub": "u zlatého tygra",
            "limit": 2,
            "cursor": first.json()["next_cursor"],
        },
        **_auth(token),
    )
    assert second.status_code == status.HTTP_200_OK, second.content
    assert second.json()["next_cursor"] is None
    returned_ids = [
        row["id"] for row in [*first.json()["nights"], *second.json()["nights"]]
    ]
    assert len(returned_ids) == 3
    assert set(returned_ids) == set(matching_ids)


@pytest.mark.django_db
def test_round_reaction_upserts_unreacts_and_rejects_self_or_invisible(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, _viewer = _register(client, "divak")
    stranger_token, _stranger = _register(client, "cizi")
    public = _publish(client, owner_token, visibility="public").json()["night"]
    hidden = _publish(
        client,
        owner_token,
        client_id="hidden-night",
        drinking_day="2026-07-22",
        visibility="friends",
    ).json()["night"]

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
def test_round_reaction_bypasses_ugc_gate_without_stored_acceptance(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, viewer = _register(client, "divak")
    assert viewer.ugc_terms_accepted_at is None
    public = _publish(client, owner_token, visibility="public").json()["night"]

    response = client.post(
        f"/v1/nights/{public['id']}/react", **_auth(viewer_token), **_ugc()
    )

    assert response.status_code == status.HTTP_200_OK, response.content
    assert response.json() == {"rounds": 1, "my_round": True}
    assert NightRound.objects.filter(night__public_id=public["id"], account=viewer).exists()


@pytest.mark.django_db
def test_night_detail_and_comments_inherit_visibility_and_are_idempotent(client):
    owner_token, owner = _register(client, "autor")
    viewer_token, viewer = _register(client, "divak")
    hidden_token, _hidden = _register(client, "schovany")
    public = _publish(client, owner_token, visibility="public").json()["night"]
    hidden = _publish(
        client,
        owner_token,
        client_id="friends-only",
        drinking_day="2026-07-22",
        visibility="friends",
    ).json()["night"]
    comment_id = str(uuid.uuid4())

    detail = client.get(f"/v1/nights/{public['id']}/detail", **_auth(viewer_token))
    first = client.post(
        f"/v1/nights/{public['id']}/comments",
        data={"client_id": comment_id, "body": "  Tohle mělo říz.  "},
        format="json",
        **_auth(viewer_token),
    )
    retry = client.post(
        f"/v1/nights/{public['id']}/comments",
        data={"client_id": comment_id, "body": "jiné tělo se nesmí přepsat"},
        format="json",
        **_auth(viewer_token),
    )
    comments = client.get(f"/v1/nights/{public['id']}/comments", **_auth(owner_token))
    invisible_detail = client.get(
        f"/v1/nights/{hidden['id']}/detail",
        **_auth(hidden_token),
    )

    assert detail.status_code == status.HTTP_200_OK, detail.content
    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert retry.status_code == status.HTTP_200_OK, retry.content
    assert PublishedNightComment.objects.count() == 1
    assert first.json()["comment"]["body"] == "Tohle mělo říz."
    assert retry.json()["comment"]["body"] == "Tohle mělo říz."
    assert retry.json()["comment"]["is_mine"] is True
    assert retry.json()["comment"]["can_delete"] is True
    assert comments.json()["comments"][0]["author"]["id"] == str(viewer.public_id)
    assert comments.json()["comments"][0]["can_delete"] is True
    assert invisible_detail.status_code == status.HTTP_404_NOT_FOUND
    assert invisible_detail.json()["code"] == "night_not_found"
    assert owner.public_id


@pytest.mark.django_db
def test_comment_blocks_hide_rows_and_count_then_owner_can_moderate(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, viewer = _register(client, "divak")
    commenter_token, commenter = _register(client, "komentator")
    night = _publish(client, owner_token, visibility="public").json()["night"]
    created = client.post(
        f"/v1/nights/{night['id']}/comments",
        data={"client_id": str(uuid.uuid4()), "body": "Nazdar u stolu."},
        format="json",
        **_auth(commenter_token),
    )
    comment_id = created.json()["comment"]["id"]
    FriendBlock.objects.create(blocker=viewer, blocked=commenter)

    comments = client.get(f"/v1/nights/{night['id']}/comments", **_auth(viewer_token))
    detail = client.get(f"/v1/nights/{night['id']}/detail", **_auth(viewer_token))
    removed = client.delete(
        f"/v1/nights/{night['id']}/comments/{comment_id}",
        **_auth(owner_token),
    )

    assert comments.status_code == status.HTTP_200_OK
    assert comments.json()["comments"] == []
    assert detail.json()["night"]["comment_count"] == 0
    assert removed.status_code == status.HTTP_200_OK
    assert removed.json() == {"removed": True}
    assert PublishedNightComment.objects.get(public_id=comment_id).is_removed is True


@pytest.mark.django_db
def test_comment_write_throttle_limits_spam(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, _viewer = _register(client, "divak")
    night = _publish(client, owner_token, visibility="public").json()["night"]

    responses = [
        client.post(
            f"/v1/nights/{night['id']}/comments",
            data={"client_id": str(uuid.uuid4()), "body": f"Komentář {index}"},
            format="json",
            **_auth(viewer_token),
        )
        for index in range(31)
    ]

    assert all(response.status_code == status.HTTP_201_CREATED for response in responses[:30])
    assert responses[30].status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_anonymous_merge_removes_rounds_that_become_self_reactions(client):
    source_token, source = _register(client, "zdroj")
    target_token, target = _register(client, "cil")
    other_token, other = _register(client, "jiny")
    source_night_id = _publish(client, source_token).json()["night"]["id"]
    target_night_id = _publish(
        client,
        target_token,
        drinking_day="2026-07-22",
        started_at="2026-07-22T18:00:00+02:00",
        ended_at="2026-07-22T23:30:00+02:00",
        updated_at="2026-07-23T00:00:00+02:00",
    ).json()["night"]["id"]
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


@pytest.mark.django_db
def test_content_report_with_comment_id_snapshots_visible_comment(client):
    owner_token, _owner = _register(client, "autor")
    commenter_token, commenter = _register(client, "komentator")
    reporter_token, _reporter = _register(client, "hlasatel")
    night = _publish(client, owner_token, visibility="public").json()["night"]
    created = client.post(
        f"/v1/nights/{night['id']}/comments",
        data={"client_id": str(uuid.uuid4()), "body": "Tohle je přes čáru."},
        format="json",
        **_auth(commenter_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    comment_id = created.json()["comment"]["id"]

    response = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": str(commenter.public_id),
            "reason": ContentReport.Reason.OTHER,
            "comment_id": comment_id,
        },
        format="json",
        **_auth(reporter_token),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    report = ContentReport.objects.get()
    assert report.target_account == commenter
    snapshot = report.target_snapshot
    assert snapshot["comment_id"] == comment_id
    assert snapshot["comment"]["body"] == "Tohle je přes čáru."
    assert snapshot["comment"]["author"]["id"] == str(commenter.public_id)
    assert snapshot["comment"]["author"]["nickname"] == "komentator"
    assert snapshot["night_id"] == night["id"]
    assert snapshot["night"]["visibility"] == "public"


@pytest.mark.django_db
def test_content_report_rejects_removed_hidden_or_mismatched_comment(client):
    owner_token, owner = _register(client, "autor")
    commenter_token, commenter = _register(client, "komentator")
    other_token, other = _register(client, "cizi")
    reporter_token, _reporter = _register(client, "hlasatel")
    night = _publish(client, owner_token, visibility="public").json()["night"]
    hidden_night = _publish(
        client,
        owner_token,
        client_id="friends-only",
        drinking_day="2026-07-22",
        visibility="friends",
    ).json()["night"]

    def _comment(night_body: dict, token: str) -> str:
        created = client.post(
            f"/v1/nights/{night_body['id']}/comments",
            data={"client_id": str(uuid.uuid4()), "body": "Nazdar."},
            format="json",
            **_auth(token),
        )
        assert created.status_code == status.HTTP_201_CREATED, created.content
        return created.json()["comment"]["id"]

    removed_comment_id = _comment(night, commenter_token)
    removed = client.delete(
        f"/v1/nights/{night['id']}/comments/{removed_comment_id}",
        **_auth(owner_token),
    )
    assert removed.status_code == status.HTTP_200_OK, removed.content
    hidden_comment_id = _comment(hidden_night, owner_token)
    visible_comment_id = _comment(night, other_token)

    cases = [
        # Soft-removed comment: nobody can see it, so nobody can report it.
        {"target_account_id": str(commenter.public_id), "comment_id": removed_comment_id},
        # Visible comment living on a night the reporter cannot see.
        {"target_account_id": str(owner.public_id), "comment_id": hidden_comment_id},
        # The comment author does not match the reported account.
        {"target_account_id": str(commenter.public_id), "comment_id": visible_comment_id},
    ]
    for payload in cases:
        response = client.post(
            "/v1/content-reports",
            data={"reason": ContentReport.Reason.OTHER, **payload},
            format="json",
            **_auth(reporter_token),
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND, response.content
    assert ContentReport.objects.count() == 0


@pytest.mark.django_db
def test_ugc_gate_blocks_night_post_without_acceptance(client):
    token, account = _register(client, "janek")
    assert account.ugc_terms_accepted_at is None

    response = client.post(
        "/v1/nights",
        data=_payload(),
        format="json",
        **_auth(token),
        **_ugc(),
    )

    assert response.status_code == 428, response.content
    assert response.json()["code"] == "ugc_consent_required"
    assert PublishedNight.objects.count() == 0


@pytest.mark.django_db
def test_ugc_gate_blocks_night_post_with_stale_stored_acceptance(client):
    token, account = _register(client, "janek")
    _accept(account, version="2020-01-01")

    response = client.post(
        "/v1/nights",
        data=_payload(),
        format="json",
        **_auth(token),
        **_ugc(),
    )

    assert response.status_code == 428, response.content
    assert response.json()["code"] == "ugc_policy_update_required"
    assert PublishedNight.objects.count() == 0


@pytest.mark.django_db
def test_ugc_gate_blocks_night_post_with_stale_header(client):
    token, _account = _register(client, "janek")
    _accept(_account)

    response = client.post(
        "/v1/nights",
        data=_payload(),
        format="json",
        **_auth(token),
        **_ugc(version="2020-01-01"),
    )

    assert response.status_code == 428, response.content
    assert response.json()["code"] == "ugc_policy_update_required"
    assert PublishedNight.objects.count() == 0


@pytest.mark.django_db
def test_ugc_gate_allows_accepted_account_with_current_header(client):
    token, account = _register(client, "janek")
    _accept(account)

    response = client.post(
        "/v1/nights",
        data=_payload(),
        format="json",
        **_auth(token),
        **_ugc(),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert PublishedNight.objects.count() == 1


@pytest.mark.django_db
def test_ugc_gate_keeps_no_header_requests_legacy_compatible(client):
    token, account = _register(client, "janek")
    assert account.ugc_terms_accepted_at is None

    response = _publish(client, token)

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert PublishedNight.objects.count() == 1


@pytest.mark.django_db
def test_ugc_gate_does_not_block_deletes_without_acceptance(client):
    owner_token, owner = _register(client, "autor")
    viewer_token, viewer = _register(client, "divak")
    night = _publish(client, owner_token, visibility="public").json()["night"]
    comment = client.post(
        f"/v1/nights/{night['id']}/comments",
        data={"client_id": str(uuid.uuid4()), "body": "Nazdar."},
        format="json",
        **_auth(viewer_token),
    ).json()["comment"]
    comment_id = comment["id"]

    deleted_comment = client.delete(
        f"/v1/nights/{night['id']}/comments/{comment_id}",
        **_auth(viewer_token),
        **_ugc(),
    )
    deleted_night = client.delete(f"/v1/nights/{night['client_id']}", **_auth(owner_token), **_ugc())

    assert deleted_comment.status_code == status.HTTP_200_OK, deleted_comment.content
    assert deleted_night.status_code == status.HTTP_200_OK, deleted_night.content
    # Deleting the night cascade-hard-deletes its comment rows.
    assert not PublishedNightComment.objects.filter(public_id=comment_id).exists()
    assert not PublishedNight.objects.filter(public_id=night["id"]).exists()


@pytest.mark.django_db
def test_ugc_gate_blocks_comment_post_without_acceptance(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, viewer = _register(client, "divak")
    assert viewer.ugc_terms_accepted_at is None
    night = _publish(client, owner_token, visibility="public").json()["night"]

    response = client.post(
        f"/v1/nights/{night['id']}/comments",
        data={"client_id": str(uuid.uuid4()), "body": "Nazdar."},
        format="json",
        **_auth(viewer_token),
        **_ugc(),
    )

    assert response.status_code == 428, response.content
    assert response.json()["code"] == "ugc_consent_required"
    assert PublishedNightComment.objects.count() == 0


@pytest.mark.django_db
def test_ugc_gate_allows_comment_post_from_accepted_account_with_current_header(client):
    owner_token, _owner = _register(client, "autor")
    viewer_token, viewer = _register(client, "divak")
    _accept(viewer)
    night = _publish(client, owner_token, visibility="public").json()["night"]

    response = client.post(
        f"/v1/nights/{night['id']}/comments",
        data={"client_id": str(uuid.uuid4()), "body": "Nazdar."},
        format="json",
        **_auth(viewer_token),
        **_ugc(),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert PublishedNightComment.objects.count() == 1

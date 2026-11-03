"""Contract tests for the new-look Výčep backend.

Covers the sharing preferences on /v1/account/me, GET /v1/nights/summary,
public beer photos with a beer tag plus GET /v1/beers/photos, and the
multi-entry / multi-runda FotoPivař. Every block also replays what a released
client sends and checks it keeps its old answer.
"""

from __future__ import annotations

import io
import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from pubs.beer_photo_gallery import visible_beer_photo_count
from pubs.models import (
    Account,
    FriendBlock,
    Friendship,
    PhotoContest,
    PhotoContestEntry,
    PhotoContestVote,
)
from pubs.photo_contest import CONTEST_PERIOD, close_due_contests


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def tmp_media(tmp_path, settings):
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


def _register(client: APIClient, nickname: str | None) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    account = Account.objects.get(public_id=resp.json()["id"])
    if nickname:
        account.nickname = nickname
        account.display_name = nickname.capitalize()
        account.is_public = True
        account.save(update_fields=["nickname", "display_name", "is_public"])
    return resp.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _friends(a: Account, b: Account) -> None:
    Friendship.objects.create(
        requester=a, recipient=b, status=Friendship.Status.ACCEPTED, responded_at=timezone.now()
    )


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), (200, 150, 40)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(client: APIClient, token: str, **fields) -> dict:
    data = {"client_id": str(uuid.uuid4()), "caption": "", "visibility": "friends", **fields}
    data["image"] = SimpleUploadedFile("beer.jpg", _jpeg(), content_type="image/jpeg")
    resp = client.post("/v1/beer-photos", data=data, format="multipart", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    return resp.json()["photo"]


def _night(client: APIClient, token: str, day: str, **overrides):
    payload = {
        "client_id": f"night-{day}",
        "drinking_day": day,
        "started_at": f"{day}T18:00:00+02:00",
        "ended_at": f"{day}T23:00:00+02:00",
        "beer_count": 3,
        "wine_count": 0,
        "soft_drink_count": 0,
        "shot_count": 0,
        "pub_names": ["U Pinkasů"],
        "city": "Praha",
        "visibility": "public",
        "updated_at": f"{day}T23:30:00+02:00",
        **overrides,
    }
    resp = client.post("/v1/nights", data=payload, format="json", **_auth(token))
    assert resp.status_code in (200, 201), resp.content
    return resp


# ---------------------------------------------------------------------------
# Sharing preferences
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_sharing_preferences_default_private_and_patch_round_trips(client):
    token, _account = _register(client, "janek")

    me = client.get("/v1/account/me", **_auth(token)).json()
    assert me["share_default"] == "friends"
    assert me["night_autopublish"] == "off"

    patched = client.patch(
        "/v1/account/me",
        data={"share_default": "public", "night_autopublish": "friends"},
        format="json",
        **_auth(token),
    )
    assert patched.status_code == status.HTTP_200_OK, patched.content
    assert patched.json()["share_default"] == "public"
    assert patched.json()["night_autopublish"] == "friends"
    again = client.get("/v1/account/me", **_auth(token)).json()
    assert (again["share_default"], again["night_autopublish"]) == ("public", "friends")


@pytest.mark.django_db
def test_sharing_preferences_reject_unknown_values(client):
    token, _account = _register(client, "janek")
    resp = client.patch(
        "/v1/account/me", data={"night_autopublish": "everyone"}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_released_client_preferences_patch_leaves_sharing_untouched(client):
    token, account = _register(client, "janek")
    Account.objects.filter(pk=account.pk).update(share_default="public")

    resp = client.patch(
        "/v1/account/me", data={"hide_pub_names": True}, format="json", **_auth(token)
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    account.refresh_from_db()
    assert account.hide_pub_names is True
    assert account.share_default == "public"
    assert account.night_autopublish == "off"


# ---------------------------------------------------------------------------
# Nights summary
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_nights_summary_requires_auth(client):
    assert client.get("/v1/nights/summary").status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_nights_summary_global_counts_public_nights_and_names_city(client):
    token_a, _a = _register(client, "janek")
    token_b, _b = _register(client, "petr")
    token_c, _c = _register(client, None)
    _night(client, token_a, "2026-10-28", beer_count=4, city="Brno")
    _night(client, token_a, "2026-10-29", beer_count=2, city="Brno")
    _night(client, token_b, "2026-10-29", beer_count=5, city="Praha")
    _night(client, token_b, "2026-10-30", beer_count=1, city="Praha", visibility="friends")
    # No public handle: never on the global Výčep, so never counted.
    _night(client, token_c, "2026-10-29", beer_count=30, city="Ostrava")

    resp = client.get("/v1/nights/summary?scope=global&days=7", **_auth(token_a))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json() == {
        "scope": "global",
        "days": 7,
        "nights": 3,
        "beers": 11,
        "leader": {"kind": "city", "name": "Brno"},
    }


@pytest.mark.django_db
def test_nights_summary_friends_counts_me_and_visible_friends(client):
    token_a, a = _register(client, "janek")
    token_b, b = _register(client, "marek")
    token_c, c = _register(client, "blokac")
    token_d, _d = _register(client, "cizi")
    _friends(a, b)
    _friends(a, c)
    FriendBlock.objects.create(blocker=c, blocked=a)
    _night(client, token_a, "2026-10-29", beer_count=2, visibility="friends")
    _night(client, token_b, "2026-10-29", beer_count=6, visibility="friends")
    _night(client, token_c, "2026-10-29", beer_count=20)
    _night(client, token_d, "2026-10-29", beer_count=20)

    body = client.get("/v1/nights/summary?scope=friends", **_auth(token_a)).json()

    assert body["nights"] == 2
    assert body["beers"] == 8
    assert body["leader"] == {
        "kind": "account",
        "id": str(b.public_id),
        "name": "@marek",
        "is_me": False,
    }


@pytest.mark.django_db
def test_nights_summary_ignores_old_and_removed_nights(client):
    token, account = _register(client, "janek")
    _night(client, token, "2026-10-01")
    account.published_nights.update(created_at=timezone.now() - timedelta(days=8))

    body = client.get("/v1/nights/summary?scope=friends", **_auth(token)).json()

    assert (body["nights"], body["beers"], body["leader"]) == (0, 0, None)
    assert client.get("/v1/nights/summary?days=0", **_auth(token)).status_code == 400


# ---------------------------------------------------------------------------
# Beer photos: public visibility, beer tag, gallery of one beer
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_released_client_photo_upload_is_unchanged(client):
    token, _account = _register(client, "janek")

    photo = _upload(client, token, pub_name="U Tygra")

    assert photo["visibility"] == "friends"
    assert photo["beer_name"] is None
    assert photo["beer_key"] is None


@pytest.mark.django_db
def test_beer_gallery_respects_visibility_friendship_and_blocks(client):
    token_me, me = _register(client, "janek")
    token_friend, friend = _register(client, "marek")
    token_stranger, stranger = _register(client, "cizi")
    token_blocked, blocked = _register(client, "blokac")
    _friends(me, friend)
    FriendBlock.objects.create(blocker=me, blocked=blocked)

    mine_private = _upload(client, token_me, beer_name="Kozel 11", visibility="private")
    friend_only = _upload(client, token_friend, beer_name="Kozel 11", visibility="friends")
    stranger_public = _upload(client, token_stranger, beer_name="kozel  11", visibility="public")
    stranger_friends = _upload(client, token_stranger, beer_name="Kozel 11", visibility="friends")
    blocked_public = _upload(client, token_blocked, beer_name="Kozel 11", visibility="public")
    _upload(client, token_friend, beer_name="Pilsner Urquell", visibility="public")

    resp = client.get("/v1/beers/photos?beer_name=Kozel%2011", **_auth(token_me))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    ids = {row["id"] for row in resp.json()["photos"]}
    assert ids == {mine_private["id"], friend_only["id"], stranger_public["id"]}
    assert resp.json()["total"] == 3
    assert visible_beer_photo_count(me, beer_name="Kozel 11") == 3
    assert "lat" not in resp.json()["photos"][0]

    # A stranger sees their own photos plus public photos of people with a
    # public handle (the block is only between me and blokac); my private and
    # my friend's friends-only photos stay hidden.
    as_stranger = client.get(
        f"/v1/beers/photos?beer={stranger_public['beer_key']}", **_auth(token_stranger)
    ).json()
    assert {row["id"] for row in as_stranger["photos"]} == {
        stranger_public["id"],
        stranger_friends["id"],
        blocked_public["id"],
    }

    assert client.get("/v1/beers/photos", **_auth(token_me)).status_code == 400


@pytest.mark.django_db
def test_public_photo_reaches_friend_surfaces(client):
    token_me, me = _register(client, "janek")
    token_friend, friend = _register(client, "marek")
    _friends(me, friend)
    photo = _upload(client, token_me, visibility="public")

    diary = client.get(f"/v1/friends/{me.public_id}/beer-photos", **_auth(token_friend))
    feed = client.get("/v1/friends/beer-photos/feed", **_auth(token_friend))

    assert photo["id"] in {row["id"] for row in diary.json()["photos"]}
    assert photo["id"] in {row["id"] for row in feed.json()["photos"]}


# ---------------------------------------------------------------------------
# FotoPivař: several entries, unlimited removable rundas
# ---------------------------------------------------------------------------


def _enter(client, token, photo_id, **extra):
    return client.post(
        "/v1/photo-contest/entries",
        data={"photo_id": photo_id, **extra},
        format="json",
        **_auth(token),
    )


@pytest.mark.django_db
def test_add_mode_keeps_several_entries_and_old_snapshot_shows_newest(client):
    token, _account = _register(client, "janek")
    first = _upload(client, token, beer_name="Kozel 11")
    second = _upload(client, token)

    one = _enter(client, token, first["id"], add=True)
    two = _enter(client, token, second["id"], add=True)
    again = _enter(client, token, second["id"], add=True)

    assert one.status_code == two.status_code == again.status_code == 201
    assert again.json()["entry"]["id"] == two.json()["entry"]["id"]
    snapshot = client.get("/v1/photo-contest", **_auth(token)).json()
    assert len(snapshot["entries"]) == 2
    assert snapshot["my_entry_id"] == two.json()["entry"]["id"]
    assert set(snapshot["my_entry_ids"]) == {one.json()["entry"]["id"], two.json()["entry"]["id"]}
    assert {row["beer_name"] for row in snapshot["entries"]} == {"Kozel 11", None}


@pytest.mark.django_db
def test_released_client_enter_still_replaces_all_my_entries(client):
    token, _account = _register(client, "janek")
    photos = [_upload(client, token) for _ in range(3)]
    _enter(client, token, photos[0]["id"], add=True)
    _enter(client, token, photos[1]["id"], add=True)

    resp = _enter(client, token, photos[2]["id"])

    assert resp.status_code == 201
    assert list(PhotoContestEntry.objects.values_list("photo__public_id", flat=True)) == [
        uuid.UUID(photos[2]["id"])
    ]


@pytest.mark.django_db
def test_rundas_per_entry_and_old_vote_still_moves(client):
    token_a, _a = _register(client, "janek")
    token_b, _b = _register(client, "petr")
    token_v, _v = _register(client, "volic")
    entry_a = _enter(client, token_a, _upload(client, token_a)["id"]).json()["entry"]["id"]
    entry_b = _enter(client, token_b, _upload(client, token_b)["id"]).json()["entry"]["id"]

    give_a = client.post(f"/v1/photo-contest/entries/{entry_a}/round", **_auth(token_v))
    give_b = client.post(f"/v1/photo-contest/entries/{entry_b}/round", **_auth(token_v))
    repeat = client.post(f"/v1/photo-contest/entries/{entry_b}/round", **_auth(token_v))
    own = client.post(f"/v1/photo-contest/entries/{entry_a}/round", **_auth(token_a))

    assert give_a.json() == {"entry_id": entry_a, "votes": 1, "my_vote": True}
    assert give_b.json()["votes"] == 1
    assert repeat.json()["votes"] == 1
    assert own.status_code == 400 and own.json()["code"] == "cannot_vote_own"
    snapshot = client.get("/v1/photo-contest", **_auth(token_v)).json()
    assert set(snapshot["my_vote_entry_ids"]) == {entry_a, entry_b}
    assert all(row["my_vote"] for row in snapshot["entries"])

    taken = client.delete(f"/v1/photo-contest/entries/{entry_a}/round", **_auth(token_v))
    assert taken.json() == {"entry_id": entry_a, "votes": 0, "my_vote": False}

    # A released client's vote leaves exactly one runda, on the chosen entry.
    client.post(f"/v1/photo-contest/entries/{entry_a}/round", **_auth(token_v))
    moved = client.post(
        "/v1/photo-contest/vote", data={"entry_id": entry_b}, format="json", **_auth(token_v)
    )
    assert moved.json() == {"entry_id": entry_b, "votes": 1}
    assert list(PhotoContestVote.objects.values_list("entry__public_id", flat=True)) == [
        uuid.UUID(entry_b)
    ]
    assert client.get("/v1/photo-contest", **_auth(token_v)).json()["my_vote_entry_id"] == entry_b
    client.delete("/v1/photo-contest/vote", **_auth(token_v))
    assert PhotoContestVote.objects.count() == 0

    missing = client.post(f"/v1/photo-contest/entries/{uuid.uuid4()}/round", **_auth(token_v))
    assert missing.status_code == 404


@pytest.mark.django_db
def test_withdraw_one_entry_and_order_top(client):
    token_a, _a = _register(client, "janek")
    token_v, _v = _register(client, "volic")
    token_w, _w = _register(client, "volic2")
    first = _enter(client, token_a, _upload(client, token_a)["id"], add=True).json()["entry"]["id"]
    second = _enter(client, token_a, _upload(client, token_a)["id"], add=True).json()["entry"]["id"]
    for token in (token_v, token_w):
        client.post(f"/v1/photo-contest/entries/{first}/round", **_auth(token))

    newest = client.get("/v1/photo-contest", **_auth(token_v)).json()["entries"]
    top = client.get("/v1/photo-contest?order=top", **_auth(token_v)).json()["entries"]
    assert [row["id"] for row in newest] == [second, first]
    assert [row["id"] for row in top] == [first, second]

    gone = client.delete(f"/v1/photo-contest/entries/{first}", **_auth(token_a))
    stranger = client.delete(f"/v1/photo-contest/entries/{second}", **_auth(token_v))
    assert gone.status_code == stranger.status_code == 204
    assert list(PhotoContestEntry.objects.values_list("public_id", flat=True)) == [
        uuid.UUID(second)
    ]


@pytest.mark.django_db
def test_close_gives_one_podium_place_per_account(client):
    token_a, a = _register(client, "janek")
    token_b, b = _register(client, "petr")
    voters = [_register(client, f"volic{n}")[0] for n in range(3)]
    entries_a = [
        _enter(client, token_a, _upload(client, token_a)["id"], add=True).json()["entry"]["id"]
        for _ in range(2)
    ]
    entry_b = _enter(client, token_b, _upload(client, token_b)["id"]).json()["entry"]["id"]
    for token in voters:
        for entry in entries_a:
            client.post(f"/v1/photo-contest/entries/{entry}/round", **_auth(token))
    client.post(f"/v1/photo-contest/entries/{entry_b}/round", **_auth(voters[0]))
    contest = PhotoContest.objects.get()
    PhotoContest.objects.filter(pk=contest.pk).update(
        period_start=contest.period_start - CONTEST_PERIOD,
        period_end=timezone.now() - timedelta(hours=1),
    )

    close_due_contests()

    ranked = dict(
        PhotoContestEntry.objects.filter(final_rank__isnull=False).values_list(
            "account_id", "final_rank"
        )
    )
    assert ranked == {a.pk: 1, b.pk: 2}
    last = client.get("/v1/photo-contest", **_auth(token_a)).json()["last_results"]
    assert last["my_result"]["rank"] == 1

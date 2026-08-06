"""Tests for the beer photo diary endpoints (/v1/beer-photos).

Uploads go through a tmp MEDIA_ROOT (``settings(MEDIA_ROOT=...)`` per test +
Pillow-generated in-memory JPEGs) so the suite never writes into the repo's
media dir — same pattern as the avatar tests in test_profile.py.
"""

from __future__ import annotations

import io
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    BeerPhoto,
    ContentReport,
    FriendBlock,
    Friendship,
    PartyEvening,
    PartyEveningMember,
    PhotoContestEntry,
)
from pubs.photo_contest import current_photo_contest


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def tmp_media(tmp_path, settings):
    """Point MEDIA_ROOT at a per-test tmp dir so photo writes never hit the repo."""
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


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


def _active_party(account: Account, code: str = "PRAH24") -> PartyEvening:
    evening = PartyEvening.objects.create(
        host=account,
        client_id=uuid.uuid4(),
        join_code=code,
        pub_name="U Zlatého tygra",
        pub_city="Praha",
    )
    PartyEveningMember.objects.create(evening=evening, account=account)
    return evening


def _create_photo(
    account: Account,
    caption: str,
    *,
    visibility: str = BeerPhoto.Visibility.FRIENDS,
    taken_at=None,
) -> BeerPhoto:
    return BeerPhoto.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        image=f"beer-photos/{account.public_id}/{uuid.uuid4()}.webp",
        caption=caption,
        visibility=visibility,
        taken_at=taken_at or timezone.now(),
    )


def _jpeg_bytes(size: tuple[int, int] = (800, 600), color=(210, 160, 40)) -> bytes:
    """A solid-colour JPEG of the given size."""
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _upload(content: bytes | None = None, *, content_type: str = "image/jpeg"):
    return SimpleUploadedFile(
        "beer.jpg", content if content is not None else _jpeg_bytes(), content_type=content_type
    )


def _post_photo(
    client: APIClient,
    token: str,
    *,
    client_id: uuid.UUID | None = None,
    image=None,
    **overrides,
):
    data = {
        "client_id": str(client_id or uuid.uuid4()),
        "caption": "Večer u Tygra",
        "pub_cache_key": "u2fkbn1z",
        "pub_name": "U Zlatého tygra",
        "pub_city": "Praha",
        "visibility": "friends",
        "taken_at": timezone.now().isoformat(),
    }
    data.update(overrides)
    if image is not False:
        data["image"] = image if image is not None else _upload()
    return client.post("/v1/beer-photos", data=data, format="multipart", **_auth(token))


@pytest.mark.django_db
def test_upload_happy_path_stores_downscaled_webp(client, tmp_media):
    token, account = _register(client, "janek")

    resp = _post_photo(client, token, image=_upload(_jpeg_bytes(size=(2000, 1200))))

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()["photo"]
    assert set(body.keys()) == {
        "id",
        "client_id",
        "image_url",
        "caption",
        "pub_cache_key",
        "pub_name",
        "pub_city",
        "visibility",
        "taken_at",
        "created_at",
        "in_contest",
    }
    assert body["caption"] == "Večer u Tygra"
    assert body["pub_cache_key"] == "u2fkbn1z"
    assert body["pub_name"] == "U Zlatého tygra"
    assert body["pub_city"] == "Praha"
    assert body["visibility"] == "friends"
    assert body["in_contest"] is False
    assert body["image_url"].startswith(
        f"http://testserver/media/beer-photos/{account.public_id}/"
    )
    assert body["image_url"].endswith(".webp")

    # The stored file is a downscaled webp on disk (long edge 1600, ratio kept).
    photo = BeerPhoto.objects.get()
    stored = Path(photo.image.path)
    assert stored.exists()
    with Image.open(stored) as img:
        assert img.format == "WEBP"
        assert img.size == (1600, 960)


@pytest.mark.django_db
def test_upload_empty_pub_tag_serializes_null(client):
    token, _account = _register(client, "janek")

    resp = _post_photo(client, token, pub_cache_key="", pub_name="", pub_city="", caption="")

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()["photo"]
    assert body["pub_cache_key"] is None
    assert body["pub_name"] is None
    assert body["pub_city"] is None
    assert body["caption"] == ""


@pytest.mark.django_db
def test_upload_retry_same_client_id_is_idempotent(client):
    token, _account = _register(client, "janek")
    client_id = uuid.uuid4()

    first = _post_photo(client, token, client_id=client_id)
    second = _post_photo(client, token, client_id=client_id, caption="Jiný popisek")

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert second.status_code == status.HTTP_200_OK, second.content
    assert BeerPhoto.objects.count() == 1
    # The retry returns the EXISTING photo unchanged (image not re-processed).
    assert second.json()["photo"]["id"] == first.json()["photo"]["id"]
    assert second.json()["photo"]["caption"] == "Večer u Tygra"
    media_files = list(Path(BeerPhoto.objects.get().image.path).parent.iterdir())
    assert len(media_files) == 1


@pytest.mark.django_db
def test_upload_links_active_membership_and_stale_or_foreign_code_is_silent(client):
    token, account = _register(client, "janek")
    evening = _active_party(account)

    linked = _post_photo(client, token, party_code="PRAH24")
    assert linked.status_code == status.HTTP_201_CREATED, linked.content
    assert BeerPhoto.objects.get(public_id=linked.json()["photo"]["id"]).party_evening == evening

    evening.active = False
    evening.ended_at = timezone.now()
    evening.save(update_fields=["active", "ended_at"])
    stale = _post_photo(client, token, party_code="PRAH24", caption="po zavíračce")
    assert stale.status_code == status.HTTP_201_CREATED, stale.content
    assert BeerPhoto.objects.get(public_id=stale.json()["photo"]["id"]).party_evening is None

    _active_party(account, code="TABR24")
    other_token, _other = _register(client, "cizi")
    foreign = _post_photo(client, other_token, party_code="TABR24", caption="cizí stůl")
    assert foreign.status_code == status.HTTP_201_CREATED, foreign.content
    assert BeerPhoto.objects.get(public_id=foreign.json()["photo"]["id"]).party_evening is None


@pytest.mark.django_db
def test_upload_invalid_image_and_missing_image_400(client):
    token, _account = _register(client, "janek")

    invalid = _post_photo(client, token, image=_upload(b"definitely not an image"))
    missing = _post_photo(client, token, image=False)

    assert invalid.status_code == status.HTTP_400_BAD_REQUEST, invalid.content
    assert invalid.json()["code"] == "photo_invalid"
    assert missing.status_code == status.HTTP_400_BAD_REQUEST, missing.content
    assert missing.json()["code"] == "photo_missing"
    assert BeerPhoto.objects.count() == 0


@pytest.mark.django_db
def test_upload_over_size_cap_400(client, settings):
    settings.BEER_PHOTO_MAX_UPLOAD_BYTES = 1024
    token, _account = _register(client, "janek")

    resp = _post_photo(client, token, image=_upload(_jpeg_bytes(size=(1200, 900))))

    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "photo_too_large"
    assert BeerPhoto.objects.count() == 0


@pytest.mark.django_db
def test_upload_per_account_cap_400_but_retry_still_works(client, settings):
    settings.BEER_PHOTO_MAX_PER_ACCOUNT = 1
    token, _account = _register(client, "janek")
    first_client_id = uuid.uuid4()

    first = _post_photo(client, token, client_id=first_client_id)
    over_cap = _post_photo(client, token)
    retry = _post_photo(client, token, client_id=first_client_id)

    assert first.status_code == status.HTTP_201_CREATED, first.content
    assert over_cap.status_code == status.HTTP_400_BAD_REQUEST, over_cap.content
    assert over_cap.json()["code"] == "photo_limit_reached"
    # The idempotent retry of an ALREADY STORED photo is not blocked by the cap.
    assert retry.status_code == status.HTTP_200_OK, retry.content
    assert BeerPhoto.objects.count() == 1


@pytest.mark.django_db
def test_list_own_photos_newest_taken_first(client):
    token, _account = _register(client, "janek")
    base = timezone.now()
    older = _post_photo(client, token, caption="starší", taken_at=base.isoformat())
    newer = _post_photo(
        client,
        token,
        caption="novější",
        taken_at=(base + timedelta(hours=2)).isoformat(),
    )
    assert older.status_code == status.HTTP_201_CREATED
    assert newer.status_code == status.HTTP_201_CREATED

    resp = client.get("/v1/beer-photos", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    photos = resp.json()["photos"]
    assert [p["caption"] for p in photos] == ["novější", "starší"]


@pytest.mark.django_db
def test_delete_photo_removes_row_and_file(client):
    token, _account = _register(client, "janek")
    token_other, _other = _register(client, "petr")
    created = _post_photo(client, token)
    photo_id = created.json()["photo"]["id"]
    stored = Path(BeerPhoto.objects.get().image.path)
    assert stored.exists()

    foreign = client.delete(f"/v1/beer-photos/{photo_id}", **_auth(token_other))
    deleted = client.delete(f"/v1/beer-photos/{photo_id}", **_auth(token))
    again = client.delete(f"/v1/beer-photos/{photo_id}", **_auth(token))

    # Owner-only: someone else's delete is an opaque 404 and removes nothing.
    assert foreign.status_code == status.HTTP_404_NOT_FOUND, foreign.content
    assert deleted.status_code == status.HTTP_204_NO_CONTENT, deleted.content
    assert again.status_code == status.HTTP_404_NOT_FOUND, again.content
    assert BeerPhoto.objects.count() == 0
    assert not stored.exists()


@pytest.mark.django_db
def test_friend_photos_visibility_gating(client):
    token_owner, owner = _register(client, "janek")
    token_friend, friend = _register(client, "petr")
    token_stranger, _stranger = _register(client, "cizinec")
    token_blocked, blocked = _register(client, "blokovany")
    _make_friends(owner, friend)
    _make_friends(owner, blocked)
    FriendBlock.objects.create(blocker=owner, blocked=blocked)

    shared = _post_photo(client, token_owner, caption="pro partu", visibility="friends")
    private = _post_photo(client, token_owner, caption="jen pro mě", visibility="private")
    assert shared.status_code == status.HTTP_201_CREATED
    assert private.status_code == status.HTTP_201_CREATED
    url = f"/v1/friends/{owner.public_id}/beer-photos"

    as_friend = client.get(url, **_auth(token_friend))
    as_stranger = client.get(url, **_auth(token_stranger))
    as_blocked = client.get(url, **_auth(token_blocked))
    unknown = client.get(f"/v1/friends/{uuid.uuid4()}/beer-photos", **_auth(token_friend))

    assert as_friend.status_code == status.HTTP_200_OK, as_friend.content
    assert [p["caption"] for p in as_friend.json()["photos"]] == ["pro partu"]
    # Stranger / blocked / unknown are all the same opaque 404 (no existence leak).
    assert as_stranger.status_code == status.HTTP_404_NOT_FOUND
    assert as_blocked.status_code == status.HTTP_404_NOT_FOUND
    assert unknown.status_code == status.HTTP_404_NOT_FOUND

    # Ghost mode hides the diary from friends too — same opaque 404 as the
    # other friend surfaces (feed, live, detail).
    owner.ghost_mode = True
    owner.save(update_fields=["ghost_mode"])
    as_friend_ghosted = client.get(url, **_auth(token_friend))
    assert as_friend_ghosted.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_friends_beer_photos_feed_applies_visibility_and_author_gating(client):
    token, requester = _register(client, "janek")
    _friend_token, friend = _register(client, "petr")
    _blocked_token, blocked = _register(client, "blokovany")
    _ghost_token, ghost = _register(client, "duch")
    _inactive_token, inactive = _register(client, "spici")
    _stranger_token, stranger = _register(client, "cizinec")
    for account in (friend, blocked, ghost, inactive):
        _make_friends(requester, account)
    FriendBlock.objects.create(blocker=blocked, blocked=requester)
    ghost.ghost_mode = True
    ghost.save(update_fields=["ghost_mode"])
    inactive.status = Account.Status.PENDING_DELETION
    inactive.save(update_fields=["status"])

    visible = _create_photo(friend, "od kamaráda")
    _create_photo(requester, "moje")
    _create_photo(friend, "soukromá", visibility=BeerPhoto.Visibility.PRIVATE)
    _create_photo(blocked, "blokovaná")
    _create_photo(ghost, "duch")
    _create_photo(inactive, "neaktivní")
    _create_photo(stranger, "cizí")
    _create_photo(friend, "stará", taken_at=timezone.now() - timedelta(days=7, seconds=1))

    response = client.get("/v1/friends/beer-photos/feed", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    assert [photo["id"] for photo in response.json()["photos"]] == [str(visible.public_id)]
    assert response.json()["photos"][0]["account"] == {
        "nickname": "petr",
        "display_name": "Petr",
        "avatar_url": None,
    }


@pytest.mark.django_db
def test_friends_beer_photos_feed_orders_limits_and_joins_accounts(
    client, django_assert_num_queries
):
    token, requester = _register(client, "janek")
    _friend_token, friend = _register(client, "petr")
    _make_friends(requester, friend)
    now = timezone.now()
    photos = [
        _create_photo(friend, f"foto {index}", taken_at=now - timedelta(minutes=index))
        for index in range(31)
    ]
    current_photo_contest()

    with django_assert_num_queries(5):
        response = client.get("/v1/friends/beer-photos/feed", **_auth(token))

    assert response.status_code == status.HTTP_200_OK, response.content
    payload = response.json()["photos"]
    assert len(payload) == 30
    assert [photo["id"] for photo in payload] == [str(photo.public_id) for photo in photos[:30]]


@pytest.mark.django_db
def test_friends_beer_photos_feed_requires_authentication(client):
    response = client.get("/v1/friends/beer-photos/feed")

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_content_report_with_photo_id_gates_on_photo_visibility(client):
    token_owner, owner = _register(client, "janek")
    token_stranger, _stranger = _register(client, "cizinec")
    # A PRIVATE profile whose only exposure is the contest entry.
    owner.is_public = False
    owner.save(update_fields=["is_public"])
    entered = _post_photo(client, token_owner, caption="soutěžní", visibility="private")
    hidden = _post_photo(client, token_owner, caption="skrytá", visibility="private")
    entered_id = entered.json()["photo"]["id"]
    PhotoContestEntry.objects.create(
        contest=current_photo_contest(),
        photo=BeerPhoto.objects.get(public_id=entered_id),
        account=owner,
    )

    def _report(photo_id: str):
        return client.post(
            "/v1/content-reports",
            data={
                "target_account_id": str(owner.public_id),
                "reason": "inappropriate_photo",
                "photo_id": photo_id,
            },
            format="json",
            **_auth(token_stranger),
        )

    visible = _report(entered_id)
    invisible = _report(hidden.json()["photo"]["id"])

    # The contest entry makes the photo (and thus the report) visible even
    # though the profile is private and the reporter is a stranger.
    assert visible.status_code == status.HTTP_201_CREATED, visible.content
    report = ContentReport.objects.get()
    assert report.reason == ContentReport.Reason.INAPPROPRIATE_PHOTO
    assert report.target_snapshot["photo_id"] == entered_id
    assert report.target_snapshot["photo_caption"] == "soutěžní"
    assert report.target_snapshot["photo_url"].endswith(".webp")
    # A photo the reporter cannot see is an opaque 404.
    assert invisible.status_code == status.HTTP_404_NOT_FOUND, invisible.content
    assert invisible.json()["code"] == "photo_not_found"

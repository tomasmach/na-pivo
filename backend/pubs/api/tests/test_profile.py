"""
Tests for the beer-social PROFILE feature (nickname + avatar + is_public),
covering the locked contract in ``docs/profiles-spec.md``.

Three layers are exercised:

* the service layer (:mod:`pubs.accounts`) directly — nickname validation,
  the DB UniqueConstraint backstop, and the avatar Pillow pipeline (the stored
  bytes are a 256px square WEBP with EXIF stripped);
* the DRF endpoints — PATCH /v1/account/me (nickname/is_public/hide_pub_names),
  GET /v1/account/me, the avatar PUT/POST/DELETE view, and the nickname-available
  probe;
* the migration backfill — existing rows keep ``nickname=NULL`` / ``is_public=True``
  and two NULL-nickname rows coexist under the partial unique index.

Avatar uploads go through a tmp MEDIA_ROOT (``settings(MEDIA_ROOT=...)`` per test
+ a ``SimpleUploadedFile``) so the suite never writes into the repo's media dir.
OAuth + the Google picture fetch are mocked at their module boundaries
(``pubs.oauth`` for the verifier, ``pubs.accounts.requests`` for the picture GET)
so no test touches the network.
"""

from __future__ import annotations

import io
import time
import uuid

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError, connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

import pubs.accounts as accounts
import pubs.oauth as oauth
from pubs.accounts import AccountError
from pubs.models import Account, DrinkLog, PubRating, PubVisit

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # The account/auth/nickname-check/avatar endpoints share a per-IP
    # (127.0.0.1) ScopedRateThrottle counter in the default cache; clear it
    # around every test so the count never bleeds as this file grows.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def tmp_media(tmp_path, settings):
    """Point MEDIA_ROOT at a per-test tmp dir so avatar writes never hit the repo."""
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


def _bootstrap(client) -> tuple[str, str]:
    """Create an anonymous device account; return (raw_token, account_public_id)."""
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], body["id"]


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------


def _png_bytes(size: tuple[int, int] = (640, 480), color=(180, 60, 30)) -> bytes:
    """A solid-colour PNG of the given size, no EXIF."""
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_with_exif_orientation(orientation: int = 6) -> bytes:
    """A non-square JPEG carrying an EXIF Orientation tag.

    Orientation 6 = rotate 90° CW on display. The raw pixel buffer is 200 wide
    × 100 tall; a viewer honouring the tag shows it 100×200. We paint the left
    half red and the right half blue so that, after exif_transpose, the colour
    geography is provably rotated — proving the pipeline applied the orientation
    rather than ignoring (or double-applying) it.
    """
    img = Image.new("RGB", (200, 100))
    for x in range(200):
        for y in range(100):
            img.putpixel((x, y), (255, 0, 0) if x < 100 else (0, 0, 255))
    exif = img.getexif()
    exif[0x0112] = orientation  # 0x0112 = Orientation
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _upload(content: bytes, name: str = "a.png", content_type: str = "image/png"):
    return SimpleUploadedFile(name, content, content_type=content_type)


class _FakePictureResponse:
    """Minimal stand-in for a ``requests`` streaming Response."""

    def __init__(self, body: bytes, content_type: str = "image/png", status_code: int = 200):
        self._body = body
        self.headers = {"Content-Type": content_type}
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def iter_content(self, chunk_size: int = 65536):
        for i in range(0, len(self._body), chunk_size):
            yield self._body[i : i + chunk_size]


# ===========================================================================
# 1. Nickname uniqueness — service layer + endpoint
# ===========================================================================


@pytest.mark.django_db
def test_nickname_case_insensitive_taken_is_409(client):
    """A nickname differing only in case from an existing one is rejected 409."""
    token_a, _ = _bootstrap(client)
    token_b, _ = _bootstrap(client)

    first = client.patch(
        "/v1/account/me", data={"nickname": "BeerFan"}, format="json", **_auth(token_a)
    )
    assert first.status_code == status.HTTP_200_OK, first.content
    assert first.json()["nickname"] == "BeerFan"

    # A different-cased spelling collides via the case-insensitive constraint.
    clash = client.patch(
        "/v1/account/me", data={"nickname": "beerfan"}, format="json", **_auth(token_b)
    )
    assert clash.status_code == status.HTTP_409_CONFLICT, clash.content
    body = clash.json()
    assert body["code"] == "nickname_taken"
    assert "detail" in body


@pytest.mark.django_db
def test_setting_own_nickname_again_is_idempotent(client):
    """Re-saving an account's OWN current nickname (any casing) is not 'taken'."""
    token, _ = _bootstrap(client)
    first = client.patch(
        "/v1/account/me", data={"nickname": "Hopster"}, format="json", **_auth(token)
    )
    assert first.status_code == status.HTTP_200_OK, first.content

    # Exact same value → still ok.
    again = client.patch(
        "/v1/account/me", data={"nickname": "Hopster"}, format="json", **_auth(token)
    )
    assert again.status_code == status.HTTP_200_OK, again.content
    assert again.json()["nickname"] == "Hopster"

    # Different casing of the same handle → also ok (idempotent on Lower()).
    recased = client.patch(
        "/v1/account/me", data={"nickname": "HOPSTER"}, format="json", **_auth(token)
    )
    assert recased.status_code == status.HTTP_200_OK, recased.content
    assert recased.json()["nickname"] == "HOPSTER"


@pytest.mark.django_db
def test_db_unique_constraint_backstops_case_insensitive_dup():
    """The functional UniqueConstraint is the race backstop: a direct create of a
    differently-cased duplicate raises IntegrityError even when validation is
    bypassed entirely."""
    Account.objects.create(device_id="d-ci-1", nickname="Lager")
    with pytest.raises(IntegrityError):
        Account.objects.create(device_id="d-ci-2", nickname="lager")


@pytest.mark.django_db
def test_validate_nickname_taken_excludes_own_account():
    """validate_nickname raises taken for another account but not for the owner."""
    owner = Account.objects.create(device_id="d-own", nickname="Stout")
    other = Account.objects.create(device_id="d-other")

    # Owner re-validating its own handle (different case) → returns verbatim.
    assert accounts.validate_nickname("STOUT", account=owner) == "STOUT"

    # A different account → taken (409).
    with pytest.raises(AccountError) as exc:
        accounts.validate_nickname("stout", account=other)
    assert exc.value.code == "nickname_taken"
    assert exc.value.http_status == 409


# ===========================================================================
# 2. Nickname charset / length / reserved rejection
# ===========================================================================


@pytest.mark.django_db
@pytest.mark.parametrize(
    "value,code",
    [
        ("ab", "nickname_too_short"),
        ("a" * 21, "nickname_too_long"),
        ("bad name", "nickname_invalid"),  # space
        ("bad!", "nickname_invalid"),  # punctuation
        ("café", "nickname_invalid"),  # non-ascii
        ("..dots", "nickname_invalid"),  # leading dot
        ("dots.", "nickname_invalid"),  # trailing dot
        ("do..ts", "nickname_invalid"),  # double dot
        ("admin", "nickname_reserved"),
        ("ADMIN", "nickname_reserved"),  # reserved compare is case-insensitive
        ("pivo", "nickname_reserved"),
        ("napivo", "nickname_reserved"),
    ],
)
def test_validate_nickname_rejects_bad_values(value, code):
    with pytest.raises(AccountError) as exc:
        accounts.validate_nickname(value)
    assert exc.value.code == code


@pytest.mark.django_db
def test_patch_nickname_charset_rejection_is_400_with_code(client):
    token, _ = _bootstrap(client)
    resp = client.patch(
        "/v1/account/me", data={"nickname": "no spaces"}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "nickname_invalid"


@pytest.mark.django_db
def test_patch_nickname_reserved_rejection_is_400_with_code(client):
    token, _ = _bootstrap(client)
    resp = client.patch(
        "/v1/account/me", data={"nickname": "admin"}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "nickname_reserved"


@pytest.mark.django_db
def test_patch_nickname_too_long_rejection_is_400_with_code(client):
    """A 21-char nickname must surface the contract code, not DRF's 'max_length'.

    validate_nickname (single source of truth) owns the 20-char ceiling; the
    serializer field carries NO max_length so the {detail, code} shape with
    code='nickname_too_long' reaches the mobile client.
    """
    token, _ = _bootstrap(client)
    resp = client.patch(
        "/v1/account/me", data={"nickname": "a" * 21}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "nickname_too_long"


# ===========================================================================
# 3. Clearing the nickname frees the handle (→ NULL)
# ===========================================================================


@pytest.mark.django_db
def test_clearing_nickname_sets_null_and_frees_the_handle(client):
    token_a, id_a = _bootstrap(client)
    token_b, _ = _bootstrap(client)

    # A claims "Pilsner".
    claim = client.patch(
        "/v1/account/me", data={"nickname": "Pilsner"}, format="json", **_auth(token_a)
    )
    assert claim.status_code == status.HTTP_200_OK, claim.content

    # B cannot take it while A holds it.
    blocked = client.patch(
        "/v1/account/me", data={"nickname": "pilsner"}, format="json", **_auth(token_b)
    )
    assert blocked.status_code == status.HTTP_409_CONFLICT

    # A clears it with an empty string → coerced to NULL.
    cleared = client.patch(
        "/v1/account/me", data={"nickname": ""}, format="json", **_auth(token_a)
    )
    assert cleared.status_code == status.HTTP_200_OK, cleared.content
    assert cleared.json()["nickname"] is None
    account_a = Account.objects.get(public_id=id_a)
    assert account_a.nickname is None

    # Now B can take the freed handle.
    freed = client.patch(
        "/v1/account/me", data={"nickname": "Pilsner"}, format="json", **_auth(token_b)
    )
    assert freed.status_code == status.HTTP_200_OK, freed.content
    assert freed.json()["nickname"] == "Pilsner"


@pytest.mark.django_db
def test_clearing_nickname_with_null_sets_null(client):
    """Explicit JSON null clears the handle too (not just empty string)."""
    token, account_id = _bootstrap(client)
    client.patch("/v1/account/me", data={"nickname": "Porter"}, format="json", **_auth(token))

    resp = client.patch(
        "/v1/account/me", data={"nickname": None}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["nickname"] is None
    assert Account.objects.get(public_id=account_id).nickname is None


# ===========================================================================
# 4. nickname-available endpoint — every reason + missing param
# ===========================================================================


@pytest.mark.django_db
def test_nickname_available_free(client):
    resp = client.get("/v1/account/nickname-available", {"nickname": "FreshHandle"})
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body == {"nickname": "FreshHandle", "available": True, "reason": None}


@pytest.mark.django_db
@pytest.mark.parametrize(
    "value,reason",
    [
        ("ab", "too_short"),
        ("a" * 21, "too_long"),
        ("bad name", "invalid"),
        ("admin", "reserved"),
    ],
)
def test_nickname_available_reasons(client, value, reason):
    resp = client.get("/v1/account/nickname-available", {"nickname": value})
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == reason


@pytest.mark.django_db
def test_nickname_available_taken_reason(client):
    token, _ = _bootstrap(client)
    client.patch("/v1/account/me", data={"nickname": "Amber"}, format="json", **_auth(token))

    # Unauthenticated probe of the taken handle (different case) → taken.
    resp = client.get("/v1/account/nickname-available", {"nickname": "amber"})
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "taken"


@pytest.mark.django_db
def test_nickname_available_own_nickname_reports_available(client):
    """With a Bearer token, the caller's OWN current handle reports available."""
    token, _ = _bootstrap(client)
    client.patch("/v1/account/me", data={"nickname": "Saison"}, format="json", **_auth(token))

    resp = client.get(
        "/v1/account/nickname-available", {"nickname": "Saison"}, **_auth(token)
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["available"] is True
    assert body["reason"] is None


@pytest.mark.django_db
def test_nickname_available_missing_param_is_400(client):
    resp = client.get("/v1/account/nickname-available")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "nickname_missing"

    # A blank/whitespace-only param is also 400.
    blank = client.get("/v1/account/nickname-available", {"nickname": "   "})
    assert blank.status_code == status.HTTP_400_BAD_REQUEST


# ===========================================================================
# 5. Migration backfill — existing rows keep NULL nick / is_public True
# ===========================================================================


@pytest.mark.django_db
def test_migration_backfill_state_for_existing_rows():
    """Two pre-existing accounts (no profile fields set) coexist with NULL
    nicknames and default is_public True — the state a real migrate leaves on
    rows created before 0026. Proves the partial unique index does NOT collide
    on NULL/empty handles."""
    a = Account.objects.create(device_id="legacy-1")
    b = Account.objects.create(device_id="legacy-2")

    for acc in (a, b):
        acc.refresh_from_db()
        assert acc.nickname is None
        assert acc.is_public is True
        assert acc.avatar == ""  # ImageField default

    # Two NULL-nickname rows coexist (the partial constraint skips them).
    assert Account.objects.filter(nickname__isnull=True).count() == 2


@pytest.mark.django_db(transaction=True)
def test_migration_0026_applies_and_constraint_exists():
    """0026 brings the schema to head and installs the functional CI unique
    index. Verified by round-tripping through the migration executor: migrate
    back to 0025, forward to 0026, then prove the constraint by attempting a
    case-insensitive duplicate. Finally migrate to the current head again."""
    executor = MigrationExecutor(connection)
    app_label = "pubs"

    # Roll back to just-before-0026, then forward again. (Leaves the DB at head
    # for the rest of the transactional test DB.)
    executor.migrate([(app_label, "0025_backfill_auth_tokens")])
    executor.loader.build_graph()
    executor.migrate([(app_label, "0026_account_profile_fields")])
    executor.loader.build_graph()

    historical_apps = executor.loader.project_state(
        [(app_label, "0026_account_profile_fields")]
    ).apps
    HistoricalAccount = historical_apps.get_model(app_label, "Account")

    HistoricalAccount.objects.create(device_id="m-1", nickname="Dunkel")
    with pytest.raises(IntegrityError):
        HistoricalAccount.objects.create(device_id="m-2", nickname="DUNKEL")

    executor.migrate([(app_label, "0027_account_settings")])
    executor.loader.build_graph()


# ===========================================================================
# 6. Avatar pipeline — service layer (stored bytes are 256 WEBP, no EXIF)
# ===========================================================================


@pytest.mark.django_db
def test_process_avatar_outputs_256_square_webp_no_exif():
    content = accounts.process_avatar(_png_bytes((640, 480)))
    img = Image.open(io.BytesIO(content.read()))
    assert img.format == "WEBP"
    assert img.size == (256, 256)
    # Re-encoded output carries no EXIF.
    assert not img.getexif()


@pytest.mark.django_db
def test_set_avatar_stores_256_webp_file(client, tmp_media):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)

    accounts.set_avatar(account, _upload(_png_bytes((500, 500))))
    account.refresh_from_db()

    assert account.avatar  # field populated
    assert account.avatar.name == f"avatars/{account.public_id}.webp"
    with account.avatar.open("rb") as fh:
        stored = Image.open(io.BytesIO(fh.read()))
    assert stored.format == "WEBP"
    assert stored.size == (256, 256)


@pytest.mark.django_db
def test_set_avatar_overwrites_in_place_on_reupload(client, tmp_media):
    """A second upload OVERWRITES the stable path — no orphan, no name drift.

    Django's default FileSystemStorage never overwrites (it appends a random
    suffix when the target exists), so without the explicit pre-delete a re-upload
    would leak the old file and drift account.avatar.name off the stable path.
    """
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    stable_name = f"avatars/{account.public_id}.webp"

    accounts.set_avatar(account, _upload(_png_bytes((500, 500))))
    account.refresh_from_db()
    assert account.avatar.name == stable_name

    # Second upload to the SAME account.
    accounts.set_avatar(account, _upload(_png_bytes((400, 400))))
    account.refresh_from_db()
    # Name must still be the stable path (no random suffix).
    assert account.avatar.name == stable_name
    # And only ONE file may exist in MEDIA_ROOT/avatars (no orphan).
    avatars_dir = tmp_media / "avatars"
    files = sorted(p.name for p in avatars_dir.iterdir())
    assert files == [f"{account.public_id}.webp"], files


@pytest.mark.django_db
def test_set_avatar_advances_cache_bust_on_reupload(client, tmp_media):
    """Re-uploading advances the ?v= cache-bust so the new image isn't served
    stale behind the production immutable /media cache.

    set_avatar touches last_seen_at in the same save; avatar_url's ?v= derives
    from last_seen_at's epoch. int(timestamp()) is whole-second granularity, so
    sleep >1s between uploads to make the strict increase observable.
    """
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)

    accounts.set_avatar(account, _upload(_png_bytes((300, 300))))
    first = client.get("/v1/account/me", **_auth(token)).json()["avatar_url"]
    first_v = int(first.split("?v=")[1])

    time.sleep(1.1)
    account.refresh_from_db()
    accounts.set_avatar(account, _upload(_png_bytes((300, 300))))
    second = client.get("/v1/account/me", **_auth(token)).json()["avatar_url"]
    second_v = int(second.split("?v=")[1])

    assert second_v > first_v, (first, second)


@pytest.mark.django_db
def test_avatar_exif_orientation_is_applied(tmp_media):
    """An EXIF Orientation=6 (90° CW) image is transposed before re-encode.

    The source paints left-half red / right-half blue at 200×100. Orientation 6
    means a correct viewer shows it rotated 90° CW to 100×200, which moves the
    red region to the TOP. After our pipeline (exif_transpose then a square
    centre-crop) the centre-top pixel must be red-ish and the centre-bottom
    blue-ish — proving the rotation was applied (and not ignored / doubled)."""
    content = accounts.process_avatar(_jpeg_with_exif_orientation(6))
    img = Image.open(io.BytesIO(content.read())).convert("RGB")
    assert img.size == (256, 256)

    cx = img.size[0] // 2
    top = img.getpixel((cx, 10))
    bottom = img.getpixel((cx, img.size[1] - 10))
    # Top should be dominated by red, bottom by blue.
    assert top[0] > top[2], f"expected red-dominant top, got {top}"
    assert bottom[2] > bottom[0], f"expected blue-dominant bottom, got {bottom}"


@pytest.mark.django_db
def test_process_avatar_rejects_too_large():
    big = _png_bytes((50, 50)) + b"\x00" * (5 * 1024 * 1024 + 1)
    with pytest.raises(AccountError) as exc:
        accounts.process_avatar(big)
    assert exc.value.code == "avatar_too_large"


@pytest.mark.django_db
def test_process_avatar_rejects_invalid_bytes():
    with pytest.raises(AccountError) as exc:
        accounts.process_avatar(b"this is definitely not an image")
    assert exc.value.code == "avatar_invalid"


# ===========================================================================
# 7. Avatar endpoint — happy / validation / delete idempotent
# ===========================================================================


@pytest.mark.django_db
def test_avatar_upload_put_happy_path(client, tmp_media):
    token, account_id = _bootstrap(client)
    resp = client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(_png_bytes((400, 300)))},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["has_avatar"] is True
    assert body["avatar_url"] is not None
    assert Account.objects.get(public_id=account_id).avatar


@pytest.mark.django_db
def test_avatar_upload_post_alias_works(client, tmp_media):
    """POST is accepted as a mobile alias for PUT."""
    token, _ = _bootstrap(client)
    resp = client.post(
        "/v1/account/me/avatar",
        data={"avatar": _upload(_png_bytes((300, 300)))},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["has_avatar"] is True


@pytest.mark.django_db
def test_avatar_missing_field_is_400(client, tmp_media):
    token, _ = _bootstrap(client)
    resp = client.put(
        "/v1/account/me/avatar", data={}, format="multipart", **_auth(token)
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "avatar_missing"


@pytest.mark.django_db
def test_avatar_invalid_image_is_400(client, tmp_media):
    token, _ = _bootstrap(client)
    resp = client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(b"not an image", name="x.png")},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "avatar_invalid"


@pytest.mark.django_db
def test_avatar_too_large_is_400(client, tmp_media):
    token, _ = _bootstrap(client)
    big = _png_bytes((50, 50)) + b"\x00" * (5 * 1024 * 1024 + 1)
    resp = client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(big, name="big.png")},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "avatar_too_large"


@pytest.mark.django_db
def test_avatar_delete_is_idempotent(client, tmp_media):
    token, account_id = _bootstrap(client)

    # Upload first.
    client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(_png_bytes((300, 300)))},
        format="multipart",
        **_auth(token),
    )
    assert Account.objects.get(public_id=account_id).avatar

    # First delete clears it.
    first = client.delete("/v1/account/me/avatar", **_auth(token))
    assert first.status_code == status.HTTP_200_OK, first.content
    assert first.json()["has_avatar"] is False
    assert first.json()["avatar_url"] is None
    assert not Account.objects.get(public_id=account_id).avatar

    # Second delete is a no-op success (idempotent).
    second = client.delete("/v1/account/me/avatar", **_auth(token))
    assert second.status_code == status.HTTP_200_OK, second.content
    assert second.json()["has_avatar"] is False


# ===========================================================================
# 8. avatar_url is ABSOLUTE in GET /me and in a login response
# ===========================================================================


@pytest.mark.django_db
def test_avatar_url_is_absolute_in_get_me(client, tmp_media):
    token, _ = _bootstrap(client)
    client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(_png_bytes((300, 300)))},
        format="multipart",
        **_auth(token),
    )

    resp = client.get("/v1/account/me", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK, resp.content
    url = resp.json()["avatar_url"]
    assert url is not None
    assert url.startswith("http://"), f"avatar_url must be absolute, got {url!r}"
    assert "/media/avatars/" in url
    assert "?v=" in url  # cache-bust on last_seen_at


@pytest.mark.django_db
def test_avatar_url_is_absolute_in_login_response(client, tmp_media):
    """A login response (which goes through _account_state) carries an absolute
    avatar_url too — proving the request context is threaded there."""
    token, account_id = _bootstrap(client)

    # Attach an email credential so we can log in, and give the account an avatar.
    reg = client.post(
        "/v1/auth/register",
        data={"email": "avurl@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(token),
    )
    assert reg.status_code == status.HTTP_201_CREATED, reg.content
    session = reg.json()["token"]
    client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(_png_bytes((300, 300)))},
        format="multipart",
        **_auth(session),
    )

    login = client.post(
        "/v1/auth/login",
        data={"email": "avurl@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK, login.content
    url = login.json()["avatar_url"]
    assert url is not None
    assert url.startswith("http://"), f"login avatar_url must be absolute, got {url!r}"
    assert "/media/avatars/" in url


# ===========================================================================
# 9. is_public round-trip + hide_pub_names regression through new serializer
# ===========================================================================


@pytest.mark.django_db
def test_is_public_defaults_true_and_round_trips(client):
    token, account_id = _bootstrap(client)

    # Default exposed by GET /me is True.
    me = client.get("/v1/account/me", **_auth(token))
    assert me.json()["is_public"] is True

    # Opt out.
    off = client.patch(
        "/v1/account/me", data={"is_public": False}, format="json", **_auth(token)
    )
    assert off.status_code == status.HTTP_200_OK, off.content
    assert off.json()["is_public"] is False
    assert Account.objects.get(public_id=account_id).is_public is False

    # Opt back in.
    on = client.patch(
        "/v1/account/me", data={"is_public": True}, format="json", **_auth(token)
    )
    assert on.status_code == status.HTTP_200_OK, on.content
    assert on.json()["is_public"] is True


@pytest.mark.django_db
def test_hide_pub_names_still_works_through_new_serializer(client):
    """Regression: PATCH now uses AccountUpdateSerializer; hide_pub_names must
    still round-trip (it shares the endpoint with the new profile fields)."""
    token, account_id = _bootstrap(client)

    resp = client.patch(
        "/v1/account/me",
        data={"hide_pub_names": True},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["hide_pub_names"] is True
    assert Account.objects.get(public_id=account_id).hide_pub_names is True

    # And a combined PATCH updates several fields at once.
    combined = client.patch(
        "/v1/account/me",
        data={"hide_pub_names": False, "display_name": "Tomáš", "is_public": False},
        format="json",
        **_auth(token),
    )
    assert combined.status_code == status.HTTP_200_OK, combined.content
    body = combined.json()
    assert body["hide_pub_names"] is False
    assert body["display_name"] == "Tomáš"
    assert body["is_public"] is False


@pytest.mark.django_db
def test_account_settings_round_trip_through_me(client):
    token, account_id = _bootstrap(client)

    resp = client.patch(
        "/v1/account/me",
        data={
            "compass_mode": "surprise",
            "max_distance_km": 5,
            "price_currency": "EUR",
            "haptic_enabled": False,
            "sound_enabled": True,
            "hide_closed_pubs": False,
            "hide_pub_names": True,
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["hide_pub_names"] is True
    assert body["settings"] == {
        "mode": "surprise",
        "max_distance_km": 5.0,
        "price_currency": "EUR",
        "haptic_enabled": False,
        "sound_enabled": True,
        "hide_closed_pubs": False,
        "hide_pub_names": True,
        "marketing_emails_enabled": False,
    }

    account = Account.objects.get(public_id=account_id)
    assert account.compass_mode == "surprise"
    assert account.max_distance_km == 5
    assert account.price_currency == "EUR"
    assert account.haptic_enabled is False
    assert account.sound_enabled is True
    assert account.hide_closed_pubs is False
    assert account.hide_pub_names is True


@pytest.mark.django_db
def test_get_me_returns_backend_profile_stats_and_achievements(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    now = timezone.now()

    for i in range(10):
        DrinkLog.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            cache_key="u2fkbn12" if i < 6 else "u2fkbn34",
            name="U Zlatého tygra" if i < 6 else "Lokál",
            lat=50.0876,
            lng=14.4214,
            city="Praha",
            external_id="",
            beer_name="Pilsner Urquell",
            price_czk=50 + i,
            volume_ml=500,
            drank_at=now,
        )

    for drink_type, name, price, volume in [
        (DrinkLog.DrinkType.SOFT_DRINK, "Kofola", 49, 400),
        (DrinkLog.DrinkType.SHOT, "Slivovice", 65, 40),
    ]:
        DrinkLog.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            cache_key="u2fkbn12",
            name="U Zlatého tygra",
            lat=50.0876,
            lng=14.4214,
            city="Praha",
            external_id="",
            drink_type=drink_type,
            beer_name=name,
            price_czk=price,
            volume_ml=volume,
            drank_at=now,
        )

    for i in range(5):
        PubVisit.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            cache_key="u2fkbn12",
            name="U Zlatého tygra",
            lat=50.0876,
            lng=14.4214,
            city="Praha",
            external_id="",
            started_at=now,
            ended_at=now,
            client_updated_at=now,
        )
    PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn34",
        name="Lokál",
        lat=50.088,
        lng=14.422,
        city="Praha",
        external_id="",
        started_at=now,
        ended_at=now,
        client_updated_at=now,
    )

    for i in range(10):
        PubRating.objects.create(
            account=account,
            cache_key=f"u2fk{i:04d}",
            name=f"Pub {i}",
            lat=50.0 + i / 1000,
            lng=14.0,
            external_id="",
            verdict=PubRating.Verdict.LIKE,
            tag="",
            note="",
            client_updated_at=now,
        )

    resp = client.get("/v1/account/me", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["stats"] == {
        "total_beers": 10,
        "distinct_pubs": 2,
        "ratings_count": 10,
        "total_spent_czk": sum(range(50, 60)) + 49 + 65,
        "max_visits_to_one_pub": 5,
    }
    assert body["achievements"] == {
        "first_ten": True,
        "regular": True,
        "reviewer": True,
        # Mapér badges are additive and locked off here (no amenity votes yet).
        "first_map": False,
        "explorer": False,
        "cartographer": False,
        "completionist": False,
        "fact_machine": False,
        # FotoPivař badge is additive too (no contest win yet).
        "foto_pivar": False,
        "first_beer": True,
        "century": False,
        "pilgrim": False,
        "stamgast": False,
        "night_owl": False,
        "taster": False,
        "party_animal": False,
    }
    # The additive Mapér block is present even for an account that never voted.
    assert body["mapper"]["xp"] == 0
    assert body["mapper"]["level"] == 1
    assert body["mapper"]["title"] == "Nováček"


# ===========================================================================
# 10. Google picture capture (once) + display_name seed; Apple no-op
# ===========================================================================


@pytest.fixture
def fake_oauth_with_picture(monkeypatch):
    """Patch the provider verifiers so Google asserts a name + picture.

    Test token form ``"<provider>:<sub>:<email>"`` (mirrors test_auth). The
    Google verifier additionally returns ``name`` and ``picture`` so we can
    drive the social display-name + avatar-capture paths. Apple returns no
    picture (it never has one).
    """

    def fake_google(token: str) -> dict:
        _, sub, email = token.split(":")
        return {
            "sub": sub,
            "email": email,
            "email_verified": True,
            "name": "Google Person",
            "picture": "https://lh3.googleusercontent.com/test-avatar",
        }

    def fake_apple(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    def fake_exchange(code: str) -> dict:
        return {"refresh_token": "rt_test"}

    monkeypatch.setattr(oauth, "verify_google_id_token", fake_google)
    monkeypatch.setattr(oauth, "verify_apple_identity_token", fake_apple)
    monkeypatch.setattr(oauth, "exchange_apple_auth_code", fake_exchange)


@pytest.fixture
def picture_fetches(monkeypatch):
    """Record every Google picture GET and return a valid PNG body.

    Patches the ``requests.get`` used by ``_maybe_capture_social_avatar`` (it
    lives at the ``pubs.accounts`` module boundary, called as
    ``requests.get(...)``). Returns the list of fetched URLs so a test can prove
    the picture is fetched EXACTLY ONCE."""
    fetched: list[str] = []
    body = _png_bytes((128, 128))

    def fake_get(url, *args, **kwargs):
        fetched.append(url)
        return _FakePictureResponse(body, content_type="image/png")

    monkeypatch.setattr(accounts.requests, "get", fake_get)
    return fetched


@pytest.mark.django_db
def test_google_captures_picture_once_and_seeds_display_name(
    client, tmp_media, fake_oauth_with_picture, picture_fetches
):
    # First Google sign-in: captures the picture + seeds display_name.
    first = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-PIC-1:pic1@x.cz"},
        format="json",
    )
    assert first.status_code == status.HTTP_200_OK, first.content
    body = first.json()
    assert body["display_name"] == "Google Person"
    assert body["has_avatar"] is True
    assert body["avatar_url"] is not None
    assert len(picture_fetches) == 1  # fetched exactly once

    account = Account.objects.get(public_id=body["id"])
    assert account.avatar
    captured_name = account.avatar.name

    # Second sign-in for the same identity: avatar already set → NOT re-fetched,
    # and the existing display_name is NOT overwritten.
    second = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-PIC-1:pic1@x.cz"},
        format="json",
    )
    assert second.status_code == status.HTTP_200_OK, second.content
    assert len(picture_fetches) == 1  # still only one fetch — captured once
    account.refresh_from_db()
    assert account.avatar.name == captured_name
    assert account.display_name == "Google Person"


@pytest.mark.django_db
def test_google_does_not_overwrite_existing_display_name(
    client, tmp_media, fake_oauth_with_picture, picture_fetches
):
    """A pre-existing display_name on the claimed account is preserved (Google's
    asserted name only SEEDS an empty one)."""
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    account.display_name = "Already Named"
    account.save(update_fields=["display_name"])

    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-PIC-2:pic2@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["display_name"] == "Already Named"
    account.refresh_from_db()
    assert account.display_name == "Already Named"
    # The picture is still captured (avatar was empty).
    assert account.avatar


@pytest.mark.django_db
def test_apple_signin_does_not_capture_avatar(
    client, tmp_media, fake_oauth_with_picture, picture_fetches
):
    """Apple has no picture claim → no capture attempt, no avatar."""
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-NOPIC:np@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["has_avatar"] is False
    assert body["avatar_url"] is None
    assert picture_fetches == []  # Apple → no fetch at all

    account = Account.objects.get(public_id=body["id"])
    assert not account.avatar


@pytest.mark.django_db
def test_google_picture_fetch_failure_never_breaks_signin(
    client, tmp_media, fake_oauth_with_picture, monkeypatch
):
    """A flaky picture fetch is swallowed: sign-in still succeeds with no avatar."""

    def boom(url, *args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(accounts.requests, "get", boom)

    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-PIC-FAIL:fail@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["has_avatar"] is False
    # display_name is still seeded — only the avatar capture failed.
    assert body["display_name"] == "Google Person"


# ===========================================================================
# 11. Throttling — nickname-available + avatar scopes
# ===========================================================================


def _override_rate(monkeypatch, scope: str, rate: str) -> None:
    """Tighten one throttle scope without dropping the others.

    Monkeypatching THROTTLE_RATES (not @override_settings) because DRF binds the
    rates at import time — the same gotcha documented in test_account.py. We copy
    the existing dict and override a single scope so the 'account' scope used by
    ``_bootstrap`` (and any other endpoint a test hits) keeps working."""
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates[scope] = rate
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)


@pytest.mark.django_db
def test_nickname_available_is_throttled(client, monkeypatch):
    """The nickname_check scope rate-limits the public probe."""
    _override_rate(monkeypatch, "nickname_check", "3/min")

    for _ in range(3):
        ok = client.get("/v1/account/nickname-available", {"nickname": "Throttle"})
        assert ok.status_code == status.HTTP_200_OK

    throttled = client.get("/v1/account/nickname-available", {"nickname": "Throttle"})
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_avatar_upload_is_throttled(client, tmp_media, monkeypatch):
    token, _ = _bootstrap(client)
    _override_rate(monkeypatch, "avatar", "2/min")

    for _ in range(2):
        ok = client.put(
            "/v1/account/me/avatar",
            data={"avatar": _upload(_png_bytes((120, 120)))},
            format="multipart",
            **_auth(token),
        )
        assert ok.status_code == status.HTTP_200_OK, ok.content

    throttled = client.put(
        "/v1/account/me/avatar",
        data={"avatar": _upload(_png_bytes((120, 120)))},
        format="multipart",
        **_auth(token),
    )
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ===========================================================================
# 12. Smoke: a fresh migrate from empty applies the full chain (sanity gate)
# ===========================================================================


@pytest.mark.django_db
def test_makemigrations_reports_no_pending_changes():
    """No model drift: 0026 captures every field/constraint on Account."""
    call_command("makemigrations", "pubs", check=True, dry_run=True, verbosity=0)

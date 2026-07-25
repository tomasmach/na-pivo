"""
pubs.accounts — the account/auth service layer.

This is where the real logic of user accounts lives, kept out of the DRF views
so it is independently testable and reusable. The mobile app starts ANONYMOUS:
the first contact creates a device-bound :class:`~pubs.models.Account` (see
``AccountView``) and issues an :class:`~pubs.models.AuthToken` of kind ``device``.

Registering or signing in then **claims** that same anonymous account by attaching
a credential to it — an :class:`~pubs.models.EmailCredential` (email + password)
or an :class:`~pubs.models.AuthIdentity` (Google / Apple). Because the credential
attaches to the existing row, all the user's already-synced data (drinks, ratings,
visits, …) follows them with zero migration.

Identity resolution rules (see :func:`resolve_social`):

* A login is resolved by the provider's stable ``sub`` (``AuthIdentity`` lookup),
  never by email — email is mutable and may be an Apple private-relay address.
* A *new* social identity claims the CURRENT anonymous account if there is one;
  otherwise it creates a fresh account.
* We never silently link a social identity to a *different* existing account by
  matching email (the classic account-takeover vector). If the asserted email
  already belongs to a password account, we reject and tell the user to sign in
  with their password and link the provider explicitly.
* Linking a provider to an *already-authenticated* account (``link_social``) is
  the blessed flow — the live session is the authorization.

Tokens are opaque random secrets stored only as SHA-256 digests; revocation is a
row delete. Account deletion is a soft-delete with a grace window (the
``purge_deleted_accounts`` command hard-purges later), and revokes the Apple
token because Apple requires it.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit

import requests
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError

from pubs import emailer, oauth
from pubs.models import (
    Account,
    AccountMappedPub,
    AccountPubCompletion,
    AccountUsageStats,
    AmenityXpLedger,
    AuthIdentity,
    AuthToken,
    ClientEvent,
    ContentReport,
    DrinkLog,
    EmailCredential,
    FeedbackReport,
    FriendPubActivity,
    NightRound,
    OneTimeToken,
    PubAmenity,
    PubAmenityVote,
    PubAmenityVoteTombstone,
    PubCommunityData,
    PubContributionLog,
    PublishedNight,
    PubRating,
    PubReport,
    PubVisit,
    PushDevice,
    UserAddedPub,
    generate_account_token,
    hash_account_token,
)

logger = logging.getLogger("pubs.accounts")


class AccountError(Exception):
    """A domain error the API layer maps to an HTTP response.

    ``code`` is a stable machine-readable string the mobile app can branch on;
    ``message`` is human-facing (Czech); ``http_status`` is the response status.
    """

    def __init__(self, message: str, *, code: str = "invalid", http_status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status


# ---------------------------------------------------------------------------
# Normalization & validation
# ---------------------------------------------------------------------------
def normalize_email(email: str) -> str:
    """Canonical form used for storage and uniqueness: trimmed + lowercased."""
    return (email or "").strip().lower()


def validate_password_strength(raw_password: str, *, account: Account | None = None) -> None:
    """Run Django's AUTH_PASSWORD_VALIDATORS. Raise AccountError on failure."""
    try:
        validate_password(raw_password, user=account)
    except DjangoValidationError as exc:
        raise AccountError(
            " ".join(exc.messages) or "Heslo je příliš slabé.",
            code="weak_password",
            http_status=400,
        ) from exc


# ---------------------------------------------------------------------------
# Nickname (unique public handle)
# ---------------------------------------------------------------------------
# Handles users may NOT take — system terms, brand names, route-conflicting
# words, and the falsy literals that often leak through clients. Compared
# lowercase against the lowercased candidate.
RESERVED_NICKNAMES = frozenset(
    {
        "admin",
        "administrator",
        "root",
        "superuser",
        "mod",
        "moderator",
        "support",
        "help",
        "staff",
        "team",
        "official",
        "napivo",
        "na-pivo",
        "na_pivo",
        "system",
        "api",
        "www",
        "me",
        "null",
        "none",
        "undefined",
        "anonymous",
        "user",
        "account",
        "settings",
        "auth",
        "login",
        "register",
        "privacy",
        "terms",
        "about",
        "contact",
        "pivo",
        "beer",
    }
)

# 3–20 chars from [a-zA-Z0-9_.]. Dot rules (no '..', no leading/trailing '.')
# are enforced separately so each gets its own clear error.
_NICKNAME_RE = re.compile(r"^[a-zA-Z0-9_.]{3,20}$")


def validate_nickname(value: str, *, account: Account | None = None) -> str:
    """Validate a candidate nickname; return it verbatim (casing preserved).

    Order: charset/length → reserved → taken. Raises :class:`AccountError` with a
    stable ``code`` the mobile app branches on. ``account`` (when given) is
    excluded from the taken-check so re-saving an account's own current nickname
    is idempotent.
    """
    value = (value or "").strip()
    if len(value) < 3:
        raise AccountError("Přezdívka je příliš krátká.", code="nickname_too_short")
    if len(value) > 20:
        raise AccountError("Přezdívka je příliš dlouhá.", code="nickname_too_long")
    if (
        not _NICKNAME_RE.match(value)
        or ".." in value
        or value.startswith(".")
        or value.endswith(".")
    ):
        raise AccountError(
            "Přezdívka smí obsahovat jen písmena, číslice, tečku a podtržítko.",
            code="nickname_invalid",
        )
    if value.lower() in RESERVED_NICKNAMES:
        raise AccountError("Tuto přezdívku nelze použít.", code="nickname_reserved")

    taken = Account.objects.filter(nickname__iexact=value)
    if account is not None and account.pk is not None:
        taken = taken.exclude(pk=account.pk)
    if taken.exists():
        raise AccountError(
            "Tuto přezdívku už někdo používá.", code="nickname_taken", http_status=409
        )
    return value


def check_nickname(value: str, account: Account | None = None) -> tuple[bool, str | None]:
    """Non-raising availability probe for the nickname-available endpoint.

    Returns ``(available, reason)`` where ``reason`` is one of
    ``invalid|reserved|taken|too_short|too_long`` (or ``None`` when available).
    Mirrors :func:`validate_nickname` exactly — same order — but never raises.
    """
    try:
        validate_nickname(value, account=account)
    except AccountError as exc:
        # Strip the "nickname_" prefix to the bare reason the contract specifies.
        reason = exc.code.removeprefix("nickname_")
        return False, reason
    return True, None


def set_nickname(account: Account, value: str | None) -> Account:
    """Set (or clear) the account's nickname. Empty/None clears it to NULL.

    Validation is the single source of truth (:func:`validate_nickname`); the DB
    UniqueConstraint is the race backstop — the caller catches ``IntegrityError``
    and maps it to 409 ``nickname_taken``.
    """
    if value is None or not value.strip():
        account.nickname = None
        account.save(update_fields=["nickname"])
        return account
    account.nickname = validate_nickname(value, account=account)
    account.save(update_fields=["nickname"])
    return account


# ---------------------------------------------------------------------------
# Avatar pipeline (local-disk upload → 256px square webp, EXIF stripped)
# ---------------------------------------------------------------------------
def process_avatar(file_or_bytes) -> ContentFile:
    """Re-encode an uploaded image to a 256px square webp ContentFile.

    NEVER trusts the client's content-type or extension — every upload is decoded
    and re-encoded. Guards run BEFORE decode (size cap + decompression-bomb
    ceiling). Pipeline: ``exif_transpose`` (honour orientation) → ``RGB`` →
    ``ImageOps.fit`` (centre-crop to square) → webp. Raises :class:`AccountError`
    (``avatar_too_large`` | ``avatar_invalid``).
    """
    max_bytes = settings.AVATAR_MAX_UPLOAD_BYTES

    # --- size guard (before any decode) ---
    size = getattr(file_or_bytes, "size", None)
    if size is None and isinstance(file_or_bytes, (bytes, bytearray)):
        size = len(file_or_bytes)
    if size is not None and size > max_bytes:
        raise AccountError("Obrázek je příliš velký.", code="avatar_too_large", http_status=400)

    if isinstance(file_or_bytes, (bytes, bytearray)):
        raw = bytes(file_or_bytes)
    else:
        # Read at most max_bytes + 1 so a lying/streaming Content-Length cannot
        # let an oversized body slip past the size attribute above.
        try:
            file_or_bytes.seek(0)
        except (AttributeError, OSError):
            pass
        raw = file_or_bytes.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise AccountError("Obrázek je příliš velký.", code="avatar_too_large", http_status=400)
    if not raw:
        raise AccountError("Obrázek nelze načíst.", code="avatar_invalid", http_status=400)

    # --- decompression-bomb ceiling (before decode) ---
    # Cap the decoded pixel count so a tiny highly-compressed file cannot blow up
    # memory. Restored in a finally so we never leak the override across calls.
    edge = settings.AVATAR_SIZE_PX
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = 50_000_000  # ~50 MP, generous for phone photos
    try:
        try:
            with Image.open(io.BytesIO(raw)) as img:
                img.load()
                img = ImageOps.exif_transpose(img)
                img = img.convert("RGB")
                img = ImageOps.fit(
                    img, (edge, edge), Image.Resampling.LANCZOS, centering=(0.5, 0.5)
                )
                out = io.BytesIO()
                img.save(
                    out,
                    format="WEBP",
                    quality=settings.AVATAR_WEBP_QUALITY,
                    method=6,
                )
        except (DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise AccountError(
                "Obrázek nelze načíst.", code="avatar_invalid", http_status=400
            ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit

    return ContentFile(out.getvalue(), name="avatar.webp")


def set_avatar(account: Account, file) -> Account:
    """Process and store an uploaded avatar, overwriting any previous one.

    The storage path is stable (``avatars/<public_id>.webp``). Django's default
    storage NEVER overwrites — ``get_available_name`` appends a random suffix when
    the target exists — so a naive re-upload would leak the old file AND drift the
    field off the stable path. We therefore delete the existing file first, then
    save to the stable path. ``last_seen_at`` is touched in the same save so the
    ``avatar_url`` ``?v=`` cache-bust advances and clients/CDNs bypass the stale
    immutable cache after a change.
    """
    content = process_avatar(file)
    # Default FileSystemStorage won't overwrite, so drop the previous file first
    # to guarantee the stable path and avoid orphans.
    if account.avatar:
        account.avatar.delete(save=False)
    # Pass save=False then a single save() to avoid two writes; the upload_to
    # callable ignores the supplied name and returns the stable path.
    account.avatar.save("avatar.webp", content, save=False)
    account.save(update_fields=["avatar", "last_seen_at"])
    return account


def clear_avatar(account: Account) -> Account:
    """Remove the stored avatar file and reset the field. Idempotent."""
    if account.avatar:
        account.avatar.delete(save=False)
    account.avatar = ""
    account.save(update_fields=["avatar"])
    return account


def _maybe_capture_social_avatar(account: Account, claims: dict, provider: str) -> None:
    """Capture a Google profile picture into the avatar ONCE, best-effort.

    Only fires when the account has no avatar yet AND the provider is Google AND
    the token carried a ``picture`` URL. Apple has no picture → no-op. ALL errors
    are swallowed with a warning: a flaky picture fetch must never break sign-in.
    """
    if account.avatar:
        return
    if provider != AuthIdentity.Provider.GOOGLE:
        return
    picture_url = (claims.get("picture") or "").strip()
    if not picture_url:
        return
    if not picture_url.lower().startswith("https://"):
        return
    try:
        resp = requests.get(picture_url, timeout=10, stream=True)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if not content_type.lower().startswith("image/"):
            logger.warning("social avatar: non-image content-type %r, skipping", content_type)
            return
        # Stream-cap at the upload limit so a hostile picture URL can't exhaust
        # memory; iter_content honours the cap regardless of Content-Length.
        max_bytes = settings.AVATAR_MAX_UPLOAD_BYTES
        chunks = io.BytesIO()
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            total += len(chunk)
            if total > max_bytes:
                logger.warning("social avatar: picture exceeded %d bytes, skipping", max_bytes)
                return
            chunks.write(chunk)
        set_avatar(account, chunks.getvalue())
        logger.info("captured social avatar for account %s", account.public_id)
    except Exception as exc:  # noqa: BLE001 — best-effort, must never break sign-in
        logger.warning("social avatar capture failed (ignored): %s", exc)


# ---------------------------------------------------------------------------
# Token issuance / revocation
# ---------------------------------------------------------------------------
def issue_token(
    account: Account,
    *,
    kind: str = AuthToken.Kind.SESSION,
    device_label: str = "",
) -> str:
    """Create a fresh AuthToken for the account and return the RAW secret (the
    only time it exists in plaintext — only its digest is stored)."""
    raw = generate_account_token()
    expires_at = None
    if settings.AUTH_TOKEN_TTL_DAYS:
        expires_at = timezone.now() + timedelta(days=settings.AUTH_TOKEN_TTL_DAYS)
    AuthToken.objects.create(
        account=account,
        token_hash=hash_account_token(raw),
        kind=kind,
        device_label=device_label[:120],
        expires_at=expires_at,
    )
    return raw


def revoke_token(raw_token: str) -> None:
    """Revoke a single token (this device / sign-out)."""
    AuthToken.objects.filter(token_hash=hash_account_token(raw_token)).delete()


def prune_device_tokens(account: Account, *, keep_raw_tokens: tuple[str, ...]) -> None:
    """Delete stale bootstrap tokens while preserving the supplied raw tokens."""
    keep_hashes = [hash_account_token(raw_token) for raw_token in keep_raw_tokens]
    account.auth_tokens.filter(kind=AuthToken.Kind.DEVICE).exclude(
        token_hash__in=keep_hashes
    ).delete()


def revoke_all_tokens(account: Account) -> None:
    """Revoke every token for the account (sign out everywhere)."""
    account.auth_tokens.all().delete()


# ---------------------------------------------------------------------------
# Email + password
# ---------------------------------------------------------------------------
def _email_taken_by_other(email: str, *, account: Account) -> bool:
    return EmailCredential.objects.filter(email=email).exclude(account=account).exists()


def set_password(account: Account, raw_password: str, *, email: str | None = None) -> EmailCredential:
    """Create or update the account's EmailCredential.

    When the account has no credential yet, ``email`` is required (this is the
    "set a password" escape hatch for a social-only account, or part of
    registration). When it already has one, the password is rotated and the email
    left unchanged unless a new one is supplied.
    """
    validate_password_strength(raw_password, account=account)
    cred = EmailCredential.objects.filter(account=account).first()

    if cred is None:
        if not email:
            raise AccountError("Pro nastavení hesla je potřeba e-mail.", code="email_required")
        norm = normalize_email(email)
        if _email_taken_by_other(norm, account=account):
            raise AccountError(
                "Tento e-mail už používá jiný účet.", code="email_taken", http_status=409
            )
        cred = EmailCredential(account=account, email=norm, email_verified=False)
    elif email:
        norm = normalize_email(email)
        if norm != cred.email and _email_taken_by_other(norm, account=account):
            raise AccountError(
                "Tento e-mail už používá jiný účet.", code="email_taken", http_status=409
            )
        if norm != cred.email:
            cred.email = norm
            cred.email_verified = False

    cred.password = make_password(raw_password)
    cred.save()
    return cred


def register_email(
    current_account: Account,
    *,
    email: str,
    password: str,
    display_name: str = "",
    verification_link_base: str | None = None,
) -> tuple[Account, str]:
    """Register email+password, claiming the current anonymous account.

    Returns ``(account, raw_session_token)``. Sends a verification email
    (best-effort).
    """
    norm = normalize_email(email)
    if not norm:
        raise AccountError("Zadej platný e-mail.", code="email_invalid")

    if current_account.has_email_credential:
        raise AccountError(
            "Účet už má nastavené heslo.", code="already_has_password", http_status=409
        )
    if EmailCredential.objects.filter(email=norm).exists():
        raise AccountError(
            "Tento e-mail už používá jiný účet.", code="email_taken", http_status=409
        )

    validate_password_strength(password, account=current_account)

    with transaction.atomic():
        EmailCredential.objects.create(
            account=current_account,
            email=norm,
            password=make_password(password),
            email_verified=False,
        )
        if display_name and not current_account.display_name:
            current_account.display_name = display_name[:120]
            current_account.save(update_fields=["display_name"])

    token = issue_token(current_account, device_label=display_name)
    request_email_verification(current_account, link_base=verification_link_base)
    return current_account, token


def login_email(
    *,
    email: str,
    password: str,
    current_account: Account | None = None,
) -> tuple[Account, str]:
    """Authenticate email+password. Returns ``(account, raw_session_token)``.

    Uses a single generic error for both unknown-email and wrong-password to
    avoid account enumeration. Reactivates an account that was pending deletion.
    When an anonymous account token is supplied, its already-synced local progress
    is merged into the signed-in account after the password has been proven.
    """
    norm = normalize_email(email)
    cred = EmailCredential.objects.select_related("account").filter(email=norm).first()
    generic = AccountError(
        "Nesprávný e-mail nebo heslo.", code="invalid_credentials", http_status=401
    )
    if cred is None or not check_password(password, cred.password):
        raise generic

    account = cred.account
    # The merge touches public amenity aggregates with select_for_update(), and
    # every earlier token deletion / data move must roll back if any step fails.
    with transaction.atomic():
        _reactivate_if_pending(account)
        _merge_anonymous_account(current_account, account)
        token = issue_token(account)
    return account, token


# ---------------------------------------------------------------------------
# Social (Google / Apple)
# ---------------------------------------------------------------------------
def verify_provider_token(provider: str, token: str) -> dict:
    """Verify an ID/identity token with the right provider. Raises AccountError."""
    try:
        if provider == AuthIdentity.Provider.GOOGLE:
            return oauth.verify_google_id_token(token)
        if provider == AuthIdentity.Provider.APPLE:
            return oauth.verify_apple_identity_token(token)
    except oauth.OAuthError as exc:
        raise AccountError(str(exc), code="oauth_failed", http_status=401) from exc
    raise AccountError("Neznámý poskytovatel přihlášení.", code="bad_provider")


def apple_refresh_from_code(authorization_code: str) -> str:
    """Exchange an Apple auth code for a refresh token.

    Returns an empty string when no code is provided or the exchange fails; callers
    reject Apple sign-in/link flows that would create an unrevokeable identity.
    """
    if not authorization_code:
        return ""
    try:
        data = oauth.exchange_apple_auth_code(authorization_code)
        return data.get("refresh_token", "") or ""
    except oauth.OAuthError as exc:
        logger.warning("apple auth-code exchange failed: %s", exc)
        return ""


def _claims_email_is_verified(provider: str, claims: dict) -> bool:
    if provider == AuthIdentity.Provider.GOOGLE:
        return claims.get("email_verified") is True
    if provider == AuthIdentity.Provider.APPLE:
        value = claims.get("email_verified", True)
        return value is True or str(value).lower() == "true"
    return False


def _delete_or_move_account_rows(
    model,
    *,
    source: Account,
    target: Account,
    unique_fields: tuple[str, ...],
) -> None:
    target_keys = {
        tuple(values)
        for values in model.objects.filter(account=target).values_list(*unique_fields)
    }
    for row in model.objects.filter(account=source).order_by("pk"):
        row_key = tuple(getattr(row, field) for field in unique_fields)
        if row_key in target_keys:
            row.delete()
            continue
        row.account = target
        row.save(update_fields=["account"])
        target_keys.add(row_key)


def _recount_amenity_aggregate(
    cache_key: str, pub_identity_key: str, amenity_key: str
) -> None:
    """Recompute one EXISTING PubAmenity aggregate from its live votes.

    Used after a merge moves/deletes votes so the public counts stay derived from
    PubAmenityVote and never drift. Must run inside the merge transaction. Does
    NOT create a row (unlike the write-path recompute) — if no aggregate exists
    there is nothing to keep consistent. ``first_mapper`` is never touched here.
    """
    # Lazy import: pubs.api.views imports pubs.accounts at module load, so a
    # top-level import here would be circular. _amenity_status is the pure
    # status/confidence function shared with the write path.
    from pubs.api.views import _amenity_status

    agg = (
        PubAmenity.objects.select_for_update()
        .filter(pub_identity_key=pub_identity_key, amenity_key=amenity_key)
        .first()
    )
    if agg is None:
        return
    votes = PubAmenityVote.objects.filter(
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
    )
    counts = votes.aggregate(
        yes_count=Count("id", filter=Q(value=PubAmenityVote.Value.YES)),
        no_count=Count("id", filter=Q(value=PubAmenityVote.Value.NO)),
    )
    yes_count = int(counts["yes_count"] or 0)
    no_count = int(counts["no_count"] or 0)
    agg.yes_count = yes_count
    agg.no_count = no_count
    agg.distinct_voter_count = yes_count + no_count
    agg.status, agg.confidence = _amenity_status(yes_count, no_count)
    agg.last_updated = timezone.now()
    agg.save(
        update_fields=[
            "yes_count",
            "no_count",
            "distinct_voter_count",
            "status",
            "confidence",
            "last_updated",
            "updated_at",
        ]
    )


def _merge_usage_stats(source: Account, target: Account) -> None:
    source_stats = AccountUsageStats.objects.filter(account=source).first()
    if source_stats is None:
        return

    target_stats = AccountUsageStats.objects.filter(account=target).first()
    if target_stats is None:
        source_stats.account = target
        source_stats.save(update_fields=["account"])
        return

    target_stats.app_open_count += source_stats.app_open_count
    target_stats.app_foreground_count += source_stats.app_foreground_count
    target_stats.walked_distance_m += source_stats.walked_distance_m
    target_stats.client_warning_count += source_stats.client_warning_count
    target_stats.client_error_count += source_stats.client_error_count
    target_stats.api_failure_count += source_stats.api_failure_count
    # Mapér gamification counters (§7.2). XP + the personal-progress counters sum
    # across the merged accounts (matching the established sum-on-merge pattern);
    # the anonymous source's mapping work follows the user onto the signed-in
    # account, exactly as XP "follows the account through claim" (§7.1). Distinct-
    # pub double-counting across both accounts is accepted as a soft over-count on
    # a cosmetic counter (the public PubAmenity aggregate is recounted separately).
    target_stats.mapper_xp += source_stats.mapper_xp
    target_stats.pivar_xp += source_stats.pivar_xp
    target_stats.mapped_pubs_count += source_stats.mapped_pubs_count
    target_stats.first_mapper_count += source_stats.first_mapper_count
    target_stats.amenity_votes_count += source_stats.amenity_votes_count
    target_stats.completed_pubs_count += source_stats.completed_pubs_count

    if source_stats.last_app_open_at and (
        target_stats.last_app_open_at is None
        or source_stats.last_app_open_at > target_stats.last_app_open_at
    ):
        target_stats.last_app_open_at = source_stats.last_app_open_at

    if source_stats.last_event_at and (
        target_stats.last_event_at is None
        or source_stats.last_event_at > target_stats.last_event_at
    ):
        target_stats.last_event_at = source_stats.last_event_at
        target_stats.last_app_version = source_stats.last_app_version
        target_stats.last_platform = source_stats.last_platform
        target_stats.last_os_version = source_stats.last_os_version

    target_stats.save()
    source_stats.delete()


def _merge_anonymous_account(source: Account | None, target: Account) -> None:
    """Move best-effort anonymous data onto an existing signed-in account.

    This is used when a credential sign-in resolves to an existing account while
    the request also carries a fresh anonymous bearer. Unique-key conflicts keep
    the target account's existing row and drop the anonymous duplicate.
    """
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "_merge_anonymous_account must run inside transaction.atomic()"
        )

    if source is None or source.pk == target.pk or source.is_claimed:
        return

    source_id = source.id
    target_id = target.id
    logger.info(
        "anonymous account merge started",
        extra={
            "event": "account_merge_started",
            "observability": {
                "source_account_id": source_id,
                "target_account_id": target_id,
            },
        },
    )

    source.auth_tokens.all().delete()
    source.one_time_tokens.all().delete()

    _delete_or_move_account_rows(
        DrinkLog, source=source, target=target, unique_fields=("client_id",)
    )
    _delete_or_move_account_rows(
        PubRating, source=source, target=target, unique_fields=("cache_key",)
    )
    _delete_or_move_account_rows(
        PubVisit, source=source, target=target, unique_fields=("client_id",)
    )
    _delete_or_move_account_rows(
        PublishedNight, source=source, target=target, unique_fields=("client_id",)
    )
    _delete_or_move_account_rows(
        NightRound, source=source, target=target, unique_fields=("night_id",)
    )
    # Moving PublishedNight ownership can turn either direction of a cross-account
    # reaction into a self-reaction. Keep the normal deduplicating move above so
    # the (night, account) constraint stays safe, then remove rounds that violate
    # the same invariant enforced by the reaction endpoint.
    NightRound.objects.filter(account=target, night__account=target).delete()
    _delete_or_move_account_rows(
        UserAddedPub, source=source, target=target, unique_fields=("client_id",)
    )
    _delete_or_move_account_rows(
        FeedbackReport, source=source, target=target, unique_fields=("client_id",)
    )
    _delete_or_move_account_rows(
        PubContributionLog,
        source=source,
        target=target,
        unique_fields=("client_id", "kind"),
    )
    _delete_or_move_account_rows(
        PubReport,
        source=source,
        target=target,
        unique_fields=("cache_key", "reason"),
    )

    # Amenity votes are PUBLIC: moving (or dropping on conflict) the source's
    # votes changes the aggregate counts, so we must recompute every affected
    # (pub_identity_key, amenity_key) or the public PubAmenity row over-counts a merged
    # user forever. Capture the affected pairs BEFORE the move (some rows may be
    # dropped as target-duplicates), then recount after.
    affected_amenities = set(
        PubAmenityVote.objects.filter(account=source).values_list(
            "cache_key", "pub_identity_key", "amenity_key"
        )
    )
    _delete_or_move_account_rows(
        PubAmenityVote,
        source=source,
        target=target,
        unique_fields=("pub_identity_key", "amenity_key"),
    )
    _delete_or_move_account_rows(
        PubAmenityVoteTombstone,
        source=source,
        target=target,
        unique_fields=("pub_identity_key", "amenity_key"),
    )
    for cache_key, pub_identity_key, amenity_key in affected_amenities:
        _recount_amenity_aggregate(cache_key, pub_identity_key, amenity_key)

    # Durable Mapér XP-idempotency markers (§7.3): move them so the merged
    # account can't re-farm base/complete XP on a pub/amenity it already mapped.
    # The summed counters live on AccountUsageStats (_merge_usage_stats); these
    # rows are only the gates, so dedup-on-conflict is correct and never double
    # counts.
    _delete_or_move_account_rows(
        AmenityXpLedger,
        source=source,
        target=target,
        unique_fields=("pub_identity_key", "amenity_key"),
    )
    _delete_or_move_account_rows(
        AccountMappedPub,
        source=source,
        target=target,
        unique_fields=("pub_identity_key",),
    )
    _delete_or_move_account_rows(
        AccountPubCompletion,
        source=source,
        target=target,
        unique_fields=("pub_identity_key",),
    )
    _delete_or_move_account_rows(
        PushDevice,
        source=source,
        target=target,
        unique_fields=("push_token",),
    )

    PubCommunityData.objects.filter(account=source).update(account=target)
    ClientEvent.objects.filter(account=source).update(account=target)
    ContentReport.objects.filter(reporter=source).update(reporter=target)
    ContentReport.objects.filter(target_account=source).update(target_account=target)
    _merge_usage_stats(source, target)

    source.delete()
    logger.info(
        "anonymous account merge completed",
        extra={
            "event": "account_merge_completed",
            "observability": {
                "source_account_id": source_id,
                "target_account_id": target_id,
                "amenity_aggregates_recounted": len(affected_amenities),
            },
        },
    )


def _social_account_for_verified_email(
    provider: str,
    *,
    email: str,
    claims: dict,
) -> Account | None:
    if not email or not _claims_email_is_verified(provider, claims):
        return None
    identity = (
        AuthIdentity.objects.select_related("account")
        .filter(email=email)
        .exclude(provider=provider)
        .order_by("created_at")
        .first()
    )
    return identity.account if identity is not None else None


def resolve_social(
    current_account: Account | None,
    *,
    provider: str,
    claims: dict,
    full_name: str = "",
    apple_refresh_token: str = "",
) -> tuple[Account, str, bool]:
    """Resolve a verified social login to an account and issue a token.

    Returns ``(account, raw_session_token, created)`` where ``created`` is True
    when a brand-new account was made. See the module docstring for the rules.
    """
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise AccountError("Poskytovatel nevrátil identitu.", code="oauth_failed", http_status=401)
    email = normalize_email(claims.get("email", ""))

    existing = (
        AuthIdentity.objects.select_related("account")
        .filter(provider=provider, subject=subject)
        .first()
    )
    if existing is not None:
        if (
            provider == AuthIdentity.Provider.APPLE
            and not existing.apple_refresh_token
            and not apple_refresh_token
        ):
            raise AccountError(
                "Přihlášení přes Apple teď potřebuje nový autorizační kód.",
                code="apple_refresh_required",
                http_status=400,
            )
        # Known identity → sign in to its account.
        account = existing.account
        _reactivate_if_pending(account)
        updated = []
        if apple_refresh_token and apple_refresh_token != existing.apple_refresh_token:
            existing.apple_refresh_token = apple_refresh_token
            updated.append("apple_refresh_token")
        if email and email != existing.email:
            existing.email = email
            updated.append("email")
        if updated:
            existing.save(update_fields=updated)
        _maybe_set_display_name(account, full_name or claims.get("name", ""))
        # The merge touches public amenity aggregates with select_for_update(),
        # so keep the whole data move atomic on PostgreSQL.
        with transaction.atomic():
            _merge_anonymous_account(current_account, account)
        _maybe_capture_social_avatar(account, claims, provider)
        return account, issue_token(account), False

    # New identity. Decide which account it attaches to.
    claim_target = (
        current_account
        if (current_account is not None and not current_account.is_claimed)
        else None
    )

    # Guard the email-collision takeover vector: a new social identity whose
    # asserted email already belongs to a password account on a DIFFERENT account
    # must NOT auto-link. Make the user prove ownership (sign in + link).
    if email:
        collision = EmailCredential.objects.filter(email=email)
        if claim_target is not None:
            collision = collision.exclude(account=claim_target)
        if collision.exists():
            raise AccountError(
                "Tento e-mail už používá jiný účet. Přihlas se heslem a propoj "
                "poskytovatele v nastavení účtu.",
                code="email_exists",
                http_status=409,
            )

    email_match_account = _social_account_for_verified_email(
        provider,
        email=email,
        claims=claims,
    )
    if email_match_account is not None and (
        claim_target is None or email_match_account.pk != claim_target.pk
    ):
        if AuthIdentity.objects.filter(account=email_match_account, provider=provider).exists():
            raise AccountError(
                "Tenhle poskytovatel už je propojený s jiným účtem.",
                code="provider_already_linked",
                http_status=409,
            )
        _reactivate_if_pending(email_match_account)
        claim_target = email_match_account

    if provider == AuthIdentity.Provider.APPLE and not apple_refresh_token:
        raise AccountError(
            "Přihlášení přes Apple teď potřebuje nový autorizační kód.",
            code="apple_refresh_required",
            http_status=400,
        )

    try:
        with transaction.atomic():
            if claim_target is not None:
                account = claim_target
                created = False
            else:
                account = Account.objects.create(device_id=f"social-{generate_account_token()}")
                created = True
            AuthIdentity.objects.create(
                account=account,
                provider=provider,
                subject=subject,
                email=email,
                apple_refresh_token=apple_refresh_token,
            )
            _maybe_set_display_name(account, full_name or claims.get("name", ""))
            if account.pk == getattr(email_match_account, "pk", None):
                _merge_anonymous_account(current_account, account)
    except IntegrityError:
        # Concurrent first sign-in for the same (provider, subject) — re-resolve.
        existing = (
            AuthIdentity.objects.select_related("account")
            .filter(provider=provider, subject=subject)
            .first()
        )
        if existing is None:
            raise
        return existing.account, issue_token(existing.account), False

    # Avatar capture does network I/O + a file write, so run it AFTER the
    # identity transaction has committed (best-effort, never fatal).
    _maybe_capture_social_avatar(account, claims, provider)
    return account, issue_token(account), created


# ---------------------------------------------------------------------------
# Linking / unlinking (authenticated account)
# ---------------------------------------------------------------------------
def link_social(
    account: Account,
    *,
    provider: str,
    claims: dict,
    apple_refresh_token: str = "",
    full_name: str = "",
) -> AuthIdentity:
    """Link a social provider to the already-authenticated account.

    Rejects if the identity is already linked to a different account, or if this
    account already has an identity for the provider.
    """
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise AccountError("Poskytovatel nevrátil identitu.", code="oauth_failed", http_status=401)
    email = normalize_email(claims.get("email", ""))

    existing = (
        AuthIdentity.objects.filter(provider=provider, subject=subject)
        .select_related("account")
        .first()
    )
    if existing is not None:
        if existing.account_id == account.id:
            if provider == AuthIdentity.Provider.APPLE:
                if apple_refresh_token and apple_refresh_token != existing.apple_refresh_token:
                    existing.apple_refresh_token = apple_refresh_token
                    existing.save(update_fields=["apple_refresh_token"])
                elif not existing.apple_refresh_token:
                    raise AccountError(
                        "Propojení přes Apple teď potřebuje nový autorizační kód.",
                        code="apple_refresh_required",
                        http_status=400,
                    )
            return existing  # already linked to this account — idempotent
        raise AccountError(
            "Tento účet u poskytovatele je už propojený s jiným účtem.",
            code="provider_linked_elsewhere",
            http_status=409,
        )
    if account.identities.filter(provider=provider).exists():
        raise AccountError(
            "K účtu už je propojený jiný účet tohoto poskytovatele.",
            code="provider_already_linked",
            http_status=409,
        )

    if provider == AuthIdentity.Provider.APPLE and not apple_refresh_token:
        raise AccountError(
            "Propojení přes Apple teď potřebuje nový autorizační kód.",
            code="apple_refresh_required",
            http_status=400,
        )

    identity = AuthIdentity.objects.create(
        account=account,
        provider=provider,
        subject=subject,
        email=email,
        apple_refresh_token=apple_refresh_token,
    )
    _maybe_set_display_name(account, full_name or claims.get("name", ""))
    _maybe_capture_social_avatar(account, claims, provider)
    return identity


def unlink(account: Account, *, provider: str) -> None:
    """Remove a sign-in method, enforcing that at least one always remains.

    ``provider`` is one of 'email', 'google', 'apple'.
    """
    methods = account.auth_methods()
    if provider not in methods:
        raise AccountError("Tento způsob přihlášení není propojený.", code="not_linked")
    if len(methods) <= 1:
        raise AccountError(
            "Tohle je tvůj jediný způsob přihlášení. Nejdřív přidej heslo nebo "
            "jiného poskytovatele.",
            code="last_credential",
            http_status=400,
        )

    if provider == "email":
        EmailCredential.objects.filter(account=account).delete()
        return

    identity = account.identities.filter(provider=provider).first()
    if identity is None:
        raise AccountError("Tento způsob přihlášení není propojený.", code="not_linked")
    if provider == AuthIdentity.Provider.APPLE and identity.apple_refresh_token:
        # Revoke at Apple before dropping the identity so we do not lose the only
        # token that can satisfy Apple's deletion/unlink requirement.
        try:
            oauth.revoke_apple_token(identity.apple_refresh_token)
        except oauth.OAuthError as exc:
            logger.warning("apple token revoke on unlink failed: %s", exc)
            raise AccountError(
                "Apple token se nepodařilo odvolat. Zkus to prosím znovu.",
                code="apple_revoke_failed",
                http_status=502,
            ) from exc
    identity.delete()


# ---------------------------------------------------------------------------
# One-time tokens: email verification & password reset
# ---------------------------------------------------------------------------
def _create_one_time_token(account: Account, *, purpose: str, ttl: timedelta) -> str:
    """Mint a single-use token, store only its digest, return the raw value."""
    raw = generate_account_token()
    OneTimeToken.objects.create(
        account=account,
        purpose=purpose,
        token_hash=hash_account_token(raw),
        expires_at=timezone.now() + ttl,
    )
    return raw


def _consume_one_time_token(raw_token: str, *, purpose: str) -> Account:
    token_hash = hash_account_token(raw_token)
    now = timezone.now()
    with transaction.atomic():
        consumed = OneTimeToken.objects.filter(
            token_hash=token_hash,
            purpose=purpose,
            used_at__isnull=True,
            expires_at__gt=now,
        ).update(used_at=now)
        if consumed != 1:
            raise AccountError(
                "Odkaz je neplatný nebo vypršel.", code="token_invalid", http_status=400
            )
        ott = OneTimeToken.objects.select_related("account").get(
            token_hash=token_hash,
            purpose=purpose,
        )
    return ott.account


def _deep_link(path: str, raw_token: str) -> str:
    """Build the app deep link carried in an email."""
    scheme = settings.APP_DEEP_LINK_SCHEME
    return f"{scheme}://auth/{path}?{urlencode({'token': raw_token})}"


def _append_token(url: str, raw_token: str) -> str:
    """Append a one-time token query parameter to an absolute action URL."""
    parts = urlsplit(url)
    query = "&".join(part for part in (parts.query, urlencode({"token": raw_token})) if part)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def request_email_verification(account: Account, *, link_base: str | None = None) -> bool:
    """Send (or re-send) the email-verification message. No-op without an email."""
    cred = EmailCredential.objects.filter(account=account).first()
    if cred is None or cred.email_verified:
        return False
    raw = _create_one_time_token(
        account,
        purpose=OneTimeToken.Purpose.VERIFY_EMAIL,
        ttl=timedelta(hours=settings.EMAIL_VERIFY_TTL_HOURS),
    )
    link = _append_token(link_base, raw) if link_base else _deep_link("verify", raw)
    return emailer.send_verification_email(cred.email, link=link, code=raw)


def verify_email(raw_token: str) -> Account:
    account = _consume_one_time_token(raw_token, purpose=OneTimeToken.Purpose.VERIFY_EMAIL)
    EmailCredential.objects.filter(account=account).update(email_verified=True)
    return account


def request_password_reset(email: str, *, link_base: str | None = None) -> None:
    """Email a password-reset link. ALWAYS succeeds silently (no enumeration)."""
    norm = normalize_email(email)
    cred = EmailCredential.objects.select_related("account").filter(email=norm).first()
    if cred is None:
        logger.info("password reset requested for unknown email (ignored)")
        return
    raw = _create_one_time_token(
        cred.account,
        purpose=OneTimeToken.Purpose.RESET_PASSWORD,
        ttl=timedelta(hours=settings.PASSWORD_RESET_TTL_HOURS),
    )
    link = _append_token(link_base, raw) if link_base else _deep_link("reset", raw)
    emailer.send_password_reset_email(cred.email, link=link, code=raw)


def reset_password(raw_token: str, *, new_password: str) -> Account:
    """Consume a reset token, set the new password, revoke all sessions."""
    account = _consume_one_time_token(raw_token, purpose=OneTimeToken.Purpose.RESET_PASSWORD)
    validate_password_strength(new_password, account=account)
    cred = EmailCredential.objects.filter(account=account).first()
    if cred is None:
        raise AccountError("Účet nemá nastavené heslo.", code="no_password", http_status=400)
    cred.password = make_password(new_password)
    cred.email_verified = True  # proving control of the inbox verifies it
    cred.save(update_fields=["password", "email_verified", "updated_at"])
    revoke_all_tokens(account)  # force re-login everywhere after a reset
    return account


# ---------------------------------------------------------------------------
# Deletion (soft-delete + grace window; Apple revoke required)
# ---------------------------------------------------------------------------
def schedule_deletion(account: Account) -> None:
    """Begin account deletion: log out everywhere, revoke Apple, mark pending,
    email the user a cancel-by date. The purge command hard-deletes later."""
    revoke_all_tokens(account)
    _revoke_apple_identities(account)
    PushDevice.objects.filter(account=account, enabled=True).update(
        enabled=False,
        permission_status=PushDevice.PermissionStatus.DENIED,
        updated_at=timezone.now(),
    )
    FriendPubActivity.objects.filter(account=account, active=True).update(
        active=False,
        updated_at=timezone.now(),
    )

    account.status = Account.Status.PENDING_DELETION
    account.deleted_at = timezone.now()
    account.save(update_fields=["status", "deleted_at"])

    email = account.primary_email
    if email:
        cancel_by = (
            account.deleted_at + timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS)
        ).strftime("%-d. %-m. %Y")
        emailer.send_account_deletion_scheduled_email(email, cancel_by=cancel_by)


def cancel_deletion(account: Account) -> None:
    account.status = Account.Status.ACTIVE
    account.deleted_at = None
    account.save(update_fields=["status", "deleted_at"])


def hard_delete(account: Account) -> None:
    """Irreversibly delete the account. Cascades wipe credentials/identities/
    tokens and CASCADE-bound personal data; SET_NULL community data is orphaned.
    Emails a confirmation first (the row is about to vanish)."""
    email = account.primary_email
    _revoke_apple_identities(account, fail_on_error=True)
    if email:
        emailer.send_account_deleted_email(email)
    if account.avatar:
        account.avatar.delete(save=False)
    # Beer photo files live outside the DB, so the CASCADE row delete below
    # would orphan them on the media volume; drop each file first (same reason
    # as the avatar above).
    for photo in account.beer_photos.all():
        if photo.image:
            photo.image.delete(save=False)
    affected_amenities = set(
        PubAmenityVote.objects.filter(account=account).values_list(
            "cache_key", "pub_identity_key", "amenity_key"
        )
    )
    with transaction.atomic():
        account.delete()
        for cache_key, pub_identity_key, amenity_key in affected_amenities:
            _recount_amenity_aggregate(cache_key, pub_identity_key, amenity_key)


def _revoke_apple_identities(account: Account, *, fail_on_error: bool = False) -> None:
    failed_identity_ids: list[int] = []
    for identity in account.identities.filter(provider=AuthIdentity.Provider.APPLE):
        if not identity.apple_refresh_token:
            continue
        try:
            oauth.revoke_apple_token(identity.apple_refresh_token)
        except oauth.OAuthError as exc:
            logger.warning("apple token revoke on deletion failed: %s", exc)
            failed_identity_ids.append(identity.pk)
        else:
            identity.apple_refresh_token = ""
            identity.save(update_fields=["apple_refresh_token"])
    if failed_identity_ids and fail_on_error:
        raise AccountError(
            "Apple token se nepodařilo odvolat. Zkusíme to znovu.",
            code="apple_revoke_failed",
            http_status=502,
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _reactivate_if_pending(account: Account) -> None:
    if account.status == Account.Status.PENDING_DELETION:
        cancel_deletion(account)
        logger.info("account %s reactivated by sign-in within grace window", account.public_id)


def _maybe_set_display_name(account: Account, full_name: str) -> None:
    name = (full_name or "").strip()
    if name and not account.display_name:
        account.display_name = name[:120]
        account.save(update_fields=["display_name"])

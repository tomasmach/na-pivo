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
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit

import requests
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Count, Q
from django.db.models.deletion import CASCADE
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError

from pubs import community_trust, emailer, oauth
from pubs.beer_catalog import BeerCatalogMatchCache, sync_pub_beer_indexes_for_menu
from pubs.beer_photo_deletions import (
    enqueue_account_avatar_file_deletion,
    enqueue_beer_photo_file_deletion,
    enqueue_feedback_attachment_file_deletion,
    schedule_beer_photo_file_deletions,
)
from pubs.enrichment.normalizer import community_hours_to_osm
from pubs.models import (
    Account,
    AccountDeletionOperation,
    AccountIdentityAlias,
    AccountMappedPub,
    AccountMergeOperation,
    AccountPubCompletion,
    AccountUsageStats,
    AmenityXpLedger,
    AuthIdentity,
    AuthToken,
    BeerCheckIn,
    BeerCheckInReaction,
    BeerPhoto,
    BeerPhotoDeletionTombstone,
    BeerPhotoFileDeletion,
    ClientEvent,
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
    ContentReport,
    DrinkLog,
    EmailCredential,
    FeedbackReport,
    Follow,
    FriendActivityReaction,
    FriendActivityResponse,
    FriendBlock,
    FriendInviteCode,
    FriendNotification,
    FriendPubActivity,
    FriendPubActivityRecipient,
    Friendship,
    NightRound,
    OneTimeToken,
    PartyEvening,
    PartyEveningCode,
    PartyEveningDrink,
    PartyEveningMember,
    PartyGame,
    PartyGameAlias,
    PartyGameEvent,
    PhotoContestEntry,
    PhotoContestVote,
    PubAmenity,
    PubAmenityVote,
    PubAmenityVoteTombstone,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubCommunityXpLedger,
    PubContributionLog,
    PubEvent,
    PublishedNight,
    PublishedNightComment,
    PubNameCorrection,
    PubPriceIndex,
    PubRating,
    PubReport,
    PubVisit,
    PushDevice,
    UserAddedPub,
    account_deletion_fingerprint_candidates,
    account_merge_fingerprint,
    account_merge_fingerprint_matches,
    generate_account_token,
    hash_account_token,
)
from pubs.price_index import upsert_pub_price_index

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


class ExternalFeedbackCleanupError(Exception):
    """Remote feedback cleanup (Linear) failed; an account purge must abort.

    Deliberately not an :class:`AccountError`: this is infrastructure cleanup,
    not user-facing validation. Never carries response bodies or credentials.
    """


class AccountPurgeConflictError(Exception):
    """A shared tree changed while the purge acquired its global lock scope."""


_LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"
# Bounded per-call timeout; deletes run sequentially, one request per issue,
# fail-closed — any failure aborts the whole purge with nothing committed.
_LINEAR_GRAPHQL_TIMEOUT_S = 5


def _delete_linear_issue(issue_id: str, api_key: str) -> None:
    """Permanently delete one Linear issue; accept only exact success states."""
    try:
        resp = requests.post(
            _LINEAR_GRAPHQL_URL,
            json={
                "query": (
                    "mutation IssueDelete($id: String!, $permanentlyDelete: Boolean) {"
                    " issueDelete(id: $id, permanentlyDelete: $permanentlyDelete)"
                    " { success } }"
                ),
                "variables": {"id": issue_id, "permanentlyDelete": True},
            },
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            timeout=_LINEAR_GRAPHQL_TIMEOUT_S,
        )
        resp.raise_for_status()
        payload = resp.json()
        data = (payload or {}).get("data") or {}
        if isinstance(data, dict):
            result = data.get("issueDelete")
            if isinstance(result, dict) and result.get("success") is True:
                return
        errors = (payload or {}).get("errors")
        if isinstance(errors, list) and errors and all(
            isinstance(error, dict)
            and error.get("extensions", {}).get("code") == "ENTITY_NOT_FOUND"
            for error in errors
        ):
            # The issue is already gone remotely — idempotent success.
            return
    except Exception as exc:  # noqa: BLE001 — any transport/parse failure aborts
        raise ExternalFeedbackCleanupError("linear issue cleanup failed") from exc
    raise ExternalFeedbackCleanupError("linear issue cleanup rejected")


def _delete_linear_feedback_issues(account: Account) -> None:
    """Delete every Linear issue synced from the account's feedback reports.

    Runs inside the purge transaction BEFORE local report rows are removed, so
    any failure rolls the whole hard delete back. No-op without synced reports;
    never touches the network for unsynced feedback.
    """
    issue_ids = list(
        FeedbackReport.objects.filter(account=account)
        .exclude(linear_issue_id="")
        .values_list("linear_issue_id", flat=True)
        .distinct()
    )
    if not issue_ids:
        return
    api_key = getattr(settings, "LINEAR_API_KEY", "") or ""
    if not api_key:
        raise ExternalFeedbackCleanupError("linear api key missing")
    for issue_id in issue_ids:
        _delete_linear_issue(issue_id, api_key)


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
        logger.warning(
            "social avatar capture failed (ignored; %s)",
            type(exc).__name__,
        )


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
        deletion_epoch=account.deletion_epoch,
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


def _validate_account_merge_operation(
    operation: AccountMergeOperation,
    *,
    source_public_id: uuid.UUID | None,
    target_public_id: uuid.UUID,
) -> None:
    if not account_merge_fingerprint_matches(
        operation.target_account_fingerprint, target_public_id
    ):
        raise AccountError(
            "Tento pokus o přihlášení už patří jinému účtu. Zkus původní přihlášení.",
            code="merge_operation_target_mismatch",
            http_status=409,
        )
    if (
        source_public_id is not None
        and not account_merge_fingerprint_matches(
            operation.source_account_fingerprint, source_public_id
        )
    ):
        raise AccountError(
            "Tento pokus o přihlášení vznikl na jiném účtu.",
            code="merge_operation_source_mismatch",
            http_status=409,
        )


def _party_tree_account_ids_for_merge(account_ids: set[int]) -> set[int]:
    """Return every Account FK in party trees an account merge can rewrite."""

    evening_ids = set(
        PartyEvening.objects.filter(
            Q(host_id__in=account_ids)
            | Q(memberships__account_id__in=account_ids)
        )
        .values_list("pk", flat=True)
        .distinct()
    )
    if not evening_ids:
        return set()

    related_ids = set(
        PartyEvening.objects.filter(pk__in=evening_ids)
        .exclude(host_id__isnull=True)
        .values_list("host_id", flat=True)
    )
    for queryset in (
        PartyEveningMember.objects.filter(evening_id__in=evening_ids),
        PartyEveningDrink.objects.filter(evening_id__in=evening_ids),
        DrinkLog.objects.filter(party_evening_id__in=evening_ids),
        BeerPhoto.objects.filter(party_evening_id__in=evening_ids),
        PubVisit.objects.filter(party_evening_id__in=evening_ids),
    ):
        related_ids.update(queryset.values_list("account_id", flat=True))
    related_ids.update(
        PartyGame.objects.filter(
            evening_id__in=evening_ids,
            started_by_id__isnull=False,
        ).values_list("started_by_id", flat=True)
    )
    for account_id, subject_id in PartyGameEvent.objects.filter(
        game__evening_id__in=evening_ids
    ).values_list("account_id", "subject_id"):
        if account_id is not None:
            related_ids.add(account_id)
        if subject_id is not None:
            related_ids.add(subject_id)
    return related_ids


def _community_tree_account_ids_for_merge(account_ids: set[int]) -> set[int]:
    """Return every Account FK in community trees an account merge can rewrite."""

    event_ids = set(
        CommunityEvent.objects.filter(
            Q(host_id__in=account_ids)
            | Q(memberships__account_id__in=account_ids)
            | Q(teams__created_by_id__in=account_ids)
            | Q(team_memberships__account_id__in=account_ids)
        )
        .values_list("pk", flat=True)
        .distinct()
    )
    if not event_ids:
        return set()

    related_ids = set(
        CommunityEvent.objects.filter(
            pk__in=event_ids,
            host_id__isnull=False,
        ).values_list("host_id", flat=True)
    )
    related_ids.update(
        CommunityEventMembership.objects.filter(
            event_id__in=event_ids
        ).values_list("account_id", flat=True)
    )
    related_ids.update(
        CommunityEventTeam.objects.filter(
            event_id__in=event_ids,
            created_by_id__isnull=False,
        ).values_list("created_by_id", flat=True)
    )
    related_ids.update(
        CommunityEventTeamMembership.objects.filter(
            event_id__in=event_ids
        ).values_list("account_id", flat=True)
    )
    return related_ids


def _shared_tree_account_ids_for_merge(account_ids: set[int]) -> set[int]:
    return _party_tree_account_ids_for_merge(
        account_ids
    ) | _community_tree_account_ids_for_merge(account_ids)


def _direct_counterparty_account_ids_for_purge(account_id: int) -> set[int]:
    """Every other Account FK on a row the final delete can rewrite/remove."""
    counterpart_ids: set[int] = set()
    pair_queries = (
        Friendship.objects.filter(Q(requester_id=account_id) | Q(recipient_id=account_id))
        .values_list("requester_id", "recipient_id"),
        Follow.objects.filter(Q(follower_id=account_id) | Q(target_id=account_id)).values_list(
            "follower_id", "target_id"
        ),
        FriendBlock.objects.filter(Q(blocker_id=account_id) | Q(blocked_id=account_id)).values_list(
            "blocker_id", "blocked_id"
        ),
        FriendNotification.objects.filter(
            Q(recipient_id=account_id) | Q(actor_id=account_id)
        ).values_list("recipient_id", "actor_id"),
        ContentReport.objects.filter(
            Q(reporter_id=account_id) | Q(target_account_id=account_id)
        ).values_list("reporter_id", "target_account_id"),
        PartyGameEvent.objects.filter(
            Q(account_id=account_id) | Q(subject_id=account_id)
        ).values_list("account_id", "subject_id"),
    )
    for rows in pair_queries:
        for left_id, right_id in rows:
            if left_id is not None and left_id != account_id:
                counterpart_ids.add(left_id)
            if right_id is not None and right_id != account_id:
                counterpart_ids.add(right_id)
    return counterpart_ids


def _lock_merge_participants(
    source_account: Account | None,
    target_account: Account,
) -> tuple[Account | None, Account]:
    """Lock merge accounts in one global primary-key order.

    Every credential/social merge calls this before reactivation, operation-row
    binding, or identity locking. Without this boundary one path could hold the
    target and wait for the anonymous source while another held the source and
    waited for the target.
    """

    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("account merge participant locking must be atomic")

    participant_ids = {target_account.pk}
    if source_account is not None:
        participant_ids.add(source_account.pk)
    if source_account is not None and source_account.pk != target_account.pk:
        # Shared-tree writers lock every Account FK in PK order before parent
        # rows. A real cross-account merge must own the same identity set before
        # it locks those trees; an ordinary login/claim must not lock the table.
        participant_ids.update(_shared_tree_account_ids_for_merge(participant_ids))
    locked_accounts = {
        account.pk: account
        for account in Account.objects.select_for_update()
        .filter(pk__in=participant_ids)
        .order_by("pk")
    }
    locked_target = locked_accounts.get(target_account.pk)
    if locked_target is None:
        raise RuntimeError("account merge target disappeared")

    if source_account is None:
        return None, locked_target
    # Keep a stale source object when another transaction already completed its
    # deletion. The operation binder then returns its existing replay result or
    # the merge routine treats the already-finished move as idempotent.
    locked_source = locked_accounts.get(source_account.pk, source_account)
    return locked_source, locked_target


def _bind_account_merge_operation(
    operation_id: uuid.UUID | None,
    *,
    source_account: Account | None,
    target_public_id: uuid.UUID,
) -> Account | None:
    """Atomically bind one client retry capability to one source/target pair."""
    if operation_id is None:
        return source_account
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("account merge operation binding must be atomic")

    operation = (
        AccountMergeOperation.objects.select_for_update()
        .filter(operation_id=operation_id)
        .first()
    )
    if operation is not None:
        _validate_account_merge_operation(
            operation,
            source_public_id=(
                source_account.public_id if source_account is not None else None
            ),
            target_public_id=target_public_id,
        )
        return source_account
    if source_account is None:
        # A brand-new operation must prove the anonymous source with its bearer.
        # A response-loss replay is allowed without it because the committed row
        # above already carries that proof after the source account was deleted.
        raise AccountError(
            "Původní anonymní účet už nejde bezpečně ověřit. Zkus přihlášení znovu.",
            code="merge_operation_source_missing",
            http_status=409,
        )

    # This lock and the later merge live in the same transaction. Credential
    # claim paths lock the same Account row, so a concurrent claim either wins
    # first (and this request fails) or waits until this merge has committed.
    locked_source = (
        Account.objects.select_for_update()
        .filter(pk=source_account.pk, public_id=source_account.public_id)
        .first()
    )
    if locked_source is None:
        raise AccountError(
            "Původní anonymní účet už nejde bezpečně ověřit. Zkus přihlášení znovu.",
            code="merge_operation_source_missing",
            http_status=409,
        )
    if locked_source.is_claimed:
        raise AccountError(
            "Původní účet už byl mezitím přihlášen. Zkus pokračovat s tímto účtem.",
            code="merge_operation_source_claimed",
            http_status=409,
        )
    if locked_source.status != Account.Status.ACTIVE:
        raise AccountError(
            "Původní účet už není aktivní. Dokonči nejdřív obnovu nebo smazání účtu.",
            code="merge_operation_source_inactive",
            http_status=409,
        )

    try:
        # The savepoint keeps the outer auth transaction usable if another
        # request races us on the operation UUID's primary key.
        with transaction.atomic():
            AccountMergeOperation.objects.create(
                operation_id=operation_id,
                source_account_fingerprint=account_merge_fingerprint(
                    locked_source.public_id
                ),
                target_account_fingerprint=account_merge_fingerprint(target_public_id),
            )
    except IntegrityError:
        operation = AccountMergeOperation.objects.select_for_update().get(
            operation_id=operation_id
        )
        _validate_account_merge_operation(
            operation,
            source_public_id=locked_source.public_id,
            target_public_id=target_public_id,
        )
    return locked_source


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
    current_account: Account | None,
    *,
    email: str,
    password: str,
    display_name: str = "",
    verification_link_base: str | None = None,
    merge_operation_id: uuid.UUID | None = None,
) -> tuple[Account, str]:
    """Register email+password, claiming the current anonymous account.

    Returns ``(account, raw_session_token)``. Sends a verification email
    (best-effort).
    """
    norm = normalize_email(email)
    if not norm:
        raise AccountError("Zadej platný e-mail.", code="email_invalid")

    created_credential = False
    with transaction.atomic():
        operation_exists = bool(
            merge_operation_id
            and AccountMergeOperation.objects.filter(
                operation_id=merge_operation_id
            ).exists()
        )
        if operation_exists:
            # The first response may have been lost after the credential and
            # operation committed. Re-prove the same credential and mint a new
            # token instead of treating this idempotent register replay as a
            # duplicate e-mail.
            cred = (
                EmailCredential.objects.select_related("account")
                .filter(email=norm)
                .first()
            )
            if cred is None or not check_password(password, cred.password):
                raise AccountError(
                    "Nesprávný e-mail nebo heslo.",
                    code="invalid_credentials",
                    http_status=401,
                )
            account = cred.account
            current_account, account = _lock_merge_participants(
                current_account,
                account,
            )
        else:
            if current_account is None:
                raise AccountError(
                    "Původní anonymní účet už nejde bezpečně ověřit. Zkus registraci znovu.",
                    code="merge_operation_source_missing",
                    http_status=409,
                )
            current_account, account = _lock_merge_participants(
                current_account,
                current_account,
            )
            if account.has_email_credential:
                raise AccountError(
                    "Účet už má nastavené heslo.",
                    code="already_has_password",
                    http_status=409,
                )
            if EmailCredential.objects.filter(email=norm).exists():
                raise AccountError(
                    "Tento e-mail už používá jiný účet.",
                    code="email_taken",
                    http_status=409,
                )
            validate_password_strength(password, account=account)
            current_account = _bind_account_merge_operation(
                merge_operation_id,
                source_account=current_account,
                target_public_id=account.public_id,
            )
            EmailCredential.objects.create(
                account=account,
                email=norm,
                password=make_password(password),
                email_verified=False,
            )
            created_credential = True
            if display_name and not account.display_name:
                account.display_name = display_name[:120]
                account.save(update_fields=["display_name"])

        if operation_exists:
            current_account = _bind_account_merge_operation(
                merge_operation_id,
                source_account=current_account,
                target_public_id=account.public_id,
            )
        _reactivate_if_pending(account)
        token = issue_token(account, device_label=display_name)

    if created_credential:
        request_email_verification(account, link_base=verification_link_base)
    return account, token


def login_email(
    *,
    email: str,
    password: str,
    current_account: Account | None = None,
    merge_operation_id: uuid.UUID | None = None,
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
        current_account, account = _lock_merge_participants(
            current_account,
            account,
        )
        locked_credential = EmailCredential.objects.select_for_update().get(pk=cred.pk)
        if not check_password(password, locked_credential.password):
            raise generic
        _reactivate_if_pending(account)
        current_account = _bind_account_merge_operation(
            merge_operation_id,
            source_account=current_account,
            target_public_id=account.public_id,
        )
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
        raise AccountError(
            "Přihlášení u poskytovatele se nepodařilo ověřit.",
            code="oauth_failed",
            http_status=401,
        ) from exc
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
        logger.warning(
            "apple auth-code exchange failed (%s)",
            type(exc).__name__,
        )
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
    account_field: str = "account",
) -> None:
    source_filter = {f"{account_field}_id": source.pk}
    target_filter = {f"{account_field}_id": target.pk}
    target_keys = {
        tuple(values)
        for values in model.objects.filter(**target_filter).values_list(*unique_fields)
    }
    for row in model.objects.filter(**source_filter).order_by("pk"):
        row_key = tuple(getattr(row, field) for field in unique_fields)
        if row_key in target_keys:
            row.delete()
            continue
        setattr(row, account_field, target)
        row.save(update_fields=[account_field])
        target_keys.add(row_key)


def _move_parent_rows(
    model,
    *,
    parent_field: str,
    source_parent,
    target_parent,
    unique_fields: tuple[str, ...],
) -> None:
    """Move child rows to a retained duplicate parent without losing children."""
    target_keys = {
        tuple(values)
        for values in model.objects.filter(**{f"{parent_field}_id": target_parent.pk}).values_list(
            *unique_fields
        )
    }
    for row in model.objects.filter(**{f"{parent_field}_id": source_parent.pk}).order_by("pk"):
        row_key = tuple(getattr(row, field) for field in unique_fields)
        if row_key in target_keys:
            row.delete()
            continue
        setattr(row, parent_field, target_parent)
        row.save(update_fields=[parent_field])
        target_keys.add(row_key)


def _replace_published_night_reference(
    field_name: str,
    *,
    old_public_id,
    new_public_id,
    account_ids: set[int] | None,
) -> None:
    """Keep consent-filtered story references valid after parent deduplication."""
    old_value = str(old_public_id)
    new_value = str(new_public_id)
    nights = PublishedNight.objects.all()
    if account_ids is not None:
        nights = nights.filter(account_id__in=account_ids)
    for night in nights.only("pk", field_name):
        values = getattr(night, field_name) or []
        if old_value not in values:
            continue
        setattr(
            night,
            field_name,
            list(dict.fromkeys(new_value if value == old_value else value for value in values)),
        )
        night.save(update_fields=[field_name])


def _replace_exact_json_value(value, *, old_value: str, new_value: str):
    """Recursively rekey exact UUID values without interpreting game payloads."""
    if isinstance(value, dict):
        return {
            key: _replace_exact_json_value(
                nested_value,
                old_value=old_value,
                new_value=new_value,
            )
            for key, nested_value in value.items()
        }
    if isinstance(value, list):
        return [
            _replace_exact_json_value(
                nested_value,
                old_value=old_value,
                new_value=new_value,
            )
            for nested_value in value
        ]
    return new_value if value == old_value else value


def _replace_party_game_roster_reference(
    *,
    old_public_id,
    new_public_id,
    source_account: Account,
    target_account: Account,
) -> None:
    """Keep frozen game entrants valid when an anonymous account is claimed."""
    old_value = str(old_public_id)
    new_value = str(new_public_id)
    affected_game_ids = set(
        PartyGame.objects.filter(started_by=source_account).values_list("pk", flat=True)
    )
    affected_game_ids.update(
        PartyGameEvent.objects.filter(
            Q(account=source_account) | Q(subject=source_account)
        ).values_list("game_id", flat=True)
    )
    for game in PartyGame.objects.exclude(roster_account_ids=[]).only("pk", "roster_account_ids"):
        values = game.roster_account_ids or []
        if old_value in values:
            affected_game_ids.add(game.pk)

    for game in PartyGame.objects.filter(pk__in=affected_game_ids).order_by("pk"):
        touched = False
        values = game.roster_account_ids or []
        if old_value in values:
            game.roster_account_ids = list(
                dict.fromkeys(new_value if value == old_value else value for value in values)
            )
            game.save(update_fields=["roster_account_ids"])
            touched = True
        # Existing opaque events can carry player UUIDs at arbitrary nesting
        # depths. Rekey exact values alongside the frozen roster so a cold-start
        # client can still fold picks, rolls and finishes after account claim.
        for event in PartyGameEvent.objects.filter(game=game).exclude(payload={}):
            payload = _replace_exact_json_value(
                event.payload,
                old_value=old_value,
                new_value=new_value,
            )
            if payload != event.payload:
                event.payload = payload
                event.save(update_fields=["payload"])
                touched = True
        if not touched:
            continue
        # A START envelope means "refetch this game row" to every connected
        # phone. It replaces a stale frozen roster before the next queued score
        # arrives, and is deterministic across a replayed merge.
        PartyGameEvent.objects.get_or_create(
            game=game,
            client_id=uuid.uuid5(
                game.client_id,
                f"na-pivo-party-game-account-rekey:{old_value}",
            ),
            defaults={
                "account": target_account,
                "kind": PartyGameEvent.Kind.START,
            },
        )


def _merge_party_game(
    source_game: PartyGame,
    target_game: PartyGame,
    *,
    synthetic_ended_game_ids: set[int],
) -> None:
    """Fold a duplicate into the canonical game without changing its lobby.

    Callers pass the later/discarded row as ``source_game`` and the first row
    as ``target_game``. A lobby is a frozen gameplay input, not profile data to
    union during an account merge: adding the later row's entrants would make
    an already-running quiz change teams after login.
    """
    real_ended_at = max(
        (
            game.ended_at
            for game in (source_game, target_game)
            if game.pk not in synthetic_ended_game_ids and game.ended_at is not None
        ),
        default=None,
    )
    _move_parent_rows(
        PartyGameEvent,
        parent_field="game",
        source_parent=source_game,
        target_parent=target_game,
        unique_fields=("client_id",),
    )
    if source_game.payloads_redacted and not target_game.payloads_redacted:
        target_game.payloads_redacted = True
        target_game.save(update_fields=["payloads_redacted"])
    if target_game.payloads_redacted:
        # Redaction is monotonic across duplicate offline games. Rows just moved
        # from the source must not resurrect opaque data on the retained alias.
        PartyGameEvent.objects.filter(game=target_game).update(payload={})
    _replace_published_night_reference(
        "game_ids",
        old_public_id=source_game.public_id,
        new_public_id=target_game.public_id,
        account_ids=None,
    )
    PartyGameAlias.objects.filter(game=source_game).update(game=target_game)
    PartyGameAlias.objects.update_or_create(
        public_id=source_game.public_id,
        defaults={"game": target_game},
    )
    # A connected phone can still cache the retired server UUID. Publish a new
    # cursor so its next catch-up receives the canonical row and can rekey the
    # local snapshot before any later canonical events arrive.
    PartyGameEvent.objects.get_or_create(
        game=target_game,
        client_id=uuid.uuid5(
            source_game.client_id,
            f"na-pivo-party-game-alias:{source_game.public_id}",
        ),
        defaults={
            "account_id": target_game.evening.host_id,
            "kind": PartyGameEvent.Kind.START,
        },
    )
    source_game.delete()
    # A real finish is monotonic across offline duplicates. The only ended_at
    # we may clear is the temporary one added below to satisfy the one-active-
    # game constraint while two still-active copies collapse into one row.
    merged_ended_at = real_ended_at
    if target_game.ended_at != merged_ended_at:
        target_game.ended_at = merged_ended_at
        target_game.save(update_fields=["ended_at"])


def _merge_party_member_row(source_row: PartyEveningMember, target_row: PartyEveningMember) -> None:
    """Combine duplicate membership state by its latest join/leave transition."""
    update_fields: list[str] = []
    source_state_at = (
        source_row.left_at
        if not source_row.active and source_row.left_at is not None
        else source_row.joined_at
    )
    target_state_at = (
        target_row.left_at
        if not target_row.active and target_row.left_at is not None
        else target_row.joined_at
    )
    source_state_wins = source_state_at > target_state_at or (
        source_state_at == target_state_at
        and not source_row.active
        and target_row.active
    )
    if source_state_wins:
        if source_row.active != target_row.active:
            target_row.active = source_row.active
            update_fields.append("active")
        target_row.left_at = None if source_row.active else source_state_at
        update_fields.append("left_at")
        if source_row.active:
            # joined_at is the ACTIVE transition timestamp: every rejoin path
            # resets it. Keeping an older first-join time would let a later
            # merge resurrect an older leave over this newer rejoin.
            target_row.joined_at = source_state_at
            update_fields.append("joined_at")
    elif (
        not source_row.active
        and not target_row.active
        and source_row.left_at
        and (target_row.left_at is None or source_row.left_at > target_row.left_at)
    ):
        target_row.left_at = source_row.left_at
        update_fields.append("left_at")
    if not target_row.active and source_row.joined_at < target_row.joined_at:
        # Once inactive, left_at carries the current state transition, so the
        # original join is safe to retain for historical ordering.
        target_row.joined_at = source_row.joined_at
        update_fields.append("joined_at")
    if update_fields:
        target_row.save(update_fields=list(dict.fromkeys(update_fields)))
    source_row.delete()


def _lock_party_evenings_for_accounts(*account_ids: int) -> list[PartyEvening]:
    """Lock every party tree touched by an account lifecycle transition.

    Callers already hold the Account rows. Resolving the complete evening-id
    set first is safe because party mutations take the participant Account lock
    before touching an evening. The second query acquires every Evening lock in
    one deterministic primary-key order.
    """

    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("party evening locking must run inside transaction.atomic()")
    ids = set(
        PartyEvening.objects.filter(host_id__in=account_ids).values_list("pk", flat=True)
    )
    ids.update(
        PartyEveningMember.objects.filter(account_id__in=account_ids).values_list(
            "evening_id", flat=True
        )
    )
    return list(
        PartyEvening.objects.select_for_update(of=("self",))
        .filter(pk__in=ids)
        .order_by("pk")
    )


def _resolve_active_party_memberships_after_merge(source: Account, target: Account) -> None:
    """Leave the claimed account on one active table after an anonymous merge."""

    memberships = list(
        PartyEveningMember.objects.select_for_update(of=("self",))
        .select_related("evening")
        .filter(
            account_id__in=(source.pk, target.pk),
            active=True,
            evening__active=True,
        )
        .order_by("pk")
    )
    source_memberships = [row for row in memberships if row.account_id == source.pk]
    candidates = source_memberships or [
        row for row in memberships if row.account_id == target.pk
    ]
    canonical = (
        max(
            candidates,
            key=lambda row: (
                row.evening.started_at,
                row.evening_id,
                row.joined_at,
                row.pk,
            ),
        )
        if candidates
        else None
    )
    canonical_evening_id = canonical.evening_id if canonical is not None else None
    if canonical_evening_id is None:
        newest_hosted = (
            PartyEvening.objects.filter(host=target, active=True)
            .order_by("-started_at", "-pk")
            .first()
        )
        canonical_evening_id = newest_hosted.pk if newest_hosted is not None else None

    now = timezone.now()
    for membership in memberships:
        if membership.pk == getattr(canonical, "pk", None):
            continue
        membership.active = False
        membership.left_at = now
        membership.save(update_fields=["active", "left_at"])

    for evening in PartyEvening.objects.filter(host=target, active=True).order_by("pk"):
        if evening.pk == canonical_evening_id:
            continue
        evening.active = False
        evening.ended_at = now
        evening.save(update_fields=["active", "ended_at", "updated_at"])


def _finish_superseded_games_before_evening_merge(
    source_evening: PartyEvening,
    target_evening: PartyEvening,
) -> set[int]:
    """Make two copies of one evening satisfy the single-active-game invariant."""
    synthetic_ended_game_ids: set[int] = set()
    active_games = list(
        PartyGame.objects.select_for_update(of=("self",))
        .filter(
            evening_id__in=(source_evening.pk, target_evening.pk),
            ended_at__isnull=True,
        )
        .select_related("started_by")
        .order_by("-started_at", "-pk")
    )
    if len(active_games) < 2:
        return synthetic_ended_game_ids
    canonical = active_games[0]
    for superseded in active_games[1:]:
        superseded.ended_at = canonical.started_at
        superseded.save(update_fields=["ended_at"])
        if (
            superseded.catalog_key == canonical.catalog_key
            or superseded.client_id == canonical.client_id
        ):
            # The rows collapse into one logical game below. Publishing an
            # intermediate finish would leave that retained game with a finish
            # event even though the later copy keeps it active.
            synthetic_ended_game_ids.add(superseded.pk)
            continue
        PartyGameEvent.objects.get_or_create(
            game=superseded,
            client_id=uuid.uuid5(
                superseded.client_id,
                "na-pivo-party-game-superseded",
            ),
            defaults={
                # This is merge bookkeeping, not the superseded game's
                # starter action. Attribute it to the retained evening's host:
                # the merge already holds that Account lock, so the FK cannot
                # deadlock with a third participant. Keeping a non-null author
                # also preserves the privacy meaning of account=NULL, which is
                # reserved for events whose real author was purged.
                "account_id": target_evening.host_id,
                "kind": PartyGameEvent.Kind.FINISH,
                "created_at": canonical.started_at,
            },
        )
    return synthetic_ended_game_ids


def _merge_party_evening_tree(source_evening: PartyEvening, target_evening: PartyEvening) -> None:
    target_members = {
        row.account_id: row for row in PartyEveningMember.objects.filter(evening=target_evening)
    }
    for row in PartyEveningMember.objects.filter(evening=source_evening).order_by("pk"):
        conflict = target_members.get(row.account_id)
        if conflict is not None:
            _merge_party_member_row(row, conflict)
            continue
        row.evening = target_evening
        row.save(update_fields=["evening"])
        target_members[row.account_id] = row

    # Drink idempotency is account-wide, so a matching row may already belong
    # to any retained evening. Such a row is the same offline write.
    for row in PartyEveningDrink.objects.filter(evening=source_evening).order_by("pk"):
        if (
            PartyEveningDrink.objects.filter(account_id=row.account_id, client_id=row.client_id)
            .exclude(pk=row.pk)
            .exists()
        ):
            row.delete()
            continue
        row.evening = target_evening
        row.save(update_fields=["evening"])

    synthetic_ended_game_ids = _finish_superseded_games_before_evening_merge(
        source_evening,
        target_evening,
    )
    target_games_by_catalog = {
        row.catalog_key: row
        for row in PartyGame.objects.filter(evening=target_evening).order_by("started_at", "pk")
    }
    target_games_by_client = {
        row.client_id: row for row in target_games_by_catalog.values()
    }
    for game in PartyGame.objects.filter(evening=source_evening).order_by("started_at", "pk"):
        # Catalogue identity is canonical for the table. Keep the client-id
        # lookup as a compatibility guard for a released retry that changed its
        # payload while reusing the same UUID.
        conflict = target_games_by_catalog.get(game.catalog_key)
        if conflict is None:
            conflict = target_games_by_client.get(game.client_id)
        if conflict is not None:
            if (conflict.started_at, conflict.pk) <= (game.started_at, game.pk):
                _merge_party_game(
                    game,
                    conflict,
                    synthetic_ended_game_ids=synthetic_ended_game_ids,
                )
                target_games_by_catalog[conflict.catalog_key] = conflict
                target_games_by_client[conflict.client_id] = conflict
                continue

            # The source evening can contain the genuinely first start. Delete
            # the later retained-evening row before moving it, satisfying both
            # unique constraints while preserving the first frozen roster.
            target_games_by_catalog.pop(conflict.catalog_key, None)
            target_games_by_client.pop(conflict.client_id, None)
            _merge_party_game(
                conflict,
                game,
                synthetic_ended_game_ids=synthetic_ended_game_ids,
            )
            game.evening = target_evening
            game.save(update_fields=["evening"])
            target_games_by_catalog[game.catalog_key] = game
            target_games_by_client[game.client_id] = game
            continue
        game.evening = target_evening
        game.save(update_fields=["evening"])
        target_games_by_catalog[game.catalog_key] = game
        target_games_by_client[game.client_id] = game

    DrinkLog.objects.filter(party_evening=source_evening).update(party_evening=target_evening)
    BeerPhoto.objects.filter(party_evening=source_evening).update(party_evening=target_evening)
    PubVisit.objects.filter(party_evening=source_evening).update(party_evening=target_evening)
    # Ending is monotonic. If either offline copy was ended before login merged
    # them, the canonical table must not spring back to life.
    if not source_evening.active:
        ended_at = max(
            filter(None, (source_evening.ended_at, target_evening.ended_at)),
            default=timezone.now(),
        )
        target_evening.active = False
        target_evening.ended_at = ended_at
        target_evening.save(update_fields=["active", "ended_at", "updated_at"])

    # Every retired code remains a stable forward pointer. Phones can carry a
    # durable leave/end write or a link for either offline copy long after this
    # transaction deletes the duplicate parent.
    PartyEveningCode.objects.filter(evening=source_evening).update(
        evening=target_evening
    )
    PartyEveningCode.objects.update_or_create(
        join_code=source_evening.join_code,
        defaults={"evening": target_evening},
    )
    source_evening.delete()


def _merge_party_evenings(source: Account, target: Account) -> None:
    target_by_client = {row.client_id: row for row in PartyEvening.objects.filter(host=target)}
    for evening in PartyEvening.objects.filter(host=source).order_by("pk"):
        conflict = target_by_client.get(evening.client_id)
        if conflict is not None:
            _merge_party_evening_tree(evening, conflict)
            continue
        evening.host = target
        evening.save(update_fields=["host"])
        target_by_client[evening.client_id] = evening


def _merge_beer_checkin_tree(source_checkin: BeerCheckIn, target_checkin: BeerCheckIn) -> None:
    _move_parent_rows(
        BeerCheckInReaction,
        parent_field="checkin",
        source_parent=source_checkin,
        target_parent=target_checkin,
        unique_fields=("account_id",),
    )
    source_checkin.delete()


def _merge_beer_checkins(source: Account, target: Account) -> None:
    target_by_client = {row.client_id: row for row in BeerCheckIn.objects.filter(account=target)}
    for checkin in BeerCheckIn.objects.filter(account=source).order_by("pk"):
        conflict = target_by_client.get(checkin.client_id)
        if conflict is not None:
            _merge_beer_checkin_tree(checkin, conflict)
            continue
        checkin.account = target
        checkin.save(update_fields=["account"])
        target_by_client[checkin.client_id] = checkin


def _merge_published_night_tree(source_night: PublishedNight, target_night: PublishedNight) -> None:
    _move_parent_rows(
        NightRound,
        parent_field="night",
        source_parent=source_night,
        target_parent=target_night,
        unique_fields=("account_id",),
    )
    PublishedNightComment.objects.filter(night=source_night).update(night=target_night)
    source_night.delete()


def _merge_published_nights(source: Account, target: Account) -> None:
    """Move nights while respecting both released and 3.0 identities.

    A published night is unique by drinking day in 3.0, but older clients still
    address deletes and retries by ``client_id``. A collision on either key
    keeps the claimed account's existing row, matching the merge policy used by
    the other diary tables.
    """

    target_rows = list(PublishedNight.objects.filter(account=target))
    target_by_client_id = {
        client_id: night
        for night in target_rows
        for client_id in [night.client_id, *(night.client_aliases or [])]
    }
    target_by_day = {night.drinking_day: night for night in target_rows}
    for row in PublishedNight.objects.filter(account=source).order_by("pk"):
        row_ids = set([row.client_id, *(row.client_aliases or [])])
        conflict = target_by_day.get(row.drinking_day)
        if conflict is None:
            conflict = next(
                (
                    target_by_client_id[row_id]
                    for row_id in row_ids
                    if row_id in target_by_client_id
                ),
                None,
            )
        if conflict is not None:
            conflict.client_aliases = list(
                dict.fromkeys([conflict.client_id, *(conflict.client_aliases or []), *row_ids])
            )
            update_fields = ["client_aliases"]
            # A FRIENDS retry must never enrich an existing PUBLIC post. Equal-
            # visibility copies may safely combine their already consent-gated
            # non-location story references, bounded by the API's normal caps.
            if conflict.visibility == row.visibility:
                for field_name, limit in (
                    ("participant_ids", 8),
                    ("photo_ids", 6),
                    ("game_ids", 3),
                ):
                    combined = list(
                        dict.fromkeys(
                            [
                                *(getattr(conflict, field_name) or []),
                                *(getattr(row, field_name) or []),
                            ]
                        )
                    )[:limit]
                    if combined != (getattr(conflict, field_name) or []):
                        setattr(conflict, field_name, combined)
                        update_fields.append(field_name)
            conflict.save(update_fields=update_fields)
            for row_id in row_ids:
                target_by_client_id[row_id] = conflict
            _merge_published_night_tree(row, conflict)
            continue
        row.account = target
        row.save(update_fields=["account"])
        for row_id in row_ids:
            target_by_client_id[row_id] = row
        target_by_day[row.drinking_day] = row


def _merge_contest_entry_tree(
    source_entry: PhotoContestEntry, target_entry: PhotoContestEntry
) -> None:
    target_voters = set(
        PhotoContestVote.objects.filter(contest=target_entry.contest)
        .exclude(entry=source_entry)
        .values_list("voter_id", flat=True)
    )
    for vote in PhotoContestVote.objects.filter(entry=source_entry).order_by("pk"):
        if vote.voter_id in target_voters:
            vote.delete()
            continue
        vote.entry = target_entry
        vote.save(update_fields=["entry"])
        target_voters.add(vote.voter_id)
    source_entry.delete()


def _merge_beer_photo_tree(
    source_photo: BeerPhoto,
    target_photo: BeerPhoto,
    *,
    cleanup_account: Account,
    cleanup_ids: list[int],
) -> None:
    update_fields: list[str] = []
    if source_photo.visibility == target_photo.visibility:
        for field_name in (
            "party_evening",
            "caption",
            "pub_cache_key",
            "pub_name",
            "pub_city",
        ):
            if not getattr(target_photo, field_name) and getattr(source_photo, field_name):
                setattr(target_photo, field_name, getattr(source_photo, field_name))
                update_fields.append(field_name)
    if update_fields:
        target_photo.save(update_fields=update_fields)

    target_entries = {
        row.contest_id: row for row in PhotoContestEntry.objects.filter(photo=target_photo)
    }
    for entry in PhotoContestEntry.objects.filter(photo=source_photo).order_by("pk"):
        conflict = target_entries.get(entry.contest_id)
        if conflict is not None:
            _merge_contest_entry_tree(entry, conflict)
            continue
        entry.photo = target_photo
        entry.save(update_fields=["photo"])
        target_entries[entry.contest_id] = entry
    # Never turn a reference to a PRIVATE source into a visible FRIENDS photo.
    if not (
        source_photo.visibility == BeerPhoto.Visibility.PRIVATE
        and target_photo.visibility == BeerPhoto.Visibility.FRIENDS
    ):
        _replace_published_night_reference(
            "photo_ids",
            old_public_id=source_photo.public_id,
            new_public_id=target_photo.public_id,
            account_ids={source_photo.account_id, target_photo.account_id},
        )
    cleanup_id = enqueue_beer_photo_file_deletion(
        source_photo,
        account=cleanup_account,
    )
    if cleanup_id is not None:
        cleanup_ids.append(cleanup_id)
    source_photo.delete()


def _merge_beer_photos(source: Account, target: Account) -> None:
    # A deletion marker always beats either account's live duplicate. This is
    # the same no-resurrection rule as the upload/delete race, applied while an
    # anonymous account is folded into a claimed one.
    # Preserve and immediately retry any cleanup that was already pending for
    # the anonymous account. SET_NULL would keep it durable during source
    # deletion, but moving it lets DELETE-by-client remain retryable under the
    # newly authenticated target account too.
    cleanup_ids = list(
        BeerPhotoFileDeletion.objects.filter(account=source).values_list("pk", flat=True)
    )
    BeerPhotoFileDeletion.objects.filter(pk__in=cleanup_ids).update(account=target)
    tombstoned_client_ids = set(
        BeerPhotoDeletionTombstone.objects.filter(account=target).values_list(
            "client_id", flat=True
        )
    )
    for photo in BeerPhoto.objects.filter(
        account__in=(source, target),
        client_id__in=tombstoned_client_ids,
    ):
        cleanup_id = enqueue_beer_photo_file_deletion(photo, account=target)
        if cleanup_id is not None:
            cleanup_ids.append(cleanup_id)
        photo.delete()

    target_by_client = {row.client_id: row for row in BeerPhoto.objects.filter(account=target)}
    for photo in BeerPhoto.objects.filter(account=source).order_by("pk"):
        conflict = target_by_client.get(photo.client_id)
        if conflict is not None:
            _merge_beer_photo_tree(
                photo,
                conflict,
                cleanup_account=target,
                cleanup_ids=cleanup_ids,
            )
            continue
        photo.account = target
        photo.save(update_fields=["account"])
        target_by_client[photo.client_id] = photo
    schedule_beer_photo_file_deletions(cleanup_ids)


def _recount_amenity_aggregate(cache_key: str, pub_identity_key: str, amenity_key: str) -> None:
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


def _merge_friend_activity_tree(
    source_activity: FriendPubActivity, target_activity: FriendPubActivity
) -> None:
    for model in (
        FriendPubActivityRecipient,
        FriendActivityResponse,
        FriendActivityReaction,
    ):
        _move_parent_rows(
            model,
            parent_field="activity",
            source_parent=source_activity,
            target_parent=target_activity,
            unique_fields=("account_id",),
        )
    FriendNotification.objects.filter(activity=source_activity).update(activity=target_activity)
    source_activity.delete()


def _merge_friend_activities(source: Account, target: Account) -> None:
    target_by_client = {
        row.client_id: row for row in FriendPubActivity.objects.filter(account=target)
    }
    for activity in FriendPubActivity.objects.filter(account=source).order_by("pk"):
        conflict = target_by_client.get(activity.client_id)
        if conflict is not None:
            _merge_friend_activity_tree(activity, conflict)
            continue
        activity.account = target
        activity.save(update_fields=["account"])
        target_by_client[activity.client_id] = activity


def _merge_friendship_status(source_row: Friendship, target_row: Friendship) -> None:
    status_rank = {
        Friendship.Status.DECLINED: 0,
        Friendship.Status.PENDING: 1,
        Friendship.Status.ACCEPTED: 2,
    }
    update_fields: list[str] = []
    if status_rank[source_row.status] > status_rank[target_row.status]:
        target_row.status = source_row.status
        target_row.responded_at = source_row.responded_at
        update_fields.extend(["status", "responded_at"])
    elif source_row.responded_at and (
        target_row.responded_at is None or source_row.responded_at > target_row.responded_at
    ):
        target_row.responded_at = source_row.responded_at
        update_fields.append("responded_at")
    if update_fields:
        target_row.save(update_fields=update_fields)
    FriendNotification.objects.filter(friendship=source_row).update(friendship=target_row)
    source_row.delete()


def _merge_friendships(source: Account, target: Account) -> None:
    self_rows = Friendship.objects.filter(
        Q(requester=source, recipient=target) | Q(requester=target, recipient=source)
    )
    FriendNotification.objects.filter(friendship__in=self_rows).update(friendship=None)
    self_rows.delete()
    for account_field, other_field in (
        ("requester", "recipient"),
        ("recipient", "requester"),
    ):
        for row in Friendship.objects.filter(**{f"{account_field}_id": source.pk}).order_by("pk"):
            other_id = getattr(row, f"{other_field}_id")
            conflict = Friendship.objects.filter(
                **{
                    f"{account_field}_id": target.pk,
                    f"{other_field}_id": other_id,
                }
            ).first()
            if conflict is not None:
                _merge_friendship_status(row, conflict)
                continue
            setattr(row, account_field, target)
            row.save(update_fields=[account_field])


def _merge_follows(source: Account, target: Account) -> None:
    Follow.objects.filter(
        Q(follower=source, target=target) | Q(follower=target, target=source)
    ).delete()
    for account_field, other_field in (
        ("follower", "target"),
        ("target", "follower"),
    ):
        for row in Follow.objects.filter(**{f"{account_field}_id": source.pk}).order_by("pk"):
            other_id = getattr(row, f"{other_field}_id")
            if Follow.objects.filter(
                **{
                    f"{account_field}_id": target.pk,
                    f"{other_field}_id": other_id,
                }
            ).exists():
                row.delete()
                continue
            setattr(row, account_field, target)
            row.save(update_fields=[account_field])

    Follow.objects.filter(Q(follower=target) | Q(target=target)).exclude(
        target__status=Account.Status.ACTIVE,
        target__is_public=True,
    ).delete()


def _merge_friend_blocks(source: Account, target: Account) -> None:
    FriendBlock.objects.filter(
        Q(blocker=source, blocked=target) | Q(blocker=target, blocked=source)
    ).delete()
    for account_field, other_field in (
        ("blocker", "blocked"),
        ("blocked", "blocker"),
    ):
        for row in FriendBlock.objects.filter(**{f"{account_field}_id": source.pk}).order_by("pk"):
            other_id = getattr(row, f"{other_field}_id")
            if FriendBlock.objects.filter(
                **{
                    f"{account_field}_id": target.pk,
                    f"{other_field}_id": other_id,
                }
            ).exists():
                row.delete()
                continue
            setattr(row, account_field, target)
            row.save(update_fields=[account_field])

    blocked_ids = {
        blocked_id if blocker_id == target.pk else blocker_id
        for blocker_id, blocked_id in FriendBlock.objects.filter(
            Q(blocker=target) | Q(blocked=target)
        ).values_list("blocker_id", "blocked_id")
    }
    Follow.objects.filter(
        Q(follower=target, target_id__in=blocked_ids)
        | Q(target=target, follower_id__in=blocked_ids)
    ).delete()


_COMMUNITY_MEMBERSHIP_STATUS_RANK = {
    CommunityEventMembership.Status.LEFT: 0,
    CommunityEventMembership.Status.CANCELLED: 0,
    CommunityEventMembership.Status.REJECTED: 1,
    CommunityEventMembership.Status.PENDING: 2,
    CommunityEventMembership.Status.APPROVED: 3,
}


def _merge_community_membership_row(
    source_row: CommunityEventMembership,
    target_row: CommunityEventMembership,
) -> None:
    update_fields: list[str] = []
    if (
        _COMMUNITY_MEMBERSHIP_STATUS_RANK[source_row.status]
        > _COMMUNITY_MEMBERSHIP_STATUS_RANK[target_row.status]
    ):
        target_row.status = source_row.status
        target_row.message = source_row.message
        target_row.decided_at = source_row.decided_at
        update_fields.extend(["status", "message", "decided_at"])
    if source_row.requested_at < target_row.requested_at:
        target_row.requested_at = source_row.requested_at
        update_fields.append("requested_at")
    if update_fields:
        target_row.save(update_fields=update_fields)
    source_row.delete()


def _move_community_team_memberships(
    source_team: CommunityEventTeam,
    target_team: CommunityEventTeam,
    target_event: CommunityEvent,
) -> None:
    for row in CommunityEventTeamMembership.objects.filter(team=source_team).order_by("pk"):
        if CommunityEventTeamMembership.objects.filter(
            event=target_event, account_id=row.account_id
        ).exists():
            row.delete()
            continue
        used_slots = set(
            CommunityEventTeamMembership.objects.filter(team=target_team).values_list(
                "slot", flat=True
            )
        )
        available_slot = next((slot for slot in range(1, 5) if slot not in used_slots), None)
        if available_slot is None:
            raise RuntimeError("community team merge would discard a participant")
        row.event = target_event
        row.team = target_team
        row.slot = available_slot
        row.save(update_fields=["event", "team", "slot"])


def _merge_community_event_tree(source_event: CommunityEvent, target_event: CommunityEvent) -> None:
    target_members = {
        row.account_id: row for row in CommunityEventMembership.objects.filter(event=target_event)
    }
    for row in CommunityEventMembership.objects.filter(event=source_event).order_by("pk"):
        conflict = target_members.get(row.account_id)
        if conflict is not None:
            _merge_community_membership_row(row, conflict)
            continue
        row.event = target_event
        row.save(update_fields=["event"])
        target_members[row.account_id] = row

    target_teams = {
        row.client_id: row for row in CommunityEventTeam.objects.filter(event=target_event)
    }
    for team in CommunityEventTeam.objects.filter(event=source_event).order_by("pk"):
        conflict = target_teams.get(team.client_id)
        if conflict is not None:
            _move_community_team_memberships(team, conflict, target_event)
            team.delete()
            continue
        for membership in CommunityEventTeamMembership.objects.filter(team=team).order_by("pk"):
            if CommunityEventTeamMembership.objects.filter(
                event=target_event, account_id=membership.account_id
            ).exists():
                membership.delete()
                continue
            membership.event = target_event
            membership.save(update_fields=["event"])
        team.event = target_event
        team.save(update_fields=["event"])
        target_teams[team.client_id] = team
    source_event.delete()


def _merge_community_events(source: Account, target: Account) -> None:
    target_by_client = {row.client_id: row for row in CommunityEvent.objects.filter(host=target)}
    for event in CommunityEvent.objects.filter(host=source).order_by("pk"):
        conflict = target_by_client.get(event.client_id)
        if conflict is not None:
            _merge_community_event_tree(event, conflict)
            continue
        event.host = target
        event.save(update_fields=["host"])
        target_by_client[event.client_id] = event


def _merge_photo_contest_entries(source: Account, target: Account) -> None:
    target_by_contest = {
        row.contest_id: row for row in PhotoContestEntry.objects.filter(account=target)
    }
    for entry in PhotoContestEntry.objects.filter(account=source).order_by("pk"):
        conflict = target_by_contest.get(entry.contest_id)
        if conflict is not None:
            _merge_contest_entry_tree(entry, conflict)
            continue
        entry.account = target
        entry.save(update_fields=["account"])
        target_by_contest[entry.contest_id] = entry


def _assert_no_cascade_rows_for_source(source: Account) -> None:
    """Fail closed when a new Account-owned model is omitted from merge logic."""
    remaining: list[str] = []
    for relation in Account._meta.related_objects:
        field = relation.field
        if field.remote_field.on_delete is not CASCADE:
            continue
        model = relation.related_model
        if model.objects.filter(**{f"{field.name}_id": source.pk}).exists():
            remaining.append(f"{model._meta.label}.{field.name}")
    if remaining:
        raise RuntimeError(
            "anonymous account merge left owned rows: " + ", ".join(sorted(remaining))
        )


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

    if source is None or source.pk == target.pk:
        return

    # First own the two identities themselves. The optimistic outer discovery
    # normally already locked the whole shared tree in PK order. A party join
    # can still commit one new related account in the narrow gap before these
    # locks, though; any newly discovered row is therefore acquired NOWAIT
    # below. Waiting for a lower-PK participant while already holding source
    # would form a cycle with that join writer.
    participant_ids = {source.pk, target.pk}
    locked_accounts = {
        account.pk: account
        for account in Account.objects.select_for_update()
        .filter(pk__in=participant_ids)
        .order_by("pk")
    }
    if target.pk not in locked_accounts:
        raise RuntimeError("account merge target disappeared")
    if source.pk not in locked_accounts:
        # Another concurrent login already completed this exact merge.
        return
    shared_account_ids = _shared_tree_account_ids_for_merge(participant_ids)
    missing_account_ids = shared_account_ids - set(locked_accounts)
    if missing_account_ids:
        try:
            # A savepoint restores the transaction after PostgreSQL reports a
            # NOWAIT lock conflict, allowing AccountError to become a clean 409
            # instead of a deadlock/500.
            with transaction.atomic():
                newly_locked = {
                    account.pk: account
                    for account in Account.objects.select_for_update(nowait=True)
                    .filter(pk__in=missing_account_ids)
                    .order_by("pk")
                }
        except DatabaseError as exc:
            raise AccountError(
                "Účet se mezitím změnil. Zkus přihlášení znovu.",
                code="auth",
                http_status=409,
            ) from exc
        if set(newly_locked) != missing_account_ids:
            raise AccountError(
                "Účet se mezitím změnil. Zkus přihlášení znovu.",
                code="auth",
                http_status=409,
            )
        locked_accounts.update(newly_locked)
    source = locked_accounts[source.pk]
    target = locked_accounts[target.pk]
    if source.is_claimed:
        return
    # Trust is earned only through claim proofs, so an UNCLAIMED source must
    # never carry a stamp. If one somehow does (restored row, corruption),
    # refuse the whole merge before any data moves; the surrounding auth
    # transaction rolls everything back.
    if source.quorum_trusted_at is not None:
        raise AccountError(
            "Původní účet nejde bezpečně sloučit. Zkus přihlášení znovu.",
            code="merge_source_suspicious_trust",
            http_status=409,
        )

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
    AccountIdentityAlias.objects.filter(account=source).update(account=target)
    AccountIdentityAlias.objects.update_or_create(
        public_id=source.public_id,
        defaults={"account": target},
    )

    _lock_party_evenings_for_accounts(source.pk, target.pk)

    # Move parent rows before their Account CASCADE can erase entire 3.0 trees.
    # Duplicate offline identities retain the claimed account's parent row, but
    # every child with an independent identity is moved or deduplicated first.
    _merge_friendships(source, target)
    _merge_follows(source, target)
    _merge_friend_blocks(source, target)
    _merge_friend_activities(source, target)
    _merge_party_evenings(source, target)
    _resolve_active_party_memberships_after_merge(source, target)
    _replace_party_game_roster_reference(
        old_public_id=source.public_id,
        new_public_id=target.public_id,
        source_account=source,
        target_account=target,
    )
    _merge_community_events(source, target)
    _merge_beer_checkins(source, target)

    _delete_or_move_account_rows(
        DrinkLog, source=source, target=target, unique_fields=("client_id",)
    )
    _delete_or_move_account_rows(
        PubRating, source=source, target=target, unique_fields=("cache_key",)
    )
    _delete_or_move_account_rows(
        PubVisit, source=source, target=target, unique_fields=("client_id",)
    )
    _merge_published_nights(source, target)
    _replace_published_night_reference(
        "participant_ids",
        old_public_id=source.public_id,
        new_public_id=target.public_id,
        account_ids={target.pk},
    )
    _delete_or_move_account_rows(
        BeerPhotoDeletionTombstone,
        source=source,
        target=target,
        unique_fields=("client_id",),
    )
    _merge_beer_photos(source, target)

    for membership in PartyEveningMember.objects.filter(account=source).order_by("pk"):
        conflict = PartyEveningMember.objects.filter(
            evening_id=membership.evening_id, account=target
        ).first()
        if conflict is not None:
            _merge_party_member_row(membership, conflict)
            continue
        membership.account = target
        membership.save(update_fields=["account"])
    _delete_or_move_account_rows(
        PartyEveningDrink,
        source=source,
        target=target,
        unique_fields=("client_id",),
    )
    PartyGame.objects.filter(started_by=source).update(started_by=target)
    PartyGameEvent.objects.filter(account=source).update(account=target)
    PartyGameEvent.objects.filter(subject=source).update(subject=target)

    _delete_or_move_account_rows(
        BeerCheckInReaction,
        source=source,
        target=target,
        unique_fields=("checkin_id",),
    )
    BeerCheckInReaction.objects.filter(account=target, checkin__account=target).delete()

    _delete_or_move_account_rows(
        NightRound, source=source, target=target, unique_fields=("night_id",)
    )
    # Moving PublishedNight ownership can turn either direction of a cross-account
    # reaction into a self-reaction. Keep the normal deduplicating move above so
    # the (night, account) constraint stays safe, then remove rounds that violate
    # the same invariant enforced by the reaction endpoint.
    NightRound.objects.filter(account=target, night__account=target).delete()
    _delete_or_move_account_rows(
        PublishedNightComment,
        source=source,
        target=target,
        unique_fields=("client_id",),
    )

    _merge_photo_contest_entries(source, target)
    _delete_or_move_account_rows(
        PhotoContestVote,
        source=source,
        target=target,
        account_field="voter",
        unique_fields=("contest_id",),
    )
    PhotoContestVote.objects.filter(voter=target, entry__account=target).delete()

    for model in (
        FriendPubActivityRecipient,
        FriendActivityResponse,
        FriendActivityReaction,
    ):
        _delete_or_move_account_rows(
            model,
            source=source,
            target=target,
            unique_fields=("activity_id",),
        )
    FriendPubActivityRecipient.objects.filter(account=target, activity__account=target).delete()
    FriendActivityResponse.objects.filter(account=target, activity__account=target).delete()
    FriendActivityReaction.objects.filter(account=target, activity__account=target).delete()
    FriendNotification.objects.filter(recipient=source).update(recipient=target)
    FriendNotification.objects.filter(actor=source).update(actor=target)
    FriendInviteCode.objects.filter(account=source).update(account=target)

    for membership in CommunityEventMembership.objects.filter(account=source).order_by("pk"):
        conflict = CommunityEventMembership.objects.filter(
            event_id=membership.event_id, account=target
        ).first()
        if conflict is not None:
            _merge_community_membership_row(membership, conflict)
            continue
        membership.account = target
        membership.save(update_fields=["account"])
    for membership in CommunityEventTeamMembership.objects.filter(account=source).order_by("pk"):
        if CommunityEventTeamMembership.objects.filter(
            event_id=membership.event_id, account=target
        ).exists():
            membership.delete()
            continue
        membership.account = target
        membership.save(update_fields=["account"])
    CommunityEventTeam.objects.filter(created_by=source).update(created_by=target)

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
        PubCommunityXpLedger,
        source=source,
        target=target,
        unique_fields=("cache_key", "kind"),
    )
    _delete_or_move_account_rows(
        PubEvent,
        source=source,
        target=target,
        unique_fields=("client_id",),
    )
    _delete_or_move_account_rows(
        PubNameCorrection,
        source=source,
        target=target,
        unique_fields=("client_id",),
    )
    _delete_or_move_account_rows(
        PushDevice,
        source=source,
        target=target,
        unique_fields=("push_token",),
    )

    PubCommunityData.objects.filter(account=source).update(account=target)
    PubBeerBrand.objects.filter(account=source).update(account=target)
    PubBeerProduct.objects.filter(account=source).update(account=target)
    PubAmenity.objects.filter(first_mapper=source).update(first_mapper=target)
    ClientEvent.objects.filter(account=source).update(account=target)
    ContentReport.objects.filter(reporter=source).update(reporter=target)
    ContentReport.objects.filter(target_account=source).update(target_account=target)
    _merge_usage_stats(source, target)

    # Future Account-owned models must be added above. Failing the transaction
    # is safer than authenticating successfully while CASCADE silently erases a
    # newly introduced diary/community tree.
    _assert_no_cascade_rows_for_source(source)
    source_proof_valid = (
        source.ugc_terms_version == settings.UGC_POLICY_VERSION
        and source.ugc_terms_accepted_at is not None
    )
    target_proof_valid = (
        target.ugc_terms_version == settings.UGC_POLICY_VERSION
        and target.ugc_terms_accepted_at is not None
    )
    if source_proof_valid and not target_proof_valid:
        target.ugc_terms_version = source.ugc_terms_version
        target.ugc_terms_accepted_at = source.ugc_terms_accepted_at
        target.save(update_fields=["ugc_terms_version", "ugc_terms_accepted_at"])
    # The durable outbox keeps the storage name alive even though the source
    # account row is about to disappear; the physical delete runs post-commit
    # and stays retryable if storage fails.
    avatar_cleanup_id = enqueue_account_avatar_file_deletion(source)
    if avatar_cleanup_id is not None:
        schedule_beer_photo_file_deletions((avatar_cleanup_id,))
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
    merge_operation_id: uuid.UUID | None = None,
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
        with transaction.atomic():
            current_account, account = _lock_merge_participants(
                current_account,
                existing.account,
            )
            # Known identity → sign in to its account. Lock the identity so two
            # retries cannot interleave token refresh and merge-operation bind.
            existing = (
                AuthIdentity.objects.select_for_update()
                .select_related("account")
                .get(pk=existing.pk)
            )
            if existing.account_id != account.pk:
                raise RuntimeError("social identity account changed during sign-in")
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
            # The provider token was cryptographically verified before we got
            # here, so the proven SUBJECT itself is the quorum-trust proof;
            # stamp inside this transaction whether or not the claims carried
            # an email or flagged it verified (never advances an existing
            # stamp).
            community_trust.mark_quorum_trusted(account.pk)
            current_account = _bind_account_merge_operation(
                merge_operation_id,
                source_account=current_account,
                target_public_id=account.public_id,
            )
            _merge_anonymous_account(current_account, account)
            token = issue_token(account)
        _maybe_capture_social_avatar(account, claims, provider)
        return account, token, False

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
            current_account, account = _lock_merge_participants(
                current_account,
                account,
            )
            current_account = _bind_account_merge_operation(
                merge_operation_id,
                source_account=current_account,
                target_public_id=account.public_id,
            )
            if current_account is not None and account.pk == current_account.pk:
                account = current_account
            _reactivate_if_pending(account)
            AuthIdentity.objects.create(
                account=account,
                provider=provider,
                subject=subject,
                email=email,
                apple_refresh_token=apple_refresh_token,
            )
            _maybe_set_display_name(account, full_name or claims.get("name", ""))
            # The verified provider subject is the proof, not the email: stamp
            # in the same transaction as the identity row itself, whether or
            # not the claims carried an email or flagged it verified.
            community_trust.mark_quorum_trusted(account.pk)
            _merge_anonymous_account(current_account, account)
            token = issue_token(account)
    except IntegrityError:
        # Concurrent first sign-in for the same (provider, subject) — re-resolve.
        existing = (
            AuthIdentity.objects.select_related("account")
            .filter(provider=provider, subject=subject)
            .first()
        )
        if existing is None:
            raise
        with transaction.atomic():
            current_account, account = _lock_merge_participants(
                current_account,
                existing.account,
            )
            current_account = _bind_account_merge_operation(
                merge_operation_id,
                source_account=current_account,
                target_public_id=account.public_id,
            )
            _reactivate_if_pending(account)
            # Concurrent re-resolve still went through a cryptographically
            # verified provider subject, so it stamps like any other proof.
            community_trust.mark_quorum_trusted(account.pk)
            _merge_anonymous_account(current_account, account)
            token = issue_token(account)
        return account, token, False

    # Avatar capture does network I/O + a file write, so run it AFTER the
    # identity transaction has committed (best-effort, never fatal).
    _maybe_capture_social_avatar(account, claims, provider)
    return account, token, created


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
            # Idempotent relink of the same verified subject still proves
            # identity; stamp once (never advances an existing stamp).
            community_trust.mark_quorum_trusted(account.pk)
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

    # The verified provider link and its trust stamp commit together.
    with transaction.atomic():
        identity = AuthIdentity.objects.create(
            account=account,
            provider=provider,
            subject=subject,
            email=email,
            apple_refresh_token=apple_refresh_token,
        )
        # The verified provider subject is the proof, not the email: stamp in
        # the same transaction as the identity row itself.
        community_trust.mark_quorum_trusted(account.pk)
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
            logger.warning(
                "apple token revoke on unlink failed (%s)",
                type(exc).__name__,
            )
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
    """Consume a verification token, verify the email, and stamp quorum trust.

    Token consumption, the credential flip and the trust stamp commit or roll
    back as one unit: a replayed/burned token raises before anything changes,
    so it can never advance an existing stamp.
    """
    with transaction.atomic():
        account = _consume_one_time_token(
            raw_token, purpose=OneTimeToken.Purpose.VERIFY_EMAIL
        )
        proven_at = timezone.now()
        EmailCredential.objects.filter(account=account).update(email_verified=True)
        # Inbox control is a quorum-trust proof; stamped in the same transaction
        # so a rollback removes both the verification and the stamp.
        community_trust.mark_quorum_trusted(account.pk, proven_at=proven_at)
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


def reset_password(raw_token: str, *, new_password: str) -> tuple[Account, str]:
    """Atomically consume a reset token and return a fresh authenticated session.

    Password validation happens before the one-time token is marked used, so a
    rejected password does not burn a valid link. Token consumption, password
    replacement, session revocation, deletion-epoch advancement, and fresh token
    issuance then commit or roll back as one unit.
    """

    token_hash = hash_account_token(raw_token)
    candidate_account_id = (
        OneTimeToken.objects.filter(
            token_hash=token_hash,
            purpose=OneTimeToken.Purpose.RESET_PASSWORD,
        )
        .values_list("account_id", flat=True)
        .first()
    )
    if candidate_account_id is None:
        raise AccountError(
            "Odkaz je neplatný nebo vypršel.",
            code="token_invalid",
            http_status=400,
        )

    with transaction.atomic():
        # Account is the global first lock for account-owned trees. Read the
        # token's owner without locking above, then lock Account before the OTP;
        # merge/purge paths use the same order and cannot deadlock this reset.
        account = (
            Account.objects.select_for_update()
            .filter(pk=candidate_account_id)
            .first()
        )
        one_time_token = (
            OneTimeToken.objects.select_for_update()
            .filter(
                token_hash=token_hash,
                purpose=OneTimeToken.Purpose.RESET_PASSWORD,
                account_id=candidate_account_id,
            )
            .first()
        )
        if (
            account is None
            or one_time_token is None
            or one_time_token.used_at is not None
            or one_time_token.expires_at <= timezone.now()
        ):
            raise AccountError(
                "Odkaz je neplatný nebo vypršel.",
                code="token_invalid",
                http_status=400,
            )

        validate_password_strength(new_password, account=account)
        credential = (
            EmailCredential.objects.select_for_update()
            .filter(account=account)
            .first()
        )
        if credential is None:
            raise AccountError(
                "Účet nemá nastavené heslo.",
                code="no_password",
                http_status=400,
            )

        one_time_token.used_at = timezone.now()
        one_time_token.save(update_fields=["used_at"])
        credential.password = make_password(new_password)
        credential.email_verified = True  # proving inbox control verifies it
        credential.save(update_fields=["password", "email_verified", "updated_at"])
        # The completed reset is a quorum-trust proof; same transaction, so a
        # failure anywhere above leaves no stamp behind.
        community_trust.mark_quorum_trusted(account.pk, proven_at=timezone.now())
        revoke_all_tokens(account)  # force every existing session out after reset
        _reactivate_if_pending(account)
        fresh_token = issue_token(account)

    return account, fresh_token


# ---------------------------------------------------------------------------
# Deletion (soft-delete + grace window; Apple revoke required)
# ---------------------------------------------------------------------------
def schedule_deletion(account: Account) -> None:
    """Begin account deletion: log out everywhere, revoke Apple, mark pending,
    email the user a cancel-by date. The purge command hard-deletes later."""
    with transaction.atomic():
        locked = Account.objects.select_for_update().get(pk=account.pk)
        revoke_all_tokens(locked)
        _revoke_apple_identities(locked)
        PushDevice.objects.filter(account=locked, enabled=True).update(
            enabled=False,
            permission_status=PushDevice.PermissionStatus.DENIED,
            updated_at=timezone.now(),
        )
        FriendPubActivity.objects.filter(account=locked, active=True).update(
            active=False,
            updated_at=timezone.now(),
        )
        _resolve_shared_lifecycles_on_soft_delete(locked)

        locked.status = Account.Status.PENDING_DELETION
        locked.deleted_at = timezone.now()
        locked.save(update_fields=["status", "deleted_at"])

        account.status = locked.status
        account.deleted_at = locked.deleted_at
        email = locked.primary_email
        if email:
            cancel_by = (
                locked.deleted_at + timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS)
            ).strftime("%-d. %-m. %Y")
            _send_account_email_after_commit(
                "deletion_scheduled",
                lambda: emailer.send_account_deletion_scheduled_email(
                    email,
                    cancel_by=cancel_by,
                ),
            )


def cancel_deletion(account: Account) -> bool:
    """Advance credential auth and invalidate old deletion authorization.

    A deletion operation proves that one *particular* deletion epoch completed.
    Every successful credential proof advances the epoch before its fresh token
    is issued. A DELETE request authenticated earlier keeps the old snapshot and
    is rejected under the Account row lock, so it cannot race sign-in and put a
    freshly reactivated account back into pending deletion after the client has
    processed the login response.

    Return whether a pending deletion was actually cancelled.
    """

    with transaction.atomic():
        locked = Account.objects.select_for_update().get(pk=account.pk)
        was_pending = locked.status == Account.Status.PENDING_DELETION

        locked.deletion_epoch += 1

        # Also repairs any stale proof left on an ACTIVE row by an older server
        # version. There is no valid completed deletion epoch while ACTIVE.
        AccountDeletionOperation.objects.filter(
            account_fingerprint__in=account_deletion_fingerprint_candidates(locked.public_id)
        ).delete()

        if was_pending:
            locked.status = Account.Status.ACTIVE
            locked.deleted_at = None
            locked.save(update_fields=["status", "deleted_at", "deletion_epoch"])
        else:
            locked.save(update_fields=["deletion_epoch"])

        # Keep the caller's already-loaded instance coherent for the remainder
        # of the enclosing auth transaction and serializer response.
        account.status = locked.status
        account.deleted_at = locked.deleted_at
        account.deletion_epoch = locked.deletion_epoch
        return was_pending


def _send_account_email_after_commit(event: str, send: Callable[[], object]) -> None:
    """Run an account lifecycle email only after its database state commits."""

    def deliver() -> None:
        try:
            send()
        except Exception as exc:  # noqa: BLE001 -- commit must stay successful
            logger.warning(
                "account email delivery failed (%s)",
                type(exc).__name__,
                extra={"event": event},
            )

    transaction.on_commit(deliver)


def _scrub_account_uuid_from_json_arrays(account: Account) -> set[int]:
    """Remove current/retired UUIDs and return games whose payloads may name them."""

    targets = {
        str(account.public_id),
        *(
            str(value)
            for value in AccountIdentityAlias.objects.filter(account=account).values_list(
                "public_id",
                flat=True,
            )
        ),
    }

    def scrub(values: object) -> object | None:
        if not isinstance(values, list):
            return None
        filtered = [value for value in values if str(value) not in targets]
        return filtered if filtered != values else None

    for night in PublishedNight.objects.exclude(participant_ids=[]).only(
        "pk", "participant_ids"
    ):
        cleaned = scrub(night.participant_ids)
        if cleaned is not None:
            night.participant_ids = cleaned
            night.save(update_fields=["participant_ids"])

    affected_game_ids = set(
        PartyGame.objects.filter(started_by=account).values_list("pk", flat=True)
    )
    affected_game_ids.update(
        PartyGameEvent.objects.filter(Q(account=account) | Q(subject=account)).values_list(
            "game_id",
            flat=True,
        )
    )
    # An unbound/legacy game has no roster edge to scrub. Membership in its
    # evening is the only safe scope signal, so permanently redact those games
    # before a stale offline FINISH can arrive after this account is gone.
    affected_game_ids.update(
        PartyGame.objects.filter(roster_account_ids=[])
        .filter(
            Q(evening__host=account)
            | Q(evening__memberships__account=account)
        )
        .values_list("pk", flat=True)
        .distinct()
    )
    for game in PartyGame.objects.exclude(roster_account_ids=[]).only(
        "pk", "roster_account_ids"
    ):
        values = game.roster_account_ids
        if isinstance(values, list) and any(str(value) in targets for value in values):
            affected_game_ids.add(game.pk)
        cleaned = scrub(game.roster_account_ids)
        if cleaned is not None:
            game.roster_account_ids = cleaned
            game.save(update_fields=["roster_account_ids"])
    return affected_game_ids


def _resolve_owned_community_lifecycles(account: Account) -> None:
    """Remove every live community relation; reactivation starts detached."""

    hosted_event_ids = set(
        CommunityEvent.objects.filter(host=account).values_list("pk", flat=True)
    )
    created_teams = list(
        CommunityEventTeam.objects.filter(created_by=account)
        .values_list("pk", "event_id")
        .order_by("pk")
    )
    joined_teams = list(
        CommunityEventTeamMembership.objects.filter(account=account)
        .values_list("team_id", "event_id")
        .order_by("pk")
    )
    membership_event_ids = set(
        CommunityEventMembership.objects.filter(account=account).values_list(
            "event_id", flat=True
        )
    )
    event_ids = (
        hosted_event_ids
        | {event_id for _team_id, event_id in created_teams}
        | {event_id for _team_id, event_id in joined_teams}
        | membership_event_ids
    )
    list(
        CommunityEvent.objects.select_for_update(of=("self",))
        .filter(pk__in=event_ids)
        .order_by("pk")
    )
    team_ids = {
        *(team_id for team_id, _event_id in created_teams),
        *(team_id for team_id, _event_id in joined_teams),
    }
    list(
        CommunityEventTeam.objects.select_for_update(of=("self",))
        .filter(pk__in=team_ids)
        .order_by("pk")
    )
    team_memberships = list(
        CommunityEventTeamMembership.objects.select_for_update(of=("self",))
        .filter(account=account)
        .order_by("pk")
    )
    event_memberships = list(
        CommunityEventMembership.objects.select_for_update(of=("self",))
        .filter(account=account)
        .exclude(event_id__in=hosted_event_ids)
        .order_by("pk")
    )

    CommunityEventTeamMembership.objects.filter(
        pk__in=[membership.pk for membership in team_memberships]
    ).delete()
    now = timezone.now()
    for membership in event_memberships:
        membership.status = (
            CommunityEventMembership.Status.LEFT
            if membership.status == CommunityEventMembership.Status.APPROVED
            else CommunityEventMembership.Status.CANCELLED
        )
        membership.decided_at = now
        membership.save(update_fields=["status", "decided_at", "updated_at"])

    created_team_ids = [team_id for team_id, _event_id in created_teams]
    CommunityEventTeam.objects.filter(pk__in=created_team_ids).delete()
    CommunityEvent.objects.filter(pk__in=hosted_event_ids).delete()


def _resolve_shared_lifecycles_on_soft_delete(account: Account) -> None:
    """End live party state immediately; reactivation never restores it."""

    now = timezone.now()
    evenings = _lock_party_evenings_for_accounts(account.pk)
    for evening in evenings:
        if evening.host_id != account.pk or not evening.active:
            continue
        evening.active = False
        evening.ended_at = now
        evening.save(update_fields=["active", "ended_at", "updated_at"])

    memberships = list(
        PartyEveningMember.objects.select_for_update(of=("self",))
        .filter(account=account, active=True)
        .order_by("pk")
    )
    for membership in memberships:
        membership.active = False
        membership.left_at = now
        membership.save(update_fields=["active", "left_at"])

    _resolve_owned_community_lifecycles(account)


def _resolve_shared_lifecycles_before_delete(account: Account) -> None:
    """Hand active evenings to a survivor; delete hosted community events."""

    now = timezone.now()
    for evening in PartyEvening.objects.select_for_update().filter(
        host=account, active=True
    ).order_by("pk"):
        replacement = (
            PartyEveningMember.objects.select_for_update()
            .filter(
                evening=evening,
                active=True,
                account__status=Account.Status.ACTIVE,
            )
            .exclude(account=account)
            .order_by("joined_at", "id")
            .first()
        )
        if replacement is not None:
            evening.host = replacement.account
            evening.save(update_fields=["host", "updated_at"])
        else:
            evening.active = False
            evening.ended_at = now
            evening.save(update_fields=["active", "ended_at", "updated_at"])
    _resolve_owned_community_lifecycles(account)


def _capture_affected_community_keys(account: Account) -> set[str]:
    """Collect cache keys whose public community state the purge may change.

    Captured BEFORE any deletion: account-authored contribution logs, the
    current PubCommunityData pointer, and the brand/product pointer rows.
    """
    keys: set[str] = set()
    keys.update(
        PubContributionLog.objects.filter(account=account).values_list("cache_key", flat=True)
    )
    keys.update(PubCommunityData.objects.filter(account=account).values_list("cache_key", flat=True))
    keys.update(PubBeerBrand.objects.filter(account=account).values_list("cache_key", flat=True))
    keys.update(PubBeerProduct.objects.filter(account=account).values_list("cache_key", flat=True))
    return keys


def _rebuild_community_signals_after_purge(cache_key: str) -> None:
    """Rebuild one pub's public community signals from surviving contributors.

    Runs inside the purge transaction after ``Account.delete()``. The only
    provenance is the latest surviving non-anonymous PubContributionLog per
    kind (newest created_at, then id); private DrinkLog rows are never
    consulted. Community-sourced signal rows always restart from that
    provenance; independent EXTERNAL price data is never touched.
    """
    hours_log = (
        PubContributionLog.objects.exclude(account=None)
        .filter(cache_key=cache_key, kind=PubContributionLog.Kind.HOURS)
        .order_by("-created_at", "-id")
        .first()
    )
    beers_log = (
        PubContributionLog.objects.exclude(account=None)
        .filter(cache_key=cache_key, kind=PubContributionLog.Kind.BEERS)
        .order_by("-created_at", "-id")
        .first()
    )

    # Community-sourced state loses its provenance with the deleted author and
    # is rebuilt from scratch below. A DRINK-derived price survives only while
    # a surviving account still stands behind the pub's brand/product rows;
    # independently verified EXTERNAL price data is never touched.
    PubPriceIndex.objects.filter(
        cache_key=cache_key, source=PubPriceIndex.Source.COMMUNITY
    ).delete()
    survivor_backs_drink_price = (
        PubBeerBrand.objects.filter(
            cache_key=cache_key,
            source=PubBeerBrand.Source.DRINK,
            account__isnull=False,
        ).exists()
        or PubBeerProduct.objects.filter(
            cache_key=cache_key,
            source=PubBeerProduct.Source.DRINK,
            account__isnull=False,
        ).exists()
    )
    if not survivor_backs_drink_price:
        PubPriceIndex.objects.filter(
            cache_key=cache_key, source=PubPriceIndex.Source.DRINK
        ).delete()

    if hours_log is None and beers_log is None:
        # Nobody survives behind this pub's community state — remove it.
        PubCommunityData.objects.filter(cache_key=cache_key).delete()
        return

    newest = max(
        (log for log in (hours_log, beers_log) if log),
        key=lambda log: (log.created_at, log.id),
    )
    defaults = {
        "name": newest.name,
        "lat": newest.lat,
        "lng": newest.lng,
        # Historical menus backed by the deleted author must not survive.
        "historical_beers": [],
        # Contribution logs cannot prove city or external_id, so the rebuilt
        # row must not carry the deleted author's identity fields forward.
        "city": None,
        "external_id": None,
        "account": newest.account,
    }
    if hours_log is not None:
        defaults["hours_json"] = hours_log.payload
        defaults["opening_hours_raw"] = community_hours_to_osm(hours_log.payload)
        defaults["hours_updated_at"] = hours_log.created_at
    else:
        defaults["hours_json"] = None
        defaults["opening_hours_raw"] = ""
        defaults["hours_updated_at"] = None

    beers: list[dict] = []
    if beers_log is not None:
        payload = beers_log.payload
        rotates = False
        if isinstance(payload, dict):
            rotates = bool(payload.get("beer_menu_rotates"))
            payload = payload.get("beers")
        if isinstance(payload, list):
            beers = payload
        defaults["beers"] = beers
        defaults["beer_menu_rotates"] = rotates
        defaults["beers_updated_at"] = beers_log.created_at
    else:
        defaults["beers"] = []
        defaults["beer_menu_rotates"] = False
        defaults["beers_updated_at"] = None

    PubCommunityData.objects.update_or_create(cache_key=cache_key, defaults=defaults)

    if beers_log is None or not beers:
        return
    sync_pub_beer_indexes_for_menu(
        cache_key=cache_key,
        data={"name": beers_log.name, "lat": beers_log.lat, "lng": beers_log.lng},
        beers=beers,
        source=PubBeerBrand.Source.COMMUNITY,
        account=beers_log.account,
        match_cache=BeerCatalogMatchCache(),
    )
    upsert_pub_price_index(
        cache_key=cache_key,
        name=beers_log.name,
        lat=beers_log.lat,
        lng=beers_log.lng,
        beers=beers,
        observed_at=beers_log.created_at,
        source=PubPriceIndex.Source.COMMUNITY,
    )


def _hard_delete_locked(account: Account) -> None:
    """Delete one row while its caller owns the shared-tree lock scope."""

    email = account.primary_email
    # Remote cleanup runs before anything irreversible or local. Linear goes
    # FIRST: it is the only remote step that can legitimately fail, and a
    # failure here must roll the whole purge back while the Apple token is
    # still unrevoked locally — never after Apple has already revoked it.
    # The sequence is strictly sequential and fail-closed: any remote failure
    # aborts with nothing committed, and retries rely on idempotency
    # (exact ENTITY_NOT_FOUND from Linear, provider-side token revocation).
    _delete_linear_feedback_issues(account)
    _revoke_apple_identities(account, fail_on_error=True)
    cleanup_ids: list[int] = []
    avatar_cleanup_id = enqueue_account_avatar_file_deletion(account)
    if avatar_cleanup_id is not None:
        cleanup_ids.append(avatar_cleanup_id)
    for photo in account.beer_photos.all():
        cleanup_id = enqueue_beer_photo_file_deletion(photo, account=account)
        if cleanup_id is not None:
            cleanup_ids.append(cleanup_id)
    # Feedback reports authored by the account go away completely. Remote
    # issues were deleted above (before Apple), so by this point every remote
    # deletion has succeeded; attachments are enqueued while the storage names
    # still exist, then the rows themselves go.
    for report in FeedbackReport.objects.filter(account=account).exclude(attachment=""):
        cleanup_id = enqueue_feedback_attachment_file_deletion(report)
        if cleanup_id is not None:
            cleanup_ids.append(cleanup_id)
    FeedbackReport.objects.filter(account=account).delete()

    affected_amenities = set(
        PubAmenityVote.objects.filter(account=account).values_list(
            "cache_key", "pub_identity_key", "amenity_key"
        )
    )
    affected_community_keys = _capture_affected_community_keys(account)

    # UGC / telemetry authored by the deleted account is purged outright.
    PubReport.objects.filter(account=account).delete()
    PubNameCorrection.objects.filter(account=account).delete()
    UserAddedPub.objects.filter(account=account).delete()
    PubContributionLog.objects.filter(account=account).delete()
    ClientEvent.objects.filter(account=account).delete()
    # The beer-index account FK is SET_NULL, so without this the purged
    # author's rows would linger anonymously; survivor-owned rows stay.
    PubBeerBrand.objects.filter(account=account).delete()
    PubBeerProduct.objects.filter(account=account).delete()

    FriendNotification.objects.filter(actor=account).delete()
    _resolve_shared_lifecycles_before_delete(account)
    affected_game_ids = _scrub_account_uuid_from_json_arrays(account)

    ContentReport.objects.filter(target_account=account).update(target_snapshot={})
    ContentReport.objects.filter(reporter=account).update(comment="")
    # A finish/action payload can carry names and UUIDs for players other than
    # its author. Once a deleted account participated in a game, clear every
    # opaque payload from that game rather than guessing at future nested
    # shapes. Audit kind/delta and survivor-owned rows remain intact.
    PartyGame.objects.filter(pk__in=affected_game_ids).update(payloads_redacted=True)
    PartyGameEvent.objects.filter(game_id__in=affected_game_ids).update(payload={})
    account.delete()

    for cache_key in sorted(affected_community_keys):
        _rebuild_community_signals_after_purge(cache_key)
    for cache_key, pub_identity_key, amenity_key in affected_amenities:
        _recount_amenity_aggregate(cache_key, pub_identity_key, amenity_key)

    # The outbox rows were inserted in this same transaction and survive the
    # Account cascade through SET_NULL. Physical storage is touched only after
    # commit; transient failures remain retryable by the management command.
    schedule_beer_photo_file_deletions(cleanup_ids)
    if email:
        _send_account_email_after_commit(
            "account_deleted",
            lambda: emailer.send_account_deleted_email(email),
        )


def _lock_account_purge_scope(account_id: int) -> Account | None:
    """Lock Account→Evening in writer order before a purge touches game rows."""
    candidate_ids = {account_id}
    candidate_ids.update(_shared_tree_account_ids_for_merge(candidate_ids))
    candidate_ids.update(_direct_counterparty_account_ids_for_purge(account_id))
    locked_accounts = {
        locked.pk: locked
        for locked in Account.objects.select_for_update()
        .filter(pk__in=candidate_ids)
        .order_by("pk")
    }
    account = locked_accounts.get(account_id)
    if account is None:
        return None

    # A join can commit between optimistic discovery and the first Account
    # locks. Never wait for a newly discovered lower-PK row while already
    # holding the old scope: abort this purge run and let the worker retry.
    discovered_ids = {account_id}
    discovered_ids.update(_shared_tree_account_ids_for_merge(discovered_ids))
    discovered_ids.update(_direct_counterparty_account_ids_for_purge(account_id))
    missing_ids = discovered_ids - set(locked_accounts)
    if missing_ids:
        try:
            with transaction.atomic():
                newly_locked = {
                    locked.pk: locked
                    for locked in Account.objects.select_for_update(nowait=True)
                    .filter(pk__in=missing_ids)
                    .order_by("pk")
                }
        except DatabaseError as exc:
            raise AccountPurgeConflictError from exc
        if set(newly_locked) != missing_ids:
            raise AccountPurgeConflictError
        locked_accounts.update(newly_locked)

    # Party writers take Account rows first, then the Evening and Game. Owning
    # the same order makes a survivor writer either finish before the scrub or
    # resume after the durable redaction flag commits, never deadlock at commit.
    _lock_party_evenings_for_accounts(account_id)
    return locked_accounts[account_id]


def hard_delete(account: Account) -> None:
    """Irreversibly delete an account under a row lock.

    Cascades wipe credentials/tokens and personal rows; SET_NULL community data
    is anonymized. Media cleanup and confirmation email run only after commit.
    Call :func:`hard_delete_expired_account` from the grace-period worker so its
    eligibility is rechecked under this same lock.
    """

    with transaction.atomic():
        locked = _lock_account_purge_scope(account.pk)
        if locked is None:
            return
        _hard_delete_locked(locked)


def hard_delete_expired_account(
    account_id: int,
    *,
    cutoff: datetime,
    expected_deletion_epoch: int,
) -> bool:
    """Atomically purge only the exact expired deletion generation observed.

    A command candidate is necessarily stale by the time it reaches this
    function. Reauthentication advances ``deletion_epoch`` under the same row
    lock; a later delete gets a new ``deleted_at``. Rechecking all three values
    prevents either transition from being erased by an old purge iterator.
    Missing/already-purged/ineligible rows are successful idempotent skips.
    """

    with transaction.atomic():
        account = _lock_account_purge_scope(account_id)
        if account is None:
            return False
        if (
            account.status != Account.Status.PENDING_DELETION
            or account.deleted_at is None
            or account.deleted_at > cutoff
            or account.deletion_epoch != expected_deletion_epoch
        ):
            return False
        _hard_delete_locked(account)
        return True


def _revoke_apple_identities(account: Account, *, fail_on_error: bool = False) -> None:
    failed_identity_ids: list[int] = []
    for identity in account.identities.filter(provider=AuthIdentity.Provider.APPLE):
        if not identity.apple_refresh_token:
            continue
        try:
            oauth.revoke_apple_token(identity.apple_refresh_token)
        except oauth.OAuthError as exc:
            logger.warning(
                "apple token revoke on deletion failed (%s)",
                type(exc).__name__,
            )
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
    # Always advance under the row lock, even when already ACTIVE: successful
    # credential auth cancels DELETE requests authenticated before this point.
    if cancel_deletion(account):
        logger.info("account %s reactivated by sign-in within grace window", account.public_id)


def _maybe_set_display_name(account: Account, full_name: str) -> None:
    name = (full_name or "").strip()
    if name and not account.display_name:
        account.display_name = name[:120]
        account.save(update_fields=["display_name"])

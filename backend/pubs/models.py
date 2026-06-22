"""
Data models for the na-pivo pub-hours enrichment service.

PubHours  — the cached result of enriching a pub with opening hours from Firmy.cz.
EnrichTask — a queued enrichment job for pubs that missed the sync_budget.
PubReport — user reports for places that should no longer be shown as pubs.
UserAddedPub — community-added pubs missing from Mapy.cz / suggest results.
ReleaseNote — a "what's new" entry shown once after the app updates to a version.
FeedbackReport — an in-app feedback / bug report submitted by a user.
PubCommunityData — current community-contributed hours + beers for a pub.
PubContributionLog — append-only history of community contributions.
ClientEvent — privacy-safe diagnostic / usage telemetry from the app.
AccountUsageStats — aggregated per-account app usage counters.
"""

import hashlib
import secrets
import uuid

from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone


class PubHours(models.Model):
    """
    Cached opening-hours data for a pub identified by a geohash-8 cache key.

    cache_key is a geohash at precision 8 (~38 m cell) derived from (lat, lng).
    This lets nearby requests for the same physical location reuse a single row
    without requiring exact coordinate equality.
    """

    class Status(models.TextChoices):
        OK = "ok", "OK"
        UNKNOWN = "unknown", "Unknown"
        PENDING = "pending", "Pending"
        ERROR = "error", "Error"

    # ---------- identity ----------
    cache_key = models.CharField(
        max_length=12,
        unique=True,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — ~38 m precision.",
    )
    name = models.CharField(max_length=255)
    lat = models.FloatField()
    lng = models.FloatField()

    # ---------- enrichment result ----------
    # TextField (not CharField(512)): a heavily multi-segmented openingHoursSpecification
    # can normalise to an OSM string well over 512 chars. On Postgres a varchar(512)
    # overflow raises DataError on the unguarded write in cache._enrich_sync, which
    # bubbles to a batch-wide HTTP 500 (SQLite silently truncates, masking it in tests).
    # TextField is unbounded, removing the failure mode entirely.
    opening_hours_raw = models.TextField(
        blank=True,
        null=True,
        help_text="OSM opening_hours grammar string, e.g. 'Mo-Fr 10:00-22:00; Sa 11:00-20:00'.",
    )
    source = models.CharField(
        max_length=64,
        default="firmy",
        help_text="Data source identifier, e.g. 'firmy'.",
    )
    source_ref = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        help_text="Firmy.cz firmId of the matched business listing.",
    )
    confidence = models.FloatField(
        null=True,
        blank=True,
        help_text="Match confidence in [0, 1] — name similarity blended with geo distance.",
    )
    rating_value = models.FloatField(
        null=True,
        blank=True,
        help_text="Public star rating from the source listing, e.g. 4.1.",
    )
    rating_count = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Number of public user ratings behind rating_value.",
    )
    rating_label = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        help_text="Human rating label from the source listing, e.g. 'Velmi dobré'.",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    error = models.TextField(blank=True, null=True)

    # ---------- venue classification ----------
    # Whether this place serves draft beer, derived from the Firmy.cz categories
    # / tags by pubs.enrichment.venue.classify_venue. Indexed because the read
    # path and future filtering query by it. 'unknown' is the safe default for
    # a row that has never been classified (e.g. a no-match or pre-migration row).
    class VenueKind(models.TextChoices):
        PUB = "pub", "Pub"
        MAYBE = "maybe", "Maybe"
        NOT_PUB = "not_pub", "Not a pub"
        UNKNOWN = "unknown", "Unknown"

    venue_kind = models.CharField(
        max_length=16,
        choices=VenueKind.choices,
        default=VenueKind.UNKNOWN,
        db_index=True,
        help_text="Draft-beer classification derived from Firmy.cz categories/tags.",
    )
    venue_categories = models.JSONField(
        default=list,
        blank=True,
        help_text="Firmy.cz category names the classification was derived from.",
    )

    # ---------- timestamps ----------
    fetched_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the Firmy.cz fetch completed (None = never fetched).",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Hours"
        verbose_name_plural = "Pub Hours"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.name} [{self.cache_key}] — {self.status}"


class EnrichTask(models.Model):
    """
    A queued enrichment job for a pub that could not be enriched synchronously.

    The management command `refresh_hours` processes these rows respecting
    FIRMY_MIN_INTERVAL_SEC and FIRMY_DAILY_CAP settings.
    """

    # ---------- identity ----------
    cache_key = models.CharField(
        max_length=12,
        unique=True,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — matches PubHours.cache_key.",
    )
    name = models.CharField(max_length=255)
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.CharField(
        max_length=128,
        blank=True,
        null=True,
        help_text="Optional city hint passed by the mobile app.",
    )

    # ---------- retry bookkeeping ----------
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=3)
    done = models.BooleanField(
        default=False,
        db_index=True,
        help_text="True once the task has been processed successfully (or max_attempts exceeded).",
    )
    error = models.TextField(blank=True, null=True)

    # ---------- timestamps ----------
    created_at = models.DateTimeField(auto_now_add=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Enrich Task"
        verbose_name_plural = "Enrich Tasks"
        ordering = ["created_at"]

    def __str__(self) -> str:
        done_label = "done" if self.done else f"attempt {self.attempts}/{self.max_attempts}"
        return f"EnrichTask({self.name} [{self.cache_key}] — {done_label})"


def generate_account_token() -> str:
    """Return a fresh opaque bearer secret for a new Account.

    32 bytes of CSPRNG entropy, URL-safe base64 (~43 chars). This is the
    account's auth secret for future authenticated calls; it is generated
    server-side and never derived from anything the client controls.
    """
    return secrets.token_urlsafe(32)


def hash_account_token(raw_token: str) -> str:
    """Return the SHA-256 hex digest used to store / look up an account token.

    Tokens are 256-bit CSPRNG secrets, so a single fast hash (not a slow
    password KDF) is the right choice: brute-forcing the preimage is infeasible,
    and storing only the digest means a database leak never exposes a usable
    bearer token.
    """
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def account_avatar_path(instance, filename: str) -> str:
    """Storage path for an account avatar: one stable file per account.

    Keyed on ``public_id`` (never the PK), and always ``.webp`` because the
    avatar pipeline re-encodes every upload to webp. The path is stable so a
    re-upload OVERWRITES the previous file instead of accumulating orphans; the
    ``?v=<last_seen epoch>`` cache-bust on ``avatar_url`` lets clients bypass a
    stale CDN/browser cache after a change. ``filename`` is ignored on purpose —
    we never trust the client-supplied name or extension.
    """
    return f"avatars/{instance.public_id}.webp"


class Account(models.Model):
    """
    An anonymous, device-bound user account.

    Created automatically the first time a device contacts the backend. There is
    no registration or login yet — identity is the ``device_id`` the mobile app
    generates and persists locally, which survives until the app is reinstalled
    or the phone is replaced. A future auth feature will attach real credentials
    (email / phone) to this same row, so downstream per-user data should FK to
    ``Account`` rather than to a credential.

    ``device_id`` is the stable PUBLIC anchor the client owns; the bearer token
    is the server-issued SECRET used to authenticate future calls. Only a SHA-256
    hash of the token is stored (``token_hash``) — the raw token is returned once
    at registration and never persisted, so a DB leak exposes no usable
    credentials. Re-registering with a known ``device_id`` ROTATES the token (a
    fresh one is issued, since the old raw value cannot be recovered from its
    hash), so ``device_id`` is still effectively as sensitive as a token. That is
    an accepted trade-off while accounts hold no personal data; real auth will
    bind ``device_id`` to a verified credential and tighten this.

    Downstream relations: future per-user models must FK to this model's PRIMARY
    KEY — ``account = models.ForeignKey("pubs.Account", on_delete=models.CASCADE)``
    — NOT to ``public_id`` (the externally exposed id, not the PK) and never to
    ``token``. Pick an explicit ``on_delete`` policy so account pruning has
    defined semantics.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        # Soft-deleted: logged out + tokens revoked, hard-purged by the
        # purge_deleted_accounts command after the grace window. Signing back in
        # within the window reactivates it.
        PENDING_DELETION = "pending_deletion", "Pending deletion"

    class CompassMode(models.TextChoices):
        NEAREST = "nearest", "Nearest"
        SURPRISE = "surprise", "Surprise"

    class PriceCurrency(models.TextChoices):
        CZK = "CZK", "CZK"
        EUR = "EUR", "EUR"

    class SubscriptionTier(models.TextChoices):
        FREE = "free", "Free"
        PLUS = "plus", "Na Pivo+"

    class SubscriptionStatus(models.TextChoices):
        INACTIVE = "inactive", "Inactive"
        PENDING_VERIFICATION = "pending_verification", "Pending verification"
        ACTIVE = "active", "Active"
        GRACE_PERIOD = "grace_period", "Grace period"
        EXPIRED = "expired", "Expired"

    # ---------- identity ----------
    public_id = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
        help_text="Stable public account id exposed to the client (not the PK).",
    )
    device_id = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        help_text="Client-generated UUID persisted on the device; the identity anchor.",
    )
    token_hash = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        # LEGACY: bearer tokens now live in the AuthToken table (multi-device,
        # revocable). This column is kept (nullable) only so existing rows survive
        # the migration; new accounts leave it NULL. unique=True still allows many
        # NULLs on both sqlite and Postgres. No db_index — see AuthToken.token_hash.
        help_text="DEPRECATED — superseded by AuthToken. SHA-256 digest of the "
        "legacy single bearer token; nullable, kept for backwards compatibility.",
    )

    # ---------- preferences ----------
    hide_pub_names = models.BooleanField(
        default=False,
        help_text="Whether the app should hide pub names behind the reveal interaction.",
    )
    compass_mode = models.CharField(
        max_length=16,
        choices=CompassMode.choices,
        default=CompassMode.NEAREST,
        help_text="Preferred compass mode in the mobile app.",
    )
    max_distance_km = models.FloatField(
        null=True,
        blank=True,
        help_text="Preferred search radius in kilometres; null means unlimited.",
    )
    price_currency = models.CharField(
        max_length=3,
        choices=PriceCurrency.choices,
        default=PriceCurrency.CZK,
        help_text="Preferred currency for displaying counted beer totals.",
    )
    haptic_enabled = models.BooleanField(
        default=True,
        help_text="Whether haptic feedback is enabled in the mobile app.",
    )
    sound_enabled = models.BooleanField(
        default=False,
        help_text="Whether counter sounds are enabled in the mobile app.",
    )
    hide_closed_pubs = models.BooleanField(
        default=True,
        help_text="Whether known-closed pubs should be hidden in the mobile app.",
    )
    marketing_emails_enabled = models.BooleanField(
        default=False,
        help_text="Whether the user opted in to product/marketing e-mails.",
    )

    # ---------- subscription / restore-purchases scaffold ----------
    subscription_tier = models.CharField(
        max_length=16,
        choices=SubscriptionTier.choices,
        default=SubscriptionTier.FREE,
        db_index=True,
        help_text="Current entitlement tier. Free until a receipt is verified.",
    )
    subscription_status = models.CharField(
        max_length=32,
        choices=SubscriptionStatus.choices,
        default=SubscriptionStatus.INACTIVE,
        db_index=True,
        help_text="Current subscription state; pending_verification means restore data was received.",
    )
    subscription_platform = models.CharField(
        max_length=16,
        blank=True,
        default="",
        help_text="Store platform for the latest known purchase, e.g. apple or google.",
    )
    subscription_product_id = models.CharField(
        max_length=128,
        blank=True,
        default="",
        help_text="Store product id for the latest known purchase.",
    )
    subscription_original_transaction_id = models.CharField(
        max_length=255,
        blank=True,
        default="",
        db_index=True,
        help_text="Stable store purchase id used for future restore-purchases verification.",
    )
    subscription_expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Expiry reported by a verified subscription provider, when available.",
    )
    subscription_updated_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When subscription metadata last changed.",
    )

    # ---------- profile (populated once the account is claimed) ----------
    nickname = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        db_index=True,
        help_text="Unique public handle (3–20 chars [a-zA-Z0-9_.]), user-picked. "
        "Casing is preserved; uniqueness is case-insensitive via the "
        "uniq_account_nickname_ci functional constraint. NULL for accounts that "
        "have not set one yet.",
    )
    display_name = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text="Optional real name (free text).",
    )
    avatar = models.ImageField(
        upload_to=account_avatar_path,
        max_length=255,
        blank=True,
        default="",
        help_text="Uploaded profile picture, stored on local disk as a 256px "
        "square webp. Empty when the account has no avatar (client renders an "
        "initials fallback).",
    )
    is_public = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Public profile (opt-out). Gates global search and "
        "leaderboards; friends always see the profile regardless.",
    )

    # ---------- lifecycle / deletion ----------
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
        help_text="ACTIVE, or PENDING_DELETION during the soft-delete grace window.",
    )
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When deletion was requested. Hard purge happens after the grace window.",
    )

    # ---------- timestamps ----------
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Account"
        verbose_name_plural = "Accounts"
        ordering = ["-created_at"]
        constraints = [
            # Case-insensitive unique handle as a functional PARTIAL index on
            # Lower(nickname). The partial condition skips NULL/'' rows so every
            # account without a handle coexists. This works identically on
            # sqlite and Postgres (Django >= 4.0) and — crucially — adds a plain
            # functional unique index, NOT the varchar_pattern_ops "_like" index
            # that a column-level unique=True / db_index pairing produces (the
            # footgun that broke migration 0004). Uniqueness comes ONLY from this
            # constraint; the column itself is a plain btree (db_index=True).
            models.UniqueConstraint(
                Lower("nickname"),
                name="uniq_account_nickname_ci",
                condition=~Q(nickname="") & Q(nickname__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        return f"Account({self.public_id} — device {self.device_id})"

    # --- DRF auth duck-typing -------------------------------------------------
    # AccountTokenAuthentication returns an Account as request.user, so DRF's
    # IsAuthenticated permission checks `request.user.is_authenticated`. Account
    # is not a Django user, so expose the two attributes DRF relies on.
    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    # --- account-claim helpers ------------------------------------------------
    # "Anonymous" (above) is the DRF duck-typing flag and is always False so the
    # IsAuthenticated permission passes for any token holder. Whether the account
    # has been CLAIMED with a real credential is a separate question answered here.
    @property
    def has_email_credential(self) -> bool:
        return EmailCredential.objects.filter(account=self).exists()

    @property
    def is_claimed(self) -> bool:
        """True once a real credential (email/password or a social identity) is
        attached. A fresh device account is unclaimed (anonymous)."""
        return self.has_email_credential or self.identities.exists()

    @property
    def primary_email(self) -> str:
        """Best contact email: the password email if set, else a social one."""
        cred = EmailCredential.objects.filter(account=self).first()
        if cred:
            return cred.email
        identity = self.identities.exclude(email="").first()
        return identity.email if identity else ""

    @property
    def email_is_verified(self) -> bool:
        """Whether the account's email/password credential is verified."""
        cred = EmailCredential.objects.filter(account=self).first()
        return bool(cred and cred.email_verified)

    def auth_methods(self) -> list[str]:
        """The provider keys the account can sign in with ('email', 'google',
        'apple') — used to enforce the never-remove-your-last-credential rule."""
        methods = ["email"] if self.has_email_credential else []
        methods += list(self.identities.values_list("provider", flat=True))
        return methods


class AuthToken(models.Model):
    """A bearer token (session) for an Account.

    Supersedes the single ``Account.token_hash`` field: an account can hold many
    tokens (one per device / sign-in), each independently revocable. Only the
    SHA-256 digest of the raw token is stored (same scheme as the legacy field),
    so a DB leak exposes no usable credential. Revocation = delete the row;
    "log out everywhere" = delete all rows for the account; account deletion
    cascades these away.
    """

    class Kind(models.TextChoices):
        DEVICE = "device", "Device"  # anonymous device bootstrap (POST /v1/account)
        SESSION = "session", "Session"  # issued after a credential / social login

    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="auth_tokens",
    )
    token_hash = models.CharField(
        max_length=64,
        unique=True,
        # No db_index — unique=True already creates the exact-match lookup index;
        # adding it would create a redundant Postgres varchar_pattern_ops "_like"
        # index (the footgun that broke migration 0004 on Account.token_hash).
        help_text="SHA-256 hex digest of the raw bearer token.",
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.SESSION)
    device_label = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text="Optional human label, e.g. 'iPhone 16 / app 1.2'.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Optional absolute expiry. NULL = never expires (revoke by row).",
    )

    class Meta:
        verbose_name = "Auth token"
        verbose_name_plural = "Auth tokens"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AuthToken({self.kind} for account {self.account_id})"

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= timezone.now()


class EmailCredential(models.Model):
    """Email + password credential for an Account (0 or 1 per account).

    ``password`` holds a Django password-hash string (Argon2 via
    make_password/check_password). ``email`` is stored normalized (lowercased,
    stripped) and is globally unique so one email maps to one account.
    """

    account = models.OneToOneField(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="email_credential",
    )
    email = models.EmailField(
        unique=True,
        help_text="Normalized (lowercase) login email; globally unique.",
    )
    password = models.CharField(
        max_length=128,
        help_text="Django password-hash string (Argon2).",
    )
    email_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Email credential"
        verbose_name_plural = "Email credentials"

    def __str__(self) -> str:
        verified = "verified" if self.email_verified else "unverified"
        return f"EmailCredential({self.email} — {verified})"


class AuthIdentity(models.Model):
    """A linked social sign-in provider (Google / Apple) for an Account.

    One row per linked provider. ``subject`` is the provider's stable ``sub``
    claim — the ONLY reliable join key (email is mutable / may be an Apple private
    relay). ``UniqueConstraint(provider, subject)`` guarantees one social identity
    maps to exactly one account; ``UniqueConstraint(account, provider)`` keeps it
    to one identity per provider per account.
    """

    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        APPLE = "apple", "Apple"

    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="identities",
    )
    provider = models.CharField(max_length=20, choices=Provider.choices, db_index=True)
    subject = models.CharField(
        max_length=255,
        help_text="Provider 'sub' claim — the stable per-provider user id.",
    )
    email = models.EmailField(
        blank=True,
        default="",
        help_text="Email asserted by the provider at link time (snapshot).",
    )
    apple_refresh_token = models.CharField(
        max_length=512,
        blank=True,
        default="",
        help_text="Apple refresh token, stored so the token can be revoked at "
        "account deletion (Apple requires revocation). Empty for Google.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Auth identity"
        verbose_name_plural = "Auth identities"
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "subject"], name="uniq_provider_subject"
            ),
            models.UniqueConstraint(
                fields=["account", "provider"], name="uniq_account_provider"
            ),
        ]

    def __str__(self) -> str:
        return f"AuthIdentity({self.provider}:{self.subject} → account {self.account_id})"


class OneTimeToken(models.Model):
    """Single-use, hashed, TTL'd token for email verification & password reset.

    The raw token is emailed to the user (as a deep link and a manual-entry code)
    and only its SHA-256 digest is stored. It is single-use (``used_at``) and
    expires (``expires_at``). Distinct from AuthToken (different lifetime/threat
    model) — never reuse one as a session token.
    """

    class Purpose(models.TextChoices):
        VERIFY_EMAIL = "verify_email", "Verify email"
        RESET_PASSWORD = "reset_password", "Reset password"

    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="one_time_tokens",
    )
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "One-time token"
        verbose_name_plural = "One-time tokens"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        state = "used" if self.used_at else "pending"
        return f"OneTimeToken({self.purpose} — {state})"

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class PubReport(models.Model):
    """
    A user report that a Mapy.cz result should be hidden from the compass.

    Reports are keyed by the same geohash-8 cell used by PubHours so the mobile
    app can filter future Mapy.cz search results without depending solely on a
    provider-specific id. The original Mapy id is also stored when available for
    stricter matching and auditability.
    """

    class Reason(models.TextChoices):
        CLOSED = "closed", "Closed / no longer operating"
        NOT_PUB = "not_pub", "Not a pub"

    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pub_reports",
    )
    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of the reported place coordinates.",
    )
    external_id = models.CharField(
        max_length=128,
        blank=True,
        null=True,
        db_index=True,
        help_text="Client-side provider id, e.g. Mapy.cz item id.",
    )
    name = models.CharField(max_length=255)
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.CharField(max_length=128, blank=True, null=True)
    address = models.CharField(max_length=255, blank=True, null=True)
    reason = models.CharField(max_length=16, choices=Reason.choices, db_index=True)
    active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Inactive reports are retained for audit but no longer hide the place.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Report"
        verbose_name_plural = "Pub Reports"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "cache_key", "reason"],
                name="unique_pub_report_per_account_key_reason",
            )
        ]

    def __str__(self) -> str:
        return f"PubReport({self.name} [{self.cache_key}] — {self.reason})"


class UserAddedPub(models.Model):
    """
    A community-added pub that the normal Mapy.cz nearby search did not return.

    The row carries the same geohash-8 physical-place key as PubHours and
    PubCommunityData, so it participates in the rest of the app's per-pub data
    model. Rows go live immediately and are mixed into GET /v1/pubs/near on
    every request; they are intentionally NOT written into PubSearchCache, whose
    contents remain a cache of the upstream Mapy.cz source.

    Identity is (account, client_id), NOT the geohash cell: ``cache_key`` is only
    indexed (not unique), so two genuinely different pubs that happen to fall in
    the same ~38 m cell coexist rather than overwriting each other, and one
    account's submission can never silently overwrite another account's row.

    ``client_id`` gives the mobile retry queue idempotency: replaying the same
    submission for the same account returns the already-created row instead of
    creating duplicate side effects.
    """

    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="added_pubs",
        help_text="The account that submitted this pub.",
    )
    client_id = models.UUIDField(
        db_index=True,
        help_text="Client-generated UUID; idempotency key for offline retries.",
    )
    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — ~38 m precision. Indexed but NOT "
        "unique: identity is (account, client_id), so two different pubs in the "
        "same cell coexist.",
    )
    name = models.TextField(help_text="Pub name as submitted by the client.")
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.TextField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Inactive rows are kept for audit but hidden from /v1/pubs/near.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "User Added Pub"
        verbose_name_plural = "User Added Pubs"
        ordering = ["-updated_at"]
        indexes = [
            # /v1/pubs/near filters active rows by a lat/lng bounding box; without
            # this composite index that is a full table scan on Postgres.
            models.Index(fields=["active", "lat", "lng"], name="addedpub_active_latlng_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_id"],
                name="unique_added_pub_per_account_client_id",
            )
        ]

    def __str__(self) -> str:
        return f"UserAddedPub({self.name} [{self.cache_key}])"


class ReleaseNote(models.Model):
    """
    A user-facing "what's new" entry for one shipped app version.

    When the mobile app launches after an update, it fetches the note whose
    ``version`` matches the version it just updated to (the value shipped in
    app.config.ts) and shows it once in a popup. Content is authored in the
    Django admin: a ``title`` plus an ordered list of ``ReleaseNoteItem``
    highlights. A note is invisible to the app until ``is_published`` is set, so
    a release can be drafted ahead of time and flipped on when the build ships.
    """

    version = models.CharField(
        max_length=32,
        unique=True,
        db_index=True,
        help_text="App version this note describes, e.g. '1.2.0'. "
        "Must match the version shipped in the app's app.config.ts.",
    )
    title = models.CharField(
        max_length=120,
        default="Co je nového",
        help_text="Headline shown at the top of the popup.",
    )
    is_published = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Only published notes are returned to the app. Leave off to draft.",
    )
    published_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Set automatically the first time the note is published.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Release Note"
        verbose_name_plural = "Release Notes"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        # Stamp the publish date once, the first time the note goes live. Kept
        # idempotent so toggling is_published off and on again preserves the
        # original date.
        if self.is_published and self.published_at is None:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        state = "published" if self.is_published else "draft"
        return f"ReleaseNote({self.version} — {state})"


class ReleaseNoteItem(models.Model):
    """A single highlight bullet inside a ReleaseNote, shown as one row."""

    release_note = models.ForeignKey(
        ReleaseNote,
        on_delete=models.CASCADE,
        related_name="items",
    )
    icon = models.CharField(
        max_length=8,
        blank=True,
        default="",
        help_text="Optional emoji shown before the text, e.g. '🍺'.",
    )
    text = models.CharField(
        max_length=280,
        help_text="One change in plain Czech, e.g. 'Přidali jsme otevírací dobu hospod.'",
    )
    order = models.PositiveIntegerField(
        default=0,
        help_text="Lower numbers appear first.",
    )

    class Meta:
        verbose_name = "Release Note Item"
        verbose_name_plural = "Release Note Items"
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return f"{self.icon} {self.text}".strip()


class FeedbackReport(models.Model):
    """
    An in-app feedback / bug report submitted by a user from the mobile app.

    Keyed by (account, client_id): the client generates a UUID per submission and
    re-POSTs it verbatim on offline retries, so the unique constraint lets the
    endpoint update_or_create the same row instead of duplicating it.
    """

    class Category(models.TextChoices):
        BUG = "bug", "Bug"
        IDEA = "idea", "Idea"
        OTHER = "other", "Other"

    class ContactType(models.TextChoices):
        EMAIL = "email", "E-mail"
        INSTAGRAM = "instagram", "Instagram"

    class Status(models.TextChoices):
        NEW = "new", "New"
        TRIAGED = "triaged", "Triaged"
        RESOLVED = "resolved", "Resolved"

    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback_reports",
    )
    client_id = models.UUIDField(
        help_text="Client-generated UUID; idempotency key for offline retries.",
    )
    category = models.CharField(
        max_length=16,
        choices=Category.choices,
        db_index=True,
    )
    message = models.TextField(max_length=4000)
    contact_type = models.CharField(
        max_length=16,
        choices=ContactType.choices,
        blank=True,
        default="",
        help_text="How the user wants to be reached; empty = no contact given.",
    )
    contact = models.CharField(
        max_length=254,
        blank=True,
        default="",
        help_text="E-mail address or bare Instagram handle (no leading '@').",
    )
    app_version = models.CharField(max_length=64, blank=True, default="")
    platform = models.CharField(max_length=32, blank=True, default="")
    os_version = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.NEW,
        db_index=True,
    )

    # ---------- Linear sync prep (filled in by sync_feedback_linear) ----------
    linear_issue_id = models.CharField(max_length=64, blank=True, default="")
    linear_issue_url = models.URLField(blank=True, default="")
    linear_synced_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Feedback Report"
        verbose_name_plural = "Feedback Reports"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_id"],
                name="unique_feedback_per_account_client_id",
            )
        ]

    def __str__(self) -> str:
        return f"FeedbackReport({self.category} [{self.status}] — {self.message[:40]!r})"


class ContentReport(models.Model):
    """
    A user report for abusive public profile content.

    This covers the first-abuse case once profiles become public: offensive
    nicknames, avatars or profile content can be reported by any signed-in
    account, triaged in Django admin, and acted on by hiding the profile or
    clearing the offending fields.
    """

    class Reason(models.TextChoices):
        INAPPROPRIATE_NICKNAME = "inappropriate_nickname", "Inappropriate nickname"
        INAPPROPRIATE_AVATAR = "inappropriate_avatar", "Inappropriate avatar"
        IMPERSONATION = "impersonation", "Impersonation"
        SPAM = "spam", "Spam"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        NEW = "new", "New"
        TRIAGED = "triaged", "Triaged"
        ACTIONED = "actioned", "Actioned"
        DISMISSED = "dismissed", "Dismissed"

    reporter = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="content_reports_made",
    )
    target_account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="content_reports_received",
    )
    reason = models.CharField(max_length=32, choices=Reason.choices, db_index=True)
    comment = models.TextField(max_length=1000, blank=True, default="")
    target_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text="Nickname/display/avatar/is_public snapshot at report time.",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.NEW,
        db_index=True,
    )
    moderator_note = models.TextField(blank=True, default="")
    actioned_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Content Report"
        verbose_name_plural = "Content Reports"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["target_account", "status", "created_at"]),
            models.Index(fields=["reporter", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"ContentReport({self.reason} [{self.status}])"


class ClientEvent(models.Model):
    """
    Privacy-safe client-side diagnostic / usage event.

    The mobile app sends only a small whitelist of app lifecycle, counter usage,
    error, API failure and distance-summary events. It never sends bearer tokens,
    request payloads, GPS points, routes, pub names, beer names, feedback text or
    contact details. ``context`` is sanitized server-side before storage.
    """

    class Severity(models.TextChoices):
        INFO = "info", "Info"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    class Event(models.TextChoices):
        APP_OPEN = "app_open", "App opened"
        APP_FOREGROUND = "app_foreground", "App foregrounded"
        WALKING_DISTANCE = "walking_distance", "Walking distance"
        COUNTER_TAB_OPENED = "counter_tab_opened", "Counter tab opened"
        COUNTER_SESSION_STARTED = "counter_session_started", "Counter session started"
        DRINK_ADDED = "drink_added", "Drink added"
        DRINK_REMOVED = "drink_removed", "Drink removed"
        DRINK_SYNCED = "drink_synced", "Drink synced"
        DRINK_SYNC_FAILED = "drink_sync_failed", "Drink sync failed"
        RATING_SYNCED = "rating_synced", "Rating synced"
        RATING_SYNC_FAILED = "rating_sync_failed", "Rating sync failed"
        VISIT_SYNCED = "visit_synced", "Visit synced"
        VISIT_SYNC_FAILED = "visit_sync_failed", "Visit sync failed"
        BEER_FORM_OPENED = "beer_form_opened", "Beer form opened"
        BEER_PRICE_ADDED = "beer_price_added", "Beer price added"
        COUNTER_RETURNED_SAME_DAY = "counter_returned_same_day", "Counter returned same day"
        COUNTER_RETURNED_LATER = "counter_returned_later", "Counter returned later"
        CONSOLE_WARN = "console_warn", "Console warning"
        CONSOLE_ERROR = "console_error", "Console error"
        UNHANDLED_ERROR = "unhandled_error", "Unhandled error"
        API_FAILURE = "api_failure", "API failure"

    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="client_events",
        help_text="Anonymous account when the app had a valid token; null for unauthenticated telemetry.",
    )
    event = models.CharField(max_length=64, choices=Event.choices, db_index=True)
    severity = models.CharField(
        max_length=16,
        choices=Severity.choices,
        default=Severity.INFO,
        db_index=True,
    )
    message = models.CharField(max_length=300, blank=True, default="")
    context = models.JSONField(default=dict, blank=True)
    app_version = models.CharField(max_length=64, blank=True, default="", db_index=True)
    platform = models.CharField(max_length=32, blank=True, default="", db_index=True)
    os_version = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Client Event"
        verbose_name_plural = "Client Events"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["event", "created_at"]),
            models.Index(fields=["severity", "created_at"]),
            models.Index(fields=["account", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"ClientEvent({self.event} [{self.severity}] @ {self.created_at:%Y-%m-%d %H:%M})"


class AccountUsageStats(models.Model):
    """
    Aggregated usage counters for one anonymous account.

    This is the admin/query-friendly layer for product statistics:
    app-open counts, active users and distance leaderboards. The distance value
    is reported by the app as meter increments only; no GPS coordinates or route
    history are stored here.
    """

    account = models.OneToOneField(
        Account,
        on_delete=models.CASCADE,
        related_name="usage_stats",
    )
    app_open_count = models.PositiveIntegerField(default=0, db_index=True)
    app_foreground_count = models.PositiveIntegerField(default=0)
    walked_distance_m = models.PositiveIntegerField(default=0, db_index=True)
    client_warning_count = models.PositiveIntegerField(default=0)
    client_error_count = models.PositiveIntegerField(default=0)
    api_failure_count = models.PositiveIntegerField(default=0)
    last_app_open_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_event_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_app_version = models.CharField(max_length=64, blank=True, default="")
    last_platform = models.CharField(max_length=32, blank=True, default="")
    last_os_version = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Account Usage Stats"
        verbose_name_plural = "Account Usage Stats"
        ordering = ["-walked_distance_m", "-app_open_count"]

    @property
    def walked_distance_km(self) -> float:
        return round(self.walked_distance_m / 1000, 2)

    def __str__(self) -> str:
        return f"AccountUsageStats({self.account.public_id} — {self.walked_distance_km} km)"


class PubCommunityData(models.Model):
    """
    Community-contributed opening hours and beers-on-tap for one pub.

    Holds the CURRENT community state per geohash-8 cell (one row per
    ``cache_key``, matching PubHours). Contributions go live immediately — this
    row is upserted on every submission — and full history is kept in
    PubContributionLog for audit / revert. Community opening hours TAKE
    PRECEDENCE over the firmy.cz-derived PubHours in the /v1/pub-hours read path.

    ``hours_json`` is the structured weekly form the client submits and prefills
    its form from. ``opening_hours_raw`` is the OSM grammar string derived from
    it so the existing is_open evaluator works unchanged.
    """

    # ---------- identity ----------
    cache_key = models.CharField(
        max_length=12,
        unique=True,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — ~38 m precision; matches PubHours.cache_key.",
    )
    name = models.CharField(max_length=255)
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.CharField(max_length=128, blank=True, null=True)
    external_id = models.CharField(
        max_length=128,
        blank=True,
        null=True,
        db_index=True,
        help_text="Client-side provider id, e.g. Mapy.cz item id.",
    )

    # ---------- opening hours ----------
    hours_json = models.JSONField(
        null=True,
        blank=True,
        help_text=(
            "Structured weekly hours as submitted: "
            '{"mo": [["11:00","23:00"]], "tu": [], ...} — all 7 keys '
            "mo/tu/we/th/fr/sa/su; an empty list means closed that day. "
            "None means no community hours have been contributed yet."
        ),
    )
    opening_hours_raw = models.TextField(
        blank=True,
        default="",
        help_text="OSM opening_hours grammar string derived from hours_json.",
    )

    # ---------- beers on tap ----------
    beers = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'List of beers on tap: '
            '[{"name": str, "price_czk": int|null, "volume_ml": int|null}].'
        ),
    )

    # ---------- contributor / timestamps ----------
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="community_data",
        help_text="The most recent contributor.",
    )
    hours_updated_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When opening hours were last contributed (None = never).",
    )
    beers_updated_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the beer list was last contributed (None = never).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Community Data"
        verbose_name_plural = "Pub Community Data"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"PubCommunityData({self.name} [{self.cache_key}])"


class BeerBrand(models.Model):
    """
    Canonical beer brand used for suggestions and brand-level pub filtering.

    User-entered beer rows stay free-text in PubCommunityData.beers because
    people often type product details ("Gambrinus 10", "Radegast Ryze hořká").
    This lookup provides the stable brand key that the backend can attach to
    drink logs and the per-pub beer-brand index without making older clients
    understand a new schema.
    """

    key = models.SlugField(
        max_length=80,
        unique=True,
        db_index=True,
        help_text="Stable ASCII identifier, e.g. pilsner-urquell.",
    )
    name = models.CharField(max_length=120, help_text="Canonical display name.")
    aliases = models.JSONField(
        default=list,
        blank=True,
        help_text="Common typed aliases used for matching and suggestions.",
    )
    rank = models.PositiveSmallIntegerField(
        default=1000,
        db_index=True,
        help_text="Lower ranks appear earlier in suggestions.",
    )
    source_label = models.CharField(max_length=160, blank=True, default="")
    source_url = models.URLField(max_length=500, blank=True, default="")
    active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Beer Brand"
        verbose_name_plural = "Beer Brands"
        ordering = ["rank", "name"]

    def __str__(self) -> str:
        return self.name


class PubBeerBrand(models.Model):
    """
    Brand-level index of what beer brands are known to be served at a pub.

    This is deliberately separate from PubCommunityData.beers. The JSON menu is
    the user-facing current menu; this table is the queryable path for future
    "show pubs that serve Pilsner Urquell" filtering.
    """

    class Source(models.TextChoices):
        COMMUNITY = "community", "Community menu"
        DRINK = "drink", "Drink log"

    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — matches PubCommunityData.cache_key.",
    )
    name = models.TextField(help_text="Pub name as submitted by the client.")
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.TextField(blank=True, default="")
    external_id = models.TextField(blank=True, default="")
    brand = models.ForeignKey(
        BeerBrand,
        on_delete=models.CASCADE,
        related_name="pub_links",
    )
    brand_key = models.SlugField(max_length=80, db_index=True)
    brand_name = models.CharField(max_length=120)
    last_price_czk = models.PositiveSmallIntegerField(null=True, blank=True)
    last_volume_ml = models.PositiveSmallIntegerField(null=True, blank=True)
    source = models.CharField(max_length=16, choices=Source.choices)
    active = models.BooleanField(default=True, db_index=True)
    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pub_beer_brands",
    )
    last_seen_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Beer Brand"
        verbose_name_plural = "Pub Beer Brands"
        ordering = ["-last_seen_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["cache_key", "brand"],
                name="unique_pub_beer_brand",
            )
        ]
        indexes = [
            models.Index(fields=["brand_key", "active"]),
            models.Index(fields=["cache_key", "active"]),
        ]

    def __str__(self) -> str:
        return f"{self.brand_name} @ {self.name} [{self.cache_key}]"


class DrinkLog(models.Model):
    """
    A single beer the user logged via the in-app beer counter.

    The mobile beer counter lets a user at a pub tally each beer they drink.
    Every counted beer carries a name and price, which the server uses to
    community-source the pub's beer menu + prices (merged into
    ``PubCommunityData.beers`` — see ``DrinksView``). This row is the per-user,
    append-only record of one drink.

    Keyed by (account, client_id): the client generates a UUID per logged drink
    and re-POSTs it verbatim on offline retries, so the unique constraint lets
    the endpoint get_or_create the same row instead of duplicating it (and skip
    repeating the menu merge on replay). ``cache_key`` is the geohash-8 cell of
    (lat, lng) — computed server-side, matching PubCommunityData / PubHours — so
    the drink merges into the same per-pub community row.
    """

    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="drinks",
        help_text="The user who logged this drink.",
    )
    client_id = models.UUIDField(
        help_text="Client-generated UUID; idempotency key for offline retries.",
    )
    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — ~38 m precision; matches PubCommunityData.cache_key.",
    )
    # TextField (not bounded CharField): free text from the client. SQLite (dev /
    # tests) silently truncates an over-length CharField while Postgres (prod)
    # raises DataError, so use unbounded TextField and let the serializer enforce
    # the length bound. Same rationale for city / external_id / beer_name below.
    name = models.TextField(help_text="Pub name as the client saw it (1..200 chars, enforced by the serializer).")
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.TextField(blank=True, default="", help_text="Optional city hint from the client.")
    external_id = models.TextField(
        blank=True,
        default="",
        help_text="Client-side provider id, e.g. Mapy.cz item id.",
    )

    # ---------- the drunk beer ----------
    beer_name = models.TextField(help_text="Beer name (1..80 chars, enforced by the serializer).")
    beer_brand = models.ForeignKey(
        BeerBrand,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drinks",
        help_text="Matched canonical brand, if the submitted beer name was recognized.",
    )
    beer_brand_key = models.SlugField(
        max_length=80,
        blank=True,
        default="",
        db_index=True,
        help_text="Denormalized BeerBrand.key for future stats/filter queries.",
    )
    beer_brand_name = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text="Denormalized BeerBrand.name as it was at log time.",
    )
    price_czk = models.PositiveSmallIntegerField(
        help_text="Price paid in CZK (1..1000) — mandatory; this is the community-sourcing hook.",
    )
    volume_ml = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Glass volume in ml (one of 300/330/400/500/1000) or null if unknown.",
    )

    # ---------- timestamps ----------
    drank_at = models.DateTimeField(
        help_text="When the beer was drunk (client-supplied ISO8601, or server now() if omitted).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Drink Log"
        verbose_name_plural = "Drink Log"
        ordering = ["-drank_at"]
        indexes = [
            models.Index(fields=["account", "drank_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_id"],
                name="unique_drink_per_account_client_id",
            )
        ]

    def __str__(self) -> str:
        return f"DrinkLog({self.beer_name} @ {self.name} [{self.cache_key}] — {self.price_czk} Kč)"


class PubRating(models.Model):
    """
    A per-user private rating of one pub, keyed by its geohash-8 cell.

    The mobile app lets a user privately rate a pub they visited: a thumbs
    up/down ``verdict``, an optional one-word ``tag`` and a free-text ``note``.
    The row is keyed by (account, geohash-8 ``cache_key``) so the same physical
    pub collapses to one rating per account regardless of which provider id the
    client saw it under.

    Sync is two-way and conflict-resolved by LAST-WRITE-WINS on
    ``client_updated_at`` (the client's local updatedAt, NOT the server's
    ``updated_at``): a PUT whose ``updated_at`` is older than the stored
    ``client_updated_at`` is ignored, so a stale offline write never clobbers a
    newer one. An empty rating (no verdict, tag, or note) deletes the row.

    This is currently PRIVATE per account, but it is the substrate future public
    aggregates (e.g. a community like/dislike ratio per pub) and achievements
    (e.g. "rated 50 pubs") will be built on, hence the geohash-8 key shared with
    PubHours / PubCommunityData.
    """

    class Verdict(models.TextChoices):
        LIKE = "like", "Like"
        DISLIKE = "dislike", "Dislike"

    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="pub_ratings",
        help_text="The user who owns this private rating.",
    )
    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — ~38 m precision; matches PubHours.cache_key.",
    )
    # TextField (not bounded CharField): free text the client controls. SQLite
    # (dev / tests) silently truncates an over-length CharField while Postgres
    # (prod) raises DataError, so use unbounded TextField and let the serializer
    # enforce the wire bound. Same rationale for external_id / tag / note below.
    name = models.TextField(
        blank=True,
        default="",
        help_text="Pub name as the client saw it (legacy ratings may have none).",
    )
    lat = models.FloatField()
    lng = models.FloatField()
    external_id = models.TextField(
        blank=True,
        default="",
        help_text="Client-side provider id, e.g. Mapy.cz item id.",
    )
    verdict = models.CharField(
        max_length=10,
        choices=Verdict.choices,
        blank=True,
        default="",
        help_text='Thumbs verdict: "like" / "dislike" / "" (none).',
    )
    tag = models.TextField(
        blank=True,
        default="",
        help_text="Optional one-word tag (<=64 chars, enforced by the serializer).",
    )
    note = models.TextField(
        blank=True,
        default="",
        help_text="Optional free-text note (<=280 chars, enforced by the serializer).",
    )
    client_updated_at = models.DateTimeField(
        help_text="Client's local updatedAt; the last-write-wins conflict key.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Rating"
        verbose_name_plural = "Pub Ratings"
        ordering = ["-client_updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "cache_key"],
                name="unique_rating_per_account_pub",
            )
        ]

    def __str__(self) -> str:
        return f"PubRating({self.name or self.cache_key} [{self.cache_key}] — {self.verdict or 'note'})"


class PubVisit(models.Model):
    """
    An explicit user visit to a pub — one "evening" out.

    Whereas DrinkLog only exists when a beer was counted, this records that the
    user was at a pub at all, so a dry visit (a soda, a coffee, just meeting
    friends) still counts. Identity of one evening is (account, ``client_id``):
    the client generates a UUID per visit and re-POSTs it verbatim on offline
    retries / when it later fills in ``ended_at``, so the unique constraint lets
    the endpoint update_or_create the same row instead of duplicating it.
    ``started_at`` is when the evening began; ``cache_key`` is the geohash-8 cell
    computed server-side.

    Future achievements (e.g. "visited 100 pubs", streaks) will be built on
    these rows.
    """

    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="pub_visits",
        help_text="The user who made this visit.",
    )
    client_id = models.UUIDField(
        help_text="Client-generated UUID; idempotency key for offline retries / updates.",
    )
    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of (lat, lng) — ~38 m precision; matches PubHours.cache_key.",
    )
    # TextField (not bounded CharField): see PubRating / DrinkLog rationale.
    name = models.TextField(help_text="Pub name as the client saw it.")
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.TextField(blank=True, default="", help_text="Optional city hint from the client.")
    external_id = models.TextField(
        blank=True,
        default="",
        help_text="Client-side provider id, e.g. Mapy.cz item id.",
    )
    started_at = models.DateTimeField(
        help_text="When the evening began — the identity of the visit.",
    )
    ended_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the evening ended (None = still open / unknown).",
    )
    client_updated_at = models.DateTimeField(
        help_text="Client's local updatedAt; the last-write-wins conflict key.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Visit"
        verbose_name_plural = "Pub Visits"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["account", "started_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_id"],
                name="unique_visit_per_account_client_id",
            )
        ]

    def __str__(self) -> str:
        return f"PubVisit({self.name} [{self.cache_key}] @ {self.started_at:%Y-%m-%d %H:%M})"


class PubSearchCache(models.Model):
    """
    Shared, DB-cached result of a Mapy.cz "pubs near" suggest search.

    The mobile app used to call Mapy.cz /v1/suggest directly from every device,
    which exhausted the shared API credit. The server now proxies that search
    (GET /v1/pubs/near) and caches the trimmed suggest items here so every user
    in the same small cache cell shares ONE upstream fetch.

    Identity is (cache_key, radius_bucket):
      * cache_key is a geohash at precision 6 (~1.2 km × 0.6 km cell). The
        upstream search still runs from the user's actual request coordinate, so
        dense-city edge cases do not inherit results from a far-away cell centre.
      * radius_bucket is the smallest of [5, 15, 50, 100] km that covers the
        requested radius — the same widening steps the search itself uses, so a
        25 km and a 40 km request in the same cell share the 50 km row.

    Rows are refreshed when older than settings.PUBS_NEAR_TTL_DAYS; a stale row
    is still served if the upstream fetch fails (better stale than nothing).
    """

    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-6 of the request coordinate — ~1.2 km × 0.6 km cell.",
    )
    radius_bucket = models.PositiveIntegerField(
        help_text="Smallest covering radius bucket in km (one of 5, 15, 50, 100).",
    )
    items = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Trimmed Mapy.cz suggest items: "
            '[{"name", "label", "position": {"lat", "lon"}, '
            '"regionalStructure": [{"name", "type"}, ...]}].'
        ),
    )
    fetched_at = models.DateTimeField(
        help_text="When the upstream Mapy.cz fetch that produced these items completed.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Pub Search Cache"
        verbose_name_plural = "Pub Search Cache"
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["cache_key", "radius_bucket"],
                name="unique_pub_search_cache_cell_radius",
            )
        ]

    def __str__(self) -> str:
        return f"PubSearchCache({self.cache_key} @ {self.radius_bucket}km — {len(self.items)} items)"


class PubContributionLog(models.Model):
    """
    Append-only history of community contributions, for audit and revert.

    One row per (account, client_id, kind): the client generates a UUID per
    submission and re-POSTs it verbatim on offline retries, so the unique
    constraint lets the endpoint get_or_create the same row instead of
    duplicating it. ``payload`` stores exactly what was submitted for that kind
    (the hours_json dict or the beers list).
    """

    class Kind(models.TextChoices):
        HOURS = "hours", "Opening hours"
        BEERS = "beers", "Beers on tap"

    account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contribution_logs",
    )
    cache_key = models.CharField(
        max_length=12,
        db_index=True,
        help_text="Geohash-8 of the contributed pub coordinates.",
    )
    name = models.CharField(max_length=255)
    lat = models.FloatField()
    lng = models.FloatField()
    kind = models.CharField(max_length=16, choices=Kind.choices, db_index=True)
    payload = models.JSONField(
        help_text="The submitted data for this kind (hours_json dict or beers list).",
    )
    client_id = models.UUIDField(
        help_text="Client-generated UUID; idempotency key for offline retries.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Pub Contribution Log"
        verbose_name_plural = "Pub Contribution Log"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_id", "kind"],
                name="unique_contribution_per_account_client_id_kind",
            )
        ]

    def __str__(self) -> str:
        return f"PubContributionLog({self.name} [{self.cache_key}] — {self.kind})"

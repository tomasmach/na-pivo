"""
Data models for the na-pivo pub-hours enrichment service.

PubHours  — the cached result of enriching a pub with opening hours from Firmy.cz.
EnrichTask — a queued enrichment job for pubs that missed the sync_budget.
PubReport — user reports for places that should no longer be shown as pubs.
ReleaseNote — a "what's new" entry shown once after the app updates to a version.
FeedbackReport — an in-app feedback / bug report submitted by a user.
PubCommunityData — current community-contributed hours + beers for a pub.
PubContributionLog — append-only history of community contributions.
"""

import hashlib
import secrets
import uuid

from django.db import models
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
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    error = models.TextField(blank=True, null=True)

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
        # No db_index — unique=True already creates the lookup index (auth does an
        # exact-match lookup, never a prefix LIKE). Setting db_index=True too made
        # migration 0004 create the Postgres varchar_pattern_ops "_like" index
        # twice (AddField + AlterField) and fail: relation "..._like" already exists.
        help_text="SHA-256 hex digest of the bearer token. The raw token is "
        "returned once at registration and never stored, so a DB leak exposes "
        "only non-reversible hashes.",
    )

    # ---------- timestamps ----------
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Account"
        verbose_name_plural = "Accounts"
        ordering = ["-created_at"]

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

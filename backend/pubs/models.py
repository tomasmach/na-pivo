"""
Data models for the na-pivo pub-hours enrichment service.

PubHours  — the cached result of enriching a pub with opening hours from Firmy.cz.
EnrichTask — a queued enrichment job for pubs that missed the sync_budget.
"""

import hashlib
import secrets
import uuid

from django.db import models


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
        db_index=True,
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

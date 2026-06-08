"""
Data models for the na-pivo pub-hours enrichment service.

PubHours  — the cached result of enriching a pub with opening hours from Firmy.cz.
EnrichTask — a queued enrichment job for pubs that missed the sync_budget.
"""

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
    opening_hours_raw = models.CharField(
        max_length=512,
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

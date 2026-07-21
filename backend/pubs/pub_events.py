from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class PubEvent(models.Model):
    """A time-bounded community event suggestion awaiting human verification."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="pub_event_suggestions",
    )
    client_id = models.UUIDField()
    cache_key = models.CharField(max_length=12, db_index=True)
    name = models.CharField(max_length=200)
    lat = models.FloatField()
    lng = models.FloatField()
    city = models.CharField(max_length=200, blank=True)
    external_id = models.CharField(max_length=255, blank=True)
    title = models.CharField(max_length=120)
    details = models.CharField(max_length=500, blank=True)
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField(db_index=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["starts_at", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "client_id"],
                name="unique_pub_event_client_id_per_account",
            ),
            models.CheckConstraint(
                condition=models.Q(ends_at__gt=models.F("starts_at")),
                name="pub_event_ends_after_start",
            ),
        ]
        indexes = [
            models.Index(
                fields=["cache_key", "status", "ends_at"],
                name="pub_event_active_lookup",
            ),
        ]

    def save(self, *args, **kwargs) -> None:
        if self.status == self.Status.VERIFIED and self.verified_at is None:
            self.verified_at = timezone.now()
        elif self.status != self.Status.VERIFIED:
            self.verified_at = None
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.title} at {self.name}"

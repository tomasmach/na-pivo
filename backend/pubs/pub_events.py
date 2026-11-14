from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class PubEvent(models.Model):
    """A time-bounded community event suggestion awaiting human verification."""

    class Status(models.TextChoices):
        PENDING = "pending", "Čeká na ověření"
        VERIFIED = "verified", "Ověřená"
        REJECTED = "rejected", "Zamítnutá"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name="ID (technické)")
    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="pub_event_suggestions",
        verbose_name="Přidal",
    )
    client_id = models.UUIDField(verbose_name="ID z appky (technické)")
    cache_key = models.CharField(max_length=12, db_index=True, verbose_name="Klíč místa (technické)")
    name = models.CharField(max_length=200, verbose_name="Hospoda")
    lat = models.FloatField(verbose_name="Zeměpisná šířka")
    lng = models.FloatField(verbose_name="Zeměpisná délka")
    city = models.CharField(max_length=200, blank=True, verbose_name="Město")
    external_id = models.CharField(max_length=255, blank=True, verbose_name="ID u poskytovatele mapy (technické)")
    title = models.CharField(max_length=120, verbose_name="Název akce")
    details = models.CharField(max_length=500, blank=True, verbose_name="Podrobnosti")
    starts_at = models.DateTimeField(db_index=True, verbose_name="Začátek")
    ends_at = models.DateTimeField(db_index=True, verbose_name="Konec")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        verbose_name="Stav",
    )
    verified_at = models.DateTimeField(null=True, blank=True, verbose_name="Ověřeno")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Vytvořeno")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Upraveno")

    class Meta:
        verbose_name = "akce hospody"
        verbose_name_plural = "akce hospod"
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
        return f"{self.title}, {self.name}"

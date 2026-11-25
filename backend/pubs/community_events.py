from __future__ import annotations

import uuid

from django.db import models

from .display import account_label, czech_day

COMMUNITY_EVENT_TEAM_MAX_MEMBERS = 4


class CommunityEvent(models.Model):
    """Small, adult-only hosted gathering with privacy-gated exact location."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Aktivní"
        CANCELLED = "cancelled", "Zrušená"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name="ID (technické)")
    host = models.ForeignKey(
        "pubs.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hosted_community_events",
        verbose_name="Pořadatel",
    )
    client_id = models.UUIDField(verbose_name="ID z appky (technické)")
    title = models.CharField(max_length=120, verbose_name="Název")
    description = models.CharField(max_length=800, blank=True, default="", verbose_name="Popis")
    city = models.CharField(max_length=120, verbose_name="Město")
    area_label = models.CharField(max_length=120, blank=True, default="", verbose_name="Oblast")
    exact_address = models.CharField(max_length=300, verbose_name="Přesná adresa")
    lat = models.FloatField(verbose_name="Zeměpisná šířka")
    lng = models.FloatField(verbose_name="Zeměpisná délka")
    starts_at = models.DateTimeField(db_index=True, verbose_name="Začátek")
    ends_at = models.DateTimeField(db_index=True, verbose_name="Konec")
    capacity = models.PositiveSmallIntegerField(verbose_name="Kapacita")
    adults_only = models.BooleanField(default=True, verbose_name="Jen 18+")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
        verbose_name="Stav",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True, verbose_name="Zrušeno")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Vytvořeno")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Upraveno")

    class Meta:
        verbose_name = "komunitní akce"
        verbose_name_plural = "komunitní akce"
        ordering = ["starts_at", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["host", "client_id"],
                name="unique_community_event_host_client",
            ),
            models.CheckConstraint(
                condition=models.Q(ends_at__gt=models.F("starts_at")),
                name="community_event_ends_after_start",
            ),
            models.CheckConstraint(
                condition=models.Q(capacity__gte=2, capacity__lte=20),
                name="community_event_capacity_2_20",
            ),
            models.CheckConstraint(
                condition=models.Q(adults_only=True),
                name="community_event_adults_only",
            ),
        ]
        indexes = [
            models.Index(
                fields=["status", "starts_at", "ends_at"],
                name="community_event_discovery",
            ),
            models.Index(
                fields=["host", "status", "starts_at"],
                name="community_event_host_lookup",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.title}, {czech_day(self.starts_at)}"


class CommunityEventMembership(models.Model):
    """Join request and its lifecycle; approval unlocks the exact address."""

    class Status(models.TextChoices):
        PENDING = "pending", "Čeká"
        APPROVED = "approved", "Schváleno"
        REJECTED = "rejected", "Zamítnuto"
        CANCELLED = "cancelled", "Zrušeno"
        LEFT = "left", "Odešel"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name="ID (technické)")
    event = models.ForeignKey(
        CommunityEvent,
        on_delete=models.CASCADE,
        related_name="memberships",
        verbose_name="Akce",
    )
    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="community_event_memberships",
        verbose_name="Účet",
    )
    message = models.CharField(max_length=240, blank=True, default="", verbose_name="Zpráva")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        verbose_name="Stav",
    )
    requested_at = models.DateTimeField(auto_now_add=True, verbose_name="Požádáno")
    decided_at = models.DateTimeField(null=True, blank=True, verbose_name="Rozhodnuto")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Upraveno")

    class Meta:
        verbose_name = "účast na akci"
        verbose_name_plural = "účasti na akci"
        ordering = ["requested_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "account"],
                name="unique_community_event_member",
            )
        ]
        indexes = [
            models.Index(
                fields=["event", "status", "requested_at"],
                name="community_event_request_lookup",
            )
        ]

    def __str__(self) -> str:
        return f"{account_label(self)}, {self.event.title}"


class CommunityEventTeam(models.Model):
    """A named team inside one community event."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        CommunityEvent,
        on_delete=models.CASCADE,
        related_name="teams",
    )
    created_by = models.ForeignKey(
        "pubs.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_community_event_teams",
    )
    client_id = models.UUIDField()
    name = models.CharField(max_length=40)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "client_id"],
                name="unique_event_team_client",
            )
        ]
        indexes = [
            models.Index(
                fields=["event", "created_at"],
                name="community_team_event_lookup",
            )
        ]


class CommunityEventTeamMembership(models.Model):
    """One participant's race-safe seat in an event team."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        CommunityEvent,
        on_delete=models.CASCADE,
        related_name="team_memberships",
    )
    team = models.ForeignKey(
        CommunityEventTeam,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="community_event_team_memberships",
    )
    # The seat is deliberately persisted. The unique constraint is the final
    # guard against a fifth member when two joins arrive at the same time.
    slot = models.PositiveSmallIntegerField()
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["slot", "joined_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "account"],
                name="unique_event_team_account",
            ),
            models.UniqueConstraint(
                fields=["team", "account"],
                name="unique_team_account",
            ),
            models.UniqueConstraint(
                fields=["team", "slot"],
                name="unique_event_team_slot",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    slot__gte=1,
                    slot__lte=COMMUNITY_EVENT_TEAM_MAX_MEMBERS,
                ),
                name="event_team_slot_1_4",
            ),
        ]

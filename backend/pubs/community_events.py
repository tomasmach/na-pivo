from __future__ import annotations

import uuid

from django.db import models


class CommunityEvent(models.Model):
    """Small, adult-only hosted gathering with privacy-gated exact location."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    host = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="hosted_community_events",
    )
    client_id = models.UUIDField()
    title = models.CharField(max_length=120)
    description = models.CharField(max_length=800, blank=True, default="")
    city = models.CharField(max_length=120)
    area_label = models.CharField(max_length=120, blank=True, default="")
    exact_address = models.CharField(max_length=300)
    lat = models.FloatField()
    lng = models.FloatField()
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField(db_index=True)
    capacity = models.PositiveSmallIntegerField()
    adults_only = models.BooleanField(default=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
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


class CommunityEventMembership(models.Model):
    """Join request and its lifecycle; approval unlocks the exact address."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"
        LEFT = "left", "Left"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        CommunityEvent,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    account = models.ForeignKey(
        "pubs.Account",
        on_delete=models.CASCADE,
        related_name="community_event_memberships",
    )
    message = models.CharField(max_length=240, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
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

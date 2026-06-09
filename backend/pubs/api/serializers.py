"""
pubs.api.serializers — request/response serializers for the pub-hours API.

Request body (POST /v1/pub-hours):
    {
        "pubs": [{"name": str, "lat": float, "lng": float, "city"?: str}],
        "sync_budget"?: int  -- max pubs to enrich synchronously (default SYNC_ENRICH_BUDGET)
    }

Response body:
    {
        "results": [
            {
                "key": str,         -- geohash-8 cache key
                "name": str,
                "opening_hours": str|null,
                "isOpenNow": bool|null,
                "nextChange": str|null,  -- ISO-8601 datetime WITH Europe/Prague offset
                                         --   (e.g. 2026-06-08T23:00:00+02:00), NOT UTC.
                                         --   The mobile chip reads the literal HH:MM as
                                         --   Prague wall-clock, so do not normalise to UTC.
                "status": "ok|unknown|pending|error",
                "source": str|null,
                "confidence": float|null
            }
        ]
    }
"""

from __future__ import annotations

import uuid

from rest_framework import serializers

from pubs.models import Account

# ---------------------------------------------------------------------------
# Request serializers
# ---------------------------------------------------------------------------


class PubInputSerializer(serializers.Serializer):
    """A single pub entry in the request body."""

    name = serializers.CharField(max_length=255)
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    city = serializers.CharField(max_length=128, required=False, allow_null=True, allow_blank=True)

    def validate_lat(self, value: float) -> float:
        if not (-90.0 <= value <= 90.0):
            raise serializers.ValidationError("Latitude must be between -90 and 90.")
        return value

    def validate_lng(self, value: float) -> float:
        if not (-180.0 <= value <= 180.0):
            raise serializers.ValidationError("Longitude must be between -180 and 180.")
        return value


class PubHoursRequestSerializer(serializers.Serializer):
    """Top-level request body for POST /v1/pub-hours."""

    pubs = PubInputSerializer(many=True, min_length=1)
    # Hard upper bound on synchronous (in-request) fetches a client may request.
    # Each sync fetch is throttled (~FIRMY_MIN_INTERVAL_SEC), so an unbounded
    # value would let a single request tie the worker up for minutes. The value
    # is further clamped server-side to settings.SYNC_ENRICH_BUDGET in
    # get_or_enrich; this max_value is the request-level ceiling.
    sync_budget = serializers.IntegerField(
        required=False, allow_null=True, min_value=0, max_value=5
    )

    def validate_pubs(self, value: list) -> list:
        if len(value) > 50:
            raise serializers.ValidationError("At most 50 pubs may be queried at once.")
        return value


# ---------------------------------------------------------------------------
# Response serializers
# ---------------------------------------------------------------------------


class PubHoursResultSerializer(serializers.Serializer):
    """A single result entry in the response body."""

    key = serializers.CharField()
    name = serializers.CharField()
    opening_hours = serializers.CharField(allow_null=True)
    isOpenNow = serializers.BooleanField(allow_null=True)
    nextChange = serializers.CharField(allow_null=True)  # ISO-8601 w/ Europe/Prague offset
    status = serializers.CharField()
    source = serializers.CharField(allow_null=True)
    confidence = serializers.FloatField(allow_null=True)


class PubHoursResponseSerializer(serializers.Serializer):
    """Top-level response body for POST /v1/pub-hours."""

    results = PubHoursResultSerializer(many=True)


# ---------------------------------------------------------------------------
# Account serializers
# ---------------------------------------------------------------------------


class AccountRegisterSerializer(serializers.Serializer):
    """Request body for POST /v1/account."""

    device_id = serializers.CharField(max_length=64, min_length=1, trim_whitespace=True)

    def validate_device_id(self, value: str) -> str:
        # The client always generates a UUID v4. Enforcing UUID format keeps the
        # account-creation key space narrow — a bare CharField would let an
        # attacker spam arbitrary strings — and matches the documented contract.
        try:
            uuid.UUID(value)
        except (ValueError, AttributeError, TypeError) as exc:
            raise serializers.ValidationError("device_id must be a valid UUID.") from exc
        return value


class AccountSerializer(serializers.ModelSerializer):
    """Account fields returned by POST /v1/account. The raw ``token`` is NOT a
    model field (only its hash is stored), so the view injects it into the
    response separately."""

    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = Account
        fields = ["id", "device_id", "created_at"]


class AccountMeSerializer(serializers.ModelSerializer):
    """Account view returned by GET /v1/account/me — NEVER exposes the token."""

    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = Account
        fields = ["id", "device_id", "created_at", "last_seen_at"]

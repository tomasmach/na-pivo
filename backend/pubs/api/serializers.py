"""
pubs.api.serializers — request/response serializers for the pub-hours API.

Request body (POST /v1/pub-hours):
    {
        "pubs": [{"name": str, "lat": float, "lng": float, "city"?: str}],
        "sync_budget"?: int  -- max pubs to enrich synchronously; 0 = queue-only
                               -- (default SYNC_ENRICH_BUDGET)
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
                "confidence": float|null,
                "rating": float|null,       -- source star rating, 0-5
                "ratingCount": int|null,    -- number of source ratings
                "ratingLabel": str|null,    -- source label, e.g. "Velmi dobré"
                "venueKind": "pub|maybe|not_pub|unknown"  -- draft-beer classification
            }
        ]
    }
"""

from __future__ import annotations

import re
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import EmailValidator
from rest_framework import serializers

from pubs.models import (
    Account,
    ClientEvent,
    FeedbackReport,
    PubRating,
    PubReport,
    ReleaseNote,
    UserAddedPub,
)

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


class PubReportRequestSerializer(PubInputSerializer):
    """Request body for POST /v1/pub-reports."""

    reason = serializers.ChoiceField(choices=PubReport.Reason.choices)
    external_id = serializers.CharField(
        max_length=128,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    address = serializers.CharField(
        max_length=255,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )


class UserAddedPubRequestSerializer(PubInputSerializer):
    """Request body for POST /v1/pubs.

    Lets a user add a pub missing from the nearby search results. Coordinates
    are still bounds-checked by PubInputSerializer; the fields below are the
    retry idempotency key and optional human location hints.
    """

    client_id = serializers.UUIDField()
    address = serializers.CharField(
        max_length=255,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Pub name must not be empty.")
        if len(value) > 200:
            raise serializers.ValidationError("Pub name must be at most 200 characters.")
        return value


class FeedbackRequestSerializer(serializers.Serializer):
    """Request body for POST /v1/feedback."""

    client_id = serializers.UUIDField()
    category = serializers.ChoiceField(choices=FeedbackReport.Category.choices)
    message = serializers.CharField(max_length=4000, trim_whitespace=True)
    contact_type = serializers.ChoiceField(
        choices=FeedbackReport.ContactType.choices,
        required=False,
        allow_blank=True,
        default="",
    )
    contact = serializers.CharField(
        max_length=254, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    app_version = serializers.CharField(
        max_length=64, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    platform = serializers.CharField(
        max_length=32, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    os_version = serializers.CharField(
        max_length=64, required=False, allow_blank=True, default="", trim_whitespace=True
    )

    def validate_message(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Message must not be empty.")
        return value

    def validate(self, attrs: dict) -> dict:
        contact = (attrs.get("contact") or "").strip()
        contact_type = attrs.get("contact_type") or ""

        if not contact:
            # No contact given — normalise both fields to empty.
            attrs["contact"] = ""
            attrs["contact_type"] = ""
            return attrs

        if contact_type == FeedbackReport.ContactType.EMAIL:
            try:
                EmailValidator()(contact)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(
                    {"contact": "Enter a valid e-mail address."}
                ) from exc
        elif contact_type == FeedbackReport.ContactType.INSTAGRAM:
            # Store the bare handle without a single leading "@".
            contact = contact.removeprefix("@")
        else:
            raise serializers.ValidationError(
                {"contact_type": "contact_type is required when contact is given."}
            )

        attrs["contact"] = contact
        attrs["contact_type"] = contact_type
        return attrs


# ---------------------------------------------------------------------------
# Client observability (POST /v1/client-events)
# ---------------------------------------------------------------------------

_MAX_CLIENT_EVENT_CONTEXT_KEYS = 16
_MAX_CLIENT_EVENT_DISTANCE_M = 50_000
_CLIENT_EVENT_CONTEXT_KEYS = {
    "operation",
    "endpoint",
    "status",
    "reason",
    "error_name",
    "error_message",
    "stack",
    "source",
    "mode",
    "queue",
    "pending_count",
    "sync_result",
    "delivery_state",
    "return_days",
    "had_active_session",
    "retryable",
    "distance_m",
    "duration_ms",
}
_EMAIL_RE = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-z]{2,}")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
_LONG_TOKEN_RE = re.compile(r"\b[A-Za-z0-9._~+/=-]{32,}\b")


def _sanitize_client_text(value: object, *, max_len: int) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = _BEARER_RE.sub("Bearer [redacted]", text)
    text = _EMAIL_RE.sub("[redacted-email]", text)
    text = _UUID_RE.sub("[redacted-uuid]", text)
    text = _LONG_TOKEN_RE.sub("[redacted-token]", text)
    return text[:max_len]


def _sanitize_client_scalar(key: str, value: object) -> object | None:
    if value is None:
        return None

    if key == "endpoint":
        return _sanitize_client_text(value, max_len=240).split("?", 1)[0]

    if key == "distance_m":
        try:
            distance = int(value)
        except (TypeError, ValueError):
            return None
        return max(0, min(distance, _MAX_CLIENT_EVENT_DISTANCE_M))

    if key in {"status", "pending_count", "return_days", "duration_ms"}:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value

    max_len = 800 if key == "stack" else 240
    return _sanitize_client_text(value, max_len=max_len)


class ClientEventRequestSerializer(serializers.Serializer):
    """Sanitized client telemetry event.

    The backend intentionally stores only a strict event/context whitelist. This
    keeps telemetry useful for aggregate diagnostics while avoiding bearer
    tokens, coordinates, free-form request payloads and user-entered content.
    """

    event = serializers.ChoiceField(choices=ClientEvent.Event.choices)
    severity = serializers.ChoiceField(
        choices=ClientEvent.Severity.choices,
        required=False,
        default=ClientEvent.Severity.INFO,
    )
    message = serializers.CharField(
        max_length=300,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )
    context = serializers.JSONField(required=False, default=dict)
    app_version = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )
    platform = serializers.CharField(
        max_length=32,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )
    os_version = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )

    def validate_message(self, value: str) -> str:
        return _sanitize_client_text(value, max_len=300)

    def validate_context(self, value: object) -> dict:
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("context must be an object.")

        sanitized: dict[str, object] = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key)
            if key not in _CLIENT_EVENT_CONTEXT_KEYS:
                continue
            clean_value = _sanitize_client_scalar(key, raw_value)
            if clean_value is None:
                continue
            sanitized[key] = clean_value
            if len(sanitized) >= _MAX_CLIENT_EVENT_CONTEXT_KEYS:
                break
        return sanitized


# ---------------------------------------------------------------------------
# Community contribution (POST /v1/pub-community)
# ---------------------------------------------------------------------------

# The 7 weekday keys the structured community hours dict must contain, in order.
_COMMUNITY_DAY_KEYS = ("mo", "tu", "we", "th", "fr", "sa", "su")
# Allowed beer glass volumes (ml). None is also allowed (unknown).
_ALLOWED_VOLUMES_ML = {300, 330, 400, 500, 1000}
_MAX_INTERVALS_PER_DAY = 3
_MAX_BEERS = 12


def _validate_hhmm(value: str) -> str:
    """Validate a "HH:MM" 24-hour time string; return it unchanged or raise."""
    if not isinstance(value, str):
        raise serializers.ValidationError("Time must be a 'HH:MM' string.")
    parts = value.split(":")
    if len(parts) != 2 or not (parts[0].isdigit() and parts[1].isdigit()):
        raise serializers.ValidationError(f"Invalid time {value!r}; expected 'HH:MM'.")
    hh, mm = int(parts[0]), int(parts[1])
    # Allow 24:00 as an end-of-day marker (OSM-legal); otherwise 00:00–23:59.
    if not (0 <= hh <= 24 and 0 <= mm <= 59) or (hh == 24 and mm != 0):
        raise serializers.ValidationError(f"Time out of range: {value!r}.")
    return f"{hh:02d}:{mm:02d}"


class CommunityBeerSerializer(serializers.Serializer):
    """A single beer-on-tap entry in a community contribution."""

    name = serializers.CharField(max_length=80, min_length=1, trim_whitespace=True)
    price_czk = serializers.IntegerField(
        required=False, allow_null=True, min_value=1, max_value=1000
    )
    volume_ml = serializers.IntegerField(required=False, allow_null=True)

    def validate_volume_ml(self, value: int | None) -> int | None:
        if value is None:
            return None
        if value not in _ALLOWED_VOLUMES_ML:
            raise serializers.ValidationError(
                f"volume_ml must be one of {sorted(_ALLOWED_VOLUMES_ML)}."
            )
        return value

    def to_representation(self, instance: dict) -> dict:
        # Always emit the canonical shape with all three keys present.
        return {
            "name": instance.get("name"),
            "price_czk": instance.get("price_czk"),
            "volume_ml": instance.get("volume_ml"),
        }


class PubCommunityRequestSerializer(PubInputSerializer):
    """Request body for POST /v1/pub-community.

    Inherits name/lat/lng/city (+ lat/lng bounds) from PubInputSerializer and
    adds the community payload. At least one of ``hours`` / ``beers`` must be
    given.
    """

    client_id = serializers.UUIDField()
    external_id = serializers.CharField(
        max_length=128,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    # hours: dict of the 7 day keys → list of [start, end] pairs (validated in
    # validate_hours). beers: list of beer dicts (validated by the child
    # serializer + count in validate_beers).
    hours = serializers.DictField(required=False, allow_null=True)
    beers = CommunityBeerSerializer(many=True, required=False)

    def validate_hours(self, value: dict | None) -> dict | None:
        if value is None:
            return None
        keys = set(value.keys())
        expected = set(_COMMUNITY_DAY_KEYS)
        if keys != expected:
            raise serializers.ValidationError(
                f"hours must contain exactly the 7 day keys {list(_COMMUNITY_DAY_KEYS)}."
            )

        cleaned: dict[str, list] = {}
        for day in _COMMUNITY_DAY_KEYS:
            intervals = value[day]
            if not isinstance(intervals, list):
                raise serializers.ValidationError(
                    f"hours[{day!r}] must be a list of [start, end] pairs."
                )
            if len(intervals) > _MAX_INTERVALS_PER_DAY:
                raise serializers.ValidationError(
                    f"hours[{day!r}] allows at most {_MAX_INTERVALS_PER_DAY} intervals."
                )
            cleaned_intervals: list[list[str]] = []
            for pair in intervals:
                if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                    raise serializers.ValidationError(
                        f"hours[{day!r}] entries must be [start, end] pairs."
                    )
                start = _validate_hhmm(pair[0])
                end = _validate_hhmm(pair[1])
                if start == end:
                    raise serializers.ValidationError(
                        f"hours[{day!r}] interval {start}-{end} is empty (start == end)."
                    )
                # Overnight intervals (end < start) are intentionally allowed.
                cleaned_intervals.append([start, end])
            cleaned[day] = cleaned_intervals
        return cleaned

    def validate_beers(self, value: list) -> list:
        if len(value) > _MAX_BEERS:
            raise serializers.ValidationError(
                f"At most {_MAX_BEERS} beers may be submitted."
            )
        # Canonicalise every entry to all three keys so the stored JSON (and the
        # /v1/pub-hours read path) has a stable shape regardless of which
        # optional fields the client sent.
        return [
            {
                "name": beer["name"],
                "price_czk": beer.get("price_czk"),
                "volume_ml": beer.get("volume_ml"),
            }
            for beer in value
        ]

    def validate(self, attrs: dict) -> dict:
        has_hours = attrs.get("hours") is not None
        # `beers` is absent when not sent; an explicit empty list still counts as
        # a beers contribution (it clears the list).
        has_beers = "beers" in attrs
        if not has_hours and not has_beers:
            raise serializers.ValidationError(
                "At least one of 'hours' or 'beers' must be provided."
            )
        return attrs


# ---------------------------------------------------------------------------
# Drink logging (POST /v1/drinks)
# ---------------------------------------------------------------------------


class DrinkBeerSerializer(CommunityBeerSerializer):
    """A single drunk beer in a drink-log submission.

    Identical bounds to CommunityBeerSerializer (name 1..80, price 1..1000,
    volume_ml ∈ {300,330,400,500,1000} or null) except ``price_czk`` is
    REQUIRED — a logged drink always carries a price, which is the
    community-sourcing hook that feeds the pub's beer menu.
    """

    price_czk = serializers.IntegerField(required=True, min_value=1, max_value=1000)


class DrinkRequestSerializer(PubInputSerializer):
    """Request body for POST /v1/drinks.

    Inherits name/lat/lng/city (+ lat/lng bounds) from PubInputSerializer and
    adds the idempotency key, optional external id, the required ``beer`` (with a
    mandatory price), and an optional ``drank_at`` (server defaults to now()).
    """

    client_id = serializers.UUIDField()
    external_id = serializers.CharField(
        max_length=128,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    beer = DrinkBeerSerializer()
    drank_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_name(self, value: str) -> str:
        # Pub name bound for drinks is 1..200 (PubInputSerializer caps the field
        # at 255 via CharField; tighten to the wire contract here).
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Pub name must not be empty.")
        if len(value) > 200:
            raise serializers.ValidationError("Pub name must be at most 200 characters.")
        return value

    def validate_beer(self, value: dict) -> dict:
        # Canonicalise to all three keys so the merge + stored JSON have a stable
        # shape, matching CommunityBeerSerializer.to_representation output.
        return {
            "name": value["name"],
            "price_czk": value["price_czk"],
            "volume_ml": value.get("volume_ml"),
        }


# ---------------------------------------------------------------------------
# Pub ratings (PUT/GET /v1/pub-ratings, DELETE /v1/pub-ratings/<cache_key>)
# ---------------------------------------------------------------------------


class PubRatingRequestSerializer(PubInputSerializer):
    """Request body for PUT /v1/pub-ratings (upsert one private rating).

    Inherits lat/lng (+ bounds) and city from PubInputSerializer, but loosens
    ``name`` to optional/blank with a "" default — legacy ratings created before
    names were stored may not carry one. ``updated_at`` is the client's local
    updatedAt that drives last-write-wins.
    """

    # Override the inherited required name field: a rating may have no pub name.
    name = serializers.CharField(
        max_length=255, required=False, allow_null=True, allow_blank=True, default=""
    )
    external_id = serializers.CharField(
        max_length=128,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    verdict = serializers.ChoiceField(
        choices=PubRating.Verdict.choices,
        required=False,
        allow_null=True,
        allow_blank=True,
    )
    tag = serializers.CharField(
        max_length=64, required=False, allow_null=True, allow_blank=True, trim_whitespace=True
    )
    note = serializers.CharField(
        max_length=280, required=False, allow_null=True, allow_blank=True, trim_whitespace=True
    )
    updated_at = serializers.DateTimeField()


class PubVisitRequestSerializer(PubInputSerializer):
    """Request body for POST /v1/pub-visits (push one explicit visit).

    Inherits name/lat/lng (+ bounds) and city from PubInputSerializer and adds
    the idempotency key, optional external id, and the visit's start/end times.
    """

    client_id = serializers.UUIDField()
    external_id = serializers.CharField(
        max_length=128,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    started_at = serializers.DateTimeField()
    ended_at = serializers.DateTimeField(required=False, allow_null=True)
    updated_at = serializers.DateTimeField()

    def validate(self, attrs: dict) -> dict:
        ended_at = attrs.get("ended_at")
        if ended_at is not None and ended_at < attrs["started_at"]:
            raise serializers.ValidationError(
                {"ended_at": "ended_at must be greater than or equal to started_at."}
            )
        return attrs


class PubReportBlockedQuerySerializer(serializers.Serializer):
    """Query params for GET /v1/pub-reports/blocked."""

    lat = serializers.FloatField()
    lng = serializers.FloatField()
    radius_km = serializers.FloatField(required=False, min_value=0.1, max_value=100.0)

    def validate_lat(self, value: float) -> float:
        if not (-90.0 <= value <= 90.0):
            raise serializers.ValidationError("Latitude must be between -90 and 90.")
        return value

    def validate_lng(self, value: float) -> float:
        if not (-180.0 <= value <= 180.0):
            raise serializers.ValidationError("Longitude must be between -180 and 180.")
        return value


# Default radius for GET /v1/pubs/near when the client omits radius_km.
PUBS_NEAR_DEFAULT_RADIUS_KM = 25.0
# Hard ceiling on the requested radius (matches the largest Mapy bbox step).
PUBS_NEAR_MAX_RADIUS_KM = 100.0


class PubsNearQuerySerializer(serializers.Serializer):
    """Query params for GET /v1/pubs/near.

    radius_km is optional and clamped to (0, 100]; when omitted it defaults to
    PUBS_NEAR_DEFAULT_RADIUS_KM. lat/lng are bounds-checked like the other geo
    serializers.
    """

    lat = serializers.FloatField()
    lng = serializers.FloatField()
    radius_km = serializers.FloatField(required=False, allow_null=True)

    def validate_lat(self, value: float) -> float:
        if not (-90.0 <= value <= 90.0):
            raise serializers.ValidationError("Latitude must be between -90 and 90.")
        return value

    def validate_lng(self, value: float) -> float:
        if not (-180.0 <= value <= 180.0):
            raise serializers.ValidationError("Longitude must be between -180 and 180.")
        return value

    def validate_radius_km(self, value: float | None) -> float:
        # Default when omitted/null; otherwise clamp into (0, 100]. A value <= 0
        # is rejected (a zero-radius search is meaningless); values above the cap
        # are clamped down rather than rejected, mirroring the client's max bbox.
        if value is None:
            return PUBS_NEAR_DEFAULT_RADIUS_KM
        if value <= 0:
            raise serializers.ValidationError("radius_km must be greater than 0.")
        return min(value, PUBS_NEAR_MAX_RADIUS_KM)

    def validate(self, attrs: dict) -> dict:
        # Ensure radius_km is always present in validated_data even when omitted
        # (validate_radius_km only runs when the field is supplied).
        attrs.setdefault("radius_km", PUBS_NEAR_DEFAULT_RADIUS_KM)
        return attrs


class PubLocationLookupQuerySerializer(serializers.Serializer):
    """Query params for Mapy-backed pub name/address lookup endpoints."""

    query = serializers.CharField(max_length=150, trim_whitespace=True)
    lat = serializers.FloatField(required=False)
    lng = serializers.FloatField(required=False)

    def validate_query(self, value: str) -> str:
        if len(value) < 2:
            raise serializers.ValidationError("query must be at least 2 characters.")
        return value

    def validate_lat(self, value: float) -> float:
        if not (-90.0 <= value <= 90.0):
            raise serializers.ValidationError("Latitude must be between -90 and 90.")
        return value

    def validate_lng(self, value: float) -> float:
        if not (-180.0 <= value <= 180.0):
            raise serializers.ValidationError("Longitude must be between -180 and 180.")
        return value

    def validate(self, attrs: dict) -> dict:
        has_lat = "lat" in attrs
        has_lng = "lng" in attrs
        if has_lat != has_lng:
            raise serializers.ValidationError("lat and lng must be provided together.")
        return attrs


# ---------------------------------------------------------------------------
# Response serializers
# ---------------------------------------------------------------------------


class PubHoursResultSerializer(serializers.Serializer):
    """A single result entry in the response body.

    ``source`` is "community" when community-contributed hours overrode the
    firmy data, otherwise the firmy source ("firmy") or null. ``beers`` is
    always present: the community beer list, or an empty list when there is no
    community data. ``hours_json`` is the structured community hours (for client
    form prefill) when community hours exist, else null.
    """

    key = serializers.CharField()
    name = serializers.CharField()
    opening_hours = serializers.CharField(allow_null=True)
    isOpenNow = serializers.BooleanField(allow_null=True)
    nextChange = serializers.CharField(allow_null=True)  # ISO-8601 w/ Europe/Prague offset
    status = serializers.CharField()
    source = serializers.CharField(allow_null=True)
    confidence = serializers.FloatField(allow_null=True)
    rating = serializers.FloatField(allow_null=True)
    ratingCount = serializers.IntegerField(allow_null=True)
    ratingLabel = serializers.CharField(allow_null=True)
    # Draft-beer classification: one of "pub" | "maybe" | "not_pub" | "unknown".
    # A pub with no PubHours row, or one we couldn't classify, is "unknown".
    # Non-empty community beers force "pub" (the community knows best).
    venueKind = serializers.CharField()
    beers = serializers.ListField(child=serializers.DictField(), default=list)
    hours_json = serializers.JSONField(allow_null=True, required=False)


class PubCommunityResponseSerializer(serializers.Serializer):
    """Response body for POST /v1/pub-community."""

    cache_key = serializers.CharField()
    hours = serializers.JSONField(allow_null=True)
    beers = serializers.ListField(child=serializers.DictField())


class PubHoursResponseSerializer(serializers.Serializer):
    """Top-level response body for POST /v1/pub-hours."""

    results = PubHoursResultSerializer(many=True)


class PubReportSerializer(serializers.ModelSerializer):
    """Response body for a saved pub report."""

    class Meta:
        model = PubReport
        fields = [
            "id",
            "cache_key",
            "external_id",
            "name",
            "lat",
            "lng",
            "city",
            "address",
            "reason",
            "active",
            "created_at",
        ]
        read_only_fields = fields


class UserAddedPubSerializer(serializers.ModelSerializer):
    """Response body for a community-added pub."""

    class Meta:
        model = UserAddedPub
        fields = [
            "id",
            "cache_key",
            "client_id",
            "name",
            "lat",
            "lng",
            "city",
            "address",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class FeedbackReportSerializer(serializers.ModelSerializer):
    """Response body for a saved feedback report."""

    class Meta:
        model = FeedbackReport
        fields = [
            "id",
            "client_id",
            "category",
            "message",
            "contact_type",
            "contact",
            "app_version",
            "platform",
            "os_version",
            "status",
            "created_at",
        ]
        read_only_fields = fields


class BlockedPubSerializer(serializers.Serializer):
    """A compact entry the mobile app can use to filter Mapy.cz results."""

    cache_key = serializers.CharField()
    external_id = serializers.CharField(allow_null=True)
    reason = serializers.CharField()


class BlockedPubsResponseSerializer(serializers.Serializer):
    """Top-level response body for GET /v1/pub-reports/blocked."""

    blocked = BlockedPubSerializer(many=True)


# ---------------------------------------------------------------------------
# Account serializers
# ---------------------------------------------------------------------------


class AccountRegisterSerializer(serializers.Serializer):
    """Request body for POST /v1/account."""

    device_id = serializers.CharField(max_length=64, min_length=1, trim_whitespace=True)

    def validate_device_id(self, value: str) -> str:
        # The client always generates a canonical lowercase UUID v4. We parse the
        # value and re-serialise it to the canonical hyphenated form
        # (str(uuid.UUID(...))) so non-canonical spellings of the SAME id —
        # uppercase, {braces}, a urn:uuid: prefix, or dash-less — collapse to one
        # value. Without this, device_id's UNIQUE key would treat each spelling as
        # a distinct account, so a re-POST in a different form would create a
        # duplicate row instead of idempotently recovering the existing one.
        # Enforcing UUID format also keeps the account-creation key space narrow —
        # a bare CharField would let an attacker spam arbitrary strings.
        try:
            canonical = uuid.UUID(value)
        except (ValueError, AttributeError, TypeError) as exc:
            raise serializers.ValidationError("device_id must be a valid UUID.") from exc
        return str(canonical)


class AccountSerializer(serializers.ModelSerializer):
    """Account fields returned by POST /v1/account. The raw ``token`` is NOT a
    model field (only its hash is stored), so the view injects it into the
    response separately."""

    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = Account
        fields = ["id", "device_id", "hide_pub_names", "created_at"]


class AccountMeSerializer(serializers.ModelSerializer):
    """Account view returned by GET /v1/account/me — NEVER exposes the token."""

    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = Account
        fields = ["id", "device_id", "hide_pub_names", "created_at", "last_seen_at"]


class AccountPreferencesSerializer(serializers.ModelSerializer):
    """Writable account preferences accepted by PATCH /v1/account/me."""

    class Meta:
        model = Account
        fields = ["hide_pub_names"]


# ---------------------------------------------------------------------------
# Release-note ("what's new") serializers
# ---------------------------------------------------------------------------


class ReleaseNoteItemSerializer(serializers.Serializer):
    """A single highlight bullet in the response body."""

    icon = serializers.CharField(allow_blank=True)
    text = serializers.CharField()


class ReleaseNoteSerializer(serializers.ModelSerializer):
    """Response body for GET /v1/release-notes.

    ``items`` reads the related ReleaseNoteItem rows in their ``order`` (the
    related manager honours ReleaseNoteItem.Meta.ordering)."""

    items = ReleaseNoteItemSerializer(many=True, read_only=True)

    class Meta:
        model = ReleaseNote
        fields = ["version", "title", "items"]
        read_only_fields = fields

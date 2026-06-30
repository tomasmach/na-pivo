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
                "hasGarden": bool|null,     -- source says there is a garden/outdoor seating
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
from django.db import IntegrityError
from django.db.models import Count, Sum
from rest_framework import serializers

from pubs import accounts
from pubs.accounts import AccountError
from pubs.beer_catalog import (
    ALLOWED_BEER_VOLUMES_ML,
    BEER_PRICE_MAX_CZK,
    BEER_PRICE_MIN_CZK,
    normalize_beer_payload,
)
from pubs.mapper import maper_levels, maper_progress, maper_xp_rules
from pubs.models import (
    Account,
    ClientEvent,
    ContentReport,
    EmailCredential,
    FeedbackReport,
    FriendActivityResponse,
    FriendNotification,
    FriendPubActivity,
    Friendship,
    PubAmenityVote,
    PubNameCorrection,
    PubRating,
    PubReport,
    PushDevice,
    ReleaseNote,
    UserAddedPub,
)

# ---------------------------------------------------------------------------
# Request serializers
# ---------------------------------------------------------------------------

EXPO_PUSH_TOKEN_RE = re.compile(r"^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$")


class _LatLngBoundsValidationMixin:
    """Shared lat/lng range validators for the geo request/query serializers.

    Mixed in (not subclassed from Serializer) so it carries no fields of its own;
    DRF still discovers ``validate_lat`` / ``validate_lng`` via the MRO. Keeps the
    bounds + error messages identical across every endpoint that accepts a point.
    """

    def validate_lat(self, value: float) -> float:
        if not (-90.0 <= value <= 90.0):
            raise serializers.ValidationError("Latitude must be between -90 and 90.")
        return value

    def validate_lng(self, value: float) -> float:
        if not (-180.0 <= value <= 180.0):
            raise serializers.ValidationError("Longitude must be between -180 and 180.")
        return value


class _Pub200NameValidationMixin:
    """Shared 'name' validator: strip, reject empty, cap at 200 chars.

    Tightens PubInputSerializer's 255-char field to the 1..200 wire contract used
    by the user-added pub / drink / friend-activity write endpoints.
    """

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Pub name must not be empty.")
        if len(value) > 200:
            raise serializers.ValidationError("Pub name must be at most 200 characters.")
        return value


class PubInputSerializer(_LatLngBoundsValidationMixin, serializers.Serializer):
    """A single pub entry in the request body."""

    name = serializers.CharField(max_length=255)
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    city = serializers.CharField(max_length=128, required=False, allow_null=True, allow_blank=True)


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


class PubNameCorrectionRequestSerializer(PubInputSerializer):
    """Request body for POST /v1/pub-name-corrections."""

    client_id = serializers.UUIDField()
    suggested_name = serializers.CharField(max_length=200, trim_whitespace=True)
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

    def validate_suggested_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Suggested pub name must not be empty.")
        if len(value) > 200:
            raise serializers.ValidationError("Suggested pub name must be at most 200 characters.")
        return value


class UserAddedPubRequestSerializer(_Pub200NameValidationMixin, PubInputSerializer):
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


class ContentReportRequestSerializer(serializers.Serializer):
    """Request body for POST /v1/content-reports."""

    target_account_id = serializers.UUIDField()
    reason = serializers.ChoiceField(choices=ContentReport.Reason.choices)
    comment = serializers.CharField(
        max_length=1000,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )


class RestorePurchasesRequestSerializer(serializers.Serializer):
    """Receipt identifiers captured now; provider verification can be added later."""

    platform = serializers.ChoiceField(choices=["apple", "google"])
    product_id = serializers.CharField(
        max_length=128, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    original_transaction_id = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    transaction_id = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs: dict) -> dict:
        if not (attrs.get("original_transaction_id") or attrs.get("transaction_id")):
            raise serializers.ValidationError(
                {"transaction_id": "A transaction identifier is required."}
            )
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


class PushDeviceRequestSerializer(serializers.Serializer):
    """Request body for PUT /v1/push-device."""

    push_token = serializers.CharField(max_length=512, trim_whitespace=True)
    platform = serializers.ChoiceField(
        choices=PushDevice.Platform.choices,
        required=False,
        default=PushDevice.Platform.UNKNOWN,
    )
    permission_status = serializers.ChoiceField(
        choices=PushDevice.PermissionStatus.choices,
        required=False,
        default=PushDevice.PermissionStatus.GRANTED,
    )
    enabled = serializers.BooleanField(required=False, default=True)
    app_version = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )

    def validate_push_token(self, value: str) -> str:
        if not value:
            raise serializers.ValidationError("push_token must not be empty.")
        if EXPO_PUSH_TOKEN_RE.fullmatch(value) is None:
            raise serializers.ValidationError("push_token must be a valid Expo push token.")
        return value


class PushDeviceDeleteSerializer(serializers.Serializer):
    """Request body for DELETE /v1/push-device."""

    push_token = serializers.CharField(max_length=512, trim_whitespace=True)

    def validate_push_token(self, value: str) -> str:
        if not value:
            raise serializers.ValidationError("push_token must not be empty.")
        if EXPO_PUSH_TOKEN_RE.fullmatch(value) is None:
            raise serializers.ValidationError("push_token must be a valid Expo push token.")
        return value


class PushDeviceResponseSerializer(serializers.ModelSerializer):
    """Response body for a push-device registration. The token is intentionally omitted."""

    class Meta:
        model = PushDevice
        fields = [
            "id",
            "platform",
            "permission_status",
            "enabled",
            "app_version",
            "created_at",
            "updated_at",
            "last_registered_at",
        ]
        read_only_fields = fields


class FriendProfileSerializer(serializers.ModelSerializer):
    """Compact public profile shape used by the friend endpoints."""

    id = serializers.UUIDField(source="public_id", read_only=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id",
            "nickname",
            "display_name",
            "avatar_url",
            "is_public",
        ]
        read_only_fields = fields

    def get_avatar_url(self, obj: Account) -> str | None:
        if not obj.avatar:
            return None
        try:
            url = obj.avatar.url
        except (ValueError, AttributeError):
            return None
        request = self.context.get("request")
        if request is not None:
            url = request.build_absolute_uri(url)
        last_seen = getattr(obj, "last_seen_at", None)
        if last_seen is not None:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}v={int(last_seen.timestamp())}"
        return url


class FriendSearchQuerySerializer(serializers.Serializer):
    """Query params for GET /v1/friends/search."""

    q = serializers.CharField(max_length=40, trim_whitespace=True)

    def validate_q(self, value: str) -> str:
        if len(value.strip()) < 2:
            raise serializers.ValidationError("q must contain at least 2 characters.")
        return value.strip()


class FriendRequestCreateSerializer(serializers.Serializer):
    """Request body for POST /v1/friends/requests."""

    target_account_id = serializers.UUIDField(required=False)
    nickname = serializers.CharField(
        max_length=20,
        required=False,
        allow_blank=False,
        trim_whitespace=True,
    )

    def validate(self, attrs: dict) -> dict:
        if bool(attrs.get("target_account_id")) == bool(attrs.get("nickname")):
            raise serializers.ValidationError(
                "Send exactly one of target_account_id or nickname."
            )
        return attrs


class FriendActivityRequestSerializer(_Pub200NameValidationMixin, PubInputSerializer):
    """Request body for POST /v1/friends/pub-activity."""

    client_id = serializers.UUIDField()
    external_id = serializers.CharField(
        max_length=128,
        required=False,
        allow_null=True,
        allow_blank=True,
        trim_whitespace=True,
    )
    message = serializers.CharField(
        max_length=160,
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=True,
    )
    started_at = serializers.DateTimeField(required=False, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)


class FriendshipSerializer(serializers.ModelSerializer):
    """Friend request row with both endpoints embedded."""

    id = serializers.UUIDField(source="public_id", read_only=True)
    requester = FriendProfileSerializer(read_only=True)
    recipient = FriendProfileSerializer(read_only=True)

    class Meta:
        model = Friendship
        fields = [
            "id",
            "status",
            "requester",
            "recipient",
            "requested_at",
            "responded_at",
            "updated_at",
        ]
        read_only_fields = fields


class FriendActivityResponseSerializer(serializers.Serializer):
    """Request body for POST /v1/friends/pub-activity/<id>/respond (input only)."""

    response = serializers.ChoiceField(choices=FriendActivityResponse.Response.choices)


class FriendSettingsPatchSerializer(serializers.Serializer):
    """PATCH body for friend social settings."""

    ghost_mode = serializers.BooleanField(required=False)
    quiet_hours_enabled = serializers.BooleanField(required=False)
    quiet_hours_start = serializers.IntegerField(required=False, min_value=0, max_value=23)
    quiet_hours_end = serializers.IntegerField(required=False, min_value=0, max_value=23)


class FriendPubActivitySerializer(serializers.ModelSerializer):
    """Active friend pub status exposed to accepted friends.

    ``responses`` summarises the svolávací-smyčka roster: per-bucket counts plus
    up to 8 GOING responders' compact profiles. ``my_response`` is the requesting
    account's own RSVP (needs ``context['account']``). Both rely on the view
    prefetching ``responses__account`` to keep the roster N+1-free.
    """

    id = serializers.UUIDField(source="public_id", read_only=True)
    account = FriendProfileSerializer(read_only=True)
    responses = serializers.SerializerMethodField()
    my_response = serializers.SerializerMethodField()

    class Meta:
        model = FriendPubActivity
        fields = [
            "id",
            "account",
            "cache_key",
            "name",
            "city",
            "external_id",
            "message",
            "started_at",
            "expires_at",
            "active",
            "responses",
            "my_response",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_responses(self, obj: FriendPubActivity) -> dict:
        # Counts + GOING profiles computed in-Python over the prefetched rows so
        # one query feeds the whole dashboard roster.
        rows = list(obj.responses.all())
        counts = {"going": 0, "maybe": 0, "cant": 0}
        going_accounts = []
        for row in rows:
            if row.response in counts:
                counts[row.response] += 1
            if row.response == FriendActivityResponse.Response.GOING:
                # Privacy: counts stay aggregate, but never expose the profile of
                # a GOING responder who scheduled deletion (status != ACTIVE) or
                # turned on ghost mode — mirroring how the rest of the social
                # surface hides inactive/ghost accounts. account is preloaded via
                # the prefetch's select_related("account"), so this stays N+1-free.
                responder = row.account
                if (
                    responder.status == Account.Status.ACTIVE
                    and not responder.ghost_mode
                ):
                    going_accounts.append(responder)
        going_accounts = going_accounts[:8]
        going_profiles = FriendProfileSerializer(
            going_accounts, many=True, context=self.context
        ).data
        return {
            "going": counts["going"],
            "maybe": counts["maybe"],
            "cant": counts["cant"],
            "going_profiles": going_profiles,
        }

    def get_my_response(self, obj: FriendPubActivity) -> str | None:
        account = self.context.get("account")
        if account is None:
            return None
        account_id = getattr(account, "pk", None)
        for row in obj.responses.all():
            if row.account_id == account_id:
                return row.response
        return None


class FriendNotificationSerializer(serializers.ModelSerializer):
    """In-app friend notification feed item."""

    id = serializers.UUIDField(source="public_id", read_only=True)
    actor = FriendProfileSerializer(read_only=True)
    friendship_id = serializers.UUIDField(source="friendship.public_id", read_only=True)
    activity_id = serializers.UUIDField(source="activity.public_id", read_only=True)

    class Meta:
        model = FriendNotification
        fields = [
            "id",
            "kind",
            "title",
            "body",
            "actor",
            "friendship_id",
            "activity_id",
            "pub_cache_key",
            "pub_name",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields


# ---------------------------------------------------------------------------
# Community contribution (POST /v1/pub-community)
# ---------------------------------------------------------------------------

# The 7 weekday keys the structured community hours dict must contain, in order.
_COMMUNITY_DAY_KEYS = ("mo", "tu", "we", "th", "fr", "sa", "su")
# Allowed beer glass volumes (ml). None is also allowed (unknown). Sourced from
# the domain layer so the menu-scan canonicalizer and this write contract agree.
_ALLOWED_VOLUMES_ML = ALLOWED_BEER_VOLUMES_ML
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
        required=False,
        allow_null=True,
        min_value=BEER_PRICE_MIN_CZK,
        max_value=BEER_PRICE_MAX_CZK,
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


class MenuScanResultSerializer(serializers.Serializer):
    """Response body for POST /v1/pub-menu-scan.

    ``beers`` reuses CommunityBeerSerializer so each entry emits the same
    ``name`` / ``price_czk`` / ``volume_ml`` wire shape mobile maps via
    ``beerFromWire``; ``model`` is the vision model id that produced them.
    """

    beers = CommunityBeerSerializer(many=True)
    model = serializers.CharField()


class BeerBrandSuggestQuerySerializer(serializers.Serializer):
    """Query parameters for GET /v1/beer-brands/suggest."""

    q = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=80,
        trim_whitespace=True,
    )
    limit = serializers.IntegerField(required=False, min_value=1, max_value=20, default=12)


class BeerBrandSuggestionSerializer(serializers.Serializer):
    """A single beer autocomplete suggestion, product-first with brand metadata."""

    slug = serializers.CharField()
    name = serializers.CharField()
    kind = serializers.ChoiceField(choices=("product", "brand"))
    brand_slug = serializers.CharField()
    brand_name = serializers.CharField()


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
        match_cache = self.context.get("beer_match_cache")
        return [
            normalize_beer_payload(beer, match_cache=match_cache)
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


class DrinkRequestSerializer(_Pub200NameValidationMixin, PubInputSerializer):
    """Request body for POST /v1/drinks.

    Inherits name/lat/lng/city (+ lat/lng bounds) from PubInputSerializer and
    adds the idempotency key, optional external id, the required ``beer`` (with a
    mandatory price), and an optional ``drank_at`` (server defaults to now()).
    The pub name is tightened to 1..200 by _Pub200NameValidationMixin.
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

    def validate_beer(self, value: dict) -> dict:
        # Canonicalise to all three keys so the merge + stored JSON have a stable
        # shape, matching CommunityBeerSerializer.to_representation output.
        return normalize_beer_payload(value, match_cache=self.context.get("beer_match_cache"))


class DrinkUpdateSerializer(serializers.Serializer):
    """Request body for PATCH /v1/drinks/<client_id>.

    This is deliberately narrow: the mobile app only needs to fix a typo in the
    user's private drink log. Pub, price, time and community menu contributions
    are not rewritten by this endpoint.
    """

    beer_name = serializers.CharField(max_length=80, trim_whitespace=True)

    def validate_beer_name(self, value: str) -> str:
        if not value:
            raise serializers.ValidationError("Beer name must not be empty.")
        return value


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


class PubReportBlockedQuerySerializer(_LatLngBoundsValidationMixin, serializers.Serializer):
    """Query params for GET /v1/pub-reports/blocked."""

    lat = serializers.FloatField()
    lng = serializers.FloatField()
    radius_km = serializers.FloatField(required=False, min_value=0.1, max_value=100.0)


# Default radius for GET /v1/pubs/near when the client omits radius_km.
PUBS_NEAR_DEFAULT_RADIUS_KM = 25.0
# Hard ceiling on the requested radius (matches the largest Mapy bbox step).
PUBS_NEAR_MAX_RADIUS_KM = 100.0


class PubsNearQuerySerializer(_LatLngBoundsValidationMixin, serializers.Serializer):
    """Query params for GET /v1/pubs/near.

    radius_km is optional and clamped to (0, 100]; when omitted it defaults to
    PUBS_NEAR_DEFAULT_RADIUS_KM. lat/lng are bounds-checked like the other geo
    serializers.
    """

    lat = serializers.FloatField()
    lng = serializers.FloatField()
    radius_km = serializers.FloatField(required=False, allow_null=True)
    beer_brand = serializers.SlugField(
        required=False,
        allow_blank=True,
        max_length=80,
        trim_whitespace=True,
    )

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
        if not attrs.get("beer_brand"):
            attrs.pop("beer_brand", None)
        return attrs


class PubLocationLookupQuerySerializer(_LatLngBoundsValidationMixin, serializers.Serializer):
    """Query params for Mapy-backed pub name/address lookup endpoints."""

    query = serializers.CharField(max_length=150, trim_whitespace=True)
    lat = serializers.FloatField(required=False)
    lng = serializers.FloatField(required=False)

    def validate_query(self, value: str) -> str:
        if len(value) < 2:
            raise serializers.ValidationError("query must be at least 2 characters.")
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
    hasGarden = serializers.BooleanField(allow_null=True)
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
    # Additive Mapér fields (older clients ignore them). `mapper` mirrors the
    # vote-PUT snapshot; null when XP awarding was skipped/failed.
    xp_awarded = serializers.IntegerField(required=False, default=0)
    mapper = serializers.DictField(required=False, allow_null=True)


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


class PubNameCorrectionSerializer(serializers.ModelSerializer):
    """Response body for a saved pub name correction."""

    class Meta:
        model = PubNameCorrection
        fields = [
            "id",
            "cache_key",
            "client_id",
            "external_id",
            "original_name",
            "suggested_name",
            "lat",
            "lng",
            "city",
            "address",
            "active",
            "created_at",
            "updated_at",
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


class ContentReportSerializer(serializers.ModelSerializer):
    """Response body for a saved abusive-content report."""

    target_account_id = serializers.UUIDField(source="target_account.public_id", read_only=True)

    class Meta:
        model = ContentReport
        fields = [
            "id",
            "target_account_id",
            "reason",
            "comment",
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


class AccountUsageSerializer(serializers.Serializer):
    """Nested usage block for coarse per-account telemetry counters."""

    walked_distance_m = serializers.IntegerField(read_only=True)


class AccountSettingsSerializer(serializers.Serializer):
    """Nested app settings block stored on the account."""

    mode = serializers.CharField(read_only=True)
    max_distance_km = serializers.FloatField(read_only=True, allow_null=True)
    price_currency = serializers.CharField(read_only=True)
    haptic_enabled = serializers.BooleanField(read_only=True)
    sound_enabled = serializers.BooleanField(read_only=True)
    hide_closed_pubs = serializers.BooleanField(read_only=True)
    hide_pub_names = serializers.BooleanField(read_only=True)
    marketing_emails_enabled = serializers.BooleanField(read_only=True)


class AccountSubscriptionSerializer(serializers.Serializer):
    """Read-only subscription/entitlement state attached to the account."""

    tier = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    platform = serializers.CharField(read_only=True, allow_blank=True)
    product_id = serializers.CharField(read_only=True, allow_blank=True)
    original_transaction_id = serializers.CharField(read_only=True, allow_blank=True)
    expires_at = serializers.DateTimeField(read_only=True, allow_null=True)
    updated_at = serializers.DateTimeField(read_only=True, allow_null=True)


class AccountStatsSerializer(serializers.Serializer):
    """Nested profile stats derived from account-owned drinks, visits and ratings."""

    total_beers = serializers.IntegerField(read_only=True)
    distinct_pubs = serializers.IntegerField(read_only=True)
    ratings_count = serializers.IntegerField(read_only=True)
    total_spent_czk = serializers.IntegerField(read_only=True)
    max_visits_to_one_pub = serializers.IntegerField(read_only=True)


class AccountAchievementsSerializer(serializers.Serializer):
    """Server-derived achievement unlock state for the profile screen.

    The first three are the original drink/visit/rating badges; the five Mapér
    badges (§7.2) are additive — released apps ignore the unknown keys.
    """

    first_ten = serializers.BooleanField(read_only=True)
    regular = serializers.BooleanField(read_only=True)
    reviewer = serializers.BooleanField(read_only=True)
    # Mapér badges, derived from the stored AccountUsageStats counters (§7.2).
    first_map = serializers.BooleanField(read_only=True)
    explorer = serializers.BooleanField(read_only=True)
    cartographer = serializers.BooleanField(read_only=True)
    completionist = serializers.BooleanField(read_only=True)
    fact_machine = serializers.BooleanField(read_only=True)


def _account_stats(obj: Account) -> dict:
    """Aggregate the account's durable backend history into profile counters."""

    drink_totals = obj.drinks.aggregate(
        total_beers=Count("id"),
        total_spent_czk=Sum("price_czk"),
    )
    pub_keys = set(obj.pub_visits.values_list("cache_key", flat=True))
    pub_keys.update(obj.drinks.values_list("cache_key", flat=True))
    max_visit_row = (
        obj.pub_visits.values("cache_key")
        .annotate(n=Count("id"))
        .order_by("-n")
        .first()
    )

    # Mapér counters live on the stored AccountUsageStats row (NOT derived per
    # request, §7.2) — read them off the prefetched relation, defaulting to 0 for
    # an account that has never voted (no usage_stats row yet).
    usage = getattr(obj, "usage_stats", None)

    return {
        "total_beers": int(drink_totals["total_beers"] or 0),
        "distinct_pubs": len(pub_keys),
        "ratings_count": obj.pub_ratings.count(),
        "total_spent_czk": int(drink_totals["total_spent_czk"] or 0),
        "max_visits_to_one_pub": int(max_visit_row["n"]) if max_visit_row else 0,
        # Mapér stored counters (§7.2). Wire names map distinct_mapped_pubs ←
        # mapped_pubs_count in the mapper block below.
        "mapper_xp": int(getattr(usage, "mapper_xp", 0) or 0),
        "mapped_pubs_count": int(getattr(usage, "mapped_pubs_count", 0) or 0),
        "first_mapper_count": int(getattr(usage, "first_mapper_count", 0) or 0),
        "amenity_votes_count": int(getattr(usage, "amenity_votes_count", 0) or 0),
        "completed_pubs_count": int(getattr(usage, "completed_pubs_count", 0) or 0),
    }


class AccountMeSerializer(serializers.ModelSerializer):
    """Canonical account state returned by GET /v1/account/me and by every auth
    endpoint (with the raw ``token`` injected by the view). NEVER exposes a token.

    ``is_anonymous`` is True for a fresh device account with no credential yet;
    ``providers`` lists the sign-in methods ('email', 'google', 'apple') and
    drives the link/unlink UI.

    ``avatar_url`` is the ABSOLUTE media URL (so the mobile ``<Image>`` can load
    it) with a ``?v=<last_seen epoch>`` cache-bust — built only when the view
    passes ``context={'request': request}``. Without that context it degrades to
    a relative ``/media/`` path (never crashes), which is why every call site
    must thread the request.
    """

    id = serializers.UUIDField(source="public_id", read_only=True)
    email = serializers.SerializerMethodField()
    email_verified = serializers.SerializerMethodField()
    is_anonymous = serializers.SerializerMethodField()
    providers = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    has_avatar = serializers.SerializerMethodField()
    usage = serializers.SerializerMethodField()
    settings = serializers.SerializerMethodField()
    subscription = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()
    achievements = serializers.SerializerMethodField()
    mapper = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = [
            "id",
            "device_id",
            "nickname",
            "display_name",
            "avatar_url",
            "has_avatar",
            "is_public",
            "email",
            "email_verified",
            "providers",
            "is_anonymous",
            "status",
            "hide_pub_names",
            "settings",
            "subscription",
            "stats",
            "achievements",
            "mapper",
            "usage",
            "created_at",
            "last_seen_at",
        ]

    def _auth_snapshot(self, obj: Account) -> dict:
        """Load account credential/provider state once per serializer instance."""

        cache = getattr(self, "_auth_snapshot_cache", None)
        if cache is None:
            cache = {}
            self._auth_snapshot_cache = cache
        if obj.pk in cache:
            return cache[obj.pk]

        try:
            credential = obj.email_credential
        except EmailCredential.DoesNotExist:
            credential = None
        identities = list(obj.identities.order_by("pk").only("account_id", "provider", "email"))
        snapshot = {
            "credential": credential,
            "identities": identities,
        }
        cache[obj.pk] = snapshot
        return snapshot

    def get_email(self, obj: Account) -> str:
        snapshot = self._auth_snapshot(obj)
        credential = snapshot["credential"]
        if credential is not None:
            return credential.email
        for identity in snapshot["identities"]:
            if identity.email:
                return identity.email
        return ""

    def get_email_verified(self, obj: Account) -> bool:
        credential = self._auth_snapshot(obj)["credential"]
        return bool(credential and credential.email_verified)

    def get_is_anonymous(self, obj: Account) -> bool:
        snapshot = self._auth_snapshot(obj)
        return not (snapshot["credential"] or snapshot["identities"])

    def get_providers(self, obj: Account) -> list[str]:
        snapshot = self._auth_snapshot(obj)
        providers = ["email"] if snapshot["credential"] else []
        providers.extend(identity.provider for identity in snapshot["identities"])
        return providers

    def get_has_avatar(self, obj: Account) -> bool:
        return bool(obj.avatar)

    def get_avatar_url(self, obj: Account) -> str | None:
        """Absolute avatar URL + ?v=<last_seen epoch> cache-bust, or None.

        Null-guarded against a missing request context: if the view forgot to
        pass it, fall back to the relative storage URL rather than crashing
        (the absolute build is what mobile needs, so this should never happen in
        practice — see the context note in the serializer docstring)."""
        if not obj.avatar:
            return None
        try:
            url = obj.avatar.url
        except (ValueError, AttributeError):
            return None
        request = self.context.get("request")
        if request is not None:
            url = request.build_absolute_uri(url)
        # Cache-bust on last_seen_at so a fresh upload is fetched even behind an
        # immutable CDN cache. last_seen_at advances on every authenticated call.
        last_seen = getattr(obj, "last_seen_at", None)
        if last_seen is not None:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}v={int(last_seen.timestamp())}"
        return url

    def get_usage(self, obj: Account) -> dict:
        stats = getattr(obj, "usage_stats", None)
        walked = stats.walked_distance_m if stats is not None else 0
        return AccountUsageSerializer({"walked_distance_m": walked}).data

    def get_settings(self, obj: Account) -> dict:
        return AccountSettingsSerializer(
            {
                "mode": obj.compass_mode,
                "max_distance_km": obj.max_distance_km,
                "price_currency": obj.price_currency,
                "haptic_enabled": obj.haptic_enabled,
                "sound_enabled": obj.sound_enabled,
                "hide_closed_pubs": obj.hide_closed_pubs,
                "hide_pub_names": obj.hide_pub_names,
                "marketing_emails_enabled": obj.marketing_emails_enabled,
            }
        ).data

    def get_subscription(self, obj: Account) -> dict:
        return AccountSubscriptionSerializer(
            {
                "tier": obj.subscription_tier,
                "status": obj.subscription_status,
                "platform": obj.subscription_platform,
                "product_id": obj.subscription_product_id,
                "original_transaction_id": obj.subscription_original_transaction_id,
                "expires_at": obj.subscription_expires_at,
                "updated_at": obj.subscription_updated_at,
            }
        ).data

    def _stats_for(self, obj: Account) -> dict:
        cache = getattr(self, "_account_stats_cache", None)
        if cache is None:
            cache = {}
            self._account_stats_cache = cache
        if obj.pk not in cache:
            cache[obj.pk] = _account_stats(obj)
        return cache[obj.pk]

    def get_stats(self, obj: Account) -> dict:
        return AccountStatsSerializer(self._stats_for(obj)).data

    def get_achievements(self, obj: Account) -> dict:
        stats = self._stats_for(obj)
        return AccountAchievementsSerializer(
            {
                "first_ten": stats["total_beers"] >= 10,
                "regular": stats["max_visits_to_one_pub"] >= 5,
                "reviewer": stats["ratings_count"] >= 10,
                # Mapér badges, derived server-side from the stored counters (§7.2).
                "first_map": stats["first_mapper_count"] >= 1,
                "explorer": stats["mapped_pubs_count"] >= 10,
                "cartographer": stats["mapped_pubs_count"] >= 25,
                "completionist": stats["completed_pubs_count"] >= 1,
                "fact_machine": stats["amenity_votes_count"] >= 100,
            }
        ).data

    def get_mapper(self, obj: Account) -> dict:
        """The additive Mapér block (§7.2): derived level/title/progress from the
        stored ``mapper_xp`` + the raw counters + the level ladder + xp_rules so the
        client can render the meter and estimate optimistic level-ups locally."""
        stats = self._stats_for(obj)
        xp = stats["mapper_xp"]
        progress = maper_progress(xp)
        # Wire field names are the locked canonical contract (§7.2): the GET /me
        # block uses ``xp`` / ``distinct_mapped_pubs`` / ``first_mapper_count`` /
        # ``levels[].xp``. The PUT-response snapshot in mapper.py uses the SAME
        # ``xp`` key so the two endpoints can never disagree.
        return {
            "xp": xp,
            "level": progress["level"],
            "title": progress["title"],
            "xp_into_level": progress["xp_into_level"],
            "xp_for_next_level": progress["xp_for_next_level"],
            "distinct_mapped_pubs": stats["mapped_pubs_count"],
            "amenity_votes_count": stats["amenity_votes_count"],
            "first_mapper_count": stats["first_mapper_count"],
            "completed_pubs_count": stats["completed_pubs_count"],
            "levels": [
                {"level": lvl["level"], "title": lvl["title"], "xp": lvl["xp"]}
                for lvl in maper_levels()
            ],
            "xp_rules": maper_xp_rules(),
        }


class AccountUpdateSerializer(serializers.ModelSerializer):
    """Writable account subset accepted by PATCH /v1/account/me.

    Replaces the old AccountPreferencesSerializer in the view: it keeps
    ``hide_pub_names`` working and adds the profile fields. ``nickname`` is
    validated by the single source of truth (:func:`accounts.validate_nickname`);
    an empty string is coerced to NULL (clearing the handle frees it). The DB
    UniqueConstraint is the race backstop — a concurrent claim surfaces as an
    ``IntegrityError`` on save, mapped to 409 ``nickname_taken``.
    """

    # Allow null + blank so the client can CLEAR the handle. ModelSerializer would
    # otherwise reject "" because the model field rejects blank on a CharField with
    # null=True; we coerce ""→None in validate_nickname/save.
    #
    # NO ``max_length`` here: DRF runs a field-level max_length check BEFORE
    # validate_nickname, and it raises with the built-in code 'max_length' (not our
    # contract code). The single source of truth (accounts.validate_nickname) owns
    # the 20-char ceiling and emits code='nickname_too_long' in the {detail, code}
    # shape the mobile client branches on.
    nickname = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    max_distance_km = serializers.FloatField(
        required=False,
        allow_null=True,
        min_value=0.1,
        max_value=100.0,
    )

    class Meta:
        model = Account
        fields = [
            "nickname",
            "display_name",
            "is_public",
            "hide_pub_names",
            "compass_mode",
            "max_distance_km",
            "price_currency",
            "haptic_enabled",
            "sound_enabled",
            "hide_closed_pubs",
            "marketing_emails_enabled",
        ]

    def validate_nickname(self, value: str | None) -> str | None:
        # Coerce empty → None (clear). Otherwise run the canonical validator,
        # which raises AccountError; re-raise as a DRF ValidationError carrying the
        # stable code so the view can map it to {detail, code}.
        if value is None or not value.strip():
            return None
        try:
            return accounts.validate_nickname(value, account=self.instance)
        except AccountError as exc:
            raise serializers.ValidationError(exc.message, code=exc.code) from exc

    def save(self, **kwargs) -> Account:
        # The DB UniqueConstraint is the last line of defence against a TOCTOU
        # race between validate_nickname's existence check and the write. Let the
        # view translate IntegrityError into a 409; we only re-raise it here.
        try:
            return super().save(**kwargs)
        except IntegrityError:
            raise


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


# ---------------------------------------------------------------------------
# Pub amenities ("Zmapuj hospodu")
# ---------------------------------------------------------------------------


class PubAmenityVoteRequestSerializer(serializers.Serializer):
    """One row of the PUT /v1/pub-amenities/votes {"votes": [...]} array.

    ``lat``/``lng`` are bounds-checked but ``cache_key`` is NEVER accepted from
    the client — it is always derived server-side via geohash8(lat, lng). There
    is deliberately NO validation that ``value`` or ``amenity_key`` is a known
    active kind, so a stale-or-newer client can never get a 4xx and break its
    offline queue (the active-kind check is done in the VIEW: ignore, not 400).
    A ``value`` of null is an explicit retraction. ``taxonomy_version`` is
    analytics-only and never gates the write.
    """

    # name is REQUIRED and non-blank: it is the geohash-8 collision guard
    # (§2.6/§4.2 "name is always sent"). A blank name would create a guardless
    # aggregate whose votes then leak to any business sharing the ~38m cell, so
    # reject it here rather than store "". (Unlike value/amenity_key, name is NOT
    # part of the forward-compat "never 4xx" contract — only unknown KEYS are.)
    name = serializers.CharField(max_length=255)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    city = serializers.CharField(
        max_length=128, required=False, allow_null=True, allow_blank=True, default=""
    )
    external_id = serializers.CharField(
        max_length=128, required=False, allow_null=True, allow_blank=True, default=""
    )
    amenity_key = serializers.SlugField(max_length=40)  # active-kind check in the VIEW (ignore-not-400)
    value = serializers.ChoiceField(
        choices=PubAmenityVote.Value.choices, required=True, allow_null=True
    )  # null => retract
    client_updated_at = serializers.DateTimeField()  # wire field; the per-amenity LWW key
    taxonomy_version = serializers.IntegerField(
        required=False, allow_null=True, min_value=1
    )  # analytics-only; stored, never validated


class PubAmenityVotesRequestSerializer(serializers.Serializer):
    """Top-level {"votes": [...]} wrapper for PUT /v1/pub-amenities/votes."""

    votes = PubAmenityVoteRequestSerializer(many=True, min_length=1)

    def validate_votes(self, value: list) -> list:
        if len(value) > 50:
            raise serializers.ValidationError("At most 50 amenity votes may be sent at once.")
        return value


class PubAmenityKindSerializer(serializers.Serializer):
    """Output-only — emits the canonical wire field names for one AmenityKind.

    The model keeps the columns named label/short_label/filter_candidate/rank/
    active; the wire contract (and the mobile WireAmenityKind type) uses
    label_cs/short_label_cs/map_filterable/is_active/order.
    """

    key = serializers.CharField()
    group = serializers.CharField()
    label_cs = serializers.CharField(source="label")
    short_label_cs = serializers.CharField(source="short_label")
    icon = serializers.CharField()
    map_filterable = serializers.BooleanField(source="filter_candidate")
    is_active = serializers.BooleanField(source="active")
    order = serializers.IntegerField(source="rank")


class PubAmenityReadQuerySerializer(serializers.Serializer):
    """Query params for GET /v1/pub-amenities (public aggregate read)."""

    cache_keys = serializers.CharField()  # comma-split + cap to AMENITY_READ_MAX_KEYS in the view
    name = serializers.CharField(required=False, allow_blank=True, default="")  # names_match guard


def _amenity_vote_item(vote: PubAmenityVote) -> dict:
    """Serialize one PubAmenityVote for GET /v1/pub-amenities/votes (restore).

    Carries the LWW key (client_updated_at) for cross-device restore. Lat/lng
    stay omitted; name + pub_identity_key let clients keep neighbouring pubs in
    the same geohash cell separated.
    """
    return {
        "cache_key": vote.cache_key,
        "pub_identity_key": vote.pub_identity_key,
        "name": vote.name,
        "amenity_key": vote.amenity_key,
        "value": vote.value,
        "client_updated_at": vote.client_updated_at.isoformat(),
    }


def _amenity_aggregate_item(agg, my_value=None) -> dict:
    """Serialize one PubAmenity aggregate to the <Aggregate> wire shape.

    ``my_value`` is the authenticated caller's own vote ("yes"|"no"|None),
    populated ONLY when the request is authenticated; None for anonymous reads.
    lat/lng/name are NEVER emitted (privacy, §6). ``confidence`` is rounded to 2
    on the wire.
    """
    return {
        "amenity_key": agg.amenity_key,
        "yes_count": agg.yes_count,
        "no_count": agg.no_count,
        "distinct_voter_count": agg.distinct_voter_count,
        "status": agg.status,
        "confidence": round(agg.confidence, 2),
        "my_value": my_value,
    }

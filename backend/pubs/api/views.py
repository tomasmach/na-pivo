"""
pubs.api.views — DRF views for the pub-hours API.

Endpoints
---------
POST /v1/pub-hours   → PubHoursView
POST /v1/pub-reports → PubReportView
GET  /v1/pub-reports/blocked → BlockedPubReportsView
GET  /v1/release-notes → ReleaseNotesView
GET  /v1/health      → HealthView
"""

from __future__ import annotations

import logging
import math

from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.enrichment import community_hours_to_osm, geohash8
from pubs.models import (
    Account,
    EnrichTask,
    FeedbackReport,
    PubCommunityData,
    PubContributionLog,
    PubHours,
    PubReport,
    ReleaseNote,
    generate_account_token,
    hash_account_token,
)

from .authentication import AccountTokenAuthentication
from .cache import get_or_enrich
from .serializers import (
    AccountMeSerializer,
    AccountRegisterSerializer,
    AccountSerializer,
    BlockedPubsResponseSerializer,
    FeedbackReportSerializer,
    FeedbackRequestSerializer,
    PubCommunityRequestSerializer,
    PubCommunityResponseSerializer,
    PubHoursRequestSerializer,
    PubHoursResponseSerializer,
    PubReportBlockedQuerySerializer,
    PubReportRequestSerializer,
    PubReportSerializer,
    ReleaseNoteSerializer,
)

logger = logging.getLogger(__name__)

DEFAULT_BLOCKED_REPORT_RADIUS_KM = 25.0


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    radius_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    lat1 = math.radians(a_lat)
    lat2 = math.radians(b_lat)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius_km * math.asin(math.sqrt(h))


class HealthView(APIView):
    """GET /v1/health — liveness probe."""

    def get(self, request: Request) -> Response:  # noqa: ARG002
        return Response({"status": "ok"})


class PubHoursView(APIView):
    """
    POST /v1/pub-hours

    Accept a list of pubs and return opening hours + isOpenNow for each.
    Pubs are served from cache when fresh; otherwise enriched synchronously
    up to sync_budget, with the remainder queued as EnrichTask rows.
    """

    def post(self, request: Request) -> Response:
        req_serializer = PubHoursRequestSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated = req_serializer.validated_data
        pubs: list[dict] = validated["pubs"]
        sync_budget: int | None = validated.get("sync_budget")  # None → use settings default

        try:
            results = get_or_enrich(pubs, sync_budget=sync_budget)
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-hours: unexpected error: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        resp_serializer = PubHoursResponseSerializer({"results": results})
        return Response(resp_serializer.data, status=status.HTTP_200_OK)


class PubReportView(APIView):
    """
    POST /v1/pub-reports

    Save a user report that a Mapy.cz result should no longer be offered by the
    compass. The mobile app also hides the place locally immediately; this
    endpoint makes the block available to later searches and other installs.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = PubReportRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        external_id = data.get("external_id") or None

        try:
            report, created = PubReport.objects.update_or_create(
                account=request.user,
                cache_key=cache_key,
                reason=data["reason"],
                defaults={
                    "external_id": external_id,
                    "name": data["name"],
                    "lat": data["lat"],
                    "lng": data["lng"],
                    "city": data.get("city") or None,
                    "address": data.get("address") or None,
                    "active": True,
                },
            )
            PubHours.objects.filter(cache_key=cache_key).delete()
            EnrichTask.objects.filter(cache_key=cache_key).delete()
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-report: unexpected error saving report for %r: %s",
                data.get("name"),
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            PubReportSerializer(report).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PubCommunityView(APIView):
    """
    POST /v1/pub-community

    Accept community-contributed opening hours and/or a list of beers on tap for
    a pub. Contributions go LIVE IMMEDIATELY (no approval queue): the per-pub
    PubCommunityData row is upserted and full history is appended to
    PubContributionLog for audit / revert. Community opening hours take
    precedence over firmy.cz data in the /v1/pub-hours read path.

    Auth: Bearer token (per-account). Idempotent on (account, client_id, kind):
    re-POSTing the same client_id never duplicates a log row. Throttled per-IP
    (scope "community").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request) -> Response:
        serializer = PubCommunityRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        has_hours = data.get("hours") is not None
        has_beers = "beers" in data
        now = dj_timezone.now()

        try:
            defaults = {
                "name": data["name"],
                "lat": data["lat"],
                "lng": data["lng"],
                "city": data.get("city") or None,
                "external_id": data.get("external_id") or None,
                "account": request.user,
            }
            if has_hours:
                hours_json = data["hours"]
                defaults["hours_json"] = hours_json
                defaults["opening_hours_raw"] = community_hours_to_osm(hours_json)
                defaults["hours_updated_at"] = now
            if has_beers:
                defaults["beers"] = data["beers"]
                defaults["beers_updated_at"] = now

            record, _ = PubCommunityData.objects.update_or_create(
                cache_key=cache_key,
                defaults=defaults,
            )

            # Append idempotent history rows, one per submitted kind.
            if has_hours:
                PubContributionLog.objects.get_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    kind=PubContributionLog.Kind.HOURS,
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "payload": data["hours"],
                    },
                )
            if has_beers:
                PubContributionLog.objects.get_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    kind=PubContributionLog.Kind.BEERS,
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "payload": data["beers"],
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-community: unexpected error saving contribution for %r: %s",
                data.get("name"),
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        body = PubCommunityResponseSerializer(
            {
                "cache_key": record.cache_key,
                "hours": record.hours_json,
                "beers": record.beers or [],
            }
        ).data
        return Response(body, status=status.HTTP_200_OK)


class FeedbackView(APIView):
    """
    POST /v1/feedback

    Save in-app feedback / a bug report from the mobile app. Keyed by
    (account, client_id): the client generates a UUID per submission and re-POSTs
    it verbatim on offline retries, so the same client_id updates the existing row
    instead of duplicating it. Returns 201 when created, 200 when an existing row
    was updated. Throttled per-IP (scope "feedback").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback"

    def post(self, request: Request) -> Response:
        serializer = FeedbackRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data

        try:
            report, created = FeedbackReport.objects.update_or_create(
                account=request.user,
                client_id=data["client_id"],
                defaults={
                    "category": data["category"],
                    "message": data["message"],
                    "contact_type": data.get("contact_type") or "",
                    "contact": data.get("contact") or "",
                    "app_version": data.get("app_version") or "",
                    "platform": data.get("platform") or "",
                    "os_version": data.get("os_version") or "",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "feedback: unexpected error saving feedback %r: %s",
                data.get("client_id"),
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            FeedbackReportSerializer(report).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BlockedPubReportsView(APIView):
    """
    GET /v1/pub-reports/blocked?lat=...&lng=...&radius_km=...

    Return active reports near the user. This intentionally stays unauthenticated
    so filtering still works before or without a recovered anonymous account.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        serializer = PubReportBlockedQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        lat = data["lat"]
        lng = data["lng"]
        radius_km = data.get("radius_km") or DEFAULT_BLOCKED_REPORT_RADIUS_KM

        lat_delta = radius_km / 111.0
        lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))

        reports = PubReport.objects.filter(
            active=True,
            lat__gte=lat - lat_delta,
            lat__lte=lat + lat_delta,
            lng__gte=lng - lng_delta,
            lng__lte=lng + lng_delta,
        ).order_by("-created_at")

        blocked = []
        seen: set[tuple[str, str | None]] = set()
        for report in reports:
            if _haversine_km(lat, lng, report.lat, report.lng) > radius_km:
                continue
            key = (report.cache_key, report.external_id)
            if key in seen:
                continue
            seen.add(key)
            blocked.append(
                {
                    "cache_key": report.cache_key,
                    "external_id": report.external_id,
                    "reason": report.reason,
                }
            )

        return Response(
            BlockedPubsResponseSerializer({"blocked": blocked}).data,
            status=status.HTTP_200_OK,
        )


class ReleaseNotesView(APIView):
    """
    GET /v1/release-notes?version=<app-version>

    Return the published "what's new" note for the given app version, or 404 if
    none exists. Unauthenticated by design — the mobile app calls this on launch
    right after an update, with no account required. The app shows the note once
    and remembers it locally, so a 404 (no note for this version) is an expected,
    cheap response, not an error.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        version = (request.query_params.get("version") or "").strip()
        if not version:
            return Response(
                {"detail": "Query param 'version' is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = (
            ReleaseNote.objects.filter(version=version, is_published=True)
            .prefetch_related("items")
            .first()
        )
        if note is None:
            return Response(
                {"detail": "No release note for this version."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(ReleaseNoteSerializer(note).data, status=status.HTTP_200_OK)


class AccountView(APIView):
    """
    POST /v1/account

    Idempotently register (ensure) an anonymous device-bound account. The mobile
    app sends the device_id it generated and persisted locally; we get_or_create
    the Account and return it with a token. Re-posting a known device_id returns
    the same account with a freshly ROTATED token (only the token's hash is
    stored, so the original cannot be re-returned), letting a client that lost its
    token recover.

    Unauthenticated by design — this is how a brand-new device gets its first
    credentials — but throttled per-IP (scope "account") to blunt scripted mass
    account creation.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account"

    def post(self, request: Request) -> Response:
        serializer = AccountRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        device_id = serializer.validated_data["device_id"]
        raw_token = generate_account_token()
        try:
            # Idempotent on the device_id UNIQUE constraint: under a concurrent
            # first-registration race, get_or_create wraps the INSERT in a
            # savepoint and re-SELECTs on IntegrityError, so a lost-response retry
            # never creates a duplicate Account.
            #
            # Only the SHA-256 hash of the token is stored, so the raw token cannot
            # be recovered later — re-registration therefore ROTATES it (issues a
            # fresh token). For the mobile client this happens only on recovery (it
            # caches the token and re-registers solely after a cache miss), where a
            # fresh working token is exactly what it needs.
            #
            # SECURITY TODO (blocker for the future credentials feature): a re-POST
            # of a known device_id still hands back a usable token, so device_id is
            # effectively a bearer-equivalent recovery key. Acceptable ONLY while
            # accounts hold no personal data. Once real credentials / per-user data
            # attach to Account, device_id must NOT recover a token for a *claimed*
            # account — require the verified credential — and stop differentiating
            # 200/201 here to avoid account-existence enumeration.
            account, created = Account.objects.get_or_create(
                device_id=device_id,
                defaults={"token_hash": hash_account_token(raw_token)},
            )
            if not created:
                # Rotate the token (old hash discarded) and touch last_seen_at
                # (auto_now fires because the field is in update_fields).
                raw_token = generate_account_token()
                account.token_hash = hash_account_token(raw_token)
                account.save(update_fields=["token_hash", "last_seen_at"])
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "account: unexpected error registering device %r: %s",
                device_id,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # The raw token is injected here — it is never a model field, never stored.
        body = dict(AccountSerializer(account).data)
        body["token"] = raw_token
        body["created"] = created
        return Response(
            body,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class AccountMeView(APIView):
    """
    GET /v1/account/me

    Return the account that owns the supplied Bearer token. Token-authenticated;
    never echoes the token back. This is the scaffolding future per-user features
    build on.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        # request.user is the authenticated Account instance.
        return Response(AccountMeSerializer(request.user).data, status=status.HTTP_200_OK)

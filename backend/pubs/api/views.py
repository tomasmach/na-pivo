"""
pubs.api.views — DRF views for the pub-hours API.

Endpoints
---------
POST   /v1/pub-hours   → PubHoursView
POST   /v1/pubs        → UserAddedPubView
POST   /v1/pub-reports → PubReportView
GET    /v1/pub-reports/blocked → BlockedPubReportsView
GET    /v1/pubs/suggest → PubLocationSuggestView
GET    /v1/pubs/geocode → PubLocationGeocodeView
POST   /v1/drinks      → DrinksView
DELETE /v1/drinks/<client_id> → DrinksView
GET    /v1/release-notes → ReleaseNotesView
GET    /v1/health      → HealthView
"""

from __future__ import annotations

import logging
import math
from datetime import timedelta

import requests
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.enrichment import (
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestSource,
    community_hours_to_osm,
    geohash6,
    geohash8,
    names_match,
)
from pubs.models import (
    Account,
    AccountUsageStats,
    ClientEvent,
    DrinkLog,
    EnrichTask,
    FeedbackReport,
    PubCommunityData,
    PubContributionLog,
    PubHours,
    PubRating,
    PubReport,
    PubSearchCache,
    PubVisit,
    ReleaseNote,
    UserAddedPub,
    generate_account_token,
    hash_account_token,
)

from .authentication import AccountTokenAuthentication
from .cache import get_or_enrich
from .serializers import (
    AccountMeSerializer,
    AccountPreferencesSerializer,
    AccountRegisterSerializer,
    AccountSerializer,
    BlockedPubsResponseSerializer,
    ClientEventRequestSerializer,
    DrinkRequestSerializer,
    FeedbackReportSerializer,
    FeedbackRequestSerializer,
    PubCommunityRequestSerializer,
    PubCommunityResponseSerializer,
    PubHoursRequestSerializer,
    PubHoursResponseSerializer,
    PubLocationLookupQuerySerializer,
    PubRatingRequestSerializer,
    PubReportBlockedQuerySerializer,
    PubReportRequestSerializer,
    PubReportSerializer,
    PubsNearQuerySerializer,
    PubVisitRequestSerializer,
    ReleaseNoteSerializer,
    UserAddedPubRequestSerializer,
    UserAddedPubSerializer,
)

logger = logging.getLogger(__name__)

DEFAULT_BLOCKED_REPORT_RADIUS_KM = 25.0

# Radius buckets (km) for the Mapy "pubs near" cache — the same widening steps
# the search itself uses. radius_bucket = the smallest bucket >= the requested
# radius (capped at the largest). A 25 km and a 40 km request in one cell thus
# share the 50 km row.
PUBS_NEAR_RADIUS_BUCKETS = (5, 15, 50, 100)


def _radius_bucket(radius_km: float) -> int:
    """Smallest bucket >= radius_km (capped at the largest bucket)."""
    for bucket in PUBS_NEAR_RADIUS_BUCKETS:
        if radius_km <= bucket:
            return bucket
    return PUBS_NEAR_RADIUS_BUCKETS[-1]


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
                "pub-report: unexpected error saving report for cache key %s: %s",
                cache_key,
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


class UserAddedPubView(APIView):
    """
    POST /v1/pubs

    Add a pub that the normal Mapy.cz nearby search does not show. The submitted
    pub is immediately visible to all users through GET /v1/pubs/near, where it
    is mixed into the Mapy result stream by distance. Auth + throttling mirror
    the existing community contribution endpoint.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "added_pubs"

    def post(self, request: Request) -> Response:
        serializer = UserAddedPubRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])

        try:
            with transaction.atomic():
                existing = (
                    UserAddedPub.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                if existing is not None:
                    return Response(
                        UserAddedPubSerializer(existing).data,
                        status=status.HTTP_200_OK,
                    )

                pub, created = UserAddedPub.objects.update_or_create(
                    cache_key=cache_key,
                    defaults={
                        "account": request.user,
                        "client_id": data["client_id"],
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "address": data.get("address") or "",
                        "active": True,
                    },
                )

                # A user adding the same physical place is a stronger signal than
                # an older block report for that geohash cell; otherwise the
                # mobile client would fetch this new row and immediately filter it
                # out by cache_key.
                PubReport.objects.filter(cache_key=cache_key, active=True).update(
                    active=False,
                    updated_at=dj_timezone.now(),
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "user-added-pub: unexpected error saving pub for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            UserAddedPubSerializer(pub).data,
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
                "pub-community: unexpected error saving contribution for cache key %s: %s",
                cache_key,
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


# Mirror the community menu cap (serializers._MAX_BEERS): a community beer menu
# holds at most 12 entries. When the menu is full a drink is still logged, but
# the merge is skipped.
_MAX_MENU_BEERS = 12


def _merge_drink_into_menu(beers: list[dict], beer: dict) -> bool:
    """Merge one drunk ``beer`` into a community ``beers`` menu list IN PLACE.

    The match key is (normalized name, volume_ml): the beer name trimmed +
    casefolded, plus the exact volume (None matches None). On a match the
    existing entry's ``price_czk`` is updated to the posted price. Otherwise the
    beer is appended IF the menu has room (< 12 entries); a full menu is left
    untouched.

    Every entry is kept in the canonical CommunityBeerSerializer shape (all three
    keys ``name`` / ``price_czk`` / ``volume_ml`` present).

    Returns True if the list was changed (price updated or beer appended), False
    if nothing changed (no match and the menu was full).
    """
    posted_key = ((beer.get("name") or "").strip().casefold(), beer.get("volume_ml"))
    for entry in beers:
        entry_key = ((entry.get("name") or "").strip().casefold(), entry.get("volume_ml"))
        if entry_key == posted_key:
            entry["price_czk"] = beer["price_czk"]
            return True

    if len(beers) >= _MAX_MENU_BEERS:
        return False

    beers.append(
        {
            "name": beer["name"],
            "price_czk": beer["price_czk"],
            "volume_ml": beer.get("volume_ml"),
        }
    )
    return True


class DrinksView(APIView):
    """
    POST   /v1/drinks
    DELETE /v1/drinks/<client_id>

    Log one beer the user drank via the in-app beer counter. Every drink carries
    a beer name + price; the server records the per-user DrinkLog AND merges the
    beer into the pub's community menu (PubCommunityData.beers) so counting beers
    community-sources the menu and prices.

    Auth: Bearer token (per-account). Idempotent on (account, client_id): a
    replayed client_id returns 200 ``duplicate: true`` with NO repeated side
    effects (no second log row, no second merge). Throttled per-IP (scope
    "drinks").

    The menu merge NEVER touches PubCommunityData.hours and is guarded by
    names_match so a different business in the same ~38 m geohash cell does not
    inherit the menu — in that case the drink is logged but the merge is skipped.

    DELETE removes the per-user DrinkLog row for (account, client_id) — used when
    the in-app minus button decrements a beer that was already delivered. It is
    idempotent (a missing row is a success with ``deleted: false``, so the
    client's offline delete queue can retry safely) and NEVER touches
    PubCommunityData: the contributed price was real community data and stays.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "drinks"

    def post(self, request: Request) -> Response:
        serializer = DrinkRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        beer = data["beer"]
        drank_at = data.get("drank_at") or dj_timezone.now()

        try:
            with transaction.atomic():
                drink, created = DrinkLog.objects.get_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "external_id": data.get("external_id") or "",
                        "beer_name": beer["name"],
                        "price_czk": beer["price_czk"],
                        "volume_ml": beer.get("volume_ml"),
                        "drank_at": drank_at,
                    },
                )

                # Idempotent replay: the drink already exists, so do NOT repeat the
                # menu merge (which is not itself idempotent — a price could have
                # changed since).
                if not created:
                    return Response(
                        {
                            "accepted": True,
                            "duplicate": True,
                            "cache_key": drink.cache_key,
                            "menu_updated": False,
                        },
                        status=status.HTTP_200_OK,
                    )

                menu_updated = self._merge_into_community(
                    cache_key, data, beer, account=request.user
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "drinks: unexpected error logging drink for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "accepted": True,
                "duplicate": False,
                "cache_key": cache_key,
                "menu_updated": menu_updated,
            },
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request: Request, client_id) -> Response:
        # Idempotent delete of the per-user drink. The account filter means a
        # client_id belonging to another account (or never logged, or already
        # deleted) simply matches nothing → deleted: false, never a hard 404,
        # so the client's offline delete queue can retry safely. The community
        # menu (PubCommunityData) is deliberately left untouched — the price was
        # real community data and stays.
        try:
            deleted_count, _ = DrinkLog.objects.filter(
                account=request.user, client_id=client_id
            ).delete()
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "drinks: unexpected error deleting drink %r: %s",
                client_id,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"deleted": deleted_count > 0}, status=status.HTTP_200_OK)

    @staticmethod
    def _merge_into_community(
        cache_key: str, data: dict, beer: dict, account: Account
    ) -> bool:
        """Merge the drunk beer into PubCommunityData.beers for ``cache_key``.

        Returns whether the community menu was changed. NEVER touches hours.

        Three cases:
          * No row for the cell → create one holding just this beer (mirrors how
            PubCommunityView seeds a row), menu_updated = True.
          * Row exists and names_match(row.name, posted name) → merge the beer
            (update price of a same name+volume entry, else append if room).
          * Row exists but names_match fails (different business in the same
            ~38 m cell) → skip the merge, leave the menu untouched.
        """
        now = dj_timezone.now()
        row = PubCommunityData.objects.select_for_update().filter(cache_key=cache_key).first()

        if row is None:
            try:
                # Nested atomic gives this INSERT its own savepoint. If a concurrent
                # first-drink wins the unique cache_key race, the savepoint rolls back
                # cleanly and the outer DrinkLog transaction can still continue.
                with transaction.atomic():
                    PubCommunityData.objects.create(
                        cache_key=cache_key,
                        name=data["name"],
                        lat=data["lat"],
                        lng=data["lng"],
                        city=data.get("city") or None,
                        external_id=data.get("external_id") or None,
                        account=account,
                        beers=[
                            {
                                "name": beer["name"],
                                "price_czk": beer["price_czk"],
                                "volume_ml": beer.get("volume_ml"),
                            }
                        ],
                        beers_updated_at=now,
                    )
                return True
            except IntegrityError:
                # A concurrent first-drink for this brand-new cell won the race and
                # already created the row (cache_key is unique). Re-fetch it and
                # fall through to the names_match + merge path instead of letting
                # the IntegrityError bubble up as a 500 (which would commit our
                # DrinkLog but silently drop this beer from the menu). The merge
                # below is still guarded by names_match against whatever business
                # the winner seeded.
                row = (
                    PubCommunityData.objects.select_for_update()
                    .filter(cache_key=cache_key)
                    .first()
                )
                if row is None:
                    # The winner's row vanished between INSERT-fail and re-SELECT
                    # (deleted concurrently) — nothing to merge into.
                    return False

        # Collision guard: a different business sharing this geohash cell must not
        # inherit the menu (same gate as the read path).
        if not names_match(row.name, data["name"]):
            return False

        beers = list(row.beers or [])
        changed = _merge_drink_into_menu(beers, beer)
        if changed:
            row.beers = beers
            row.beers_updated_at = now
            # Refresh the most-recent-contributor pointer; never touch hours.
            row.account = account
            row.save(update_fields=["beers", "beers_updated_at", "account", "updated_at"])
        return changed


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


def _rating_item(rating: PubRating) -> dict:
    """Serialize one PubRating to the wire shape the mobile app expects.

    An empty verdict ("") is exposed as null, and updated_at is the client's
    last-write-wins timestamp (client_updated_at), not the server's updated_at.
    """
    return {
        "cache_key": rating.cache_key,
        "name": rating.name,
        "lat": rating.lat,
        "lng": rating.lng,
        "external_id": rating.external_id,
        "verdict": rating.verdict or None,
        "tag": rating.tag,
        "note": rating.note,
        "updated_at": rating.client_updated_at.isoformat(),
    }


class PubRatingView(APIView):
    """
    PUT    /v1/pub-ratings            → upsert one private rating
    GET    /v1/pub-ratings            → list all ratings of the account
    DELETE /v1/pub-ratings/<cache_key> → idempotent delete by geohash-8 key

    Two-way sync of a user's private per-pub ratings (thumbs verdict + optional
    tag + free-text note), keyed by the geohash-8 ``cache_key`` computed
    server-side from lat/lng. Conflict resolution is LAST-WRITE-WINS on the
    client's ``updated_at``: a PUT older than the stored client_updated_at is
    ignored (``applied: false``). An empty rating (no verdict, tag, or note)
    deletes any existing row. GET returns every rating so a fresh install can
    restore. Throttled per-IP (scope "pub_ratings").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_ratings"

    def get(self, request: Request) -> Response:
        try:
            ratings = PubRating.objects.filter(account=request.user)
            items = [_rating_item(rating) for rating in ratings]
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-ratings: unexpected error listing ratings: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"ratings": items}, status=status.HTTP_200_OK)

    def put(self, request: Request) -> Response:
        serializer = PubRatingRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        # Normalise the optional signal fields to "" (the model's blank default).
        verdict = data.get("verdict") or ""
        tag = (data.get("tag") or "").strip()
        note = (data.get("note") or "").strip()
        updated_at = data["updated_at"]

        try:
            with transaction.atomic():
                existing = (
                    PubRating.objects.select_for_update()
                    .filter(account=request.user, cache_key=cache_key)
                    .first()
                )
                # Last-write-wins: a stale write (older than what we already have)
                # is ignored — return the existing row with applied: false.
                if existing is not None and existing.client_updated_at > updated_at:
                    body = _rating_item(existing)
                    body["applied"] = False
                    return Response(body, status=status.HTTP_200_OK)

                # No signal at all → this is a clear/delete, guarded by the same
                # last-write-wins timestamp as normal upserts.
                if not verdict and not tag and not note:
                    if existing is not None:
                        existing.delete()
                    return Response(
                        {"deleted": existing is not None, "applied": True},
                        status=status.HTTP_200_OK,
                    )

                rating, _ = PubRating.objects.update_or_create(
                    account=request.user,
                    cache_key=cache_key,
                    defaults={
                        "name": data.get("name") or "",
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "external_id": data.get("external_id") or "",
                        "verdict": verdict,
                        "tag": tag,
                        "note": note,
                        "client_updated_at": updated_at,
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-ratings: unexpected error saving rating for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        body = _rating_item(rating)
        body["applied"] = True
        return Response(body, status=status.HTTP_200_OK)

    def delete(self, request: Request, cache_key: str) -> Response:
        # Idempotent delete: the account filter means a cache_key belonging to
        # another account (or never rated, or already deleted) matches nothing →
        # deleted: false, never a hard 404, so the client can retry safely.
        try:
            deleted_count, _ = PubRating.objects.filter(
                account=request.user, cache_key=cache_key
            ).delete()
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-ratings: unexpected error deleting rating %r: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"deleted": deleted_count > 0}, status=status.HTTP_200_OK)


def _visit_item(visit: PubVisit) -> dict:
    """Serialize one PubVisit to the wire shape the mobile app expects."""
    return {
        "client_id": str(visit.client_id),
        "cache_key": visit.cache_key,
        "name": visit.name,
        "lat": visit.lat,
        "lng": visit.lng,
        "city": visit.city,
        "external_id": visit.external_id,
        "started_at": visit.started_at.isoformat(),
        "ended_at": visit.ended_at.isoformat() if visit.ended_at else None,
        "updated_at": visit.client_updated_at.isoformat(),
    }


class PubVisitView(APIView):
    """
    POST   /v1/pub-visits              → push one explicit visit (upsert)
    GET    /v1/pub-visits              → list all visits of the account
    DELETE /v1/pub-visits/<client_id>  → idempotent delete by client_id

    Records that the user spent an evening at a pub even when no beer was
    counted. Idempotent on (account, client_id): a re-POST (offline retry, or a
    later POST filling in ``ended_at``) updates the same row. ``cache_key`` is
    the geohash-8 cell computed server-side. Throttled per-IP (scope
    "pub_visits").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_visits"

    def get(self, request: Request) -> Response:
        try:
            visits = PubVisit.objects.filter(account=request.user)
            items = [_visit_item(visit) for visit in visits]
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-visits: unexpected error listing visits: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"visits": items}, status=status.HTTP_200_OK)

    def post(self, request: Request) -> Response:
        serializer = PubVisitRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])

        try:
            with transaction.atomic():
                existing = (
                    PubVisit.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                if existing is not None and existing.client_updated_at > data["updated_at"]:
                    return Response(
                        {
                            "accepted": True,
                            "duplicate": True,
                            "cache_key": existing.cache_key,
                            "applied": False,
                        },
                        status=status.HTTP_200_OK,
                    )

                _, created = PubVisit.objects.update_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "external_id": data.get("external_id") or "",
                        "started_at": data["started_at"],
                        "ended_at": data.get("ended_at"),
                        "client_updated_at": data["updated_at"],
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-visits: unexpected error saving visit %r: %s",
                data.get("client_id"),
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "accepted": True,
                "duplicate": not created,
                "cache_key": cache_key,
                "applied": True,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request: Request, client_id) -> Response:
        # Idempotent delete scoped to the account (a foreign / missing / already
        # deleted client_id matches nothing → deleted: false, never a 404).
        try:
            deleted_count, _ = PubVisit.objects.filter(
                account=request.user, client_id=client_id
            ).delete()
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-visits: unexpected error deleting visit %r: %s",
                client_id,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"deleted": deleted_count > 0}, status=status.HTTP_200_OK)


def _account_from_request(request: Request) -> Account | None:
    user = getattr(request, "user", None)
    return user if isinstance(user, Account) else None


def _update_usage_stats(event: ClientEvent) -> None:
    """Fold one authenticated client event into per-account usage counters."""

    if event.account_id is None:
        return

    now = event.created_at or dj_timezone.now()
    stats, _ = AccountUsageStats.objects.get_or_create(account=event.account)

    update_fields: dict[str, object] = {
        "last_event_at": now,
    }
    if event.app_version:
        update_fields["last_app_version"] = event.app_version
    if event.platform:
        update_fields["last_platform"] = event.platform
    if event.os_version:
        update_fields["last_os_version"] = event.os_version

    if event.event == ClientEvent.Event.APP_OPEN:
        update_fields["app_open_count"] = F("app_open_count") + 1
        update_fields["last_app_open_at"] = now
    elif event.event == ClientEvent.Event.APP_FOREGROUND:
        update_fields["app_foreground_count"] = F("app_foreground_count") + 1
    elif event.event == ClientEvent.Event.WALKING_DISTANCE:
        distance_m = int(event.context.get("distance_m") or 0)
        if distance_m > 0:
            update_fields["walked_distance_m"] = F("walked_distance_m") + distance_m

    if event.event == ClientEvent.Event.API_FAILURE:
        update_fields["api_failure_count"] = F("api_failure_count") + 1

    if event.severity == ClientEvent.Severity.WARNING:
        update_fields["client_warning_count"] = F("client_warning_count") + 1
    elif event.severity == ClientEvent.Severity.ERROR:
        update_fields["client_error_count"] = F("client_error_count") + 1

    AccountUsageStats.objects.filter(pk=stats.pk).update(**update_fields)


class ClientEventsView(APIView):
    """
    POST /v1/client-events

    Accept one sanitized app observability event. Auth is optional: events with a
    valid account token are linked to the anonymous account and folded into
    AccountUsageStats; unauthenticated events are still useful for aggregate
    diagnostics but cannot affect per-account leaderboards.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "client_events"

    def post(self, request: Request) -> Response:
        serializer = ClientEventRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        account = _account_from_request(request)

        try:
            event = ClientEvent.objects.create(
                account=account,
                event=data["event"],
                severity=data["severity"],
                message=data.get("message") or "",
                context=data.get("context") or {},
                app_version=data.get("app_version") or "",
                platform=data.get("platform") or "",
                os_version=data.get("os_version") or "",
            )
            _update_usage_stats(event)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "client-events: unexpected error saving %r: %s",
                data.get("event"),
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        logger.info(
            "client event accepted",
            extra={
                "event": "client_event",
                "observability": {
                    "client_event": event.event,
                    "severity": event.severity,
                    "account_id": str(account.public_id) if account else "",
                    "app_version": event.app_version,
                    "platform": event.platform,
                },
            },
        )
        return Response({"accepted": True}, status=status.HTTP_202_ACCEPTED)


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


def _user_added_pub_item(pub: UserAddedPub) -> dict:
    """Return a Mapy-suggest-shaped item for the mobile client's existing parser."""

    regional_structure = []
    if pub.address:
        regional_structure.append({"name": pub.address, "type": "regional.street"})
    if pub.city:
        regional_structure.append({"name": pub.city, "type": "regional.municipality"})

    item = {
        "name": pub.name,
        "label": "Hospoda",
        "position": {"lat": pub.lat, "lon": pub.lng},
        "regionalStructure": regional_structure,
        "source": "community",
    }
    if pub.address:
        item["location"] = pub.address
    elif pub.city:
        item["location"] = pub.city
    return item


def _nearby_user_added_pub_items(lat: float, lng: float, radius_km: float) -> list[dict]:
    """Active user-added pubs within the requested circle, as suggest items."""

    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))

    rows = UserAddedPub.objects.filter(
        active=True,
        lat__gte=lat - lat_delta,
        lat__lte=lat + lat_delta,
        lng__gte=lng - lng_delta,
        lng__lte=lng + lng_delta,
    ).order_by("-updated_at")

    items = []
    for pub in rows:
        if _haversine_km(lat, lng, pub.lat, pub.lng) <= radius_km:
            items.append(_user_added_pub_item(pub))
    return items


def _with_user_added_items(user_added_items: list[dict], mapy_items: list[dict]) -> list[dict]:
    """Prepend user-added pubs while leaving the upstream cache untouched."""

    if not user_added_items:
        return mapy_items
    return [*user_added_items, *mapy_items]


class PubsNearView(APIView):
    """
    GET /v1/pubs/near?lat=<float>&lng=<float>&radius_km=<float, default 25>

    Server-side Mapy.cz /v1/suggest proxy with a shared DB cache. The mobile app
    used to call Mapy.cz directly from every device, which nearly exhausted the
    shared API credit; this endpoint fetches once per small (geohash-6) cell and
    radius bucket, caches the trimmed suggest items, and serves nearby devices
    from that row.

    Response 200:
        {"items": [<MapySuggestItem>...], "cached": <bool>, "fetched_at": "<ISO>"}
    where each MapySuggestItem is a trimmed raw Mapy suggest item the client feeds
    into its existing filtering pipeline.

    Returns 503 when Mapy is not configured / unavailable AND there is no cached
    row to fall back on — the client then calls Mapy.cz directly.

    Unauthenticated by design (like BlockedPubReportsView — filtering must work
    before an account is recovered) but throttled per-IP (scope "pubs_near").
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pubs_near"

    def get(self, request: Request) -> Response:
        serializer = PubsNearQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        radius_km: float = data["radius_km"]
        user_added_items = _nearby_user_added_pub_items(data["lat"], data["lng"], radius_km)

        # Quantize to a small shared cache cell but run the search from the user's
        # actual position. The old geohash-5 centre search could be >2 km away at
        # a cell edge, which made dense-city results point to the wrong quarter.
        cache_key = geohash6(data["lat"], data["lng"])
        radius_bucket = _radius_bucket(radius_km)

        ttl_days: int = int(getattr(settings, "PUBS_NEAR_TTL_DAYS", 7))
        cutoff = dj_timezone.now() - timedelta(days=ttl_days)

        row = PubSearchCache.objects.filter(
            cache_key=cache_key, radius_bucket=radius_bucket
        ).first()

        # Fresh cache hit — serve as-is.
        if row is not None and row.fetched_at >= cutoff:
            return Response(
                {
                    "items": _with_user_added_items(user_added_items, row.items),
                    "cached": True,
                    "fetched_at": row.fetched_at.isoformat(),
                },
                status=status.HTTP_200_OK,
            )

        # Stale or missing → fetch from Mapy. If the key isn't configured, fall
        # back to any stale row, else 503.
        api_key: str = getattr(settings, "MAPY_API_KEY", "") or ""
        if not api_key:
            if row is not None:
                logger.info(
                    "pubs-near: MAPY_API_KEY unset — serving stale cache for %s/%dkm",
                    cache_key, radius_bucket,
                )
                return Response(
                    {
                        "items": _with_user_added_items(user_added_items, row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            if user_added_items:
                return Response(
                    {
                        "items": user_added_items,
                        "cached": True,
                        "fetched_at": dj_timezone.now().isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            return Response(
                {"detail": "Mapy.cz proxy is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        daily_cap = int(getattr(settings, "MAPY_DAILY_CAP", 5000))

        try:
            with MapySuggestSource(api_key=api_key, daily_cap=daily_cap) as source:
                result = source.search_near(data["lat"], data["lng"], radius_bucket)
        except (MapyDailyCapExceededError, MapyAllQueriesFailedError) as exc:
            # Daily cap hit or every upstream query failed. Serve the stale row if
            # we have one (better stale than nothing); otherwise 503 so the client
            # falls back to calling Mapy.cz directly.
            if row is not None:
                logger.warning(
                    "pubs-near: Mapy fetch failed (%s) — serving stale cache for %s/%dkm",
                    exc, cache_key, radius_bucket,
                )
                return Response(
                    {
                        "items": _with_user_added_items(user_added_items, row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            if user_added_items:
                return Response(
                    {
                        "items": user_added_items,
                        "cached": True,
                        "fetched_at": dj_timezone.now().isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            logger.warning(
                "pubs-near: Mapy fetch failed (%s) and no cache for %s/%dkm — 503",
                exc, cache_key, radius_bucket,
            )
            return Response(
                {"detail": "Mapy.cz is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pubs-near: unexpected error fetching %s/%dkm: %s",
                cache_key, radius_bucket, exc, exc_info=True,
            )
            if row is not None:
                return Response(
                    {
                        "items": _with_user_added_items(user_added_items, row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            if user_added_items:
                return Response(
                    {
                        "items": user_added_items,
                        "cached": True,
                        "fetched_at": dj_timezone.now().isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Success — upsert the cache row. We accept the small write race between
        # concurrent requests for the same cell (both fetch, last write wins via
        # update_or_create on the unique (cache_key, radius_bucket) key): the
        # project runs sqlite in dev and Postgres in prod, so we avoid a
        # Postgres-only stampede lock (e.g. advisory locks) and a select_for_update
        # that would behave differently across the two backends. The duplicate
        # fetch is rare (TTL is days) and the result is identical, so it is cheaper
        # to tolerate than to serialize every request.
        now = dj_timezone.now()
        PubSearchCache.objects.update_or_create(
            cache_key=cache_key,
            radius_bucket=radius_bucket,
            defaults={"items": result.items, "fetched_at": now},
        )

        return Response(
            {
                "items": _with_user_added_items(user_added_items, result.items),
                "cached": False,
                "fetched_at": now.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class _PubLocationLookupBaseView(APIView):
    """Shared Mapy.cz lookup proxy for add-pub autocomplete and fallback geocode."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pubs_near"

    lookup_kind = "location"

    def _lookup(self, source: MapySuggestSource, query: str, lat: float | None, lng: float | None):
        raise NotImplementedError

    def get(self, request: Request) -> Response:
        serializer = PubLocationLookupQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        api_key: str = getattr(settings, "MAPY_API_KEY", "") or ""
        if not api_key:
            return Response(
                {"detail": "Mapy.cz proxy is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        daily_cap = int(getattr(settings, "MAPY_DAILY_CAP", 5000))
        try:
            with MapySuggestSource(api_key=api_key, daily_cap=daily_cap) as source:
                result = self._lookup(
                    source,
                    data["query"],
                    data.get("lat"),
                    data.get("lng"),
                )
        except MapyDailyCapExceededError as exc:
            logger.warning("pubs-%s: Mapy daily cap hit: %s", self.lookup_kind, exc)
            return Response(
                {"detail": "Mapy.cz daily cap exceeded."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except (requests.RequestException, ValueError) as exc:
            logger.warning("pubs-%s: Mapy lookup failed: %s", self.lookup_kind, exc)
            return Response(
                {"detail": "Mapy.cz is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pubs-%s: unexpected lookup error: %s",
                self.lookup_kind,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"items": result.items}, status=status.HTTP_200_OK)


class PubLocationSuggestView(_PubLocationLookupBaseView):
    """GET /v1/pubs/suggest?query=...&lat=...&lng=..."""

    lookup_kind = "suggest"

    def _lookup(self, source: MapySuggestSource, query: str, lat: float | None, lng: float | None):
        return source.suggest_locations(query, lat=lat, lng=lng)


class PubLocationGeocodeView(_PubLocationLookupBaseView):
    """GET /v1/pubs/geocode?query=...&lat=...&lng=..."""

    lookup_kind = "geocode"

    def _lookup(self, source: MapySuggestSource, query: str, lat: float | None, lng: float | None):
        return source.geocode_location(query, lat=lat, lng=lng)


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
                "account: unexpected error registering account: %s",
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
    GET/PATCH /v1/account/me

    Return or update the account that owns the supplied Bearer token.
    Token-authenticated; never echoes the token back. This is the scaffolding
    future per-user features build on.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        # request.user is the authenticated Account instance.
        return Response(AccountMeSerializer(request.user).data, status=status.HTTP_200_OK)

    def patch(self, request: Request) -> Response:
        serializer = AccountPreferencesSerializer(
            request.user,
            data=request.data,
            partial=True,
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        account = serializer.save()
        return Response(AccountMeSerializer(account).data, status=status.HTTP_200_OK)

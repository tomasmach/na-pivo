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
GET    /v1/beer-brands/suggest → BeerBrandSuggestView
POST   /v1/drinks      → DrinksView
PATCH  /v1/drinks/<client_id> → DrinksView
DELETE /v1/drinks/<client_id> → DrinksView
GET    /v1/release-notes → ReleaseNotesView
GET    /v1/health      → HealthView
"""

from __future__ import annotations

import json
import logging
import math
import re
from datetime import timedelta

import requests
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import ExpressionWrapper, F, FloatField, Q, Value
from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs import accounts, emailer
from pubs.accounts import AccountError
from pubs.beer_catalog import (
    match_beer_brand,
    suggest_beer_brands,
    sync_pub_beer_indexes_for_menu,
    upsert_pub_beer_brand,
)
from pubs.enrichment import (
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestSource,
    community_hours_to_osm,
    geohash6,
    geohash8,
    names_match,
)
from pubs.mapper import maper_snapshot
from pubs.models import (
    Account,
    AccountMappedPub,
    AccountPubCompletion,
    AccountUsageStats,
    AmenityKind,
    AmenityXpLedger,
    AuthToken,
    BeerBrand,
    ClientEvent,
    ContentReport,
    DrinkLog,
    EmailCredential,
    FeedbackReport,
    FriendNotification,
    FriendPubActivity,
    Friendship,
    PubAmenity,
    PubAmenityVote,
    PubAmenityVoteTombstone,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubCommunityXpLedger,
    PubContributionLog,
    PubRating,
    PubReport,
    PubSearchCache,
    PubVisit,
    PushDevice,
    ReleaseNote,
    UserAddedPub,
)

from .authentication import AccountTokenAuthentication
from .cache import get_or_enrich
from .serializers import (
    AccountMeSerializer,
    AccountRegisterSerializer,
    AccountSerializer,
    AccountUpdateSerializer,
    BeerBrandSuggestionSerializer,
    BeerBrandSuggestQuerySerializer,
    BlockedPubsResponseSerializer,
    ClientEventRequestSerializer,
    ContentReportRequestSerializer,
    ContentReportSerializer,
    DrinkRequestSerializer,
    DrinkUpdateSerializer,
    FeedbackReportSerializer,
    FeedbackRequestSerializer,
    FriendActivityRequestSerializer,
    FriendNotificationSerializer,
    FriendProfileSerializer,
    FriendRequestCreateSerializer,
    FriendSearchQuerySerializer,
    FriendPubActivitySerializer,
    FriendshipSerializer,
    PubAmenityKindSerializer,
    PubAmenityReadQuerySerializer,
    PubAmenityVotesRequestSerializer,
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
    PushDeviceDeleteSerializer,
    PushDeviceRequestSerializer,
    PushDeviceResponseSerializer,
    ReleaseNoteSerializer,
    RestorePurchasesRequestSerializer,
    UserAddedPubRequestSerializer,
    UserAddedPubSerializer,
    _amenity_aggregate_item,
    _amenity_vote_item,
)

logger = logging.getLogger(__name__)

DEFAULT_BLOCKED_REPORT_RADIUS_KM = 25.0
_IDENTITY_SPACE_RE = re.compile(r"\s+")

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


def _pub_identity_key(cache_key: str, name: str) -> str:
    """Stable per-business key inside a geohash-8 cell."""
    normalized_name = _IDENTITY_SPACE_RE.sub(" ", (name or "").strip().casefold())
    return f"{cache_key}::{normalized_name}" if normalized_name else cache_key


FRIEND_ACTIVITY_DEFAULT_TTL = timedelta(hours=4)
FRIEND_ACTIVITY_MAX_TTL = timedelta(hours=8)


def _friend_display_name(account: Account | None) -> str:
    if account is None:
        return "Kamarád"
    if account.nickname:
        return f"@{account.nickname}"
    if account.display_name:
        return account.display_name
    return "Kamarád"


def _accepted_friend_ids(account: Account) -> list[int]:
    rows = Friendship.objects.filter(status=Friendship.Status.ACCEPTED).filter(
        Q(requester=account) | Q(recipient=account)
    )
    friend_ids: list[int] = []
    for row in rows.only("requester_id", "recipient_id"):
        friend_ids.append(row.recipient_id if row.requester_id == account.id else row.requester_id)
    return friend_ids


def _shared_pub_stats(account: Account, friend_ids: list[int]) -> dict[int, dict[str, object]]:
    """Return lightweight shared-evening stats keyed by friend account id.

    A shared evening is currently a same-day visit to the same geohash-8 pub.
    This avoids storing any route or raw GPS history and stays cheap enough for
    the friend dashboard; a future version can tighten it to true time overlap.
    """

    if not friend_ids:
        return {}
    my_visits = list(PubVisit.objects.filter(account=account).only("cache_key", "started_at", "name"))
    if not my_visits:
        return {friend_id: {"shared_count": 0, "last_shared_at": None, "last_pub_name": ""} for friend_id in friend_ids}

    my_keys = {(visit.cache_key, visit.started_at.date()) for visit in my_visits}
    my_pub_names = {(visit.cache_key, visit.started_at.date()): visit.name for visit in my_visits}
    stats: dict[int, dict[str, object]] = {
        friend_id: {"shared_count": 0, "last_shared_at": None, "last_pub_name": ""}
        for friend_id in friend_ids
    }
    friend_visits = (
        PubVisit.objects.filter(account_id__in=friend_ids)
        .only("account_id", "cache_key", "started_at", "name")
        .order_by("-started_at")
    )
    seen_pairs: set[tuple[int, str, object]] = set()
    for visit in friend_visits:
        key = (visit.cache_key, visit.started_at.date())
        if key not in my_keys:
            continue
        pair = (visit.account_id, visit.cache_key, visit.started_at.date())
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        item = stats[visit.account_id]
        item["shared_count"] = int(item["shared_count"]) + 1
        last_shared_at = item["last_shared_at"]
        if last_shared_at is None or visit.started_at > last_shared_at:
            item["last_shared_at"] = visit.started_at
            item["last_pub_name"] = my_pub_names.get(key) or visit.name
    return stats


def _friend_rituals(shared_count: int) -> list[dict[str, str]]:
    rituals: list[dict[str, str]] = []
    if shared_count >= 1:
        rituals.append({"key": "first_round", "title": "První společné pivo"})
    if shared_count >= 3:
        rituals.append({"key": "regular_table", "title": "Už máte svůj stůl"})
    if shared_count >= 10:
        rituals.append({"key": "house_crew", "title": "Hospodská dvojka"})
    return rituals


def _friend_profile_context(request: Request) -> dict:
    return {"request": request}


def _send_friend_push(account_ids: list[int], title: str, body: str, data: dict) -> None:
    """Best-effort Expo push fanout.

    Push tokens are secrets. This helper never logs token values, request bodies
    or response payloads; the in-app FriendNotification row is the durable truth
    if Expo is down or the device has disabled pushes.
    """

    if not account_ids:
        return
    tokens = list(
        PushDevice.objects.filter(
            account_id__in=account_ids,
            enabled=True,
            permission_status=PushDevice.PermissionStatus.GRANTED,
        ).values_list("push_token", flat=True)
    )
    if not tokens:
        return

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "sound": "default",
            "data": data,
        }
        for token in tokens
    ]
    try:
        response = requests.post(
            "https://exp.host/--/api/v2/push/send",
            json=messages,
            timeout=3,
        )
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "friend push delivery failed",
            extra={
                "event": "friend_push_failed",
                "observability": {
                    "recipient_count": len(account_ids),
                    "token_count": len(tokens),
                    "error": exc.__class__.__name__,
                },
            },
        )


def _create_friend_notification(
    *,
    recipient: Account,
    actor: Account,
    kind: str,
    title: str,
    body: str,
    friendship: Friendship | None = None,
    activity: FriendPubActivity | None = None,
    pub_cache_key: str = "",
    pub_name: str = "",
) -> FriendNotification:
    return FriendNotification.objects.create(
        recipient=recipient,
        actor=actor,
        kind=kind,
        title=title,
        body=body,
        friendship=friendship,
        activity=activity,
        pub_cache_key=pub_cache_key,
        pub_name=pub_name,
    )


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

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_hours"

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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_reports"

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
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "address": data.get("address") or "",
                        "active": True,
                    },
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
                sync_pub_beer_indexes_for_menu(
                    cache_key=cache_key,
                    data=data,
                    beers=data["beers"],
                    source=PubBeerBrand.Source.COMMUNITY,
                    account=request.user,
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

        # ── Mapér XP (additive; an XP failure must never break a saved edit) ──
        xp_awarded = 0
        mapper = None
        try:
            pub_identity_key = _pub_identity_key(cache_key, data["name"])
            kinds: set[str] = set()
            if has_hours:
                kinds.add(PubCommunityXpLedger.Kind.HOURS)
            if has_beers:
                kinds.add(PubCommunityXpLedger.Kind.BEERS)
            xp_awarded = _award_community_xp(
                request.user, cache_key, pub_identity_key, kinds
            )
            stats, _ = AccountUsageStats.objects.get_or_create(account=request.user)
            mapper = maper_snapshot(
                stats.mapper_xp,
                {
                    "mapped_pubs_count": stats.mapped_pubs_count,
                    "amenity_votes_count": stats.amenity_votes_count,
                    "first_mapper_count": stats.first_mapper_count,
                    "completed_pubs_count": stats.completed_pubs_count,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "pub-community: XP award failed for cache key %s: %s", cache_key, exc
            )

        body = PubCommunityResponseSerializer(
            {
                "cache_key": record.cache_key,
                "hours": record.hours_json,
                "beers": record.beers or [],
                "xp_awarded": xp_awarded,
                "mapper": mapper,
            }
        ).data
        return Response(body, status=status.HTTP_200_OK)


class BeerBrandSuggestView(APIView):
    """
    GET /v1/beer-brands/suggest

    Lightweight canonical beer-brand suggestions for manual beer entry. Public
    and read-only; failures are non-critical because the mobile form remains
    free-text.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "beer_brands"

    def get(self, request: Request) -> Response:
        query = BeerBrandSuggestQuerySerializer(data=request.query_params)
        if not query.is_valid():
            return Response(query.errors, status=status.HTTP_400_BAD_REQUEST)

        brands = suggest_beer_brands(
            query.validated_data.get("q") or "",
            limit=query.validated_data["limit"],
        )
        return Response(
            {"suggestions": BeerBrandSuggestionSerializer(brands, many=True).data},
            status=status.HTTP_200_OK,
        )


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
    PATCH  /v1/drinks/<client_id>
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

    PATCH fixes the private beer name on a single DrinkLog row. It is scoped to
    the account, idempotent for repeated retries, and deliberately does NOT edit
    PubCommunityData, price, volume, pub or timestamps.
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
        brand_match = match_beer_brand(beer["name"])
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
                        "beer_brand": brand_match.brand if brand_match else None,
                        "beer_brand_key": brand_match.brand.key if brand_match else "",
                        "beer_brand_name": brand_match.brand.name if brand_match else "",
                        "beer_product": brand_match.product if brand_match else None,
                        "beer_product_key": (
                            brand_match.product.key if brand_match and brand_match.product else ""
                        ),
                        "beer_product_name": (
                            brand_match.product.name if brand_match and brand_match.product else ""
                        ),
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

    def patch(self, request: Request, client_id) -> Response:
        serializer = DrinkUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        beer_name = serializer.validated_data["beer_name"]
        brand_match = match_beer_brand(beer_name)

        try:
            with transaction.atomic():
                drink = (
                    DrinkLog.objects.select_for_update()
                    .filter(account=request.user, client_id=client_id)
                    .first()
                )
                if drink is None:
                    return Response({"updated": False}, status=status.HTTP_200_OK)

                old_brand_key = drink.beer_brand_key
                old_product_key = drink.beer_product_key

                drink.beer_name = beer_name
                drink.beer_brand = brand_match.brand if brand_match else None
                drink.beer_brand_key = brand_match.brand.key if brand_match else ""
                drink.beer_brand_name = brand_match.brand.name if brand_match else ""
                drink.beer_product = brand_match.product if brand_match else None
                drink.beer_product_key = (
                    brand_match.product.key if brand_match and brand_match.product else ""
                )
                drink.beer_product_name = (
                    brand_match.product.name if brand_match and brand_match.product else ""
                )
                drink.save(
                    update_fields=[
                        "beer_name",
                        "beer_brand",
                        "beer_brand_key",
                        "beer_brand_name",
                        "beer_product",
                        "beer_product_key",
                        "beer_product_name",
                    ]
                )

                self._refresh_drink_brand_indexes_after_patch(
                    drink=drink,
                    old_brand_key=old_brand_key,
                    old_product_key=old_product_key,
                    account=request.user,
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "drinks: unexpected error updating drink %r: %s",
                client_id,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"updated": True}, status=status.HTTP_200_OK)

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
                upsert_pub_beer_brand(
                    cache_key=cache_key,
                    data=data,
                    beer=beer,
                    source=PubBeerBrand.Source.DRINK,
                    account=account,
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
        upsert_pub_beer_brand(
            cache_key=cache_key,
            data=data,
            beer=beer,
            source=PubBeerBrand.Source.DRINK,
            account=account,
        )
        return changed

    @staticmethod
    def _community_has_brand_signal(cache_key: str, brand_key: str) -> bool:
        row = PubCommunityData.objects.filter(cache_key=cache_key).first()
        if row is None:
            return False
        for beer in row.beers or []:
            match = match_beer_brand(str(beer.get("name") or ""))
            if match is not None and match.brand.key == brand_key:
                return True
        return False

    @staticmethod
    def _community_has_product_signal(cache_key: str, product_key: str) -> bool:
        row = PubCommunityData.objects.filter(cache_key=cache_key).first()
        if row is None:
            return False
        for beer in row.beers or []:
            match = match_beer_brand(str(beer.get("name") or ""))
            if match is not None and match.product is not None and match.product.key == product_key:
                return True
        return False

    @staticmethod
    def _refresh_drink_brand_indexes_after_patch(
        *,
        drink: DrinkLog,
        old_brand_key: str,
        old_product_key: str,
        account: Account,
    ) -> None:
        data = {
            "name": drink.name,
            "lat": drink.lat,
            "lng": drink.lng,
            "city": drink.city,
            "external_id": drink.external_id,
        }
        beer = {
            "name": drink.beer_name,
            "price_czk": drink.price_czk,
            "volume_ml": drink.volume_ml,
        }
        upsert_pub_beer_brand(
            cache_key=drink.cache_key,
            data=data,
            beer=beer,
            source=PubBeerBrand.Source.DRINK,
            account=account,
        )

        if old_brand_key and old_brand_key != drink.beer_brand_key:
            has_other_drink = DrinkLog.objects.filter(
                cache_key=drink.cache_key,
                beer_brand_key=old_brand_key,
            ).exists()
            if not has_other_drink and not DrinksView._community_has_brand_signal(
                drink.cache_key, old_brand_key
            ):
                PubBeerBrand.objects.filter(
                    cache_key=drink.cache_key,
                    brand_key=old_brand_key,
                    active=True,
                ).update(active=False, last_seen_at=dj_timezone.now())

        if old_product_key and old_product_key != drink.beer_product_key:
            has_other_product = DrinkLog.objects.filter(
                cache_key=drink.cache_key,
                beer_product_key=old_product_key,
            ).exists()
            if not has_other_product and not DrinksView._community_has_product_signal(
                drink.cache_key, old_product_key
            ):
                PubBeerProduct.objects.filter(
                    cache_key=drink.cache_key,
                    product_key=old_product_key,
                    active=True,
                ).update(active=False, last_seen_at=dj_timezone.now())


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


class ContentReportView(APIView):
    """
    POST /v1/content-reports

    Save a report for inappropriate public profile content. The report captures a
    small target snapshot so moderation still has context if the user changes
    their nickname/avatar before the admin reviews it.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback"

    def post(self, request: Request) -> Response:
        serializer = ContentReportRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        target = Account.objects.filter(public_id=data["target_account_id"]).first()
        if target is None:
            return Response(
                {"detail": "Profile not found.", "code": "profile_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if target.pk == request.user.pk:
            return Response(
                {"detail": "Nelze nahlásit vlastní profil.", "code": "self_report"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        snapshot = {
            "id": str(target.public_id),
            "nickname": target.nickname,
            "display_name": target.display_name,
            "has_avatar": bool(target.avatar),
            "is_public": target.is_public,
        }
        report = ContentReport.objects.create(
            reporter=request.user,
            target_account=target,
            reason=data["reason"],
            comment=data.get("comment") or "",
            target_snapshot=snapshot,
        )
        return Response(ContentReportSerializer(report).data, status=status.HTTP_201_CREATED)


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


class PushDeviceView(APIView):
    """
    PUT/DELETE /v1/push-device

    Register or disable this install's Expo push token. The endpoint stores no
    coordinates, pub identity or notification history; reminder decisions stay
    local on the mobile device.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "push_devices"

    def put(self, request: Request) -> Response:
        serializer = PushDeviceRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        try:
            device, _created = PushDevice.objects.update_or_create(
                push_token=data["push_token"],
                defaults={
                    "account": request.user,
                    "platform": data["platform"],
                    "permission_status": data["permission_status"],
                    "enabled": data["enabled"],
                    "app_version": data.get("app_version") or "",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("push-device: unexpected error registering token: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(PushDeviceResponseSerializer(device).data, status=status.HTTP_200_OK)

    def delete(self, request: Request) -> Response:
        serializer = PushDeviceDeleteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        push_token = serializer.validated_data["push_token"]
        queryset = PushDevice.objects.filter(
            account=request.user,
            enabled=True,
            push_token=push_token,
        )

        try:
            disabled = queryset.update(
                enabled=False,
                permission_status=PushDevice.PermissionStatus.DENIED,
                updated_at=dj_timezone.now(),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("push-device: unexpected error disabling token: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"disabled": disabled}, status=status.HTTP_200_OK)


class FriendsView(APIView):
    """
    GET /v1/friends

    Social dashboard payload: accepted friends, incoming/outgoing requests,
    active friend pub statuses and recent in-app notifications.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        now = dj_timezone.now()
        context = _friend_profile_context(request)

        friendships = (
            Friendship.objects.filter(Q(requester=request.user) | Q(recipient=request.user))
            .select_related("requester", "recipient")
            .order_by("-updated_at")
        )
        accepted = [row for row in friendships if row.status == Friendship.Status.ACCEPTED]
        incoming = [
            row
            for row in friendships
            if row.status == Friendship.Status.PENDING and row.recipient_id == request.user.id
        ]
        outgoing = [
            row
            for row in friendships
            if row.status == Friendship.Status.PENDING and row.requester_id == request.user.id
        ]

        friend_accounts = [
            row.recipient if row.requester_id == request.user.id else row.requester
            for row in accepted
        ]
        friend_ids = [account.id for account in friend_accounts]
        shared_stats = _shared_pub_stats(request.user, friend_ids)
        active = (
            FriendPubActivity.objects.filter(
                account_id__in=friend_ids,
                active=True,
                expires_at__gt=now,
            )
            .select_related("account")
            .order_by("-started_at")[:20]
        )
        notifications = (
            FriendNotification.objects.filter(recipient=request.user)
            .select_related("actor", "friendship", "activity")
            .order_by("-created_at")[:30]
        )
        unread_count = FriendNotification.objects.filter(
            recipient=request.user,
            read_at__isnull=True,
        ).count()

        return Response(
            {
                "friends": FriendProfileSerializer(friend_accounts, many=True, context=context).data,
                "friend_stats": {
                    str(account.public_id): {
                        "shared_pub_count": int(shared_stats.get(account.id, {}).get("shared_count") or 0),
                        "last_shared_at": (
                            shared_stats.get(account.id, {}).get("last_shared_at").isoformat()
                            if shared_stats.get(account.id, {}).get("last_shared_at")
                            else None
                        ),
                        "last_pub_name": shared_stats.get(account.id, {}).get("last_pub_name") or "",
                        "rituals": _friend_rituals(
                            int(shared_stats.get(account.id, {}).get("shared_count") or 0)
                        ),
                    }
                    for account in friend_accounts
                },
                "incoming_requests": FriendshipSerializer(incoming, many=True, context=context).data,
                "outgoing_requests": FriendshipSerializer(outgoing, many=True, context=context).data,
                "active_friends": FriendPubActivitySerializer(active, many=True, context=context).data,
                "notifications": FriendNotificationSerializer(notifications, many=True, context=context).data,
                "unread_count": unread_count,
            },
            status=status.HTTP_200_OK,
        )


class FriendSearchView(APIView):
    """GET /v1/friends/search?q=nick — public profile lookup for adding friends."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        serializer = FriendSearchQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        q = serializer.validated_data["q"]
        profiles = (
            Account.objects.filter(
                status=Account.Status.ACTIVE,
                is_public=True,
            )
            .exclude(pk=request.user.pk)
            .filter(Q(nickname__icontains=q) | Q(display_name__icontains=q))
            .order_by("nickname", "display_name")[:20]
        )
        return Response(
            {
                "results": FriendProfileSerializer(
                    profiles,
                    many=True,
                    context=_friend_profile_context(request),
                ).data
            },
            status=status.HTTP_200_OK,
        )


class FriendRequestView(APIView):
    """POST /v1/friends/requests — send a friend request by id or nickname."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        serializer = FriendRequestCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        target_query = Account.objects.filter(status=Account.Status.ACTIVE)
        if data.get("target_account_id"):
            target = target_query.filter(public_id=data["target_account_id"]).first()
        else:
            target = target_query.filter(nickname__iexact=data["nickname"]).first()

        if target is None or (not target.is_public and target.pk not in _accepted_friend_ids(request.user)):
            return Response(
                {"detail": "Profil se nepodařilo najít.", "code": "profile_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if target.pk == request.user.pk:
            return Response(
                {"detail": "Sám sobě žádost neposílej. To by bylo moc smutné.", "code": "self_request"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = dj_timezone.now()
        try:
            with transaction.atomic():
                reverse = (
                    Friendship.objects.select_for_update()
                    .filter(requester=target, recipient=request.user)
                    .first()
                )
                if reverse is not None:
                    if reverse.status != Friendship.Status.ACCEPTED:
                        reverse.status = Friendship.Status.ACCEPTED
                        reverse.responded_at = now
                        reverse.save(update_fields=["status", "responded_at", "updated_at"])
                        title = "Žádost přijata"
                        body = f"{_friend_display_name(request.user)} si tě přidal mezi kamarády."
                        _create_friend_notification(
                            recipient=target,
                            actor=request.user,
                            kind=FriendNotification.Kind.FRIEND_ACCEPTED,
                            title=title,
                            body=body,
                            friendship=reverse,
                        )
                        _send_friend_push(
                            [target.id],
                            title,
                            body,
                            {"kind": "friend_accepted", "friendship_id": str(reverse.public_id)},
                        )
                    return Response(
                        FriendshipSerializer(reverse, context=_friend_profile_context(request)).data,
                        status=status.HTTP_200_OK,
                    )

                friendship, created = Friendship.objects.select_for_update().get_or_create(
                    requester=request.user,
                    recipient=target,
                    defaults={"status": Friendship.Status.PENDING},
                )
                if not created and friendship.status == Friendship.Status.DECLINED:
                    friendship.status = Friendship.Status.PENDING
                    friendship.responded_at = None
                    friendship.save(update_fields=["status", "responded_at", "updated_at"])
                    created = True
                if friendship.status == Friendship.Status.ACCEPTED:
                    return Response(
                        FriendshipSerializer(friendship, context=_friend_profile_context(request)).data,
                        status=status.HTTP_200_OK,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: request create failed: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if created:
            title = "Nový kámoš na pivo?"
            body = f"{_friend_display_name(request.user)} si tě chce přidat mezi kamarády."
            _create_friend_notification(
                recipient=target,
                actor=request.user,
                kind=FriendNotification.Kind.FRIEND_REQUEST,
                title=title,
                body=body,
                friendship=friendship,
            )
            _send_friend_push(
                [target.id],
                title,
                body,
                {"kind": "friend_request", "friendship_id": str(friendship.public_id)},
            )

        return Response(
            FriendshipSerializer(friendship, context=_friend_profile_context(request)).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FriendRequestActionView(APIView):
    """POST /v1/friends/requests/<id>/accept|decline."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, request_id, action: str) -> Response:
        friendship = (
            Friendship.objects.select_related("requester", "recipient")
            .filter(public_id=request_id, recipient=request.user)
            .first()
        )
        if friendship is None:
            return Response(
                {"detail": "Žádost neexistuje.", "code": "request_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if action not in {"accept", "decline"}:
            return Response(
                {"detail": "Neznámá akce.", "code": "unknown_action"},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = dj_timezone.now()
        if action == "accept":
            created_notification = friendship.status != Friendship.Status.ACCEPTED
            friendship.status = Friendship.Status.ACCEPTED
            friendship.responded_at = friendship.responded_at or now
            friendship.save(update_fields=["status", "responded_at", "updated_at"])
            if created_notification:
                title = "Jde se na pivo"
                body = f"{_friend_display_name(request.user)} přijal tvoji žádost."
                _create_friend_notification(
                    recipient=friendship.requester,
                    actor=request.user,
                    kind=FriendNotification.Kind.FRIEND_ACCEPTED,
                    title=title,
                    body=body,
                    friendship=friendship,
                )
                _send_friend_push(
                    [friendship.requester_id],
                    title,
                    body,
                    {"kind": "friend_accepted", "friendship_id": str(friendship.public_id)},
                )
        else:
            friendship.status = Friendship.Status.DECLINED
            friendship.responded_at = now
            friendship.save(update_fields=["status", "responded_at", "updated_at"])

        return Response(
            FriendshipSerializer(friendship, context=_friend_profile_context(request)).data,
            status=status.HTTP_200_OK,
        )


class FriendDetailView(APIView):
    """DELETE /v1/friends/<account_id> — remove an accepted friend."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def delete(self, request: Request, account_id) -> Response:
        friend = Account.objects.filter(public_id=account_id).first()
        if friend is None:
            return Response({"removed": False}, status=status.HTTP_200_OK)
        deleted, _ = Friendship.objects.filter(
            status=Friendship.Status.ACCEPTED,
        ).filter(
            Q(requester=request.user, recipient=friend)
            | Q(requester=friend, recipient=request.user)
        ).delete()
        return Response({"removed": deleted > 0}, status=status.HTTP_200_OK)


class FriendActivityView(APIView):
    """POST /v1/friends/pub-activity — share "I'm at this pub" to accepted friends."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        serializer = FriendActivityRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        now = dj_timezone.now()
        started_at = data.get("started_at") or now
        requested_expiry = data.get("expires_at")
        max_expiry = started_at + FRIEND_ACTIVITY_MAX_TTL
        expires_at = requested_expiry or started_at + FRIEND_ACTIVITY_DEFAULT_TTL
        if expires_at <= now:
            return Response(
                {"detail": "expires_at must be in the future.", "code": "expired_activity"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if expires_at > max_expiry:
            expires_at = max_expiry

        cache_key = geohash8(data["lat"], data["lng"])
        should_notify = False
        try:
            with transaction.atomic():
                existing = (
                    FriendPubActivity.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                should_notify = existing is None or not existing.active or existing.expires_at <= now
                activity, _created = FriendPubActivity.objects.update_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "external_id": data.get("external_id") or "",
                        "message": data.get("message") or "",
                        "started_at": started_at,
                        "expires_at": expires_at,
                        "active": True,
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: pub activity failed: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        friend_ids = _accepted_friend_ids(request.user)
        if should_notify and friend_ids:
            title = "Kamarád je na pivu"
            actor = _friend_display_name(request.user)
            body = f"{actor} sedí v {activity.name}. Nechceš se přidat?"
            recipients = list(Account.objects.filter(id__in=friend_ids))
            for recipient in recipients:
                _create_friend_notification(
                    recipient=recipient,
                    actor=request.user,
                    kind=FriendNotification.Kind.FRIEND_AT_PUB,
                    title=title,
                    body=body,
                    activity=activity,
                    pub_cache_key=activity.cache_key,
                    pub_name=activity.name[:200],
                )
            _send_friend_push(
                friend_ids,
                title,
                body,
                {
                    "kind": "friend_at_pub",
                    "activity_id": str(activity.public_id),
                    "pub_cache_key": activity.cache_key,
                },
            )

        return Response(
            FriendPubActivitySerializer(activity, context=_friend_profile_context(request)).data,
            status=status.HTTP_201_CREATED if should_notify else status.HTTP_200_OK,
        )

    def delete(self, request: Request, activity_id) -> Response:
        updated = FriendPubActivity.objects.filter(
            account=request.user,
            public_id=activity_id,
            active=True,
        ).update(active=False, updated_at=dj_timezone.now())
        return Response({"ended": updated > 0}, status=status.HTTP_200_OK)


class FriendNotificationReadView(APIView):
    """POST /v1/friends/notifications/read — mark selected or all notifications read."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        ids = request.data.get("ids")
        queryset = FriendNotification.objects.filter(recipient=request.user, read_at__isnull=True)
        if ids is not None:
            if not isinstance(ids, list):
                return Response(
                    {"detail": "ids must be a list.", "code": "invalid_ids"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(public_id__in=ids)
        updated = queryset.update(read_at=dj_timezone.now())
        return Response({"marked_read": updated}, status=status.HTTP_200_OK)


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


# Upper bounds on the user-added pubs mixed into one /v1/pubs/near response.
# A bounding-box query can match an unbounded number of rows (an attacker can
# POST ~20 pubs/min), so cap how many we scan and how many we ultimately return.
# We scan a generous prefix, compute the haversine distance, then keep only the
# nearest MAX so the rows we drop are the most distant ones, not arbitrary ones.
_USER_ADDED_SCAN_LIMIT = 200
_USER_ADDED_MAX_RESULTS = 50
_BEER_BRAND_SCAN_LIMIT = 200
_BEER_BRAND_MAX_RESULTS = 50


def _nearby_user_added_pub_items(lat: float, lng: float, radius_km: float) -> list[dict]:
    """Active user-added pubs within the requested circle, as suggest items.

    Bounded: at most _USER_ADDED_SCAN_LIMIT rows are scanned and at most
    _USER_ADDED_MAX_RESULTS (nearest first) are returned, so a flood of added
    pubs cannot inflate the response.
    """

    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))

    rows = UserAddedPub.objects.filter(
        active=True,
        lat__gte=lat - lat_delta,
        lat__lte=lat + lat_delta,
        lng__gte=lng - lng_delta,
        lng__lte=lng + lng_delta,
    ).order_by("-updated_at")[:_USER_ADDED_SCAN_LIMIT]

    within = []
    for pub in rows:
        distance = _haversine_km(lat, lng, pub.lat, pub.lng)
        if distance <= radius_km:
            within.append((distance, pub))

    within.sort(key=lambda pair: pair[0])
    return [_user_added_pub_item(pub) for _, pub in within[:_USER_ADDED_MAX_RESULTS]]


def _pub_beer_brand_item(link: PubBeerBrand) -> dict:
    item = {
        "name": link.name,
        "label": "Hospoda",
        "position": {"lat": link.lat, "lon": link.lng},
        "source": "beer_signal",
        "beerBrand": {
            "slug": link.brand_key,
            "name": link.brand_name,
            "source": link.source,
        },
    }
    if link.external_id:
        item["id"] = link.external_id
    if link.city:
        item["regionalStructure"] = [
            {"name": link.city, "type": "regional.municipality"},
        ]
        item["location"] = link.city
    return item


def _item_cache_key(item: dict) -> str:
    pos = item.get("position") or {}
    lat = pos.get("lat")
    lng = pos.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return ""
    return geohash8(float(lat), float(lng))


def _nearby_pub_beer_brand_items(
    *,
    brand_key: str,
    lat: float,
    lng: float,
    radius_km: float,
) -> tuple[list[dict], set[str]]:
    """Known pubs serving a brand, based on community menus and drink logs."""

    lat_delta = radius_km / 111.0
    lng_scale = max(math.cos(math.radians(lat)), 0.01)
    lng_delta = radius_km / (111.0 * lng_scale)
    lat_distance = F("lat") - Value(lat)
    lng_distance = (F("lng") - Value(lng)) * Value(lng_scale)
    distance_score = ExpressionWrapper(
        lat_distance * lat_distance + lng_distance * lng_distance,
        output_field=FloatField(),
    )

    rows = (
        PubBeerBrand.objects.filter(
            active=True,
            brand_key=brand_key,
            lat__gte=lat - lat_delta,
            lat__lte=lat + lat_delta,
            lng__gte=lng - lng_delta,
            lng__lte=lng + lng_delta,
        )
        .annotate(distance_score=distance_score)
        .order_by("distance_score", "-last_seen_at")[:_BEER_BRAND_SCAN_LIMIT]
    )

    within = []
    for link in rows:
        distance = _haversine_km(lat, lng, link.lat, link.lng)
        if distance <= radius_km:
            within.append((distance, link))

    within.sort(key=lambda pair: pair[0])
    links = [link for _, link in within[:_BEER_BRAND_MAX_RESULTS]]
    return [_pub_beer_brand_item(link) for link in links], {link.cache_key for link in links}


def _filter_items_by_cache_key(items: list[dict], cache_keys: set[str]) -> list[dict]:
    if not cache_keys:
        return []
    return [item for item in items if _item_cache_key(item) in cache_keys]


def _pub_near_dedupe_key(item: dict) -> str:
    """Match key for deduping community vs Mapy items.

    Mirrors enrichment.mapy._dedupe_key: casefolded name + (lat, lon) rounded to
    5 decimals (~1 m). Community items carry position.lon (not lng), same as the
    trimmed Mapy suggest items, so both sides hash identically.
    """
    pos = item.get("position") or {}
    name = (item.get("name") or "").strip().casefold()
    return f"{round(pos.get('lat', 0.0), 5)},{round(pos.get('lon', 0.0), 5)}|{name}"


def _with_user_added_items(user_added_items: list[dict], mapy_items: list[dict]) -> list[dict]:
    """Prepend user-added pubs, dropping any Mapy item that duplicates one.

    Once a community-added pub also shows up in the upstream Mapy results it would
    otherwise be returned twice; drop the Mapy copy so each physical pub appears
    once. The upstream cache row itself is left untouched.
    """

    if not user_added_items:
        return mapy_items

    seen = {_pub_near_dedupe_key(item) for item in user_added_items}
    deduped_mapy = [
        item for item in mapy_items if _pub_near_dedupe_key(item) not in seen
    ]
    return [*user_added_items, *deduped_mapy]


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
        beer_brand_key = data.get("beer_brand") or ""
        if beer_brand_key and not BeerBrand.objects.filter(
            key=beer_brand_key,
            active=True,
        ).exists():
            return Response(
                {"beer_brand": ["Unknown beer brand."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_added_items = _nearby_user_added_pub_items(data["lat"], data["lng"], radius_km)
        beer_brand_items: list[dict] = []
        beer_brand_cache_keys: set[str] = set()
        if beer_brand_key:
            beer_brand_items, beer_brand_cache_keys = _nearby_pub_beer_brand_items(
                brand_key=beer_brand_key,
                lat=data["lat"],
                lng=data["lng"],
                radius_km=radius_km,
            )
            user_added_items = _filter_items_by_cache_key(user_added_items, beer_brand_cache_keys)
            if not beer_brand_cache_keys:
                return Response(
                    {
                        "items": [],
                        "cached": True,
                        "fetched_at": dj_timezone.now().isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )

        def apply_beer_brand_filter(items: list[dict]) -> list[dict]:
            if not beer_brand_key:
                return _with_user_added_items(user_added_items, items)
            return _with_user_added_items(
                beer_brand_items,
                _filter_items_by_cache_key(items, beer_brand_cache_keys),
            )

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
                    "items": apply_beer_brand_filter(row.items),
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
                        "items": apply_beer_brand_filter(row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            fallback_items = apply_beer_brand_filter([])
            if fallback_items:
                return Response(
                    {
                        "items": fallback_items,
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
                        "items": apply_beer_brand_filter(row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            fallback_items = apply_beer_brand_filter([])
            if fallback_items:
                return Response(
                    {
                        "items": fallback_items,
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
                        "items": apply_beer_brand_filter(row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            fallback_items = apply_beer_brand_filter([])
            if fallback_items:
                return Response(
                    {
                        "items": fallback_items,
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
                "items": apply_beer_brand_filter(result.items),
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
    GET /v1/release-notes              → full published changelog (newest first)
    GET /v1/release-notes?version=<v>  → the published note for that version, 404 if none

    Two read shapes on one endpoint, both unauthenticated:

    - With ``version``: the launch popup's single-note lookup. The app calls this
      right after an update; a 404 (no note for this version) is an expected,
      cheap miss, not an error.
    - Without ``version``: the collection, used by the in-app "O appce" screen to
      let the user scroll through every update. Returns ``{"notes": [...]}``
      ordered newest-first (ReleaseNote.Meta.ordering = ["-created_at"]).
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        version = (request.query_params.get("version") or "").strip()

        # No version → the whole published changelog for the "O appce" screen.
        if not version:
            notes = ReleaseNote.objects.filter(is_published=True).prefetch_related("items")
            return Response(
                {"notes": ReleaseNoteSerializer(notes, many=True).data},
                status=status.HTTP_200_OK,
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


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _export_account_data(account: Account) -> dict:
    """Return a GDPR-style JSON export for one account, excluding secrets."""

    usage = getattr(account, "usage_stats", None)
    return {
        "exported_at": dj_timezone.now().isoformat(),
        "account": {
            "id": str(account.public_id),
            "device_id": account.device_id,
            "nickname": account.nickname,
            "display_name": account.display_name,
            "has_avatar": bool(account.avatar),
            "is_public": account.is_public,
            "email": account.primary_email,
            "email_verified": account.email_is_verified,
            "providers": account.auth_methods(),
            "status": account.status,
            "created_at": _iso(account.created_at),
            "last_seen_at": _iso(account.last_seen_at),
        },
        "settings": {
            "hide_pub_names": account.hide_pub_names,
            "compass_mode": account.compass_mode,
            "max_distance_km": account.max_distance_km,
            "price_currency": account.price_currency,
            "haptic_enabled": account.haptic_enabled,
            "sound_enabled": account.sound_enabled,
            "hide_closed_pubs": account.hide_closed_pubs,
            "marketing_emails_enabled": account.marketing_emails_enabled,
        },
        "subscription": {
            "tier": account.subscription_tier,
            "status": account.subscription_status,
            "platform": account.subscription_platform,
            "product_id": account.subscription_product_id,
            "original_transaction_id": account.subscription_original_transaction_id,
            "expires_at": _iso(account.subscription_expires_at),
            "updated_at": _iso(account.subscription_updated_at),
        },
        "push_devices": [
            {
                "platform": device.platform,
                "permission_status": device.permission_status,
                "enabled": device.enabled,
                "app_version": device.app_version,
                "created_at": _iso(device.created_at),
                "updated_at": _iso(device.updated_at),
                "last_registered_at": _iso(device.last_registered_at),
            }
            for device in account.push_devices.all()
        ],
        "usage": {
            "app_open_count": usage.app_open_count if usage else 0,
            "app_foreground_count": usage.app_foreground_count if usage else 0,
            "walked_distance_m": usage.walked_distance_m if usage else 0,
            "client_warning_count": usage.client_warning_count if usage else 0,
            "client_error_count": usage.client_error_count if usage else 0,
            "api_failure_count": usage.api_failure_count if usage else 0,
        },
        "drinks": [
            {
                "client_id": str(drink.client_id),
                "cache_key": drink.cache_key,
                "name": drink.name,
                "lat": drink.lat,
                "lng": drink.lng,
                "city": drink.city,
                "external_id": drink.external_id,
                "beer_name": drink.beer_name,
                "price_czk": drink.price_czk,
                "volume_ml": drink.volume_ml,
                "drank_at": _iso(drink.drank_at),
                "created_at": _iso(drink.created_at),
            }
            for drink in account.drinks.all()
        ],
        "visits": [_visit_item(visit) for visit in account.pub_visits.all()],
        "ratings": [_rating_item(rating) for rating in account.pub_ratings.all()],
        "community_contributions": [
            {
                "client_id": str(row.client_id),
                "kind": row.kind,
                "cache_key": row.cache_key,
                "name": row.name,
                "lat": row.lat,
                "lng": row.lng,
                "payload": row.payload,
                "created_at": _iso(row.created_at),
            }
            for row in account.contribution_logs.all()
        ],
        "pub_reports": [
            {
                "cache_key": report.cache_key,
                "external_id": report.external_id,
                "name": report.name,
                "lat": report.lat,
                "lng": report.lng,
                "city": report.city,
                "address": report.address,
                "reason": report.reason,
                "active": report.active,
                "created_at": _iso(report.created_at),
            }
            for report in account.pub_reports.all()
        ],
        "feedback_reports": [
            {
                "client_id": str(report.client_id),
                "category": report.category,
                "message": report.message,
                "contact_type": report.contact_type,
                "contact": report.contact,
                "app_version": report.app_version,
                "platform": report.platform,
                "os_version": report.os_version,
                "status": report.status,
                "created_at": _iso(report.created_at),
            }
            for report in account.feedback_reports.all()
        ],
        "content_reports_made": [
            {
                "target_account_id": (
                    str(report.target_account.public_id)
                    if report.target_account_id is not None
                    else None
                ),
                "reason": report.reason,
                "comment": report.comment,
                "status": report.status,
                "created_at": _iso(report.created_at),
            }
            for report in account.content_reports_made.all()
        ],
        # PubAmenityVote is a per-account, location-adjacent dataset (§8.5): the
        # owner's own export includes it (name/city/coords are what they supplied).
        "amenity_votes": [
            {
                "cache_key": vote.cache_key,
                "amenity_key": vote.amenity_key,
                "name": vote.name,
                "lat": vote.lat,
                "lng": vote.lng,
                "city": vote.city,
                "external_id": vote.external_id,
                "value": vote.value,
                "taxonomy_version": vote.taxonomy_version,
                "client_updated_at": _iso(vote.client_updated_at),
                "created_at": _iso(vote.created_at),
            }
            for vote in account.amenity_votes.all()
        ],
    }


class AccountExportView(APIView):
    """GET downloads data; POST sends the same export to the account e-mail."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        body = _export_account_data(request.user)
        response = Response(body, status=status.HTTP_200_OK)
        response["Content-Disposition"] = 'attachment; filename="na-pivo-export.json"'
        return response

    def post(self, request: Request) -> Response:
        account = request.user
        credential = EmailCredential.objects.filter(account=account).first()
        if credential is None:
            return Response(
                {
                    "code": "missing_email",
                    "detail": "K účtu nemáme e-mail, kam bychom export poslali.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not credential.email_verified:
            return Response(
                {
                    "code": "email_unverified",
                    "detail": "Export e-mailem pošleme až na ověřený e-mail.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        email = credential.email

        filename = f"na-pivo-export-{dj_timezone.now().date().isoformat()}.json"
        body = _export_account_data(account)
        json_bytes = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8")
        sent = emailer.send_account_export_email(
            email,
            filename=filename,
            json_bytes=json_bytes,
        )
        if not sent:
            return Response(
                {
                    "code": "email_failed",
                    "detail": "Export se nepodařilo odeslat e-mailem. Zkus to prosím znovu.",
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"email": email}, status=status.HTTP_202_ACCEPTED)


class AccountView(APIView):
    """
    POST /v1/account

    Idempotently register (ensure) an anonymous device-bound account. The mobile
    app sends the device_id it generated and persisted locally; we get_or_create
    the Account and return it with a token. Re-posting a known device_id rotates
    and returns a fresh token only when the request already carries a valid Bearer
    token for that same account.

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
        try:
            # Idempotent on the device_id UNIQUE constraint: under a concurrent
            # first-registration race, get_or_create wraps the INSERT in a
            # savepoint and re-SELECTs on IntegrityError, so a lost-response retry
            # never creates a duplicate Account.
            #
            # Tokens live in AuthToken now (kind=device for this bootstrap path).
            # Only the SHA-256 hash is stored, so a raw token cannot be recovered.
            # A known device_id is therefore allowed to rotate only when the caller
            # proves possession of the current token for this same account;
            # otherwise device_id would act as a bearer-equivalent recovery key.
            account, created = Account.objects.get_or_create(device_id=device_id)
            if created:
                raw_token = accounts.issue_token(account, kind=AuthToken.Kind.DEVICE)
            else:
                auth_result = AccountTokenAuthentication().authenticate(request)
                if auth_result is None:
                    return Response(
                        {"detail": "Authentication credentials were not provided."},
                        status=status.HTTP_401_UNAUTHORIZED,
                        headers={"WWW-Authenticate": "Bearer"},
                    )

                authenticated_account, presented_token = auth_result
                if authenticated_account.pk != account.pk:
                    return Response(
                        {"detail": "Bearer token does not match device account."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                # Rotate: revoke the presented token and mint a fresh device token.
                # Touch last_seen_at (auto_now fires via update_fields).
                accounts.revoke_token(presented_token)
                raw_token = accounts.issue_token(account, kind=AuthToken.Kind.DEVICE)
                account.save(update_fields=["last_seen_at"])
        except AuthenticationFailed as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_401_UNAUTHORIZED,
                headers={"WWW-Authenticate": "Bearer"},
            )
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


def _first_error_detail_and_code(errors) -> tuple[str, str | None]:
    """Pull the first human message + machine code out of a DRF errors dict.

    DRF wraps each message in an ``ErrorDetail`` whose ``.code`` carries the
    stable code we attached in ``validate_nickname`` (e.g. ``nickname_taken``).
    Returns ``(detail, code)`` where ``code`` is ``None`` for generic field
    errors that have no custom code (so the caller falls back to the raw dict).
    """
    for value in errors.values():
        items = value if isinstance(value, list) else [value]
        for item in items:
            code = getattr(item, "code", None)
            # DRF's default field codes ('required', 'invalid', 'null', 'blank',
            # 'max_length', 'min_length') are not our nickname_* contract codes;
            # only surface a code that looks like ours.
            if isinstance(code, str) and code.startswith("nickname_"):
                return str(item), code
            return str(item), None
    return "Neplatný požadavek.", None


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
        # request.user is the authenticated Account instance. Pass the request as
        # context so avatar_url is built absolute (the highest-leverage bug).
        return Response(
            AccountMeSerializer(request.user, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def patch(self, request: Request) -> Response:
        serializer = AccountUpdateSerializer(
            request.user,
            data=request.data,
            partial=True,
        )
        if not serializer.is_valid():
            # A nickname validation error carries a stable machine code (set by
            # AccountUpdateSerializer.validate_nickname); surface it as
            # {detail, code} like the auth endpoints, not DRF's field-error dict.
            detail, code = _first_error_detail_and_code(serializer.errors)
            if code:
                # nickname_taken is a 409 (a uniqueness conflict), matching both
                # the DB IntegrityError backstop below and the contract; the other
                # nickname_* codes (invalid/reserved/too_short/too_long) are 400.
                http_status = (
                    status.HTTP_409_CONFLICT
                    if code == "nickname_taken"
                    else status.HTTP_400_BAD_REQUEST
                )
                return Response({"detail": detail, "code": code}, status=http_status)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            account = serializer.save()
        except IntegrityError:
            # DB UniqueConstraint backstop for a nickname TOCTOU race.
            return Response(
                {"detail": "Tuto přezdívku už někdo používá.", "code": "nickname_taken"},
                status=status.HTTP_409_CONFLICT,
            )
        except AccountError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code}, status=exc.http_status
            )
        return Response(
            AccountMeSerializer(account, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request: Request) -> Response:
        """Delete the account — required in-app by the App Store and Google Play.

        Soft-delete with a grace window: revoke every token, revoke the Apple
        token (Apple mandates it), mark the account pending-deletion, and email a
        cancel-by date. The ``purge_deleted_accounts`` command hard-purges after
        the window; signing back in within it reactivates the account.
        """
        try:
            accounts.schedule_deletion(request.user)
        except Exception as exc:  # noqa: BLE001
            logger.error("account delete failed: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class RestorePurchasesView(APIView):
    """
    POST /v1/account/me/purchases/restore

    Store purchase identifiers on the account so a future Na Pivo+ verifier can
    restore entitlements across devices. This endpoint deliberately does not
    unlock Plus by itself; without App Store / Play verification it marks the
    subscription state as pending_verification.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account"

    def post(self, request: Request) -> Response:
        serializer = RestorePurchasesRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        account = request.user
        account.subscription_platform = data["platform"]
        account.subscription_product_id = data.get("product_id") or ""
        account.subscription_original_transaction_id = (
            data.get("original_transaction_id") or data.get("transaction_id") or ""
        )
        account.subscription_expires_at = data.get("expires_at")
        account.subscription_status = Account.SubscriptionStatus.PENDING_VERIFICATION
        account.subscription_updated_at = dj_timezone.now()
        account.save(
            update_fields=[
                "subscription_platform",
                "subscription_product_id",
                "subscription_original_transaction_id",
                "subscription_expires_at",
                "subscription_status",
                "subscription_updated_at",
                "last_seen_at",
            ]
        )
        return Response(
            AccountMeSerializer(account, context={"request": request}).data,
            status=status.HTTP_202_ACCEPTED,
        )


class AccountAvatarView(APIView):
    """
    PUT/POST/DELETE /v1/account/me/avatar

    Upload, replace, or remove the authenticated account's avatar. The upload is
    ``multipart/form-data`` with a single ``avatar`` file part (jpeg/png/webp/heic
    accepted, but the server NEVER trusts the declared type — every image is
    re-decoded and re-encoded to a 256px square webp with EXIF stripped). POST is
    accepted as a mobile alias for PUT. DELETE resets to the initials fallback and
    is idempotent (200 even when there was no avatar).

    ``parser_classes`` is overridden LOCALLY to MultiPartParser — the global
    default stays JSON-only so no other endpoint is affected.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "avatar"

    def _store(self, request: Request) -> Response:
        upload = request.FILES.get("avatar")
        if upload is None:
            return Response(
                {"detail": "Chybí soubor s obrázkem.", "code": "avatar_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            accounts.set_avatar(request.user, upload)
        except AccountError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code}, status=exc.http_status
            )
        return Response(
            AccountMeSerializer(request.user, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def put(self, request: Request) -> Response:
        return self._store(request)

    def post(self, request: Request) -> Response:
        # Mobile alias for PUT (some HTTP clients can't send multipart PUT).
        return self._store(request)

    def delete(self, request: Request) -> Response:
        accounts.clear_avatar(request.user)
        return Response(
            AccountMeSerializer(request.user, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class NicknameAvailableView(APIView):
    """
    GET /v1/account/nickname-available?nickname=<candidate>

    Probe whether a nickname can be claimed. Public (AllowAny) with OPTIONAL auth:
    when a Bearer token is supplied, the caller's OWN current nickname reports as
    available (so the edit screen doesn't flag the unchanged value as taken).
    Returns ``200 {nickname, available, reason}``; ``400`` when the param is
    missing. Throttled per-IP (scope ``nickname_check``).
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "nickname_check"

    def get(self, request: Request) -> Response:
        nickname = request.query_params.get("nickname")
        if nickname is None or not nickname.strip():
            return Response(
                {"detail": "Chybí parametr 'nickname'.", "code": "nickname_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        nickname = nickname.strip()
        account = request.user if isinstance(request.user, Account) else None
        available, reason = accounts.check_nickname(nickname, account=account)
        return Response(
            {"nickname": nickname, "available": available, "reason": reason},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Pub amenities ("Zmapuj hospodu")
# ---------------------------------------------------------------------------


def _amenity_status(yes: int, no: int) -> tuple[str, float]:
    """Map (yes, no) vote counts to a (status, confidence) pair (§5.4).

    Pure + env-tunable. Below AMENITY_MIN_VOTES the fact stays "unknown" (the
    completeness meter still ticks via the moving confidence); a minority share
    >= AMENITY_DISPUTE_RATIO marks it "disputed". Confidence is agreement×volume,
    rounded to 4, so the Nth confirming voter barely moves it (diminishing
    reward for confirming known facts).
    """
    total = yes + no
    if total == 0:
        return (PubAmenity.Status.UNKNOWN, 0.0)
    majority, minority = max(yes, no), min(yes, no)
    agreement = majority / total  # 0.5..1.0
    volume = total / (total + 2)  # diminishing-returns weight
    confidence = round(agreement * volume, 4)  # 0.0..1.0
    if total < settings.AMENITY_MIN_VOTES:
        return (PubAmenity.Status.UNKNOWN, confidence)  # 1-2 votes: meter ticks, not yet truth
    if minority / total >= settings.AMENITY_DISPUTE_RATIO:
        return (PubAmenity.Status.DISPUTED, confidence)
    return ((PubAmenity.Status.YES if yes >= no else PubAmenity.Status.NO), confidence)


def _active_amenity_keys() -> set[str]:
    """The set of currently-active AmenityKind keys (the read/write allow-list)."""
    return set(AmenityKind.objects.filter(active=True).values_list("key", flat=True))


def _recompute_amenity_aggregate(
    cache_key: str,
    pub_identity_key: str,
    amenity_key: str,
    account: Account,
    data: dict,
) -> tuple[PubAmenity, bool]:
    """Recompute the PubAmenity aggregate for one (cache_key, amenity_key).

    Must be called inside a transaction. get_or_create the aggregate row, then
    select_for_update it so concurrent voters on a hot pub serialize and counts
    never lost-update (§5.3). Returns (aggregate, was_first_map) where
    was_first_map is True only when THIS call created the row. first_mapper /
    first_mapped_at are set ONLY on creation and NEVER reassigned.
    """
    now = dj_timezone.now()
    agg, created = PubAmenity.objects.get_or_create(
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
        defaults={
            "cache_key": cache_key,
            "name": data.get("name") or "",
            "lat": data["lat"],
            "lng": data["lng"],
            "city": data.get("city") or "",
            "external_id": data.get("external_id") or "",
            "first_mapper": account,
            "first_mapped_at": now,
            "last_updated": now,
        },
    )
    # Lock THIS aggregate row (it exists now) so the recount is atomic on both
    # backends without relying on locking a phantom (not-yet-existing) vote row.
    agg = PubAmenity.objects.select_for_update().get(pk=agg.pk)

    votes = PubAmenityVote.objects.filter(
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
    )
    yes_count = votes.filter(value=PubAmenityVote.Value.YES).count()
    no_count = votes.filter(value=PubAmenityVote.Value.NO).count()

    agg.yes_count = yes_count
    agg.no_count = no_count
    agg.distinct_voter_count = yes_count + no_count  # one vote per account by unique constraint
    agg.status, agg.confidence = _amenity_status(yes_count, no_count)
    # Keep the denormalised identity fresh from the latest vote (dominant name).
    agg.name = data.get("name") or agg.name
    agg.lat = data["lat"]
    agg.lng = data["lng"]
    agg.city = data.get("city") or agg.city
    agg.external_id = data.get("external_id") or agg.external_id
    agg.last_updated = now
    # first_mapper / first_mapped_at are NEVER touched after creation.
    agg.save(
        update_fields=[
            "name",
            "lat",
            "lng",
            "city",
            "external_id",
            "yes_count",
            "no_count",
            "distinct_voter_count",
            "status",
            "confidence",
            "last_updated",
            "updated_at",
        ]
    )
    return agg, created


def _account_completed_pub(account: Account, pub_identity_key: str, active_keys: set[str]) -> bool:
    """Whether this account has answered every active amenity for this pub.

    The public completeness meter still depends on aggregate confidence, but the
    Pořádkumil badge copy is personal: "Zmapuj jednu hospodu naplno". A user who
    fills every visible row should unlock it even when the crowd has not reached
    AMENITY_MIN_VOTES yet. Deactivated kinds never block completion.
    """
    if not active_keys:
        return False
    answered = set(
        PubAmenityVote.objects.filter(
            account=account,
            pub_identity_key=pub_identity_key,
            amenity_key__in=active_keys,
        )
        .values_list("amenity_key", flat=True)
    )
    return active_keys.issubset(answered)


def _first_touched_pub_count_today(account: Account, now) -> int:
    """Distinct cache_keys this account FIRST cast a vote on since UTC midnight.

    The daily soft cap (AMENITY_MAX_PUBS_PER_DAY) is on distinct pubs first
    touched today, to blunt first-mapper farming. Counts the account's own vote
    rows created today (created_at is the server time the row first appeared);
    a flip/re-vote updates the row but does not move created_at, so it never
    re-counts an already-mapped pub.
    """
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return AccountMappedPub.objects.filter(
        account=account,
        created_at__gte=start_of_day,
    ).count()


def _award_community_xp(
    account: Account,
    cache_key: str,
    pub_identity_key: str,
    kinds: set[str],
) -> int:
    """Award first-fact Mapér XP for opening-hours / beers contributions and
    return the XP this request paid (the wire ``xp_awarded``).

    Mirrors :func:`_award_mapper_xp`'s durable-ledger idempotency: each kind pays
    ``MAPER_XP_FIRST_FACT`` AT MOST ONCE per (account, cache_key, kind) via
    :class:`PubCommunityXpLedger`, so a later edit or a retried offline POST pays
    0. F()-increments AccountUsageStats (never a read-modify-write on the hot
    Account row).

    The pub also counts toward ``distinct_mapped_pubs`` the first time the account
    touches it through ANY channel — reusing the shared :class:`AccountMappedPub`
    marker keeps an hours contribution and an amenity vote on the same pub from
    double-counting it. No first-mapper / pub-complete bonuses apply here: those
    are amenity-aggregate concepts, and hours/beers are last-writer-wins data.
    """
    _mapped_pub, is_new_pub = AccountMappedPub.objects.get_or_create(
        account=account,
        pub_identity_key=pub_identity_key,
        defaults={"cache_key": cache_key},
    )

    xp_awarded = 0
    facts = 0
    for kind in kinds:
        _ledger, pays_base = PubCommunityXpLedger.objects.get_or_create(
            account=account,
            cache_key=cache_key,
            kind=kind,
        )
        if pays_base:
            xp_awarded += settings.MAPER_XP_FIRST_FACT
            facts += 1

    inc: dict[str, object] = {}
    if facts:
        inc["amenity_votes_count"] = F("amenity_votes_count") + facts
    if is_new_pub:
        inc["mapped_pubs_count"] = F("mapped_pubs_count") + 1
    if xp_awarded > 0:
        inc["mapper_xp"] = F("mapper_xp") + xp_awarded

    if inc:
        stats, _ = AccountUsageStats.objects.get_or_create(account=account)
        AccountUsageStats.objects.filter(pk=stats.pk).update(**inc)

    return xp_awarded


def _award_mapper_xp(
    account: Account,
    cache_key: str,
    pub_identity_key: str,
    amenity_key: str,
    vote: PubAmenityVote,
    was_first_map: bool,
    active_keys: set[str],
    now,
) -> int:
    """Award server-authoritative Mapér XP for one applied vote and return the
    total XP this write paid (the wire ``xp_awarded``). Must run inside the vote
    transaction. F()-increments AccountUsageStats (never a read-modify-write on
    the hot Account row).

    Idempotency is anchored on DURABLE markers that outlive the vote row (§7.3),
    NOT on PubAmenityVote.awarded_xp — a retraction HARD-deletes the vote row, so
    a per-row gate would be reset and let a retract-then-revote re-farm:
      * base per-fact XP and the distinct-pub / first-fact counters are gated on
        the per-(account, cache_key, amenity_key) :class:`AmenityXpLedger` row,
        which is created on first pay and never deleted;
      * the pub-complete bonus is gated on the per-(account, cache_key)
        :class:`AccountPubCompletion` row, paid at most once per (account, pub).

    Award rules (§7.3):
      * base per-fact XP is paid AT MOST ONCE per (account, cache_key,
        amenity_key) — a flip/re-vote/retract-then-revote pays 0;
      * the base is ``first_fact`` (this account created the aggregate) or
        ``confirm`` (someone already answered it);
      * ``first_mapper_bonus`` is added when this write set the immutable
        aggregate first_mapper to this account (``was_first_map``), UNLESS the
        account is over the daily distinct-pub cap (soft anti-farm: accept the
        vote, suppress only the bonus — §7.3);
      * ``pub_complete_bonus`` is paid once when this fresh fact brings the pub to
        100% completeness.

    Counters incremented:
      * ``amenity_votes_count`` + 1 only when base XP is first paid for the row;
      * ``mapped_pubs_count`` + 1 the first time the account votes on a new pub;
      * ``first_mapper_count`` + 1 on a first-map (regardless of bonus suppression);
      * ``completed_pubs_count`` + 1 on a pub-complete bonus.
    """
    # A pub is "new for the account" only when this durable per-pub marker is
    # created. The unique row makes mapped_pubs_count race-safe across concurrent
    # first votes for different amenities on the same pub.
    _mapped_pub, is_new_pub_for_account = AccountMappedPub.objects.get_or_create(
        account=account,
        pub_identity_key=pub_identity_key,
        defaults={"cache_key": cache_key},
    )

    # Durable base-XP gate: the first pay creates the ledger row; a flip/re-vote/
    # retract-then-revote finds it already present and pays 0.
    _ledger, pays_base = AmenityXpLedger.objects.get_or_create(
        account=account,
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
        defaults={"cache_key": cache_key},
    )

    xp_awarded = 0
    inc: dict[str, object] = {}

    if pays_base:
        if was_first_map:
            xp_awarded += settings.MAPER_XP_FIRST_FACT
            inc["first_mapper_count"] = F("first_mapper_count") + 1
            # Daily soft cap: over the cap, accept the vote but suppress the
            # first-mapper bonus (NOT a 4xx) to blunt city-grid farming (§7.3).
            over_cap = (
                _first_touched_pub_count_today(account, now)
                > settings.AMENITY_MAX_PUBS_PER_DAY
            )
            if not over_cap:
                xp_awarded += settings.MAPER_XP_FIRST_MAPPER_BONUS
        else:
            xp_awarded += settings.MAPER_XP_CONFIRM

        inc["amenity_votes_count"] = F("amenity_votes_count") + 1

    # Completion marker: once the account has live answers for every active row,
    # unlock "Pořádkumil" and bump the completed-pub counter exactly once. The XP
    # bonus is paid only when this same write also paid fresh base XP; that keeps
    # legacy/revote repairs from showing fake +XP while still unlocking the badge.
    if _account_completed_pub(account, pub_identity_key, active_keys):
        _completion, first_completion = AccountPubCompletion.objects.get_or_create(
            account=account,
            pub_identity_key=pub_identity_key,
            defaults={"cache_key": cache_key},
        )
        if first_completion:
            inc["completed_pubs_count"] = F("completed_pubs_count") + 1
            if pays_base:
                xp_awarded += settings.MAPER_XP_PUB_COMPLETE_BONUS

    if is_new_pub_for_account:
        inc["mapped_pubs_count"] = F("mapped_pubs_count") + 1

    # Mirror the XP onto the vote row for observability (the durable gate is the
    # ledger, NOT this field — a deleted row no longer matters).
    if pays_base and xp_awarded > 0:
        vote.awarded_xp = xp_awarded
        vote.save(update_fields=["awarded_xp"])

    if xp_awarded > 0:
        inc["mapper_xp"] = F("mapper_xp") + xp_awarded

    if inc:
        stats, _ = AccountUsageStats.objects.get_or_create(account=account)
        AccountUsageStats.objects.filter(pk=stats.pk).update(**inc)

    return xp_awarded


class PubAmenityKindsView(APIView):
    """
    GET /v1/pub-amenities/kinds → the server-driven amenity taxonomy.

    Public (AllowAny, like PubsNearView) and cacheable: the client GETs this to
    render the mapping sheet. Only active kinds are returned, ordered by
    (order, key). ``version`` is the full ISO-8601 max(updated_at) across active
    kinds so two same-day edits produce distinct versions. Throttled per-IP
    (scope "amenity_kinds").
    """

    # Truly public: no auth class at all (like PubsNearView), so a stale/invalid
    # bearer can never 401 this read — the taxonomy never needs an account.
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "amenity_kinds"

    def get(self, request: Request) -> Response:
        try:
            kinds = list(
                AmenityKind.objects.filter(active=True).order_by("rank", "key")
            )
            version = (
                max(k.updated_at for k in kinds).isoformat()
                if kinds
                else dj_timezone.now().isoformat()
            )
            items = PubAmenityKindSerializer(kinds, many=True).data
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities/kinds: unexpected error: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"kinds": items, "version": version}, status=status.HTTP_200_OK)


class PubAmenityVoteView(APIView):
    """
    PUT    /v1/pub-amenities/votes                          → upsert votes (per-amenity LWW)
    GET    /v1/pub-amenities/votes                          → list the account's own votes
    DELETE /v1/pub-amenities/votes/<cache_key>/<amenity_key> → idempotent retract

    Two-way sync of a user's PUBLIC per-(pub, amenity) yes/no votes, each keyed
    by the geohash-8 ``cache_key`` computed server-side. The body is a
    ``{"votes": [...]}`` array (one row per amenity — §4.2); conflict resolution
    is LAST-WRITE-WINS on each row's ``client_updated_at`` so a stale push of one
    amenity can never clobber another. A ``value`` of null is an explicit
    retraction. On every write the (cache_key, amenity_key) aggregate is
    recomputed synchronously under a row lock. Throttled per-IP (scope
    "pub_amenities").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_amenities"

    def get(self, request: Request) -> Response:
        try:
            votes = PubAmenityVote.objects.filter(account=request.user)
            tombstones = PubAmenityVoteTombstone.objects.filter(account=request.user)
            items = [_amenity_vote_item(vote) for vote in votes]
            items.extend(
                {
                    "cache_key": tombstone.cache_key,
                    "pub_identity_key": tombstone.pub_identity_key,
                    "name": tombstone.name,
                    "amenity_key": tombstone.amenity_key,
                    "value": None,
                    "client_updated_at": tombstone.client_updated_at.isoformat(),
                }
                for tombstone in tombstones
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities/votes: unexpected error listing votes: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"votes": items}, status=status.HTTP_200_OK)

    def put(self, request: Request) -> Response:
        serializer = PubAmenityVotesRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            active_keys = _active_amenity_keys()
            results = [
                self._apply_one(request.user, row, active_keys)
                for row in serializer.validated_data["votes"]
            ]
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities/votes: unexpected error saving votes: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # mapper: fresh Mapér snapshot is returned ONCE at the envelope level so
        # Profile updates without a second GET. Re-read the durable XP from
        # AccountUsageStats AFTER all rows applied (F()-increments are committed).
        stats = AccountUsageStats.objects.filter(account=request.user).first()
        counters = None
        if stats is not None:
            counters = {
                "mapped_pubs_count": stats.mapped_pubs_count,
                "amenity_votes_count": stats.amenity_votes_count,
                "first_mapper_count": stats.first_mapper_count,
                "completed_pubs_count": stats.completed_pubs_count,
            }
        mapper = maper_snapshot(stats.mapper_xp if stats is not None else 0, counters=counters)
        return Response({"results": results, "mapper": mapper}, status=status.HTTP_200_OK)

    def _apply_one(self, account: Account, data: dict, active_keys: set[str]) -> dict:
        """Apply one amenity vote row and return its result object.

        Each row runs in its own atomic block so one stale/ignored row does not
        roll back its siblings. ``cache_key`` is derived from lat/lng; lat/lng
        are never logged or echoed.
        """
        amenity_key = data["amenity_key"]
        cache_key = geohash8(data["lat"], data["lng"])
        pub_identity_key = _pub_identity_key(cache_key, data.get("name") or "")
        client_updated_at = data["client_updated_at"]
        # The wire sends explicit null as a retraction.
        value = data.get("value")

        # Unknown/inactive key → ignore (NOT 400): additive forward-compat so an
        # old server tolerates a newer client's key without breaking its queue.
        if amenity_key not in active_keys:
            return {
                "applied": False,
                "ignored_unknown_amenity": True,
                "deleted": False,
                "was_first_map": False,
                "xp_awarded": 0,  # an ignored unknown key never pays XP
                "vote": None,
                "aggregate": None,
            }

        with transaction.atomic():
            existing = (
                PubAmenityVote.objects.select_for_update()
                .filter(account=account, pub_identity_key=pub_identity_key, amenity_key=amenity_key)
                .first()
            )
            tombstone = (
                PubAmenityVoteTombstone.objects.select_for_update()
                .filter(account=account, pub_identity_key=pub_identity_key, amenity_key=amenity_key)
                .first()
            )

            # Geohash-8 collision guard: if the stored vote's name does not match
            # the new one, this is a logged collision signal; v1 keeps writing
            # (the read path's names_match guard protects consumers). §2.6.
            new_name = data.get("name") or ""
            if existing is not None and new_name and existing.name and not names_match(
                new_name, existing.name
            ):
                logger.info(
                    "pub-amenities/votes: geohash-8 name collision for %s/%s",
                    cache_key,
                    amenity_key,
                )

            # Last-write-wins per amenity: a stale push (<= stored timestamp) is
            # ignored → applied: false, return the current aggregate.
            if existing is not None and existing.client_updated_at >= client_updated_at:
                agg = PubAmenity.objects.filter(
                    pub_identity_key=pub_identity_key, amenity_key=amenity_key
                ).first()
                return {
                    "applied": False,
                    "ignored_unknown_amenity": False,
                    "deleted": False,
                    "was_first_map": False,
                    "xp_awarded": 0,  # a stale (LWW-rejected) write pays nothing
                    "vote": _vote_minimal(existing),
                    "aggregate": (
                        _amenity_aggregate_item(agg, my_value=existing.value)
                        if agg is not None
                        else None
                    ),
                }

            # A newer/equal durable retraction wins even when the live vote row is
            # gone, preventing stale offline upserts from resurrecting a cleared
            # answer.
            if tombstone is not None and tombstone.client_updated_at >= client_updated_at:
                agg = PubAmenity.objects.filter(
                    pub_identity_key=pub_identity_key, amenity_key=amenity_key
                ).first()
                return {
                    "applied": False,
                    "ignored_unknown_amenity": False,
                    "deleted": False,
                    "was_first_map": False,
                    "xp_awarded": 0,
                    "vote": None,
                    "aggregate": (
                        _amenity_aggregate_item(agg, my_value=None)
                        if agg is not None
                        else None
                    ),
                }

            # value: null → explicit retraction (delete the user's row),
            # guarded by the same LWW timestamp above.
            if value is None:
                deleted = existing is not None
                if existing is not None:
                    existing.delete()
                PubAmenityVoteTombstone.objects.update_or_create(
                    account=account,
                    cache_key=cache_key,
                    pub_identity_key=pub_identity_key,
                    amenity_key=amenity_key,
                    defaults={
                        "name": data.get("name") or "",
                        "client_updated_at": client_updated_at,
                    },
                )
                agg = None
                if deleted or PubAmenity.objects.filter(
                    pub_identity_key=pub_identity_key, amenity_key=amenity_key
                ).exists():
                    agg, _ = _recompute_amenity_aggregate(
                        cache_key,
                        pub_identity_key,
                        amenity_key,
                        account,
                        data,
                    )
                return {
                    "applied": True,
                    "ignored_unknown_amenity": False,
                    "deleted": deleted,
                    "was_first_map": False,
                    "xp_awarded": 0,  # retraction never pays (and never claws back)
                    "vote": None,
                    "aggregate": (
                        _amenity_aggregate_item(agg, my_value=None)
                        if agg is not None
                        else None
                    ),
                }

            # XP idempotency gate is the DURABLE AmenityXpLedger / AccountPubCompletion
            # marker (checked inside _award_mapper_xp), NOT the vote row — a
            # retraction hard-deletes the row, so a per-row gate would re-farm on
            # revote (§7.3).
            # Upsert the user's own vote row (unique per account). update_or_create
            # is IntegrityError-safe for two concurrent first voters: one inserts,
            # the other updates the same unique row.
            vote, _ = PubAmenityVote.objects.update_or_create(
                account=account,
                pub_identity_key=pub_identity_key,
                amenity_key=amenity_key,
                defaults={
                    "cache_key": cache_key,
                    "name": data.get("name") or "",
                    "lat": data["lat"],
                    "lng": data["lng"],
                    "city": data.get("city") or "",
                    "external_id": data.get("external_id") or "",
                    "value": value,
                    "client_updated_at": client_updated_at,
                    "taxonomy_version": data.get("taxonomy_version"),
                },
            )
            if tombstone is not None:
                tombstone.delete()
            agg, was_first_map = _recompute_amenity_aggregate(
                cache_key, pub_identity_key, amenity_key, account, data
            )
            # Award server-authoritative XP + bump counters in the SAME transaction
            # (F()-increments, never a read-modify-write on the hot Account row).
            xp_awarded = _award_mapper_xp(
                account=account,
                cache_key=cache_key,
                pub_identity_key=pub_identity_key,
                amenity_key=amenity_key,
                vote=vote,
                was_first_map=was_first_map,
                active_keys=active_keys,
                now=dj_timezone.now(),
            )
            # Re-read so the echoed client_updated_at is the DB-normalised UTC
            # value, matching the GET restore path / _rating_item exactly.
            vote.refresh_from_db(fields=["client_updated_at", "value"])

        return {
            "applied": True,
            "ignored_unknown_amenity": False,
            "deleted": False,
            # was_first_map is an AGGREGATE fact (this write created the row); the
            # first-mapper XP bonus rides on it (subject to the daily cap).
            "was_first_map": was_first_map,
            # The authoritative per-vote award for the optimistic toast (§7.1).
            "xp_awarded": xp_awarded,
            # Echo the persisted row (client_updated_at normalised to UTC, like
            # the GET restore path and _rating_item), not the raw request offset.
            "vote": _vote_minimal(vote),
            "aggregate": _amenity_aggregate_item(agg, my_value=value),
        }

    def delete(self, request: Request, cache_key: str, amenity_key: str) -> Response:
        # Idempotent delete scoped to the account, filtering only by (account,
        # cache_key, amenity_key) with NO AmenityKind existence check, so a vote
        # for a since-deactivated kind can always be cleared. Recompute the
        # aggregate so the public truth reflects the removal.
        try:
            with transaction.atomic():
                existing = (
                    PubAmenityVote.objects.select_for_update()
                    .filter(account=request.user, cache_key=cache_key, amenity_key=amenity_key)
                    .first()
                )
                deleted = existing is not None
                if existing is not None:
                    tombstone_at = dj_timezone.now()
                    data = {
                        "name": existing.name,
                        "lat": existing.lat,
                        "lng": existing.lng,
                        "city": existing.city,
                        "external_id": existing.external_id,
                    }
                    existing.delete()
                    PubAmenityVoteTombstone.objects.update_or_create(
                        account=request.user,
                        cache_key=cache_key,
                        pub_identity_key=existing.pub_identity_key,
                        amenity_key=amenity_key,
                        defaults={
                            "name": existing.name,
                            "client_updated_at": tombstone_at,
                        },
                    )
                    # Only recompute if the aggregate row exists (it should).
                    if PubAmenity.objects.filter(
                        pub_identity_key=existing.pub_identity_key, amenity_key=amenity_key
                    ).exists():
                        _recompute_amenity_aggregate(
                            cache_key, existing.pub_identity_key, amenity_key, request.user, data
                        )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-amenities/votes: unexpected error deleting vote %s/%s: %s",
                cache_key,
                amenity_key,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({"deleted": deleted}, status=status.HTTP_200_OK)


def _vote_minimal(vote: PubAmenityVote) -> dict:
    """The minimal {amenity_key, value, client_updated_at} echoed on a PUT result."""
    return {
        "cache_key": vote.cache_key,
        "pub_identity_key": vote.pub_identity_key,
        "name": vote.name,
        "amenity_key": vote.amenity_key,
        "value": vote.value,
        "client_updated_at": vote.client_updated_at.isoformat(),
    }


def _optional_amenity_account(request: Request) -> Account | None:
    """Best-effort bearer → Account for the public amenity read.

    The read is truly AllowAny (authentication_classes=[]) so a stale/invalid
    token can never 401 it (§4.4, like PubsNearView). We still want ``my_value``
    for a valid token, so we resolve the account out-of-band and SWALLOW any
    AuthenticationFailed — a bad token simply degrades to an anonymous read.
    """
    try:
        result = AccountTokenAuthentication().authenticate(request)
    except AuthenticationFailed:
        return None
    if result is None:
        return None
    account, _raw_token = result
    return account if isinstance(account, Account) else None


class PubAmenityReadView(APIView):
    """
    GET /v1/pub-amenities?cache_keys=<k1>,<k2>...&name=<pub name>

    Public, cheap, local-DB-only aggregate read (the sheet/read path). Served
    from PubAmenity with its OWN short TTL, deliberately NOT bolted onto the
    metered Mapy ``/pubs/near`` proxy (§4.4). Each row is gated against the
    requesting client's pub ``name`` via names_match (§2.6): a mismatch treats
    the row as unmapped rather than leaking a neighbouring business's votes.
    Only active kinds are returned; completeness uses the active denominator and
    is clamped to [0, 1] so a pub never shows >100%. ``my_value`` is populated
    only for authenticated callers. Throttled per-IP (scope "amenity_reads").
    """

    # Truly public (like PubsNearView): no auth class, so a stale token can never
    # 401 this read. ``my_value`` is resolved best-effort via the optional bearer
    # lookup below, which degrades a bad token to an anonymous read.
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "amenity_reads"

    def get(self, request: Request) -> Response:
        serializer = PubAmenityReadQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        request_name = serializer.validated_data.get("name") or ""
        raw_keys = serializer.validated_data["cache_keys"]
        # Comma-split, strip, dedup (preserve order), cap to AMENITY_READ_MAX_KEYS.
        seen: set[str] = set()
        cache_keys: list[str] = []
        for k in raw_keys.split(","):
            k = k.strip()
            if k and k not in seen:
                seen.add(k)
                cache_keys.append(k)
            if len(cache_keys) >= settings.AMENITY_READ_MAX_KEYS:
                break

        # AllowAny + authentication_classes=[] means request.user is anonymous;
        # resolve my_value best-effort (a bad token degrades to anonymous, no 401).
        account = _optional_amenity_account(request)

        try:
            active_keys = _active_amenity_keys()
            total_kinds = len(active_keys)

            # My own live votes for these cells, so my_value comes from ONE query.
            my_votes: dict[tuple[str, str], str] = {}
            if account is not None and cache_keys:
                for v in PubAmenityVote.objects.filter(
                    account=account, cache_key__in=cache_keys
                ).values_list("pub_identity_key", "amenity_key", "value"):
                    my_votes[(v[0], v[1])] = v[2]

            aggregates = (
                PubAmenity.objects.filter(cache_key__in=cache_keys)
                if cache_keys
                else PubAmenity.objects.none()
            )
            by_cache: dict[str, list[PubAmenity]] = {}
            for agg in aggregates:
                # names_match collision guard (§2.6). When the caller sent a
                # name, a row can only be served if it carries a name that
                # matches: a stored EMPTY name can't be verified against the
                # request, so drop it rather than leak it to any business sharing
                # the ~38m geohash-8 cell. (The write path requires a non-blank
                # name, so guardless aggregates can no longer be created; this
                # also defends any legacy empty-name rows.)
                if request_name and (not agg.name or not names_match(request_name, agg.name)):
                    continue
                # Only active kinds are surfaced (deactivated kinds excluded).
                if agg.amenity_key not in active_keys:
                    continue
                by_cache.setdefault(agg.cache_key, []).append(agg)

            pubs = []
            for cache_key in cache_keys:
                rows = by_cache.get(cache_key, [])
                mapper_count = (
                    max((r.distinct_voter_count for r in rows), default=0) if rows else 0
                )
                mapped_count = sum(
                    1 for r in rows if r.status != PubAmenity.Status.UNKNOWN
                )
                pct = (mapped_count / total_kinds) if total_kinds else 0.0
                pct = max(0.0, min(1.0, pct))  # clamp to [0, 1]
                amenities = [
                    _amenity_aggregate_item(
                        r, my_value=my_votes.get((r.pub_identity_key, r.amenity_key))
                    )
                    for r in rows
                ]
                pubs.append(
                    {
                        "cache_key": cache_key,
                        "mapper_count": mapper_count,
                        "completeness": {
                            "mapped_count": mapped_count,
                            "total_kinds": total_kinds,
                            "pct": round(pct, 4),
                        },
                        "amenities": amenities,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities: unexpected error reading aggregates: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"pubs": pubs}, status=status.HTTP_200_OK)

"""
pubs.api.views — DRF views for the pub-hours API.

Endpoints
---------
POST   /v1/pub-hours   → PubHoursView
POST   /v1/pub-reports → PubReportView
GET    /v1/pub-reports/blocked → BlockedPubReportsView
POST   /v1/drinks      → DrinksView
DELETE /v1/drinks/<client_id> → DrinksView
GET    /v1/release-notes → ReleaseNotesView
GET    /v1/health      → HealthView
"""

from __future__ import annotations

import logging
import math
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
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
    DrinkLog,
    EnrichTask,
    FeedbackReport,
    PubCommunityData,
    PubContributionLog,
    PubHours,
    PubReport,
    PubSearchCache,
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
    DrinkRequestSerializer,
    FeedbackReportSerializer,
    FeedbackRequestSerializer,
    PubCommunityRequestSerializer,
    PubCommunityResponseSerializer,
    PubHoursRequestSerializer,
    PubHoursResponseSerializer,
    PubReportBlockedQuerySerializer,
    PubReportRequestSerializer,
    PubReportSerializer,
    PubsNearQuerySerializer,
    ReleaseNoteSerializer,
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
                "drinks: unexpected error logging drink for %r: %s",
                data.get("name"),
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
                    "items": row.items,
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
                        "items": row.items,
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
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
                        "items": row.items,
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
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
                        "items": row.items,
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
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
                "items": result.items,
                "cached": False,
                "fetched_at": now.isoformat(),
            },
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

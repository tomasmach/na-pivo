from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.models import Account, PubDirectory, PubHours, PubVisit, UserAddedPub

PRAGUE_TZ = ZoneInfo("Europe/Prague")
# The answer only changes when a new week starts; a day keeps workers roughly in sync.
WEEKLY_VISITORS_CACHE_TTL = 24 * 60 * 60


def last_week_bounds(now: datetime | None = None) -> tuple[date, datetime, datetime]:
    """Return the previous Monday–Sunday week in Prague: (monday, start, end)."""

    local_now = timezone.localtime(now or timezone.now(), PRAGUE_TZ)
    this_monday = local_now.date() - timedelta(days=local_now.weekday())
    last_monday = this_monday - timedelta(days=7)
    start = datetime.combine(last_monday, datetime.min.time(), tzinfo=PRAGUE_TZ)
    end = datetime.combine(this_monday, datetime.min.time(), tzinfo=PRAGUE_TZ)
    return last_monday, start, end


def weekly_pub_visitors(now: datetime | None = None) -> dict:
    """Count distinct people per pub cell for the previous calendar week.

    The result is one aggregate shared by every viewer: no names, no days, no
    times. Only cells of pubs the public map can show are returned, so a visit
    posted at arbitrary coordinates never becomes a published point. An account
    in ghost mode when the week is counted stays out of it.
    """

    monday, start, end = last_week_bounds(now)
    key = f"v1:pub-visitors:week:{monday.isoformat()}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    rows = (
        PubVisit.objects.filter(
            started_at__gte=start,
            started_at__lt=end,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
        )
        .filter(
            Q(
                cache_key__in=PubDirectory.objects.filter(active=True)
                .exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
                .values("cache_key")
            )
            | Q(cache_key__in=UserAddedPub.objects.filter(active=True).values("cache_key"))
        )
        .values("cache_key")
        .annotate(visitors=Count("account", distinct=True))
        .order_by()
    )
    payload = {
        "week_start": monday.isoformat(),
        "week_end": (monday + timedelta(days=6)).isoformat(),
        "pubs": {row["cache_key"]: row["visitors"] for row in rows},
    }
    cache.set(key, payload, WEEKLY_VISITORS_CACHE_TTL)
    return payload


class PubVisitorsLastWeekView(APIView):
    """GET /v1/pubs/visitors-last-week — distinct people per pub last week.

    Response 200:
        {"week_start": "YYYY-MM-DD", "week_end": "YYYY-MM-DD",
         "pubs": {"<geohash-8 cache_key>": <distinct accounts>, ...}}
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_reads"

    def get(self, request: Request) -> Response:
        return Response(weekly_pub_visitors())

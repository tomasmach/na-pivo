from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

from django.db.models import Sum
from django.utils import timezone as dj_timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.profile_helpers import (
    DRINKING_DAY_CUTOFF_HOUR,
    PRAGUE_TZ,
    derive_account_badge_progress,
    derive_account_profile_stats,
)
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.models import XpEvent
from pubs.xp_events import XP_EVENT_RETENTION

from .authentication import AccountTokenAuthentication

_XP_EVENTS_LIMIT = 20


class AccountXpEventsView(APIView):
    """GET /v1/account/me/xp-events?since=<ISO datetime> — what earned my XP lately.

    Newest first, at most 20. ``since`` is optional; a malformed value is ignored
    so a client clock quirk never hides the list.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "stats"

    def get(self, request: Request) -> Response:
        now = dj_timezone.now()
        events = XpEvent.objects.filter(account=request.user)
        events.filter(created_at__lt=now - XP_EVENT_RETENTION).delete()
        try:
            since = parse_datetime(request.query_params.get("since") or "")
        except ValueError:
            since = None
        if since is not None:
            if dj_timezone.is_naive(since):
                since = since.replace(tzinfo=UTC)
            events = events.filter(created_at__gt=since)
        return Response(
            {
                "events": [
                    {
                        "reason": event.reason,
                        "amount": event.amount,
                        "cache_key": event.cache_key,
                        "pub_name": event.pub_name,
                        "created_at": event.created_at.isoformat(),
                    }
                    for event in events.order_by("-created_at", "-pk")[:_XP_EVENTS_LIMIT]
                ]
            },
            status=status.HTTP_200_OK,
        )


class AccountNightSummaryView(APIView):
    """GET /v1/account/me/night-summary?day=YYYY-MM-DD — what one night brought.

    ``xp`` sums the Pivař XP of my drinks that drinking day (04:00 to 04:00
    Prague time). The two badge progress blocks count drinks and pub visits
    before the night and up to its end, so the app can tell which badge the
    night unlocked; the app owns the tier thresholds.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "stats"

    def get(self, request: Request) -> Response:
        try:
            day = date.fromisoformat(request.query_params.get("day") or "")
        except ValueError:
            return Response({"detail": "day must be YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
        start = datetime.combine(day, time(hour=DRINKING_DAY_CUTOFF_HOUR), tzinfo=PRAGUE_TZ)
        end = start + timedelta(days=1)
        account = request.user
        xp = account.drinks.filter(drank_at__gte=start, drank_at__lt=end).aggregate(
            xp=Sum("xp_awarded")
        )["xp"]
        return Response(
            {
                "day": day.isoformat(),
                "xp": int(xp or 0),
                "badge_progress_before": derive_account_badge_progress(
                    derive_account_profile_stats(account, before=start)
                ),
                "badge_progress": derive_account_badge_progress(
                    derive_account_profile_stats(account, before=end)
                ),
            },
            status=status.HTTP_200_OK,
        )

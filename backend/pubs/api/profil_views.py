from __future__ import annotations

from datetime import UTC

from django.utils import timezone as dj_timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

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

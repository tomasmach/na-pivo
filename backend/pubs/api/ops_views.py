"""Operator-only live counters for the desk clock, guarded by OPS_LIVE_TOKEN."""

from __future__ import annotations

import hmac
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Max, Q
from django.http import Http404
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.throttling import SharedScopedRateThrottle
from pubs.models import Account, ClientEvent

_PRAGUE = ZoneInfo("Europe/Prague")
_CACHE_KEY = "ops_live:v1"
_CACHE_SECONDS = 30
# app_open is sent only on a cold start; a resume from background sends app_foreground.
_OPEN_EVENTS = (ClientEvent.Event.APP_OPEN, ClientEvent.Event.APP_FOREGROUND)


def _has_valid_token(request: Request) -> bool:
    scheme, _, presented = request.headers.get("Authorization", "").partition(" ")
    return scheme.lower() == "bearer" and hmac.compare_digest(
        presented.strip().encode(), settings.OPS_LIVE_TOKEN.encode()
    )


def _live_counts() -> dict:
    today_start = datetime.combine(timezone.now().astimezone(_PRAGUE).date(), time.min, _PRAGUE)
    accounts = Account.objects.order_by().aggregate(
        today=Count("id", filter=Q(created_at__gte=today_start)),
        total=Count("id"),
        last=Max("created_at"),
    )
    active_today = (
        ClientEvent.objects.filter(
            event__in=_OPEN_EVENTS, created_at__gte=today_start, account__isnull=False
        )
        .order_by()
        .values("account_id")
        .distinct()
        .count()
    )
    return {
        "registrations_today": accounts["today"],
        "active_today": active_today,
        "registrations_total": accounts["total"],
        "last_registration_at": accounts["last"].isoformat() if accounts["last"] else None,
    }


class OpsLiveView(APIView):
    """GET /v1/ops/live — aggregate counters only, no per-account data."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "ops_live"

    def get(self, request: Request) -> Response:
        if not settings.OPS_LIVE_TOKEN:
            raise Http404
        if not _has_valid_token(request):
            return Response({"detail": "unauthorized"}, status=401)
        counts = cache.get(_CACHE_KEY)
        if counts is None:
            counts = _live_counts()
            cache.set(_CACHE_KEY, counts, _CACHE_SECONDS)
        return Response(counts)

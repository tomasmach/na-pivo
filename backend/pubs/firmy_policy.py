"""Shared Firmy.cz policy for the pub-hours API and the refresh_hours worker.

Decides which pubs are looked up, when cached hours expire, and how requests
are routed and counted. Daily counters in ExternalApiDailyUsage (provider
"firmy", UTC days):

  http                 every request, capped by FIRMY_DAILY_CAP
  http_direct          requests sent without the proxy
  http_proxy           requests through FIRMY_PROXY_URL, capped by FIRMY_PROXY_DAILY_CAP
  http_direct_blocked  direct responses Seznam blocked; updated_at is the latest block
  refresh              stale rows refresh_hours re-fetched, capped by FIRMY_REFRESH_DAILY_CAP
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from pubs.enrichment.coverage import CZ_BBOX, in_cz_bbox
from pubs.enrichment.firmy import PROXY, DirectBlockMemory
from pubs.external_api_budget import reserve_external_api_requests
from pubs.models import ExternalApiDailyUsage, PubHours

_PROVIDER = "firmy"
_DIRECT_BLOCKED = "http_direct_blocked"


def firmy_covers(lat: float, lng: float) -> bool:
    """Whether Firmy.cz can know this pub. It lists Czech businesses only."""
    return in_cz_bbox(lat, lng)


def firmy_covered_q() -> Q:
    """Database filter matching firmy_covers."""
    min_lat, min_lng, max_lat, max_lng = CZ_BBOX
    return Q(lat__gte=min_lat, lat__lte=max_lat, lng__gte=min_lng, lng__lte=max_lng)


def hours_ttl(status: str) -> timedelta | None:
    """How long a row with *status* stays fresh; None means it never is."""
    if status == PubHours.Status.OK:
        return timedelta(days=settings.HOURS_TTL_OK_DAYS)
    if status == PubHours.Status.UNKNOWN:
        return timedelta(days=settings.HOURS_TTL_UNKNOWN_DAYS)
    return None


def is_fresh(row: PubHours) -> bool:
    ttl = hours_ttl(row.status)
    return (
        ttl is not None
        and row.fetched_at is not None
        and row.fetched_at >= timezone.now() - ttl
    )


def fresh_hours_q(now: datetime) -> Q:
    ok, unknown = PubHours.Status.OK, PubHours.Status.UNKNOWN
    return Q(status=ok, fetched_at__gte=now - hours_ttl(ok)) | Q(
        status=unknown, fetched_at__gte=now - hours_ttl(unknown)
    )


def stale_hours_q(now: datetime) -> Q:
    ok, unknown = PubHours.Status.OK, PubHours.Status.UNKNOWN
    return Q(status=ok, fetched_at__lt=now - hours_ttl(ok)) | Q(
        status=unknown, fetched_at__lt=now - hours_ttl(unknown)
    )


def reserve_refresh() -> bool:
    """Reserve one of today's stale-row refreshes."""
    return reserve_external_api_requests(
        provider=_PROVIDER,
        caps={"refresh": settings.FIRMY_REFRESH_DAILY_CAP},
        reset_timezone="UTC",
    )


def _reserve_request(route: str) -> bool:
    return reserve_external_api_requests(
        provider=_PROVIDER,
        caps={
            "http": settings.FIRMY_DAILY_CAP,
            f"http_{route}": settings.FIRMY_PROXY_DAILY_CAP if route == PROXY else None,
        },
        reset_timezone="UTC",
    )


class _SharedDirectBlock(DirectBlockMemory):
    """Shares a direct-path block with every web and worker process."""

    def is_blocked(self) -> bool:
        since = timezone.now() - timedelta(
            minutes=settings.FIRMY_DIRECT_BLOCK_COOLDOWN_MINUTES
        )
        return ExternalApiDailyUsage.objects.filter(
            provider=_PROVIDER, operation=_DIRECT_BLOCKED, updated_at__gte=since
        ).exists()

    def mark_blocked(self) -> None:
        reserve_external_api_requests(
            provider=_PROVIDER, caps={_DIRECT_BLOCKED: None}, reset_timezone="UTC"
        )


def firmy_source_options() -> dict[str, Any]:
    """Keyword arguments for the production FirmyHoursSource."""
    return {
        "proxy_url": settings.FIRMY_PROXY_URL,
        "min_interval": float(settings.FIRMY_MIN_INTERVAL_SEC),
        "daily_cap": int(settings.FIRMY_DAILY_CAP),
        "request_budget": _reserve_request,
        "direct_block": _SharedDirectBlock(),
    }

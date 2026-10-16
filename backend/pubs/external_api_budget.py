"""Database-backed hard budgets for metered external APIs."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import transaction

from pubs.models import ExternalApiDailyUsage


def reserve_external_api_request(
    *,
    provider: str,
    operation: str,
    cap: int,
    reset_timezone: str = "America/Los_Angeles",
) -> bool:
    """Atomically reserve one request across all application workers."""

    return reserve_external_api_requests(
        provider=provider, caps={operation: cap}, reset_timezone=reset_timezone
    )


def reserve_external_api_requests(
    *,
    provider: str,
    caps: dict[str, int | None],
    reset_timezone: str = "America/Los_Angeles",
) -> bool:
    """Atomically count one request on every operation in *caps*, or on none.

    A None cap only counts; any other cap refuses the request once reached.
    """

    if any(cap is not None and cap <= 0 for cap in caps.values()):
        return False
    today = datetime.now(tz=ZoneInfo(reset_timezone)).date()
    with transaction.atomic():
        usages = []
        # A fixed lock order keeps concurrent multi-counter reservations from
        # deadlocking each other.
        for operation, cap in sorted(caps.items()):
            usage, _ = ExternalApiDailyUsage.objects.select_for_update().get_or_create(
                provider=provider,
                operation=operation,
                day=today,
                defaults={"request_count": 0},
            )
            if cap is not None and usage.request_count >= cap:
                return False
            usages.append(usage)
        for usage in usages:
            usage.request_count += 1
            usage.save(update_fields=["request_count", "updated_at"])
    return True

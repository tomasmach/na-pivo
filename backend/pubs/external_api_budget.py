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

    if cap <= 0:
        return False
    today = datetime.now(tz=ZoneInfo(reset_timezone)).date()
    with transaction.atomic():
        usage, _ = ExternalApiDailyUsage.objects.select_for_update().get_or_create(
            provider=provider,
            operation=operation,
            day=today,
            defaults={"request_count": 0},
        )
        if usage.request_count >= cap:
            return False
        usage.request_count += 1
        usage.save(update_fields=["request_count", "updated_at"])
    return True

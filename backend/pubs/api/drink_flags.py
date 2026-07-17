from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

from pubs.models import Account, DrinkLog


@dataclass(frozen=True)
class DrinkFlagResult:
    drank_at: datetime
    is_suspect: bool
    suspect_reason: str
    hard_limited: bool
    daily_count: int


def _day_bounds(value: datetime) -> tuple[datetime, datetime]:
    current_tz = timezone.get_current_timezone()
    local_date = timezone.localtime(value, current_tz).date()
    start = timezone.make_aware(datetime.combine(local_date, time.min), current_tz)
    return start, start + timedelta(days=1)


def evaluate_drink_flags(
    account: Account,
    drank_at: datetime,
    now: datetime,
) -> DrinkFlagResult:
    """Evaluate one new drink against indexed per-account timestamp windows."""

    if drank_at > now + timedelta(minutes=settings.DRINK_FUTURE_GRACE_MINUTES):
        drank_at = now

    is_suspect = False
    suspect_reason = ""
    if drank_at < now - timedelta(days=settings.DRINK_BACKDATE_FLAG_DAYS):
        is_suspect = True
        suspect_reason = "backdated"

    day_start, day_end = _day_bounds(drank_at)
    daily_count = DrinkLog.objects.filter(
        account=account,
        drank_at__gte=day_start,
        drank_at__lt=day_end,
    ).count()
    hard_limited = daily_count >= settings.DRINK_DAILY_HARD_CAP
    if (
        not hard_limited
        and not is_suspect
        and daily_count + 1 >= settings.DRINK_DAILY_FLAG_CAP
    ):
        is_suspect = True
        suspect_reason = "daily_cap"

    burst_count = DrinkLog.objects.filter(
        account=account,
        drank_at__gt=drank_at - timedelta(minutes=settings.DRINK_BURST_WINDOW_MINUTES),
        drank_at__lte=drank_at,
    ).count()
    if not is_suspect and burst_count >= settings.DRINK_BURST_LIMIT:
        is_suspect = True
        suspect_reason = "burst"

    return DrinkFlagResult(
        drank_at=drank_at,
        is_suspect=is_suspect,
        suspect_reason=suspect_reason,
        hard_limited=hard_limited,
        daily_count=daily_count,
    )

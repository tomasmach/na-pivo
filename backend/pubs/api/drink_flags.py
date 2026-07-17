from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings

from pubs.models import Account, DrinkLog

from .stats import drinking_day_bounds


@dataclass(frozen=True)
class DrinkFlagResult:
    drank_at: datetime
    is_suspect: bool
    suspect_reason: str
    hard_limited: bool
    daily_count: int


def _burst_size_with_candidate(
    existing: list[datetime],
    drank_at: datetime,
    window: timedelta,
) -> int:
    """Largest rolling window containing the candidate, independent of ingest order."""

    values = sorted([*existing, drank_at])
    best = 1
    right = 0
    for left, start in enumerate(values):
        if start > drank_at or drank_at >= start + window:
            continue
        right = max(right, left)
        while right + 1 < len(values) and values[right + 1] < start + window:
            right += 1
        best = max(best, right - left + 1)
    return best


def evaluate_drink_flags(
    account: Account,
    drank_at: datetime,
    now: datetime,
    drink_type: str,
) -> DrinkFlagResult:
    """Evaluate one new drink without removing it from the private diary."""

    if drank_at > now + timedelta(minutes=settings.DRINK_FUTURE_GRACE_MINUTES):
        drank_at = now

    is_suspect = False
    suspect_reason = ""
    if drank_at < now - timedelta(days=settings.DRINK_BACKDATE_FLAG_DAYS):
        is_suspect = True
        suspect_reason = "backdated"

    day_start, day_end = drinking_day_bounds(drank_at)
    daily_rows = DrinkLog.objects.filter(
        account=account,
        drank_at__gte=day_start,
        drank_at__lt=day_end,
    )
    daily_count = daily_rows.count()
    hard_limited = daily_count >= settings.DRINK_DAILY_HARD_CAP
    if drink_type == DrinkLog.DrinkType.BEER:
        daily_beer_count = daily_rows.filter(drink_type=DrinkLog.DrinkType.BEER).count()
        if (
            not hard_limited
            and not is_suspect
            and daily_beer_count + 1 >= settings.DRINK_DAILY_FLAG_CAP
        ):
            is_suspect = True
            suspect_reason = "daily_cap"

        window = timedelta(minutes=settings.DRINK_BURST_WINDOW_MINUTES)
        existing = list(
            DrinkLog.objects.filter(
                account=account,
                drink_type=DrinkLog.DrinkType.BEER,
                drank_at__gt=drank_at - window,
                drank_at__lt=drank_at + window,
            ).values_list("drank_at", flat=True)
        )
        burst_size = _burst_size_with_candidate(existing, drank_at, window)
        if not is_suspect and burst_size > settings.DRINK_BURST_LIMIT:
            is_suspect = True
            suspect_reason = "burst"

    return DrinkFlagResult(
        drank_at=drank_at,
        is_suspect=is_suspect,
        suspect_reason=suspect_reason,
        hard_limited=hard_limited,
        daily_count=daily_count,
    )

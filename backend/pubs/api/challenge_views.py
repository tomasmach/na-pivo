"""Derived community challenges for the Na pivo 3.0 Community tab.

The catalogue is product copy; progress is a read model over the diary.  There
is intentionally no mutable progress table to drift when a drink or visit is
deleted, and no CMS for three inexpensive seasonal rules.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.stats import drinking_day, resolve_stats_timezone
from pubs.models import DrinkLog, PubVisit


def _month_bounds(today: date, timezone) -> tuple[datetime, datetime, date]:
    start_day = today.replace(day=1)
    if today.month == 12:
        next_day = date(today.year + 1, 1, 1)
    else:
        next_day = date(today.year, today.month + 1, 1)
    start = datetime.combine(start_day, time(hour=4), tzinfo=timezone).astimezone(UTC)
    end = datetime.combine(next_day, time(hour=4), tzinfo=timezone).astimezone(UTC)
    return start, end, next_day


def _challenge(
    *,
    key: str,
    title: str,
    glyph: str,
    done: int,
    goal: int,
    unit: str,
    blurb: str,
    deadline: date,
    reward: str,
    rules: list[str],
) -> dict:
    return {
        "id": key,
        "title": title,
        "glyph": glyph,
        "done": done,
        "goal": goal,
        "unit": unit,
        "progress": min(1, done / goal) if goal else 0,
        "blurb": blurb,
        "deadline": deadline.isoformat(),
        "reward": reward,
        "rules": rules,
    }


def derive_challenges(account, *, timezone_name: str | None = None, now: datetime | None = None) -> list[dict]:
    """Compute the three small 3.0 challenges from durable account rows."""

    _, stats_tz = resolve_stats_timezone(timezone_name)
    local_now = (now or datetime.now(UTC)).astimezone(stats_tz)
    today = local_now.date()
    month_start, month_end, next_month_day = _month_bounds(today, stats_tz)
    deadline = next_month_day - timedelta(days=1)

    previous_pub_keys = set(
        PubVisit.objects.filter(account=account, started_at__lt=month_start).values_list(
            "cache_key", flat=True
        )
    )
    current_pub_keys = set(
        PubVisit.objects.filter(
            account=account,
            started_at__gte=month_start,
            started_at__lt=month_end,
        ).values_list("cache_key", flat=True)
    )
    new_pubs = len(current_pub_keys - previous_pub_keys)

    visit_days = {
        drinking_day(started_at, stats_tz)
        for started_at in PubVisit.objects.filter(account=account).values_list(
            "started_at", flat=True
        )
    }
    last_thursday = today - timedelta(days=(today.weekday() - 3) % 7)
    thursday_streak = 0
    cursor = last_thursday
    while cursor in visit_days:
        thursday_streak += 1
        cursor -= timedelta(days=7)

    year_start = datetime.combine(
        date(today.year, 1, 1), time(hour=4), tzinfo=stats_tz
    ).astimezone(UTC)
    valid_beers = DrinkLog.objects.filter(
        account=account,
        drink_type=DrinkLog.DrinkType.BEER,
        is_suspect=False,
        beer_brand_key__gt="",
        drank_at__gte=year_start,
        drank_at__lt=month_end,
    )
    earlier_brands = set(
        valid_beers.filter(drank_at__lt=month_start).values_list(
            "beer_brand_key", flat=True
        )
    )
    current_brands = set(
        valid_beers.filter(drank_at__gte=month_start).values_list(
            "beer_brand_key", flat=True
        )
    )
    new_brands = len(current_brands - earlier_brands)

    return [
        _challenge(
            key="new-pubs-month",
            title="Deset nových hospod",
            glyph="places",
            done=new_pubs,
            goal=10,
            unit="hospod",
            blurb="Deset podniků, kde jsi před tímhle měsícem ještě neseděl.",
            deadline=deadline,
            reward="Odznak Objevitel",
            rules=[
                "Počítá se potvrzená návštěva hospody v tomhle měsíci.",
                "Podnik, kde už jsi byl dřív, se nepočítá.",
                "Každá hospoda se započítá jen jednou.",
            ],
        ),
        _challenge(
            key="thursday-streak",
            title="Tři čtvrtky po sobě",
            glyph="rhythm",
            done=thursday_streak,
            goal=3,
            unit="čtvrtků",
            blurb="Tři čtvrteční večery v podniku bez vynechání.",
            deadline=deadline,
            reward="Odznak Čtvrtkař",
            rules=[
                "Počítá se pijácký den, který začne ve čtvrtek.",
                "Musí u něj být potvrzená návštěva podniku.",
                "Vynechaný čtvrtek sérii ukončí.",
            ],
        ),
        _challenge(
            key="new-breweries-month",
            title="Ochutnej pět pivovarů",
            glyph="taste",
            done=new_brands,
            goal=5,
            unit="pivovarů",
            blurb="Pět pivovarů, které letos ochutnáváš poprvé.",
            deadline=deadline,
            reward="Odznak Ochutnávač",
            rules=[
                "Počítá se rozpoznaný pivovar u piva v deníčku.",
                "Letos už ochutnaný pivovar se znovu nepočítá.",
                "Podezřelé záznamy se do výzvy nezapočítají.",
            ],
        ),
    ]


class ChallengeListView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        challenges = derive_challenges(
            request.user,
            timezone_name=request.query_params.get("timezone"),
        )
        return Response({"challenges": challenges}, status=status.HTTP_200_OK)

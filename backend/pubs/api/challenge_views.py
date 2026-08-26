"""Derived community challenges for the Na pivo 3.0 Community tab.

The catalogue is product copy; progress is a read model over the diary.  There
is intentionally no mutable progress table to drift when a drink or visit is
deleted, and no CMS for three inexpensive seasonal rules.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from django.db.models import Exists, OuterRef, Q
from django.utils.translation import gettext_lazy
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.stats import drinking_day, resolve_stats_timezone
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.models import Account, DrinkLog, FriendBlock, Friendship, PubVisit

_THURSDAY_STREAK_LOOKBACK_WEEKS = 260
CHALLENGE_FRIEND_LIMIT = 12


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
    # The catalogue below holds lazy msgids; render them HERE so the copy comes
    # out in the language of the request being served, not the import-time one.
    return {
        "id": key,
        "title": str(title),
        "glyph": glyph,
        "done": done,
        "goal": goal,
        "unit": str(unit),
        "progress": min(1, done / goal) if goal else 0,
        "blurb": str(blurb),
        "deadline": deadline.isoformat(),
        "reward": str(reward),
        "rules": [str(rule) for rule in rules],
    }


def _progress_for_accounts(
    account_ids: list[int],
    *,
    stats_tz,
    today: date,
    month_start: datetime,
    month_end: datetime,
) -> dict[int, dict[str, int]]:
    """Compute all three counters in fixed query count for a bounded audience."""

    progress = {
        account_id: {
            "new-pubs-month": 0,
            "thursday-streak": 0,
            "new-breweries-month": 0,
        }
        for account_id in account_ids
    }
    if not account_ids:
        return progress

    previous_pub = PubVisit.objects.filter(
        account_id=OuterRef("account_id"),
        cache_key=OuterRef("cache_key"),
        started_at__lt=month_start,
    )
    current_pub_keys = (
        PubVisit.objects.filter(
            account_id__in=account_ids,
            started_at__gte=month_start,
            started_at__lt=month_end,
        )
        .values("account_id", "cache_key")
        .distinct()
        .annotate(seen_before=Exists(previous_pub))
        .filter(seen_before=False)
    )
    for row in current_pub_keys.iterator(chunk_size=256):
        progress[row["account_id"]]["new-pubs-month"] += 1

    last_thursday = today - timedelta(days=(today.weekday() - 3) % 7)
    streak_start_day = last_thursday - timedelta(
        weeks=_THURSDAY_STREAK_LOOKBACK_WEEKS - 1
    )
    streak_start = datetime.combine(
        streak_start_day,
        time(hour=4),
        tzinfo=stats_tz,
    ).astimezone(UTC)
    streak_end = datetime.combine(
        last_thursday + timedelta(days=1),
        time(hour=4),
        tzinfo=stats_tz,
    ).astimezone(UTC)
    visit_days: dict[int, set[date]] = defaultdict(set)
    recent_visits = (
        PubVisit.objects.filter(
            account_id__in=account_ids,
            started_at__gte=streak_start,
            started_at__lt=streak_end,
        )
        .values_list("account_id", "started_at")
        .iterator(chunk_size=512)
    )
    for account_id, started_at in recent_visits:
        visit_days[account_id].add(drinking_day(started_at, stats_tz))
    for account_id in account_ids:
        cursor = last_thursday
        while (
            cursor in visit_days[account_id]
            and progress[account_id]["thursday-streak"]
            < _THURSDAY_STREAK_LOOKBACK_WEEKS
        ):
            progress[account_id]["thursday-streak"] += 1
            cursor -= timedelta(days=7)

    year_start = datetime.combine(
        date(today.year, 1, 1), time(hour=4), tzinfo=stats_tz
    ).astimezone(UTC)
    valid_beers = DrinkLog.objects.filter(
        account_id__in=account_ids,
        drink_type=DrinkLog.DrinkType.BEER,
        is_suspect=False,
        beer_brand_key__gt="",
        drank_at__gte=year_start,
        drank_at__lt=month_end,
    )
    earlier_brand = valid_beers.filter(
        account_id=OuterRef("account_id"),
        drank_at__lt=month_start,
        beer_brand_key=OuterRef("beer_brand_key"),
    )
    current_brands = (
        valid_beers.filter(drank_at__gte=month_start)
        .values("account_id", "beer_brand_key")
        .distinct()
        .annotate(seen_before=Exists(earlier_brand))
        .filter(seen_before=False)
    )
    for row in current_brands.iterator(chunk_size=256):
        progress[row["account_id"]]["new-breweries-month"] += 1
    return progress


def _challenge_rows(progress: dict[str, int], *, deadline: date) -> list[dict]:
    """Apply the small product catalogue to already-derived counters."""

    return [
        _challenge(
            key="new-pubs-month",
            title=gettext_lazy("Deset nových hospod"),
            glyph="places",
            done=progress["new-pubs-month"],
            goal=10,
            unit=gettext_lazy("hospod"),
            blurb=gettext_lazy("Deset podniků, kde jsi před tímhle měsícem ještě neseděl."),
            deadline=deadline,
            reward=gettext_lazy("Odznak Objevitel"),
            rules=[
                gettext_lazy("Počítá se potvrzená návštěva hospody v tomhle měsíci."),
                gettext_lazy("Podnik, kde už jsi byl dřív, se nepočítá."),
                gettext_lazy("Každá hospoda se započítá jen jednou."),
            ],
        ),
        _challenge(
            key="thursday-streak",
            title=gettext_lazy("Tři čtvrtky po sobě"),
            glyph="rhythm",
            done=progress["thursday-streak"],
            goal=3,
            unit=gettext_lazy("čtvrtků"),
            blurb=gettext_lazy("Tři čtvrteční večery v podniku bez vynechání."),
            deadline=deadline,
            reward=gettext_lazy("Odznak Čtvrtkař"),
            rules=[
                gettext_lazy("Počítá se pijácký den, který začne ve čtvrtek."),
                gettext_lazy("Musí u něj být potvrzená návštěva podniku."),
                gettext_lazy("Vynechaný čtvrtek sérii ukončí."),
            ],
        ),
        _challenge(
            key="new-breweries-month",
            title=gettext_lazy("Ochutnej pět pivovarů"),
            glyph="taste",
            done=progress["new-breweries-month"],
            goal=5,
            unit=gettext_lazy("pivovarů"),
            blurb=gettext_lazy("Pět pivovarů, které letos ochutnáváš poprvé."),
            deadline=deadline,
            reward=gettext_lazy("Odznak Ochutnávač"),
            rules=[
                gettext_lazy("Počítá se rozpoznaný pivovar u piva v deníčku."),
                gettext_lazy("Letos už ochutnaný pivovar se znovu nepočítá."),
                gettext_lazy("Podezřelé záznamy se do výzvy nezapočítají."),
            ],
        ),
    ]


def _visible_challenge_friends(viewer: Account) -> list[Account]:
    """A bounded, explicitly public slice of the viewer's accepted friends."""

    accepted = Friendship.objects.filter(status=Friendship.Status.ACCEPTED).filter(
        Q(requester=viewer, recipient_id=OuterRef("pk"))
        | Q(recipient=viewer, requester_id=OuterRef("pk"))
    )
    blocked = FriendBlock.objects.filter(
        Q(blocker=viewer, blocked_id=OuterRef("pk"))
        | Q(blocked=viewer, blocker_id=OuterRef("pk"))
    )
    return list(
        Account.objects.filter(
            status=Account.Status.ACTIVE,
            is_public=True,
            ghost_mode=False,
        )
        .exclude(pk=viewer.pk)
        .annotate(is_friend=Exists(accepted), is_blocked=Exists(blocked))
        .filter(is_friend=True, is_blocked=False)
        .order_by("-last_seen_at", "id")[:CHALLENGE_FRIEND_LIMIT]
    )


def _challenge_friend_profile(account: Account, request: Request) -> dict:
    avatar_url = None
    if account.avatar:
        try:
            avatar_url = request.build_absolute_uri(account.avatar.url)
        except (AttributeError, ValueError):
            avatar_url = None
    return {
        "id": str(account.public_id),
        "nickname": account.nickname,
        "display_name": account.display_name,
        "avatar_url": avatar_url,
        "is_public": True,
    }


def derive_challenges(
    account,
    *,
    timezone_name: str | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Compute the three small 3.0 challenges from durable account rows."""

    _, stats_tz = resolve_stats_timezone(timezone_name)
    local_now = (now or datetime.now(UTC)).astimezone(stats_tz)
    today = local_now.date()
    month_start, month_end, next_month_day = _month_bounds(today, stats_tz)
    progress = _progress_for_accounts(
        [account.id],
        stats_tz=stats_tz,
        today=today,
        month_start=month_start,
        month_end=month_end,
    )[account.id]
    return _challenge_rows(progress, deadline=next_month_day - timedelta(days=1))


class ChallengeListView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "challenges"

    def get(self, request: Request) -> Response:
        _, stats_tz = resolve_stats_timezone(request.query_params.get("timezone"))
        today = datetime.now(UTC).astimezone(stats_tz).date()
        month_start, month_end, next_month_day = _month_bounds(today, stats_tz)
        friends = _visible_challenge_friends(request.user)
        account_ids = [request.user.id, *(friend.id for friend in friends)]
        progress = _progress_for_accounts(
            account_ids,
            stats_tz=stats_tz,
            today=today,
            month_start=month_start,
            month_end=month_end,
        )
        challenges = _challenge_rows(
            progress[request.user.id],
            deadline=next_month_day - timedelta(days=1),
        )
        for challenge in challenges:
            challenge["friends"] = [
                {
                    "account": _challenge_friend_profile(friend, request),
                    "done": progress[friend.id][challenge["id"]],
                    "progress": min(
                        1,
                        progress[friend.id][challenge["id"]] / challenge["goal"],
                    ),
                }
                for friend in friends
            ]
        return Response({"challenges": challenges}, status=status.HTTP_200_OK)

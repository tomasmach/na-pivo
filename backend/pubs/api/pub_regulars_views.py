from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from django.core.cache import cache
from django.db.models import Count
from django.utils import timezone
from django.utils.translation import gettext
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.pub_beers_views import PRAGUE_TZ, _merged_aliases, _public_pub_directory
from pubs.api.serializers import FriendProfileSerializer
from pubs.api.stats import drinking_day_bounds
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.api.views import (
    _accepted_friend_ids,
    _blocked_account_ids,
    _countable_beer_drinks,
    _leaderboard_drinking_day_key,
    _leaderboard_red_beer_days,
)
from pubs.models import Account, UserAddedPub

PERIODS = ("30d", "year", "all")
TOP_REGULARS = 10
CACHED_ROWS = 50
CACHE_TTL = 10 * 60
# Fewer than three people who chose to be listed is not a board worth showing.
MIN_REGULARS = 3
CELL = re.compile(r"^[0-9bcdefghjkmnpqrstuvwxyz]{8}$")


def _window(period: str, now: datetime) -> tuple[datetime | None, datetime]:
    """Start and end of the counted beers. Today never counts, so nobody shows where they sit now."""

    end = drinking_day_bounds(now)[0]
    if period == "30d":
        return end - timedelta(days=30), end
    if period == "year":
        local_end = timezone.localtime(end, PRAGUE_TZ)
        return datetime(local_end.year, 1, 1, 4, tzinfo=PRAGUE_TZ), end
    return None, end


def _pub_cells(cache_key: str) -> set[str]:
    """The pub's cell plus cells merged into it, or nothing when no public pub sits there."""

    targets = dict(_merged_aliases().values_list("cache_key", "canonical_pub__cache_key"))
    canonical = targets.get(cache_key, cache_key)
    is_pub = (
        canonical in targets.values()
        or _public_pub_directory().filter(cache_key=canonical).exists()
        or UserAddedPub.objects.filter(active=True, cache_key=canonical).exists()
    )
    if not is_pub:
        return set()
    return {canonical} | {alias for alias, target in targets.items() if target == canonical}


def _listed_accounts():
    return Account.objects.filter(
        status=Account.Status.ACTIVE,
        is_public=True,
        show_as_pub_regular=True,
        ghost_mode=False,
        excluded_from_leaderboards=False,
        nickname__isnull=False,
    ).exclude(nickname="")


def _beers_here(cells: set[str], start: datetime | None, end: datetime):
    qs = _countable_beer_drinks().filter(cache_key__in=cells, drank_at__lt=end)
    if start is not None:
        qs = qs.filter(drank_at__gte=start)
    drinkers = set(qs.values_list("account_id", flat=True).distinct())
    red_days = list(
        _leaderboard_red_beer_days(start)
        .filter(account_id__in=drinkers)
        .values_list("leaderboard_day_key", flat=True)
    )
    if red_days:
        qs = qs.alias(day_key=_leaderboard_drinking_day_key()).exclude(day_key__in=red_days)
    return qs


def _ranked_regulars(cells: set[str], period: str, start: datetime | None, end: datetime) -> list[dict]:
    key = f"v1:pub-regulars:{min(cells)}:{period}:{end.date().isoformat()}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    rows = list(
        _beers_here(cells, start, end)
        .filter(account__in=_listed_accounts())
        .values("account_id")
        .annotate(beers=Count("id"))
        .order_by("-beers", "account__created_at", "account_id")[:CACHED_ROWS]
    )
    accounts = Account.objects.in_bulk([row["account_id"] for row in rows])
    ranked = [
        {
            "account_pk": row["account_id"],
            "beers": int(row["beers"]),
            "account": dict(FriendProfileSerializer(accounts[row["account_id"]]).data),
        }
        for row in rows
        if row["account_id"] in accounts
    ]
    cache.set(key, ranked, CACHE_TTL)
    return ranked


def pub_regulars(request: Request, cache_key: str, period: str, now: datetime | None = None) -> dict:
    now = now or timezone.now()
    start, end = _window(period, now)
    viewer = request.user
    cells = _pub_cells(cache_key)
    ranked = _ranked_regulars(cells, period, start, end) if cells else []
    # Who turned the listing off or went ghost since the rows were counted drops out at once.
    still_listed = set(
        _listed_accounts().filter(id__in=[row["account_pk"] for row in ranked]).values_list("id", flat=True)
    )
    ranked = [row for row in ranked if row["account_pk"] in still_listed]
    my_beers = (
        _beers_here(cells, start, end).filter(account_id=viewer.id).count()
        if cells and not viewer.ghost_mode
        else 0
    )
    # Whoever just turned the listing on sees themselves at once, not after the cache expires.
    if my_beers and viewer.id not in {row["account_pk"] for row in ranked}:
        if _listed_accounts().filter(id=viewer.id).exists():
            ranked.append(
                {"account_pk": viewer.id, "beers": my_beers, "account": dict(FriendProfileSerializer(viewer).data)}
            )
            ranked.sort(key=lambda row: -row["beers"])
    blocked = _blocked_account_ids(viewer)
    ranked = [row for row in ranked if row["account_pk"] not in blocked]
    shown = ranked if len(ranked) >= MIN_REGULARS else []

    friends = set(_accepted_friend_ids(viewer))
    entries = []
    for row in shown:
        account = dict(row["account"])
        if account.get("avatar_url"):
            account["avatar_url"] = request.build_absolute_uri(account["avatar_url"])
        entries.append(
            {
                "rank": len(entries) + 1,
                "beers": row["beers"],
                "is_me": row["account_pk"] == viewer.id,
                "is_friend": row["account_pk"] in friends,
                "account": account,
            }
        )

    mine = next((entry for entry in entries if entry["is_me"]), None)
    if mine:
        my_rank = mine["rank"]
    elif my_beers:
        my_rank = 1 + sum(1 for entry in entries if entry["beers"] > my_beers)
    else:
        my_rank = None
    last_day = timezone.localtime(end, PRAGUE_TZ).date() - timedelta(days=1)
    first_day: date | None = timezone.localtime(start, PRAGUE_TZ).date() if start else None
    return {
        "cache_key": cache_key,
        "period": period,
        "period_start": first_day.isoformat() if first_day else None,
        "period_end": last_day.isoformat(),
        "total_ranked": len(shown),
        "entries": entries[:TOP_REGULARS],
        "me": {
            "beers": my_beers,
            "rank": my_rank,
            "listed": mine is not None,
            "opted_in": bool(viewer.show_as_pub_regular),
            "eligible": bool(viewer.is_public and (viewer.nickname or "").strip()),
            "ghost": bool(viewer.ghost_mode),
        },
    }


class PubRegularsView(APIView):
    """GET /v1/pubs/regulars?cache_key=<geohash-8>&period=30d|year|all — who drank most in one pub.

    Lists only people with a public profile who turned on ``show_as_pub_regular``
    and are not in ghost mode, and only when at least three of them drank there.
    Today's beers never count. ``me`` is the caller's own standing, also when
    they are not listed.

    Response 200:
        {"cache_key", "period", "period_start", "period_end", "total_ranked",
         "entries": [{"rank", "beers", "is_me", "is_friend", "account"}, ...],
         "me": {"beers", "rank", "listed", "opted_in", "eligible", "ghost"}}
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_reads"

    def get(self, request: Request) -> Response:
        cache_key = request.query_params.get("cache_key", "").strip().lower()
        if not CELL.match(cache_key):
            return Response({"detail": gettext("Tuhle hospodu neznám."), "code": "invalid_pub"}, status=400)
        period = request.query_params.get("period", "30d")
        if period not in PERIODS:
            period = "30d"
        return Response(pub_regulars(request, cache_key, period))


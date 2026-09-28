from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.api.views import _leaderboard_countable_beer_drinks
from pubs.models import Account, PubDirectory, PubHours, UserAddedPub

PRAGUE_TZ = ZoneInfo("Europe/Prague")
# Short enough that turning ghost mode on drops out within hours on every worker.
WEEKLY_BEERS_CACHE_TTL = 60 * 60
TOP_PUBS = 20
# One person cannot put their own place on the board by drinking alone there.
TOP_MIN_DRINKERS = 2


def last_week_bounds(now: datetime | None = None) -> tuple[date, datetime, datetime]:
    """Return the previous Monday–Sunday week in Prague: (monday, start, end)."""

    local_now = timezone.localtime(now or timezone.now(), PRAGUE_TZ)
    this_monday = local_now.date() - timedelta(days=local_now.weekday())
    last_monday = this_monday - timedelta(days=7)
    start = datetime.combine(last_monday, datetime.min.time(), tzinfo=PRAGUE_TZ)
    end = datetime.combine(this_monday, datetime.min.time(), tzinfo=PRAGUE_TZ)
    return last_monday, start, end


def _public_pub_directory():
    return (
        PubDirectory.objects.filter(active=True)
        .exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
    )


def _places(cache_keys: list[str]) -> dict[str, dict]:
    """Name, city and position of each pub cell, the directory first."""

    places: dict[str, dict] = {}
    for model_rows in (
        _public_pub_directory().filter(cache_key__in=cache_keys).order_by("id"),
        UserAddedPub.objects.filter(active=True, cache_key__in=cache_keys).order_by("id"),
    ):
        for pub in model_rows:
            places.setdefault(
                pub.cache_key,
                {"name": pub.name, "city": pub.city, "lat": pub.lat, "lng": pub.lng},
            )
    return places


def weekly_pub_beers(now: datetime | None = None) -> dict:
    """Count beers per pub cell for the previous calendar week.

    The result is one aggregate shared by every viewer: no names of people, no
    days, no times. Beers the public leaderboards would not count stay out, and
    only cells of pubs the public map can show are returned, so a drink posted at
    arbitrary coordinates never becomes a published point. An account in ghost
    mode when the week is counted stays out of it.
    """

    monday, start, end = last_week_bounds(now)
    key = f"v1:pub-beers:week:{monday.isoformat()}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    rows = list(
        _leaderboard_countable_beer_drinks(start)
        .filter(
            drank_at__lt=end,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
            account__excluded_from_leaderboards=False,
        )
        .filter(
            Q(cache_key__in=_public_pub_directory().values("cache_key"))
            | Q(cache_key__in=UserAddedPub.objects.filter(active=True).values("cache_key"))
        )
        .values("cache_key")
        .annotate(beers=Count("id"), drinkers=Count("account", distinct=True))
        .order_by()
    )
    ranked = sorted(
        (row for row in rows if row["drinkers"] >= TOP_MIN_DRINKERS),
        key=lambda row: (-row["beers"], -row["drinkers"], row["cache_key"]),
    )[:TOP_PUBS]
    places = _places([row["cache_key"] for row in ranked])
    payload = {
        "week_start": monday.isoformat(),
        "week_end": (monday + timedelta(days=6)).isoformat(),
        # When this answer is replaced by the next week, so clients need no zone math.
        "next_week_starts_at": (end + timedelta(days=7)).isoformat(),
        "pubs": {row["cache_key"]: row["beers"] for row in rows},
        "top": [
            {"cache_key": row["cache_key"], "beers": row["beers"], **places[row["cache_key"]]}
            for row in ranked
            if row["cache_key"] in places
        ],
    }
    cache.set(key, payload, WEEKLY_BEERS_CACHE_TTL)
    return payload


class PubBeersLastWeekView(APIView):
    """GET /v1/pubs/beers-last-week — beers per pub last week, plus the top pubs.

    Response 200:
        {"week_start": "YYYY-MM-DD", "week_end": "YYYY-MM-DD",
         "next_week_starts_at": "<ISO datetime>",
         "pubs": {"<geohash-8 cache_key>": <beers>, ...},
         "top": [{"cache_key", "name", "city", "lat", "lng", "beers"}, ...]}
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_reads"

    def get(self, request: Request) -> Response:
        return Response(weekly_pub_beers())

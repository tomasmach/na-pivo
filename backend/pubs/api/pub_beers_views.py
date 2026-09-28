from __future__ import annotations

import re
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
from pubs.api.views import (
    _countable_beer_drinks,
    _leaderboard_drinking_day_key,
    _leaderboard_red_beer_days,
)
from pubs.models import Account, PubDirectory, PubHours, UserAddedPub

PRAGUE_TZ = ZoneInfo("Europe/Prague")
# Short enough that turning ghost mode on drops out within hours on every worker.
PUB_BEERS_CACHE_TTL = 60 * 60
TOP_PUBS = 20
TOP_CITIES = 30
# A count never shows one person's drinking: with two, either could subtract
# their own beers. Nobody puts their own place on the board alone either.
MIN_DRINKERS = 3
PERIODS = ("week", "year", "all")
# Cities split into numbered or named districts in the pub catalogue.
CITIES_WITH_DISTRICTS = ("Praha", "Brno", "Ostrava", "Plzeň")
_PLACES_CHUNK = 500


def last_week_bounds(now: datetime | None = None) -> tuple[date, datetime, datetime]:
    """Return the previous Monday–Sunday week in Prague: (monday, start, end)."""

    local_now = timezone.localtime(now or timezone.now(), PRAGUE_TZ)
    this_monday = local_now.date() - timedelta(days=local_now.weekday())
    last_monday = this_monday - timedelta(days=7)
    start = datetime.combine(last_monday, datetime.min.time(), tzinfo=PRAGUE_TZ)
    end = datetime.combine(this_monday, datetime.min.time(), tzinfo=PRAGUE_TZ)
    return last_monday, start, end


def city_name(raw: str) -> str:
    """One name per city, so "Praha 2" and "Brno-střed" count as Praha and Brno."""

    city = " ".join((raw or "").split())
    # "Praha-východ" or "Brno-venkov" is the county around the city, not the city.
    if city.endswith(("-východ", "-západ", "-venkov")):
        return city
    for base in CITIES_WITH_DISTRICTS:
        if city == base or re.match(rf"{base}[\s\-–]", city):
            return base
    return city


def _public_pub_directory():
    return (
        PubDirectory.objects.filter(active=True)
        .exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
    )


def _pub_beer_rows(start: datetime | None, end: datetime | None) -> list[dict]:
    """Beers and distinct drinkers per public pub cell between start and end.

    The rows are one aggregate shared by every viewer: no names of people, no
    days, no times. Beers the public leaderboards would not count stay out, and
    only cells of pubs the public map can show are returned, so a drink posted at
    arbitrary coordinates never becomes a published point. An account in ghost
    mode when the rows are counted stays out of them.
    """

    qs = _countable_beer_drinks().filter(
        account__status=Account.Status.ACTIVE,
        account__ghost_mode=False,
        account__excluded_from_leaderboards=False,
    )
    # Days the public boards throw out as implausible. They are few, so they go
    # in as a short list: as a subquery Postgres expects hundreds of thousands
    # and compares every beer against all of them, minutes for all time.
    red_days = list(_leaderboard_red_beer_days(start).values_list("leaderboard_day_key", flat=True))
    if red_days:
        qs = qs.alias(day_key=_leaderboard_drinking_day_key()).exclude(day_key__in=red_days)
    if start is not None:
        qs = qs.filter(drank_at__gte=start)
    if end is not None:
        qs = qs.filter(drank_at__lt=end)
    return list(
        qs.filter(
            Q(cache_key__in=_public_pub_directory().values("cache_key"))
            | Q(cache_key__in=UserAddedPub.objects.filter(active=True).values("cache_key"))
        )
        .values("cache_key")
        .annotate(beers=Count("id"), drinkers=Count("account", distinct=True))
        .order_by()
    )


def _places(cache_keys: list[str]) -> dict[str, dict]:
    """Name, city and position of each pub cell, the directory first."""

    places: dict[str, dict] = {}
    for index in range(0, len(cache_keys), _PLACES_CHUNK):
        chunk = cache_keys[index:index + _PLACES_CHUNK]
        for model_rows in (
            _public_pub_directory().filter(cache_key__in=chunk).order_by("id"),
            UserAddedPub.objects.filter(active=True, cache_key__in=chunk).order_by("id"),
        ):
            for pub in model_rows:
                places.setdefault(
                    pub.cache_key,
                    {"name": pub.name, "city": pub.city, "lat": pub.lat, "lng": pub.lng},
                )
    return places


def weekly_pub_beers(now: datetime | None = None) -> dict:
    """Beers per pub cell for the previous calendar week, for the map."""

    monday, start, end = last_week_bounds(now)
    key = f"v1:pub-beers:week:{monday.isoformat()}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    payload = {
        "week_start": monday.isoformat(),
        "week_end": (monday + timedelta(days=6)).isoformat(),
        # When this answer is replaced by the next week, so clients need no zone math.
        "next_week_starts_at": (end + timedelta(days=7)).isoformat(),
        # A pub where one or two people drank would show someone's week.
        "pubs": {
            row["cache_key"]: row["beers"]
            for row in _pub_beer_rows(start, end)
            if row["drinkers"] >= MIN_DRINKERS
        },
    }
    cache.set(key, payload, PUB_BEERS_CACHE_TTL)
    return payload


def _period_bounds(period: str, now: datetime | None = None):
    """(first day, last day, start, end) of a board window; None for all time."""

    if period == "week":
        monday, start, end = last_week_bounds(now)
        return monday, monday + timedelta(days=6), start, end
    if period == "year":
        local_now = timezone.localtime(now or timezone.now(), PRAGUE_TZ)
        first = date(local_now.year, 1, 1)
        start = datetime.combine(first, datetime.min.time(), tzinfo=PRAGUE_TZ)
        return first, local_now.date(), start, None
    return None, None, None, None


def _ranked_pubs(period: str, now: datetime | None = None) -> list[dict]:
    """Every pub with at least two drinkers in the window, most beers first."""

    first, _, start, end = _period_bounds(period, now)
    key = f"v1:pub-beers:board:{period}:{first.isoformat() if first else 'all'}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    rows = sorted(
        (row for row in _pub_beer_rows(start, end) if row["drinkers"] >= MIN_DRINKERS),
        key=lambda row: (-row["beers"], -row["drinkers"], row["cache_key"]),
    )
    places = _places([row["cache_key"] for row in rows])
    ranked = [
        {"cache_key": row["cache_key"], "beers": row["beers"], **places[row["cache_key"]]}
        for row in rows
        if row["cache_key"] in places
    ]
    cache.set(key, ranked, PUB_BEERS_CACHE_TTL)
    return ranked


def pub_beer_board(period: str, city: str = "", now: datetime | None = None) -> dict:
    """The pubs where the most beers went down in one window, optionally in one city."""

    first, last, _, _ = _period_bounds(period, now)
    ranked = _ranked_pubs(period, now)
    city = city_name(city)

    per_city: dict[str, int] = {}
    for pub in ranked:
        name = city_name(pub["city"])
        if name:
            per_city[name] = per_city.get(name, 0) + pub["beers"]
    cities = sorted(per_city.items(), key=lambda item: (-item[1], item[0]))[:TOP_CITIES]

    in_city = [pub for pub in ranked if city_name(pub["city"]) == city] if city else ranked
    return {
        "period": period,
        "period_start": first.isoformat() if first else None,
        "period_end": last.isoformat() if last else None,
        "city": city or None,
        "cities": [{"name": name, "beers": beers} for name, beers in cities],
        "total_ranked": len(in_city),
        "entries": [
            {**pub, "rank": rank} for rank, pub in enumerate(in_city[:TOP_PUBS], start=1)
        ],
    }


class PubBeersLastWeekView(APIView):
    """GET /v1/pubs/beers-last-week — beers per pub last week, for the map.

    Response 200:
        {"week_start": "YYYY-MM-DD", "week_end": "YYYY-MM-DD",
         "next_week_starts_at": "<ISO datetime>",
         "pubs": {"<geohash-8 cache_key>": <beers>, ...}}
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_reads"

    def get(self, request: Request) -> Response:
        return Response(weekly_pub_beers())


class PubBeerBoardView(APIView):
    """GET /v1/pubs/beer-board?period=week|year|all&city=<name> — top pubs by beers.

    ``week`` is the previous Monday–Sunday week (the one the map shows), ``year``
    this calendar year so far. Only pubs where at least two people drank rank.

    Response 200:
        {"period", "period_start", "period_end", "city",
         "cities": [{"name", "beers"}, ...], "total_ranked",
         "entries": [{"rank", "cache_key", "name", "city", "lat", "lng", "beers"}, ...]}
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_reads"

    def get(self, request: Request) -> Response:
        period = request.query_params.get("period", "week")
        if period not in PERIODS:
            period = "week"
        city = request.query_params.get("city", "")[:80]
        return Response(pub_beer_board(period, city))

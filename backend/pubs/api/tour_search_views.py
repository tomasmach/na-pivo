"""Finding public tours: near the walker, or by tour name, city or pub, with two filters."""

import math

from django.db.models import F, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.discovery import normalize_discovery_text
from pubs.models import FriendBlock, TourPublication
from pubs.tours import (
    COUNT_TTL,
    author_payload,
    counted_people,
    protect_response,
    readable_publications,
)

from .authentication import AccountTokenAuthentication
from .throttling import SharedScopedRateThrottle

PAGE = 20
MAX_PAGE = 10
NEARBY_KM = 25
FALLBACK = 5
STOP_BUCKETS = {"2-3": (2, 3), "4-5": (4, 5), "6-8": (6, 8)}
KM_PER_DEGREE = 111.32


class SearchSerializer(serializers.Serializer):
    # Location rides in the body so it never lands in an access log.
    lat = serializers.FloatField(required=False, min_value=-90, max_value=90)
    lon = serializers.FloatField(required=False, min_value=-180, max_value=180)
    q = serializers.CharField(required=False, allow_blank=True, max_length=60, default="")
    stops = serializers.ChoiceField(choices=list(STOP_BUCKETS), required=False, allow_null=True, default=None)
    challenges = serializers.BooleanField(required=False, default=False)
    page = serializers.IntegerField(required=False, default=0, min_value=0, max_value=MAX_PAGE - 1)

    def validate(self, data):
        if ("lat" in data) != ("lon" in data):
            raise serializers.ValidationError("lat and lon go together")
        return data


def _meters(lat, lon, publication):
    dlat = math.radians(publication.start_lat - lat)
    dlon = math.radians(publication.start_lon - lon)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(publication.start_lat)) * math.sin(dlon / 2) ** 2
    return round(6371000 * 2 * math.asin(math.sqrt(a)))


def _refresh_counts(publications):
    """One aggregate for the stale numbers on this page, not one per row."""
    now = timezone.now()
    stale = [p for p in publications if p.people_count_at is None or p.people_count_at <= now - COUNT_TTL]
    if not stale:
        return
    counts = counted_people([p.pk for p in stale], now)
    for publication in stale:
        publication.people_count, publication.people_count_at = counts.get(publication.pk, 0), now
        # A route republished meanwhile reset its count; never write the old walkers back over it.
        TourPublication.objects.filter(pk=publication.pk, count_since=publication.count_since).update(
            people_count=publication.people_count, people_count_at=now)


def _row(publication, request, lat, lon):
    return {
        "id": str(publication.public_id), "token": publication.token, "title": publication.title,
        "city": publication.city, "stop_count": publication.stop_count, "walk_m": publication.walk_m,
        "has_challenges": publication.has_challenges, "people_count": publication.people_count,
        "author": author_payload(publication.plan.owner, request),
        "distance_m": _meters(lat, lon, publication) if lat is not None else None,
    }


class TourSearchView(APIView):
    """POST, so the walker's position stays out of URLs and logs."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "tour_discover"

    def finalize_response(self, request, response, *args, **kwargs):
        return protect_response(super().finalize_response(request, response, *args, **kwargs))

    def post(self, request):
        serializer = SearchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        lat, lon = data.get("lat"), data.get("lon")
        words = normalize_discovery_text(data["q"]).split()
        rows = readable_publications().select_related("plan__owner")
        if request.user and request.user.is_authenticated:
            blocked = FriendBlock.objects.filter(Q(blocker=request.user) | Q(blocked=request.user)).values_list("blocker_id", "blocked_id")
            hidden = {account for pair in blocked for account in pair} - {request.user.pk}
            if hidden:
                rows = rows.exclude(plan__owner_id__in=hidden)
        if data["stops"]:
            low, high = STOP_BUCKETS[data["stops"]]
            rows = rows.filter(stop_count__gte=low, stop_count__lte=high)
        if data["challenges"]:
            rows = rows.filter(has_challenges=True)
        filtered = rows
        nearby = True
        start = data["page"] * PAGE
        closeness = None
        if lat is not None:
            # Squared degrees with longitude shrunk by latitude: a flat map is plenty for 25 km.
            scale = math.cos(math.radians(lat)) ** 2
            closeness = (F("start_lat") - lat) * (F("start_lat") - lat) + (F("start_lon") - lon) * (F("start_lon") - lon) * scale
        if words:
            # Every word somewhere in the name, pubs or addresses, so "tygr praha" works too.
            for word in words:
                rows = rows.filter(search_text__contains=word)
            # Near first when the walker shared a position, otherwise the most walked.
            rows = (rows.annotate(closeness=closeness).order_by("closeness", "pk") if closeness is not None
                    else rows.order_by("-people_count", "-published_at", "pk"))
        elif closeness is not None:
            reach = NEARBY_KM / KM_PER_DEGREE
            dlon = reach / max(math.cos(math.radians(lat)), 0.01)
            # The box lets the index narrow things down; the circle keeps "25 km" true in the corners.
            rows = (rows.filter(start_lat__range=(lat - reach, lat + reach), start_lon__range=(lon - dlon, lon + dlon))
                    .annotate(closeness=closeness).filter(closeness__lte=reach * reach).order_by("closeness", "pk"))
            if start == 0 and not rows.exists():
                # Nothing close yet: show the nearest ones from elsewhere, clearly labelled.
                nearby = False
                rows = filtered.annotate(closeness=closeness).order_by("closeness", "pk")
        else:
            rows = rows.order_by("-people_count", "-published_at", "pk")
        limit = FALLBACK if not nearby else PAGE
        page = list(rows[start:start + limit + 1])
        more = nearby and len(page) > limit
        page = page[:limit]
        _refresh_counts(page)
        return Response({
            "results": [_row(p, request, lat, lon) for p in page],
            "next_page": data["page"] + 1 if more and data["page"] + 1 < MAX_PAGE else None,
            "nearby": nearby,
        })

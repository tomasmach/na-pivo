"""Beers on tap around the drinker, for the "Čepují v okolí" list of the counter."""

from __future__ import annotations

from django.core.cache import cache
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.api.views import _haversine_km, _nearby_menu_rows
from pubs.beer_catalog import normalize_beer_text

BEERS_NEARBY_LIMIT = 20
BEERS_NEARBY_CACHE_TTL = 10 * 60
# Requests are answered for a ~100 m grid point, so the cache is shared by
# everyone in the same street and the exact position is never kept.
_GRID_DECIMALS = 3


class BeersNearbyQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    radius = serializers.IntegerField(min_value=100, max_value=5000, default=2000)


def _menu_entry(beer: object) -> dict | None:
    if not isinstance(beer, dict):
        return None
    name = str(beer.get("name") or "").strip()
    if not normalize_beer_text(name):
        return None
    price = beer.get("price_czk")
    volume = beer.get("volume_ml")
    return {
        "name": name,
        "price_czk": price if isinstance(price, int) else None,
        "volume_ml": volume if isinstance(volume, int) else None,
    }


def _prefer(entry: dict, existing: dict | None) -> bool:
    """Within one pub prefer the half-litre, then any priced serving."""
    if existing is None:
        return True
    if (entry["volume_ml"] == 500) != (existing["volume_ml"] == 500):
        return entry["volume_ml"] == 500
    return existing["price_czk"] is None and entry["price_czk"] is not None


def nearby_beers(*, lat: float, lng: float, radius_m: int) -> list[dict]:
    """One row per beer: the nearest pub that has it on its current menu."""
    found: dict[str, dict] = {}
    for row in _nearby_menu_rows(lat=lat, lng=lng, radius_km=radius_m / 1000):
        distance_m = round(_haversine_km(lat, lng, row.lat, row.lng) * 1000)
        in_pub: dict[str, dict] = {}
        for beer in row.beers if isinstance(row.beers, list) else []:
            entry = _menu_entry(beer)
            if entry is None:
                continue
            key = normalize_beer_text(entry["name"])
            if key in found:
                continue
            if _prefer(entry, in_pub.get(key)):
                in_pub[key] = entry
        for key, entry in in_pub.items():
            found[key] = {
                **entry,
                "pub_name": row.name,
                "pub_cache_key": row.cache_key,
                "distance_m": distance_m,
            }
        if len(found) >= BEERS_NEARBY_LIMIT:
            break
    return sorted(found.values(), key=lambda item: item["distance_m"])[:BEERS_NEARBY_LIMIT]


class BeersNearbyView(APIView):
    """GET /v1/beers/nearby?lat=&lng=&radius= — beers on tap in pubs nearby.

    Reads the public current menus (community first, imported where the pub
    has no community menu; reported pubs left out). ``radius`` is in metres,
    100 to 5000, default 2000. Coordinates are rounded to ~100 m before use and
    never stored or logged.

    Response 200: {"beers": [{"name", "price_czk", "volume_ml", "pub_name",
        "pub_cache_key", "distance_m"}]} nearest first, at most 20.
    Response 400: serializer errors.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_hours"

    def get(self, request: Request) -> Response:
        serializer = BeersNearbyQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        data = serializer.validated_data
        lat = round(data["lat"], _GRID_DECIMALS)
        lng = round(data["lng"], _GRID_DECIMALS)
        radius_m = data["radius"]
        key = f"beers_nearby:v1:{lat:.3f}:{lng:.3f}:{radius_m}"
        beers = cache.get(key)
        if beers is None:
            beers = nearby_beers(lat=lat, lng=lng, radius_m=radius_m)
            cache.set(key, beers, BEERS_NEARBY_CACHE_TTL)
        return Response({"beers": beers})

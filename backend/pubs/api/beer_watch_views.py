"""GET/POST/DELETE/PATCH /v1/beer-watches: the beers an account watches and where it is."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.beer_catalog import match_beer
from pubs.beer_watch import MAX_WATCHES, RADIUS_CHOICES_M, snap_location
from pubs.models import Account, BeerTapEvent, BeerWatch

from .authentication import AccountTokenAuthentication
from .throttling import SharedScopedRateThrottle

LOCATION_MAX_AGE = timedelta(days=14)
HELPED_WINDOW = timedelta(days=90)
HELPED_LIMIT = 100


class BeerWatchCreateSerializer(serializers.Serializer):
    beer_name = serializers.CharField(max_length=160)
    brewery_name = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")


class BeerWatchSettingsSerializer(serializers.Serializer):
    radius_m = serializers.ChoiceField(choices=RADIUS_CHOICES_M, required=False)
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    lng = serializers.FloatField(min_value=-180, max_value=180, required=False)

    def validate(self, attrs):
        if ("lat" in attrs) != ("lng" in attrs):
            raise serializers.ValidationError("lat and lng must be sent together.")
        return attrs


def _watch_item(product) -> dict:
    return {
        "product_key": product.key,
        "name": product.name,
        "aliases": [alias for alias in product.aliases or [] if isinstance(alias, str)],
    }


def _location_set(account: Account) -> bool:
    return (
        account.beer_watch_lat is not None
        and account.beer_watch_located_at is not None
        and account.beer_watch_located_at >= timezone.now() - LOCATION_MAX_AGE
    )


def _state(account: Account) -> dict:
    watches = BeerWatch.objects.filter(account=account).select_related("product").order_by("-created_at", "-id")
    helped = (
        BeerTapEvent.objects.filter(contributor=account, observed_at__gte=timezone.now() - HELPED_WINDOW)
        .annotate(helped_count=Count("pushes"))
        .filter(helped_count__gte=1)
        .select_related("product")
        .order_by("-observed_at", "-id")[:HELPED_LIMIT]
    )
    return {
        "radius_m": account.beer_watch_radius_m,
        "location_set": _location_set(account),
        "watches": [_watch_item(watch.product) for watch in watches],
        "helped": [
            {
                "cache_key": event.cache_key,
                "product_name": event.product.name,
                "helped_count": event.helped_count,
            }
            for event in helped
        ],
    }


def _clear_location(account: Account) -> None:
    Account.objects.filter(pk=account.pk).update(
        beer_watch_lat=None, beer_watch_lng=None, beer_watch_located_at=None
    )


class _BeerWatchPolicy(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "beer_watches"


class BeerWatchesView(_BeerWatchPolicy):
    def get(self, request):
        return Response(_state(request.user), status=status.HTTP_200_OK)

    def post(self, request):
        serializer = BeerWatchCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        beer = serializer.validated_data["beer_name"].strip()
        brewery = serializer.validated_data["brewery_name"].strip()
        # The exact spelling rules every menu write uses, so a watch matches what lands on a lístek.
        match = match_beer(beer, fuzzy=False)
        if (match is None or match.product is None) and brewery:
            match = match_beer(f"{brewery} {beer}", fuzzy=False)
        if match is None or match.product is None:
            return Response({"code": "unknown_beer"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        product = match.product
        account = request.user
        if BeerWatch.objects.filter(account=account, product=product).exists():
            return Response(_watch_item(product), status=status.HTTP_200_OK)
        if BeerWatch.objects.filter(account=account).count() >= MAX_WATCHES:
            return Response({"code": "too_many"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        _watch, created = BeerWatch.objects.get_or_create(account=account, product=product)
        return Response(
            _watch_item(product),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BeerWatchDetailView(_BeerWatchPolicy):
    def delete(self, request, product_key: str):
        account = request.user
        BeerWatch.objects.filter(account=account, product__key=product_key).delete()
        if not BeerWatch.objects.filter(account=account).exists():
            _clear_location(account)
        return Response(status=status.HTTP_204_NO_CONTENT)


class BeerWatchSettingsView(_BeerWatchPolicy):
    def patch(self, request):
        serializer = BeerWatchSettingsSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        data = serializer.validated_data
        account = request.user
        updates: dict = {}
        if "radius_m" in data:
            updates["beer_watch_radius_m"] = data["radius_m"]
        # Without a watch the server has no reason to know where anyone is.
        if "lat" in data and BeerWatch.objects.filter(account=account).exists():
            lat, lng = snap_location(data["lat"], data["lng"])
            updates.update(beer_watch_lat=lat, beer_watch_lng=lng, beer_watch_located_at=timezone.now())
        if updates:
            Account.objects.filter(pk=account.pk).update(**updates)
            for field, value in updates.items():
                setattr(account, field, value)
        return Response(_state(account), status=status.HTTP_200_OK)

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from django.utils.translation import gettext
from rest_framework import serializers, status
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.api.ugc_consent import ugc_consent_precondition
from pubs.enrichment import geohash8
from pubs.pub_events import PubEvent


class PubEventSuggestionSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    name = serializers.CharField(max_length=200, trim_whitespace=True)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    city = serializers.CharField(max_length=200, required=False, allow_blank=True)
    external_id = serializers.CharField(max_length=255, required=False, allow_blank=True)
    title = serializers.CharField(min_length=3, max_length=120, trim_whitespace=True)
    details = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()

    def validate(self, attrs):
        starts_at = attrs["starts_at"]
        ends_at = attrs["ends_at"]
        now = timezone.now()
        if ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": gettext("Akce musí končit po začátku.")})
        if ends_at <= now:
            raise serializers.ValidationError({"ends_at": gettext("Ukončenou akci už nejde navrhnout.")})
        if starts_at > now + timedelta(days=180):
            raise serializers.ValidationError({"starts_at": gettext("Akci lze navrhnout nejvýš 180 dní dopředu.")})
        if ends_at - starts_at > timedelta(days=14):
            raise serializers.ValidationError({"ends_at": gettext("Akce může trvat nejvýš 14 dní.")})
        return attrs


class PubEventView(APIView):
    """Read active verified events and accept credential-backed suggestions."""

    authentication_classes: list[type[BaseAuthentication]] = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def get(self, request: Request) -> Response:
        cache_key = (request.query_params.get("cache_key") or "").strip()
        if not cache_key or len(cache_key) > 12:
            return Response(
                {"cache_key": [gettext("Zadej platný klíč hospody.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        events = PubEvent.objects.filter(
            cache_key=cache_key,
            status=PubEvent.Status.VERIFIED,
            verified_at__isnull=False,
            starts_at__lte=now,
            ends_at__gt=now,
        ).order_by("ends_at", "created_at")[:3]
        payload = [
            {
                "id": str(event.id),
                "title": event.title,
                "details": event.details,
                "starts_at": event.starts_at.isoformat(),
                "ends_at": event.ends_at.isoformat(),
                "verified_at": event.verified_at.isoformat(),
            }
            for event in events
        ]
        response = Response({"events": payload, "as_of": now.isoformat()})
        response["Cache-Control"] = "public, max-age=60"
        return response

    def post(self, request: Request) -> Response:
        account = request.user
        if not getattr(account, "is_authenticated", False):
            return Response(
                {
                    "detail": gettext("Přihlas se a pak akci navrhni."),
                    "code": "authentication_required",
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not account.is_claimed:
            return Response(
                {
                    "detail": gettext("Návrhy akcí jsou jen pro přihlášené."),
                    "code": "claimed_account_required",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = PubEventSuggestionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        precondition = ugc_consent_precondition(request)
        if precondition is not None:
            return precondition
        data = serializer.validated_data
        event, created = PubEvent.objects.get_or_create(
            account=account,
            client_id=data["client_id"],
            defaults={
                "cache_key": geohash8(data["lat"], data["lng"]),
                "name": data["name"],
                "lat": data["lat"],
                "lng": data["lng"],
                "city": data.get("city", ""),
                "external_id": data.get("external_id", ""),
                "title": data["title"],
                "details": data.get("details", ""),
                "starts_at": data["starts_at"],
                "ends_at": data["ends_at"],
            },
        )
        return Response(
            {"id": str(event.id), "status": event.status},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

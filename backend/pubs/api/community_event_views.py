from __future__ import annotations

import math
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.community_events import CommunityEvent, CommunityEventMembership
from pubs.models import Account, ContentReport, FriendBlock


class CommunityEventCreateSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    title = serializers.CharField(min_length=3, max_length=120, trim_whitespace=True)
    description = serializers.CharField(
        max_length=800, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    city = serializers.CharField(max_length=120, trim_whitespace=True)
    area_label = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    exact_address = serializers.CharField(max_length=300, trim_whitespace=True)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    capacity = serializers.IntegerField(min_value=2, max_value=20)
    adults_confirmed = serializers.BooleanField()

    def validate(self, attrs):
        now = timezone.now()
        if not attrs["adults_confirmed"]:
            raise serializers.ValidationError(
                {"adults_confirmed": "Setkání je jen pro dospělé 18+."}
            )
        if attrs["starts_at"] < now + timedelta(minutes=15):
            raise serializers.ValidationError(
                {"starts_at": "Začátek musí být aspoň 15 minut dopředu."}
            )
        if attrs["starts_at"] > now + timedelta(days=60):
            raise serializers.ValidationError(
                {"starts_at": "Setkání lze založit nejvýš 60 dní dopředu."}
            )
        duration = attrs["ends_at"] - attrs["starts_at"]
        if duration < timedelta(hours=1) or duration > timedelta(hours=12):
            raise serializers.ValidationError({"ends_at": "Setkání musí trvat 1 až 12 hodin."})
        return attrs


class CommunityEventJoinSerializer(serializers.Serializer):
    message = serializers.CharField(
        max_length=240, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    adults_confirmed = serializers.BooleanField()

    def validate_adults_confirmed(self, value):
        if not value:
            raise serializers.ValidationError("Setkání je jen pro dospělé 18+.")
        return value


class CommunityEventReportSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=["spam", "other"])
    comment = serializers.CharField(
        max_length=1000, required=False, allow_blank=True, default="", trim_whitespace=True
    )


class CommunityEventDiscoverySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)


def _claimed_or_error(request: Request) -> Response | None:
    if request.user.is_claimed:
        return None
    return Response(
        {
            "detail": "Přihlas se, ať je u domácích setkání jasné, kdo přichází.",
            "code": "claimed_account_required",
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _profile(account: Account) -> dict:
    return {
        "id": str(account.public_id),
        "nickname": account.nickname,
        "display_name": account.display_name,
        "avatar_url": account.avatar.url if account.avatar else None,
    }


def _blocked(left: Account, right: Account) -> bool:
    return FriendBlock.objects.filter(
        Q(blocker=left, blocked=right) | Q(blocker=right, blocked=left)
    ).exists()


def _distance_km(lat_a: float, lng_a: float, lat_b: float, lng_b: float) -> float:
    earth_km = 6371.0
    lat1, lat2 = math.radians(lat_a), math.radians(lat_b)
    dlat = lat2 - lat1
    dlng = math.radians(lng_b - lng_a)
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return earth_km * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _distance_band(distance_km: float | None) -> str | None:
    if distance_km is None:
        return None
    if distance_km < 1:
        return "under_1_km"
    if distance_km < 3:
        return "1_3_km"
    if distance_km < 8:
        return "3_8_km"
    return "8_15_km"


def _time_status(event: CommunityEvent, now) -> str:
    if event.status == CommunityEvent.Status.CANCELLED:
        return "cancelled"
    if event.ends_at <= now:
        return "ended"
    if event.starts_at <= now:
        return "live"
    return "upcoming"


def _serialize_event(
    event: CommunityEvent,
    viewer: Account,
    *,
    distance_km: float | None = None,
) -> dict:
    membership = next(
        (member for member in event.memberships.all() if member.account_id == viewer.id),
        None,
    )
    is_host = event.host_id == viewer.id
    approved = (
        membership is not None
        and membership.status == CommunityEventMembership.Status.APPROVED
        and not viewer.ghost_mode
        and not event.host.ghost_mode
        and not _blocked(event.host, viewer)
    )
    approved_count = sum(
        member.status == CommunityEventMembership.Status.APPROVED
        for member in event.memberships.all()
    )
    payload = {
        "id": str(event.id),
        "host": _profile(event.host),
        "title": event.title,
        "description": event.description,
        "city": event.city,
        "area_label": event.area_label,
        "starts_at": event.starts_at.isoformat(),
        "ends_at": event.ends_at.isoformat(),
        "capacity": event.capacity,
        "available_spots": max(0, event.capacity - 1 - approved_count),
        "adults_only": True,
        "status": _time_status(event, timezone.now()),
        "distance_band": _distance_band(distance_km),
        "is_host": is_host,
        "membership_status": membership.status if membership else None,
        "exact_address": event.exact_address if (is_host or approved) else None,
    }
    if is_host:
        payload["join_requests"] = [
            {
                "id": str(member.id),
                "account": _profile(member.account),
                "message": member.message,
                "status": member.status,
                "requested_at": member.requested_at.isoformat(),
            }
            for member in event.memberships.all()
            if member.status
            in (
                CommunityEventMembership.Status.PENDING,
                CommunityEventMembership.Status.APPROVED,
            )
            and not member.account.ghost_mode
            and not _blocked(event.host, member.account)
        ]
    return payload


def _event_queryset():
    return CommunityEvent.objects.select_related("host").prefetch_related("memberships__account")


def _dashboard_payload(viewer: Account, viewer_lat: float | None, viewer_lng: float | None) -> dict:
    now = timezone.now()
    nearby = []
    if viewer_lat is not None and viewer_lng is not None:
        candidates = _event_queryset().filter(
            status=CommunityEvent.Status.ACTIVE,
            ends_at__gt=now,
            starts_at__lte=now + timedelta(days=30),
            host__status=Account.Status.ACTIVE,
            host__is_public=True,
            host__ghost_mode=False,
            lat__range=(viewer_lat - 0.2, viewer_lat + 0.2),
            lng__range=(viewer_lng - 0.3, viewer_lng + 0.3),
        )
        for event in candidates[:100]:
            if event.host_id == viewer.id or _blocked(event.host, viewer):
                continue
            distance = _distance_km(viewer_lat, viewer_lng, event.lat, event.lng)
            if distance <= 15:
                nearby.append((_serialize_event(event, viewer, distance_km=distance), distance))
        nearby.sort(key=lambda item: (item[1], item[0]["starts_at"]))

    hosted = _event_queryset().filter(host=viewer, ends_at__gt=now - timedelta(days=1))[:30]
    joined = _event_queryset().filter(
        memberships__account=viewer,
        memberships__status__in=(
            CommunityEventMembership.Status.PENDING,
            CommunityEventMembership.Status.APPROVED,
        ),
        ends_at__gt=now - timedelta(days=1),
    )[:30]
    return {
        "nearby": [item[0] for item in nearby[:30]],
        "hosted": [_serialize_event(event, viewer) for event in hosted],
        "joined": [_serialize_event(event, viewer) for event in joined],
    }


class CommunityEventCollectionView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def get(self, request: Request) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        return Response(_dashboard_payload(request.user, None, None))

    def post(self, request: Request) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        if request.user.ghost_mode:
            return Response(
                {"detail": "Nejdřív vypni neviditelný režim.", "code": "ghost_mode"},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = CommunityEventCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        event, created = CommunityEvent.objects.get_or_create(
            host=request.user,
            client_id=data["client_id"],
            defaults={
                "title": data["title"],
                "description": data["description"],
                "city": data["city"],
                "area_label": data["area_label"],
                "exact_address": data["exact_address"],
                "lat": data["lat"],
                "lng": data["lng"],
                "starts_at": data["starts_at"],
                "ends_at": data["ends_at"],
                "capacity": data["capacity"],
            },
        )
        event = _event_queryset().get(pk=event.pk)
        return Response(
            _serialize_event(event, request.user),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CommunityEventDiscoveryView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        serializer = CommunityEventDiscoverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # The location is used only in this request. It is never stored, returned,
        # or put in a URL where normal access logs could capture it.
        data = serializer.validated_data
        return Response(_dashboard_payload(request.user, data["lat"], data["lng"]))


class CommunityEventJoinView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request, event_id) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        serializer = CommunityEventJoinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = _event_queryset().filter(pk=event_id).first()
        if (
            not event
            or event.status != CommunityEvent.Status.ACTIVE
            or event.ends_at <= timezone.now()
        ):
            return Response(
                {"detail": "Setkání už není otevřené.", "code": "event_not_open"},
                status=status.HTTP_409_CONFLICT,
            )
        if event.host_id == request.user.id:
            return Response(
                {"detail": "Pořadatel už u stolu je.", "code": "host_cannot_join"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if request.user.ghost_mode or event.host.ghost_mode or _blocked(event.host, request.user):
            return Response(
                {"detail": "K tomuhle setkání se nejde přidat.", "code": "event_unavailable"},
                status=status.HTTP_404_NOT_FOUND,
            )
        membership, _created = CommunityEventMembership.objects.update_or_create(
            event=event,
            account=request.user,
            defaults={
                "message": serializer.validated_data["message"],
                "status": CommunityEventMembership.Status.PENDING,
                "decided_at": None,
            },
        )
        return Response(
            {"request_id": str(membership.id), "status": membership.status},
            status=status.HTTP_202_ACCEPTED,
        )

    def delete(self, request: Request, event_id) -> Response:
        membership = CommunityEventMembership.objects.filter(
            event_id=event_id, account=request.user
        ).first()
        if not membership:
            return Response({"cancelled": False})
        membership.status = (
            CommunityEventMembership.Status.LEFT
            if membership.status == CommunityEventMembership.Status.APPROVED
            else CommunityEventMembership.Status.CANCELLED
        )
        membership.decided_at = timezone.now()
        membership.save(update_fields=["status", "decided_at", "updated_at"])
        return Response({"cancelled": True, "status": membership.status})


class CommunityEventRequestDecisionView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request, event_id, request_id, action: str) -> Response:
        if action not in ("approve", "reject"):
            return Response(status=status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            event = (
                CommunityEvent.objects.select_for_update()
                .filter(pk=event_id, host=request.user)
                .first()
            )
            if not event:
                return Response(status=status.HTTP_404_NOT_FOUND)
            membership = (
                CommunityEventMembership.objects.select_related("account")
                .filter(
                    pk=request_id,
                    event=event,
                    status=CommunityEventMembership.Status.PENDING,
                )
                .first()
            )
            if not membership:
                return Response(status=status.HTTP_404_NOT_FOUND)
            if action == "approve":
                approved_count = event.memberships.filter(
                    status=CommunityEventMembership.Status.APPROVED
                ).count()
                if approved_count >= event.capacity - 1:
                    return Response(
                        {"detail": "Kapacita je plná.", "code": "capacity_full"},
                        status=status.HTTP_409_CONFLICT,
                    )
                if _blocked(event.host, membership.account) or membership.account.ghost_mode:
                    return Response(
                        {"detail": "Žádost už nejde schválit.", "code": "request_unavailable"},
                        status=status.HTTP_409_CONFLICT,
                    )
                membership.status = CommunityEventMembership.Status.APPROVED
            else:
                membership.status = CommunityEventMembership.Status.REJECTED
            membership.decided_at = timezone.now()
            membership.save(update_fields=["status", "decided_at", "updated_at"])
        return Response({"status": membership.status})


class CommunityEventCancelView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request, event_id) -> Response:
        event = CommunityEvent.objects.filter(pk=event_id, host=request.user).first()
        if not event:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if event.status != CommunityEvent.Status.CANCELLED:
            event.status = CommunityEvent.Status.CANCELLED
            event.cancelled_at = timezone.now()
            event.save(update_fields=["status", "cancelled_at", "updated_at"])
        return Response({"status": "cancelled"})


class CommunityEventReportView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback"

    def post(self, request: Request, event_id) -> Response:
        serializer = CommunityEventReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = CommunityEvent.objects.select_related("host").filter(pk=event_id).first()
        if not event:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if event.host_id == request.user.id:
            return Response(
                {"detail": "Vlastní setkání nejde nahlásit.", "code": "self_report"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        report = ContentReport.objects.create(
            reporter=request.user,
            target_account=event.host,
            reason=serializer.validated_data["reason"],
            comment=serializer.validated_data["comment"],
            target_snapshot={
                "community_event_id": str(event.id),
                "title": event.title,
                "city": event.city,
                "area_label": event.area_label,
                "host": _profile(event.host),
            },
        )
        return Response(
            {"id": str(report.id), "status": report.status}, status=status.HTTP_201_CREATED
        )

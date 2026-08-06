from __future__ import annotations

import math
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.community_events import (
    COMMUNITY_EVENT_TEAM_MAX_MEMBERS,
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
)
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


class CommunityEventTeamCreateSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()
    name = serializers.CharField(min_length=1, max_length=40, trim_whitespace=True)


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


def _blocked_account_ids(account: Account) -> set[int]:
    """Return both directions of the account's block graph in one query."""

    rows = FriendBlock.objects.filter(Q(blocker=account) | Q(blocked=account)).values_list(
        "blocker_id", "blocked_id"
    )
    return {
        blocked_id if blocker_id == account.id else blocker_id for blocker_id, blocked_id in rows
    }


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


def _event_membership(event: CommunityEvent, account: Account) -> CommunityEventMembership | None:
    prefetched = getattr(event, "_prefetched_objects_cache", {}).get("memberships")
    if prefetched is not None:
        return next((row for row in prefetched if row.account_id == account.id), None)
    return CommunityEventMembership.objects.filter(event=event, account=account).first()


def _is_event_participant(event: CommunityEvent, account: Account) -> bool:
    if event.host_id == account.id:
        return True
    membership = _event_membership(event, account)
    return membership is not None and membership.status == CommunityEventMembership.Status.APPROVED


def _team_access_error(
    event: CommunityEvent | None,
    viewer: Account,
    *,
    require_open: bool,
    blocked_account_ids: set[int] | None = None,
) -> Response | None:
    if event is None:
        return Response(
            {"detail": "Tuhle akci nevidím.", "code": "event_not_found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    if blocked_account_ids is None:
        blocked_account_ids = _blocked_account_ids(viewer)
    if (
        event.host.status != Account.Status.ACTIVE
        or viewer.status != Account.Status.ACTIVE
        or event.host_id in blocked_account_ids
        or (event.host.ghost_mode and event.host_id != viewer.id)
        or not _is_event_participant(event, viewer)
    ):
        return Response(
            {"detail": "Tuhle akci nevidím.", "code": "event_not_found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    if viewer.ghost_mode or event.host.ghost_mode:
        return Response(
            {"detail": "Nejdřív vypni neviditelný režim.", "code": "ghost_mode"},
            status=status.HTTP_409_CONFLICT,
        )
    if require_open and (
        event.status != CommunityEvent.Status.ACTIVE or event.ends_at <= timezone.now()
    ):
        return Response(
            {"detail": "Setkání už není otevřené.", "code": "event_not_open"},
            status=status.HTTP_409_CONFLICT,
        )
    return None


def _serialize_team_roster(
    event: CommunityEvent,
    viewer: Account,
    *,
    blocked_account_ids: set[int] | None = None,
) -> dict:
    if blocked_account_ids is None:
        blocked_account_ids = _blocked_account_ids(viewer)

    participants: dict[int, Account] = {}
    if (
        event.host.status == Account.Status.ACTIVE
        and not event.host.ghost_mode
        and event.host_id not in blocked_account_ids
    ):
        participants[event.host_id] = event.host
    for membership in event.memberships.all():
        account = membership.account
        if (
            membership.status == CommunityEventMembership.Status.APPROVED
            and account.status == Account.Status.ACTIVE
            and not account.ghost_mode
            and account.id not in blocked_account_ids
        ):
            participants[account.id] = account

    assigned_account_ids: set[int] = set()
    my_team_id = None
    teams = []
    for team in event.teams.all():
        all_members = [
            membership for membership in team.memberships.all() if membership.event_id == event.id
        ]
        visible_members = [
            membership for membership in all_members if membership.account_id in participants
        ]
        assigned_account_ids.update(row.account_id for row in visible_members)
        if any(row.account_id == viewer.id for row in visible_members):
            my_team_id = str(team.id)
        teams.append(
            {
                "id": str(team.id),
                "name": team.name,
                "capacity": COMMUNITY_EVENT_TEAM_MAX_MEMBERS,
                "member_count": len(visible_members),
                "available_spots": max(0, COMMUNITY_EVENT_TEAM_MAX_MEMBERS - len(all_members)),
                "is_mine": any(row.account_id == viewer.id for row in visible_members),
                "members": [
                    {
                        "account": _profile(row.account),
                        "joined_at": row.joined_at.isoformat(),
                    }
                    for row in visible_members
                ],
                "created_at": team.created_at.isoformat(),
            }
        )

    participant_ids = set(participants)
    return {
        "max_team_size": COMMUNITY_EVENT_TEAM_MAX_MEMBERS,
        "participant_count": len(participant_ids),
        "assigned_count": len(participant_ids & assigned_account_ids),
        "unassigned_count": len(participant_ids - assigned_account_ids),
        "my_team_id": my_team_id,
        "teams": teams,
    }


def _claim_team_seat(
    event: CommunityEvent,
    team: CommunityEventTeam,
    account: Account,
) -> tuple[CommunityEventTeamMembership | None, bool, str | None]:
    """Claim one of four DB-unique seats while the caller holds the event lock."""

    existing = (
        CommunityEventTeamMembership.objects.select_for_update()
        .select_related("team")
        .filter(event=event, account=account)
        .first()
    )
    if existing is not None:
        if existing.team_id == team.id:
            return existing, False, None
        return existing, False, "already_on_team"

    used_slots = set(
        CommunityEventTeamMembership.objects.select_for_update()
        .filter(team=team)
        .values_list("slot", flat=True)
    )
    for slot in range(1, COMMUNITY_EVENT_TEAM_MAX_MEMBERS + 1):
        if slot in used_slots:
            continue
        try:
            # A savepoint keeps the outer transaction usable if a concurrent
            # insert wins this slot or the account's one-team constraint.
            with transaction.atomic():
                membership = CommunityEventTeamMembership.objects.create(
                    event=event,
                    team=team,
                    account=account,
                    slot=slot,
                )
            return membership, True, None
        except IntegrityError:
            raced = (
                CommunityEventTeamMembership.objects.select_related("team")
                .filter(event=event, account=account)
                .first()
            )
            if raced is not None:
                if raced.team_id == team.id:
                    return raced, False, None
                return raced, False, "already_on_team"
            used_slots = set(
                CommunityEventTeamMembership.objects.filter(team=team).values_list(
                    "slot", flat=True
                )
            )
    return None, False, "team_full"


def _serialize_event(
    event: CommunityEvent,
    viewer: Account,
    *,
    distance_km: float | None = None,
    blocked_account_ids: set[int] | None = None,
    now=None,
    include_team_roster: bool = False,
) -> dict:
    if blocked_account_ids is None:
        blocked_account_ids = _blocked_account_ids(viewer)
    if now is None:
        now = timezone.now()
    event_is_open = event.status == CommunityEvent.Status.ACTIVE and event.ends_at > now
    membership = next(
        (member for member in event.memberships.all() if member.account_id == viewer.id),
        None,
    )
    is_host = event.host_id == viewer.id
    approved = (
        membership is not None
        and membership.status == CommunityEventMembership.Status.APPROVED
        and event_is_open
        and not viewer.ghost_mode
        and not event.host.ghost_mode
        and event.host_id not in blocked_account_ids
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
        "status": _time_status(event, now),
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
            and member.account.status == Account.Status.ACTIVE
            and not member.account.ghost_mode
            and member.account_id not in blocked_account_ids
        ]
    if (
        include_team_roster
        and _team_access_error(
            event,
            viewer,
            require_open=False,
            blocked_account_ids=blocked_account_ids,
        )
        is None
    ):
        payload["team_roster"] = _serialize_team_roster(
            event,
            viewer,
            blocked_account_ids=blocked_account_ids,
        )
    return payload


def _event_queryset(*, include_teams: bool = False):
    queryset = CommunityEvent.objects.select_related("host").prefetch_related(
        Prefetch(
            "memberships",
            queryset=CommunityEventMembership.objects.select_related("account"),
        )
    )
    if include_teams:
        queryset = queryset.prefetch_related(
            Prefetch(
                "teams",
                queryset=CommunityEventTeam.objects.select_related("created_by").prefetch_related(
                    Prefetch(
                        "memberships",
                        queryset=CommunityEventTeamMembership.objects.select_related("account"),
                    )
                ),
            )
        )
    return queryset


def _dashboard_payload(viewer: Account, viewer_lat: float | None, viewer_lng: float | None) -> dict:
    now = timezone.now()
    blocked_account_ids = _blocked_account_ids(viewer)
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
        if blocked_account_ids:
            candidates = candidates.exclude(host_id__in=blocked_account_ids)
        for event in candidates[:100]:
            if event.host_id == viewer.id:
                continue
            distance = _distance_km(viewer_lat, viewer_lng, event.lat, event.lng)
            if distance <= 15:
                nearby.append(
                    (
                        _serialize_event(
                            event,
                            viewer,
                            distance_km=distance,
                            blocked_account_ids=blocked_account_ids,
                            now=now,
                        ),
                        distance,
                    )
                )
        nearby.sort(key=lambda item: (item[1], item[0]["starts_at"]))

    hosted = _event_queryset().filter(host=viewer, ends_at__gt=now - timedelta(days=1))[:30]
    joined = _event_queryset().filter(
        memberships__account=viewer,
        memberships__status__in=(
            CommunityEventMembership.Status.PENDING,
            CommunityEventMembership.Status.APPROVED,
        ),
        ends_at__gt=now - timedelta(days=1),
        host__status=Account.Status.ACTIVE,
        host__ghost_mode=False,
    )
    if blocked_account_ids:
        joined = joined.exclude(host_id__in=blocked_account_ids)
    joined = joined[:30]
    return {
        "nearby": [item[0] for item in nearby[:30]],
        "hosted": [
            _serialize_event(
                event,
                viewer,
                blocked_account_ids=blocked_account_ids,
                now=now,
            )
            for event in hosted
        ],
        "joined": [
            _serialize_event(
                event,
                viewer,
                blocked_account_ids=blocked_account_ids,
                now=now,
            )
            for event in joined
        ],
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


class CommunityEventDetailView(APIView):
    """One privacy-filtered event for cold deep links and the 3.0 detail."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def get(self, request: Request, event_id) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        event = _event_queryset(include_teams=True).filter(pk=event_id).first()
        blocked_ids = _blocked_account_ids(request.user)
        if (
            event is None
            or event.host_id in blocked_ids
            or event.host.status != Account.Status.ACTIVE
            or event.host.ghost_mode
            or (
                event.host_id != request.user.id
                and not event.host.is_public
                and not event.memberships.filter(account=request.user).exists()
            )
        ):
            return Response(
                {"detail": "Tuhle akci nevidím.", "code": "event_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            _serialize_event(
                event,
                request.user,
                blocked_account_ids=blocked_ids,
                include_team_roster=True,
            )
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
        with transaction.atomic():
            event = CommunityEvent.objects.select_for_update().filter(pk=event_id).first()
            if event is None:
                return Response({"cancelled": False})
            membership = (
                CommunityEventMembership.objects.select_for_update()
                .filter(event=event, account=request.user)
                .first()
            )
            if not membership:
                return Response({"cancelled": False})
            CommunityEventTeamMembership.objects.filter(
                event_id=event_id,
                account=request.user,
            ).delete()
            membership.status = (
                CommunityEventMembership.Status.LEFT
                if membership.status == CommunityEventMembership.Status.APPROVED
                else CommunityEventMembership.Status.CANCELLED
            )
            membership.decided_at = timezone.now()
            membership.save(update_fields=["status", "decided_at", "updated_at"])
        return Response({"cancelled": True, "status": membership.status})


class CommunityEventTeamCollectionView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def get(self, request: Request, event_id) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        event = _event_queryset(include_teams=True).filter(pk=event_id).first()
        blocked_ids = _blocked_account_ids(request.user)
        access_error = _team_access_error(
            event,
            request.user,
            require_open=False,
            blocked_account_ids=blocked_ids,
        )
        if access_error is not None:
            return access_error
        return Response(
            _serialize_team_roster(
                event,
                request.user,
                blocked_account_ids=blocked_ids,
            )
        )

    def post(self, request: Request, event_id) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        serializer = CommunityEventTeamCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            event = (
                CommunityEvent.objects.select_for_update()
                .select_related("host")
                .filter(pk=event_id)
                .first()
            )
            access_error = _team_access_error(
                event,
                request.user,
                require_open=True,
            )
            if access_error is not None:
                return access_error

            team = CommunityEventTeam.objects.filter(
                event=event,
                client_id=data["client_id"],
            ).first()
            if team is not None:
                if team.created_by_id != request.user.id:
                    return Response(
                        {
                            "detail": "Tenhle požadavek už použil někdo jiný.",
                            "code": "team_client_id_conflict",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                created = False
            else:
                if CommunityEventTeamMembership.objects.filter(
                    event=event,
                    account=request.user,
                ).exists():
                    return Response(
                        {"detail": "Už jsi v jiném týmu.", "code": "already_on_team"},
                        status=status.HTTP_409_CONFLICT,
                    )
                if CommunityEventTeam.objects.filter(event=event).count() >= event.capacity:
                    return Response(
                        {
                            "detail": "Další tým už se sem nevejde.",
                            "code": "team_limit_reached",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                try:
                    with transaction.atomic():
                        team = CommunityEventTeam.objects.create(
                            event=event,
                            created_by=request.user,
                            client_id=data["client_id"],
                            name=data["name"],
                        )
                    created = True
                except IntegrityError:
                    team = CommunityEventTeam.objects.filter(
                        event=event,
                        client_id=data["client_id"],
                    ).first()
                    if team is None or team.created_by_id != request.user.id:
                        return Response(
                            {
                                "detail": "Tenhle požadavek už použil někdo jiný.",
                                "code": "team_client_id_conflict",
                            },
                            status=status.HTTP_409_CONFLICT,
                        )
                    created = False

                _membership, _joined, seat_error = _claim_team_seat(
                    event,
                    team,
                    request.user,
                )
                if seat_error is not None:
                    if created:
                        team.delete()
                    code = "team_full" if seat_error == "team_full" else "already_on_team"
                    detail = (
                        "Tenhle tým už má čtyři." if code == "team_full" else "Už jsi v jiném týmu."
                    )
                    return Response(
                        {"detail": detail, "code": code},
                        status=status.HTTP_409_CONFLICT,
                    )
            team_id = team.id

        event = _event_queryset(include_teams=True).get(pk=event_id)
        roster = _serialize_team_roster(event, request.user)
        team_payload = next(row for row in roster["teams"] if row["id"] == str(team_id))
        return Response(
            {"created": created, "team": team_payload, "team_roster": roster},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CommunityEventTeamMembershipView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request, event_id, team_id) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error

        with transaction.atomic():
            event = (
                CommunityEvent.objects.select_for_update()
                .select_related("host")
                .filter(pk=event_id)
                .first()
            )
            blocked_ids = _blocked_account_ids(request.user)
            access_error = _team_access_error(
                event,
                request.user,
                require_open=True,
                blocked_account_ids=blocked_ids,
            )
            if access_error is not None:
                return access_error
            team = (
                CommunityEventTeam.objects.select_for_update()
                .filter(pk=team_id, event=event)
                .first()
            )
            if team is None:
                return Response(
                    {"detail": "Tenhle tým tu není.", "code": "team_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if team.created_by_id in blocked_ids or (
                blocked_ids
                and CommunityEventTeamMembership.objects.filter(
                    team=team,
                    account_id__in=blocked_ids,
                ).exists()
            ):
                return Response(
                    {"detail": "K tomuhle týmu se nejde přidat.", "code": "team_unavailable"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            _membership, joined, seat_error = _claim_team_seat(
                event,
                team,
                request.user,
            )
            if seat_error is not None:
                code = "team_full" if seat_error == "team_full" else "already_on_team"
                detail = (
                    "Tenhle tým už má čtyři." if code == "team_full" else "Už jsi v jiném týmu."
                )
                return Response(
                    {"detail": detail, "code": code},
                    status=status.HTTP_409_CONFLICT,
                )

        event = _event_queryset(include_teams=True).get(pk=event_id)
        roster = _serialize_team_roster(event, request.user)
        team_payload = next(row for row in roster["teams"] if row["id"] == str(team_id))
        return Response(
            {"joined": joined, "team": team_payload, "team_roster": roster},
            status=status.HTTP_201_CREATED if joined else status.HTTP_200_OK,
        )

    def delete(self, request: Request, event_id, team_id) -> Response:
        error = _claimed_or_error(request)
        if error:
            return error
        with transaction.atomic():
            event = (
                CommunityEvent.objects.select_for_update()
                .select_related("host")
                .filter(pk=event_id)
                .first()
            )
            if event is None:
                return Response({"left": False})
            deleted, _details = CommunityEventTeamMembership.objects.filter(
                event=event,
                team_id=team_id,
                account=request.user,
            ).delete()

        payload = {"left": deleted > 0}
        event = _event_queryset(include_teams=True).get(pk=event_id)
        if _team_access_error(event, request.user, require_open=False) is None:
            payload["team_roster"] = _serialize_team_roster(event, request.user)
        return Response(payload)


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
                if event.status != CommunityEvent.Status.ACTIVE or event.ends_at <= timezone.now():
                    return Response(
                        {"detail": "Setkání už není otevřené.", "code": "event_not_open"},
                        status=status.HTTP_409_CONFLICT,
                    )
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

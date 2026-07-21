from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.party_serializers import PartyEveningCreateSerializer, PartyEveningDrinkSerializer
from pubs.models import (
    Account,
    FriendBlock,
    Friendship,
    PartyEvening,
    PartyEveningDrink,
    PartyEveningMember,
)


def _profile(account: Account) -> dict:
    avatar_url = account.avatar.url if account.avatar else None
    return {
        "id": str(account.public_id),
        "nickname": account.nickname,
        "display_name": account.display_name,
        "avatar_url": avatar_url,
    }


def _are_friends(left: Account, right: Account) -> bool:
    return Friendship.objects.filter(
        Q(requester=left, recipient=right) | Q(requester=right, recipient=left),
        status=Friendship.Status.ACCEPTED,
    ).exists()


def _blocked(left: Account, right: Account) -> bool:
    return FriendBlock.objects.filter(
        Q(blocker=left, blocked=right) | Q(blocker=right, blocked=left)
    ).exists()


def _accepted_friend_ids(account: Account) -> set[int]:
    rows = Friendship.objects.filter(
        Q(requester=account) | Q(recipient=account),
        status=Friendship.Status.ACCEPTED,
    ).values_list("requester_id", "recipient_id")
    return {
        recipient_id if requester_id == account.id else requester_id
        for requester_id, recipient_id in rows
    }


def _blocked_account_ids(account: Account) -> set[int]:
    rows = FriendBlock.objects.filter(Q(blocker=account) | Q(blocked=account)).values_list(
        "blocker_id", "blocked_id"
    )
    return {
        blocked_id if blocker_id == account.id else blocker_id
        for blocker_id, blocked_id in rows
    }


def _can_access(evening: PartyEvening, account: Account) -> bool:
    if account.ghost_mode or evening.host.ghost_mode:
        return False
    if evening.host_id == account.id:
        return True
    return _are_friends(account, evening.host) and not _blocked(account, evening.host)


def _visible_members(evening: PartyEvening) -> list[PartyEveningMember]:
    visible_account_ids = {
        evening.host_id,
        *(_accepted_friend_ids(evening.host) - _blocked_account_ids(evening.host)),
    }
    return list(
        evening.memberships.select_related("account")
        .filter(
            active=True,
            account_id__in=visible_account_ids,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
        )
        .order_by("joined_at", "id")
    )


def _has_other_active_membership(account: Account, evening: PartyEvening | None = None) -> bool:
    memberships = PartyEveningMember.objects.filter(
        account=account,
        active=True,
        evening__active=True,
    )
    if evening is not None:
        memberships = memberships.exclude(evening=evening)
    return memberships.exists()


def _active_membership_conflict() -> Response:
    return Response(
        {
            "detail": "Leave the active party evening before joining another.",
            "code": "active_party_membership_exists",
        },
        status=status.HTTP_409_CONFLICT,
    )


def _serialize_evening(evening: PartyEvening, viewer: Account) -> dict:
    members = _visible_members(evening)
    member_ids = {member.account_id for member in members}
    events = [
        {
            "id": f"join:{member.id}",
            "kind": "joined",
            "at": member.joined_at.isoformat(),
            "account": _profile(member.account),
        }
        for member in members
    ]
    events.extend(
        {
            "id": f"drink:{drink.id}",
            "kind": "drink",
            "at": drink.shared_at.isoformat(),
            "account": _profile(drink.account),
            "beer_name": drink.beer_name,
            "quantity": drink.quantity,
        }
        for drink in evening.shared_drinks.select_related("account").filter(
            account_id__in=member_ids,
            account__ghost_mode=False,
            account__status=Account.Status.ACTIVE,
        )
    )
    events.sort(key=lambda event: (event["at"], event["id"]))
    return {
        "id": str(evening.public_id),
        "join_code": evening.join_code,
        "join_url": f"https://na-pivo.cz/party/{evening.join_code}",
        "host": _profile(evening.host),
        "pub_name": evening.pub_name,
        "pub_city": evening.pub_city,
        "active": evening.active,
        "started_at": evening.started_at.isoformat(),
        "ended_at": evening.ended_at.isoformat() if evening.ended_at else None,
        "is_host": evening.host_id == viewer.id,
        "members": [_profile(member.account) for member in members],
        "events": events,
    }


def _member_evening(code: str, account: Account) -> PartyEvening | None:
    evening = (
        PartyEvening.objects.select_related("host")
        .filter(join_code=code.upper(), memberships__account=account, memberships__active=True)
        .first()
    )
    return evening if evening and _can_access(evening, account) else None


class PartyEveningCollectionView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        evening = (
            PartyEvening.objects.select_related("host")
            .filter(
                active=True,
                memberships__account=request.user,
                memberships__active=True,
            )
            .order_by("-started_at")
            .first()
        )
        if evening and not _can_access(evening, request.user):
            evening = None
        return Response({"evening": _serialize_evening(evening, request.user) if evening else None})

    def post(self, request: Request) -> Response:
        serializer = PartyEveningCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        if request.user.ghost_mode:
            return Response(
                {
                    "detail": "Turn off ghost mode before starting a party evening.",
                    "code": "ghost_mode",
                },
                status=status.HTTP_409_CONFLICT,
            )
        data = serializer.validated_data
        try:
            with transaction.atomic():
                host = Account.objects.select_for_update().get(pk=request.user.pk)
                evening = PartyEvening.objects.filter(
                    host=host, client_id=data["client_id"]
                ).first()
                created = evening is None
                if evening is None and PartyEvening.objects.filter(host=host, active=True).exists():
                    return Response(
                        {
                            "detail": "End the active party evening before starting another.",
                            "code": "active_party_exists",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                if _has_other_active_membership(host, evening):
                    return _active_membership_conflict()
                if evening is None:
                    evening = PartyEvening.objects.create(
                        host=host,
                        client_id=data["client_id"],
                        join_code=data["join_code"],
                        pub_name=data["pub_name"],
                        pub_city=data.get("pub_city") or "",
                        started_at=data.get("started_at") or timezone.now(),
                    )
                PartyEveningMember.objects.update_or_create(
                    evening=evening,
                    account=request.user,
                    defaults={"active": True, "left_at": None},
                )
        except IntegrityError:
            return Response(
                {"detail": "Join code already exists.", "code": "join_code_taken"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            _serialize_evening(evening, request.user),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PartyEveningDetailView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request, code: str) -> Response:
        evening = _member_evening(code, request.user)
        if not evening:
            return Response(
                {"detail": "Party evening not found.", "code": "party_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_serialize_evening(evening, request.user))


class PartyEveningJoinView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, code: str) -> Response:
        evening = (
            PartyEvening.objects.select_related("host")
            .filter(join_code=code.upper(), active=True)
            .first()
        )
        if not evening:
            return Response(
                {"detail": "Party evening not found.", "code": "party_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if request.user.ghost_mode or evening.host.ghost_mode:
            return Response(
                {"detail": "Party evening is hidden by ghost mode.", "code": "ghost_mode"},
                status=status.HTTP_409_CONFLICT,
            )
        if request.user != evening.host and (
            not _are_friends(request.user, evening.host) or _blocked(request.user, evening.host)
        ):
            return Response(
                {"detail": "Only accepted friends can join.", "code": "not_friends"},
                status=status.HTTP_403_FORBIDDEN,
            )
        with transaction.atomic():
            account = Account.objects.select_for_update().get(pk=request.user.pk)
            if _has_other_active_membership(account, evening):
                return _active_membership_conflict()
            PartyEveningMember.objects.update_or_create(
                evening=evening,
                account=account,
                defaults={"active": True, "left_at": None, "joined_at": timezone.now()},
            )
        return Response(_serialize_evening(evening, request.user))

    def delete(self, request: Request, code: str) -> Response:
        evening = _member_evening(code, request.user)
        if not evening:
            return Response({"left": False})
        if evening.host_id == request.user.id:
            return Response(
                {"detail": "The host must end the evening.", "code": "host_must_end"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        evening.memberships.filter(account=request.user).update(
            active=False, left_at=timezone.now()
        )
        return Response({"left": True})


class PartyEveningEndView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, code: str) -> Response:
        evening = PartyEvening.objects.filter(join_code=code.upper(), host=request.user).first()
        if not evening:
            return Response(
                {"detail": "Party evening not found.", "code": "party_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if evening.active:
            evening.active = False
            evening.ended_at = timezone.now()
            evening.save(update_fields=["active", "ended_at", "updated_at"])
        return Response(_serialize_evening(evening, request.user))


class PartyEveningDrinkView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, code: str) -> Response:
        serializer = PartyEveningDrinkSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        evening = _member_evening(code, request.user)
        if not evening or not evening.active:
            return Response(
                {"detail": "Party evening is not active.", "code": "party_not_active"},
                status=status.HTTP_409_CONFLICT,
            )
        if request.user.ghost_mode:
            return Response(
                {
                    "detail": "Turn off ghost mode before sharing a drink.",
                    "code": "ghost_mode",
                },
                status=status.HTTP_409_CONFLICT,
            )
        data = serializer.validated_data
        drink, created = PartyEveningDrink.objects.update_or_create(
            account=request.user,
            client_id=data["client_id"],
            defaults={
                "evening": evening,
                "beer_name": data["beer_name"],
                "quantity": data["quantity"],
                "shared_at": data.get("shared_at") or timezone.now(),
            },
        )
        return Response(
            {"drink_id": str(drink.id), "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

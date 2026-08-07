from __future__ import annotations

from collections import defaultdict

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.models import (
    Account,
    BeerPhoto,
    Challenge,
    DrinkLog,
    FriendBlock,
    Friendship,
    PubVisit,
)

RIVALS_LIMIT = 4


def _blocked_account_ids(account: Account) -> set[int]:
    rows = FriendBlock.objects.filter(Q(blocker=account) | Q(blocked=account)).values_list(
        "blocker_id", "blocked_id"
    )
    return {
        blocked_id if blocker_id == account.id else blocker_id
        for blocker_id, blocked_id in rows
    }


def _eligible_friends(account: Account) -> list[Account]:
    """Accepted friends whose aggregate diary progress may be shared.

    Ghost mode and the existing drink-sharing switch remain authoritative for
    this new surface. A block is applied in both directions even if a stale
    accepted friendship row still exists.
    """

    blocked_ids = _blocked_account_ids(account)
    rows = (
        Friendship.objects.filter(status=Friendship.Status.ACCEPTED)
        .filter(Q(requester=account) | Q(recipient=account))
        .select_related("requester", "recipient")
    )
    friends: list[Account] = []
    for friendship in rows:
        friend = friendship.recipient if friendship.requester_id == account.id else friendship.requester
        if (
            friend.id not in blocked_ids
            and friend.status == Account.Status.ACTIVE
            and not friend.ghost_mode
            and friend.share_drinks_with_parta
        ):
            friends.append(friend)
    return friends


def _progress_for_accounts(challenge: Challenge, account_ids: list[int]) -> dict[int, int]:
    """Compute one challenge from source rows, never from a stored counter."""

    if not account_ids:
        return {}
    progress: dict[int, int] = defaultdict(int)
    window = {
        "account_id__in": account_ids,
    }

    if challenge.metric_rule == Challenge.MetricRule.BEER_COUNT:
        rows = (
            DrinkLog.objects.filter(
                **window,
                drink_type=DrinkLog.DrinkType.BEER,
                is_suspect=False,
                drank_at__gte=challenge.window_start,
                drank_at__lt=challenge.window_end,
            )
            .values_list("account_id", flat=True)
        )
        for account_id in rows:
            progress[account_id] += 1
        return dict(progress)

    if challenge.metric_rule == Challenge.MetricRule.PHOTO_COUNT:
        rows = BeerPhoto.objects.filter(
            **window,
            taken_at__gte=challenge.window_start,
            taken_at__lt=challenge.window_end,
        ).values_list("account_id", flat=True)
        for account_id in rows:
            progress[account_id] += 1
        return dict(progress)

    pub_keys: dict[int, set[str]] = defaultdict(set)
    visit_rows = PubVisit.objects.filter(
        **window,
        started_at__gte=challenge.window_start,
        started_at__lt=challenge.window_end,
    ).values_list("account_id", "cache_key")
    for account_id, cache_key in visit_rows:
        if cache_key:
            pub_keys[account_id].add(cache_key)
    drink_rows = DrinkLog.objects.filter(
        **window,
        place_context=DrinkLog.PlaceContext.PUB,
        is_suspect=False,
        drank_at__gte=challenge.window_start,
        drank_at__lt=challenge.window_end,
    ).exclude(cache_key__isnull=True).values_list("account_id", "cache_key")
    for account_id, cache_key in drink_rows:
        if cache_key:
            pub_keys[account_id].add(cache_key)
    return {account_id: len(keys) for account_id, keys in pub_keys.items()}


class ChallengeSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="slug", read_only=True)
    progress = serializers.SerializerMethodField()
    rivals = serializers.SerializerMethodField()

    class Meta:
        model = Challenge
        fields = (
            "id",
            "slug",
            "title",
            "glyph_key",
            "metric_rule",
            "target",
            "unit",
            "blurb",
            "reward",
            "rules",
            "window_start",
            "window_end",
            "progress",
            "rivals",
        )

    def get_progress(self, challenge: Challenge) -> dict:
        current = self.context["progress_by_challenge"][challenge.id]
        return {
            "current": current,
            "target": challenge.target,
            "ratio": min(1, current / challenge.target),
        }

    def get_rivals(self, challenge: Challenge) -> list[dict]:
        request: Request = self.context["request"]
        rows = self.context["rivals_by_challenge"][challenge.id]
        return [
            {
                "account": {
                    "id": str(account.public_id),
                    "nickname": account.nickname,
                    "display_name": account.display_name,
                    "avatar_url": (
                        request.build_absolute_uri(account.avatar.url) if account.avatar else None
                    ),
                },
                "progress": current,
            }
            for account, current in rows
        ]


class ChallengeCollectionView(APIView):
    """GET /v1/challenges — active definitions plus read-time progress."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        now = timezone.now()
        challenges = list(
            Challenge.objects.filter(
                active=True,
                window_start__lte=now,
                window_end__gt=now,
            )
        )
        friends = _eligible_friends(request.user)
        account_ids = [request.user.id, *(friend.id for friend in friends)]
        progress_by_challenge: dict[int, int] = {}
        rivals_by_challenge: dict[int, list[tuple[Account, int]]] = {}

        for challenge in challenges:
            progress = _progress_for_accounts(challenge, account_ids)
            progress_by_challenge[challenge.id] = progress.get(request.user.id, 0)
            rivals_by_challenge[challenge.id] = sorted(
                ((friend, progress.get(friend.id, 0)) for friend in friends),
                key=lambda item: (-item[1], (item[0].nickname or item[0].display_name).casefold()),
            )[:RIVALS_LIMIT]

        serializer = ChallengeSerializer(
            challenges,
            many=True,
            context={
                "request": request,
                "progress_by_challenge": progress_by_challenge,
                "rivals_by_challenge": rivals_by_challenge,
            },
        )
        return Response({"challenges": serializer.data}, status=status.HTTP_200_OK)

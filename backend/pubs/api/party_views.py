import asyncio
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from asgiref.sync import sync_to_async
from django.db import IntegrityError, close_old_connections, transaction
from django.db.models import Exists, OuterRef, Q
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.client_time import CLIENT_FUTURE_GRACE, bounded_client_time
from pubs.api.party_serializers import (
    PARTY_GAME_EVENT_MAX_PER_EVENING,
    PARTY_GAME_EVENT_MAX_PER_GAME,
    PartyEveningCreateSerializer,
    PartyEveningDrinkSerializer,
    PartyGameCreateSerializer,
    PartyGameEventBatchSerializer,
)
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.models import (
    Account,
    AccountIdentityAlias,
    BeerPhoto,
    DrinkLog,
    FriendBlock,
    PartyEvening,
    PartyEveningCode,
    PartyEveningDrink,
    PartyEveningMember,
    PartyGame,
    PartyGameAlias,
    PartyGameEvent,
    PubVisit,
    party_game_seed,
)

# A record is a recap for one real table, not an unbounded export endpoint.
# Keep the caps comfortably above a plausible night while bounding database
# reads, legacy quantity expansion, JSON serialization and response size.
PARTY_RECORD_MAX_PARTICIPANTS = 64
PARTY_RECORD_MAX_STOPS = 256
PARTY_RECORD_MAX_DRINKS = 1_000
PARTY_RECORD_MAX_PHOTOS = 256
PARTY_RECORD_MAX_GAMES = 64
PARTY_RECORD_MAX_GAME_EVENTS = 2_000
PARTY_RECORD_MAX_TIMELINE_EVENTS = 2_000
# A recap picker is deliberately a small recent-history surface, not an export.
PARTY_HISTORY_MAX_EVENINGS = 20
# The same ceiling protects recap/game payloads and, more importantly, bounds
# the pairwise friendship work performed when somebody joins a table.
PARTY_EVENING_MAX_MEMBERS = PARTY_RECORD_MAX_PARTICIPANTS


def _lock_accounts_in_pk_order(account_ids: set[int]) -> dict[int, Account]:
    """Lock every party identity before tree rows in one global order."""

    return {
        account.pk: account
        for account in Account.objects.select_for_update()
        .filter(pk__in=sorted(account_ids))
        .order_by("pk")
    }


def _roster_accounts_by_requested_id(
    roster_ids: list[uuid.UUID],
) -> dict[str, Account]:
    """Resolve current and retired roster UUIDs before taking Account locks."""

    requested = {str(value) for value in roster_ids}
    resolved = {
        str(account.public_id): account
        for account in Account.objects.filter(
            public_id__in=requested,
            status=Account.Status.ACTIVE,
        )
    }
    unresolved = requested - set(resolved)
    if unresolved:
        resolved.update(
            {
                str(alias.public_id): alias.account
                for alias in AccountIdentityAlias.objects.select_related("account").filter(
                    public_id__in=unresolved,
                    account__status=Account.Status.ACTIVE,
                )
            }
        )
    return resolved


def _canonical_roster_ids(
    roster_ids: list[uuid.UUID],
    locked_accounts: dict[int, Account],
) -> tuple[list[str], set[str]]:
    """Map a queued roster to locked current UUIDs, preserving order."""

    requested = [str(value) for value in roster_ids]
    by_requested_id = {
        str(account.public_id): account
        for account in locked_accounts.values()
        if account.status == Account.Status.ACTIVE
    }
    unresolved = set(requested) - set(by_requested_id)
    if unresolved:
        by_requested_id.update(
            {
                str(alias.public_id): locked_accounts[alias.account_id]
                for alias in AccountIdentityAlias.objects.filter(
                    public_id__in=unresolved,
                    account_id__in=locked_accounts,
                )
                if alias.account_id in locked_accounts
                and locked_accounts[alias.account_id].status == Account.Status.ACTIVE
            }
        )

    missing = {value for value in requested if value not in by_requested_id}
    canonical = list(
        dict.fromkeys(
            str(by_requested_id[value].public_id)
            for value in requested
            if value in by_requested_id
        )
    )
    # Two retired UUIDs can collapse onto one person after login. Keep the game
    # on the table with an unbound lobby instead of persisting a one-player
    # roster that the public API itself rejects.
    if len(canonical) == 1:
        canonical = []
    return canonical, missing


def _canonicalize_identity_aliases_in_json(value, aliases: dict[str, str]):
    """Replace exact retired account UUID strings inside a bounded game payload."""

    if isinstance(value, str):
        return aliases.get(value, value)
    if isinstance(value, list):
        return [
            _canonicalize_identity_aliases_in_json(item, aliases)
            for item in value
        ]
    if isinstance(value, dict):
        return {
            key: _canonicalize_identity_aliases_in_json(item, aliases)
            for key, item in value.items()
        }
    return value


def _roster_needs_repair(value) -> bool:
    if not isinstance(value, list) or len(value) in {1} or len(value) > 64:
        return True
    normalized: list[str] = []
    try:
        normalized = [str(uuid.UUID(str(item))) for item in value]
    except (TypeError, ValueError, AttributeError):
        return True
    return len(set(normalized)) != len(normalized)


def _profile(account: Account | None) -> dict:
    if account is None or account.status != Account.Status.ACTIVE:
        return {
            "id": "deleted",
            "nickname": None,
            "display_name": "Smazaný hráč",
            "avatar_url": None,
        }
    avatar_url = account.avatar.url if account.avatar else None
    return {
        "id": str(account.public_id),
        "nickname": account.nickname,
        "display_name": account.display_name,
        "avatar_url": avatar_url,
    }


def _blocked(left: Account, right: Account) -> bool:
    return FriendBlock.objects.filter(
        Q(blocker=left, blocked=right) | Q(blocker=right, blocked=left)
    ).exists()


def _blocked_account_ids(account: Account) -> set[int]:
    cached = getattr(account, "_blocked_account_ids_cache", None)
    if cached is not None:
        return cached
    rows = FriendBlock.objects.filter(Q(blocker=account) | Q(blocked=account)).values_list(
        "blocker_id", "blocked_id"
    )
    blocked_ids = {
        blocked_id if blocker_id == account.id else blocker_id for blocker_id, blocked_id in rows
    }
    account._blocked_account_ids_cache = blocked_ids
    return blocked_ids


def _can_access(evening: PartyEvening, account: Account) -> bool:
    if account.status != Account.Status.ACTIVE or account.ghost_mode:
        return False
    host = evening.host
    if host is not None and (host.status != Account.Status.ACTIVE or host.ghost_mode):
        return False
    if host is not None and _blocked(account, host):
        return False
    # A join code grants access to this table and nothing else: membership
    # never creates or mutates a social relationship.
    return evening.memberships.filter(account=account, active=True).exists()


def _can_access_ended_history(evening: PartyEvening, account: Account) -> bool:
    """Whether a past explicit member may recover an ended table's recap.

    Leaving an active table revokes access immediately. Once the host ends the
    table, its historical membership is the durable consent record that lets a
    former member recover their own recap on another device. Current privacy
    state still wins: ghost mode or a block hides it again. Account deletion
    hides that person's identity and contributions, but keeps the other
    participants' private recap recoverable.
    """
    if evening.active or evening.ended_at is None:
        return False
    if account.status != Account.Status.ACTIVE or account.ghost_mode:
        return False
    host = evening.host
    if host is not None:
        if _blocked(account, host):
            return False
        if host.status == Account.Status.ACTIVE and host.ghost_mode:
            return False
    return evening.memberships.filter(account=account).exists()


def _visible_participant_rows(evening: PartyEvening, viewer: Account):
    return (
        evening.memberships.select_related("account")
        .filter(
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
        )
        .exclude(account_id__in=_blocked_account_ids(viewer))
        .order_by("joined_at", "id")
    )


def _visible_participants(evening: PartyEvening, viewer: Account) -> list[PartyEveningMember]:
    """Every historical participant this viewer may still see."""
    return list(_visible_participant_rows(evening, viewer))


def _limited_rows(queryset, limit: int) -> tuple[list, bool]:
    """Evaluate at most ``limit + 1`` rows and report whether one was omitted."""
    rows = list(queryset[: limit + 1])
    return rows[:limit], len(rows) > limit


def _visible_members(evening: PartyEvening, viewer: Account) -> list[PartyEveningMember]:
    """Active participants, preserving the released ``members`` semantics."""
    return [
        membership for membership in _visible_participants(evening, viewer) if membership.active
    ]


def _serialize_participant(membership: PartyEveningMember) -> dict:
    return {
        **_profile(membership.account),
        "joined_at": membership.joined_at.isoformat(),
        "left_at": membership.left_at.isoformat() if membership.left_at else None,
        "active": membership.active,
    }


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


def _drink_visible_to_viewer(viewer: Account) -> Q:
    """Keep an opted-out account's linked rows private to their owner.

    The setting is evaluated when a table is read, not only when a row is
    linked. That makes an opt-out take effect immediately for legacy rows and
    offline DrinkLog rows which reached the server before the preference
    changed, without deleting anything from the owner's private diary.
    """
    return Q(account=viewer) | Q(account__share_drinks_with_parta=True)


def _serialize_evening(evening: PartyEvening, viewer: Account) -> dict:
    participants = _visible_participants(evening, viewer)
    members = [membership for membership in participants if membership.active]
    participant_ids = {membership.account_id for membership in participants}
    events = [
        {
            "id": f"join:{member.id}",
            "kind": "joined",
            "at": member.joined_at.isoformat(),
            "account": _profile(member.account),
        }
        for member in participants
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
            account_id__in=participant_ids,
            account__ghost_mode=False,
            account__status=Account.Status.ACTIVE,
        ).filter(_drink_visible_to_viewer(viewer))
    )
    # The same evening, from the diary. Two sources, one timeline:
    #
    #   PartyEveningDrink   released apps, which POST a beer here as well as
    #                       into their diary. Kept for wire compatibility and
    #                       privacy-filtered against the owner's current choice.
    #   DrinkLog            the current app, which writes a beer ONCE and tags
    #                       it with the evening it happened in.
    #
    # No duplicates: a client that writes DrinkLog rows never posts to the other
    # endpoint, and one that posts there does not know about `party_code`.
    events.extend(
        {
            "id": f"log:{drink.id}",
            "kind": "drink",
            "at": drink.drank_at.isoformat(),
            "account": _profile(drink.account),
            "beer_name": drink.beer_name,
            "quantity": 1,
        }
        for drink in evening.logged_drinks.select_related("account").filter(
            account_id__in=participant_ids,
            account__ghost_mode=False,
            account__status=Account.Status.ACTIVE,
        ).filter(_drink_visible_to_viewer(viewer))
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
        "participants": [_serialize_participant(member) for member in participants],
        "events": events,
    }


def _evening_for_code(code: str) -> PartyEvening | None:
    normalized = code.upper()
    reservation = (
        PartyEveningCode.objects.select_related("evening__host")
        .filter(join_code=normalized)
        .first()
    )
    if reservation is not None:
        return reservation.evening
    # Compatibility for direct ORM fixtures and a rolling deploy before the
    # reservation backfill has completed in the same migration transaction.
    return (
        PartyEvening.objects.select_related("host")
        .filter(join_code=normalized)
        .first()
    )


def _member_evening(code: str, account: Account) -> PartyEvening | None:
    evening = _evening_for_code(code)
    return evening if evening and _can_access(evening, account) else None


def _record_evening(code: str, account: Account) -> PartyEvening | None:
    evening = _evening_for_code(code)
    if not evening:
        return None
    return (
        evening
        if _can_access(evening, account) or _can_access_ended_history(evening, account)
        else None
    )


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
                host = (
                    Account.objects.select_for_update()
                    .filter(pk=request.user.pk)
                    .first()
                )
                # Authentication happened before this row lock. A concurrent
                # delete or privacy change may have committed while this request
                # was waiting, so authorization must be rechecked on the locked
                # row before creating any new shared state.
                if host is None or host.status != Account.Status.ACTIVE:
                    return Response(
                        {
                            "detail": "Account is no longer active.",
                            "code": "auth",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                if host.ghost_mode:
                    return Response(
                        {
                            "detail": "Turn off ghost mode before starting a party evening.",
                            "code": "ghost_mode",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
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
                    # The reservation shares this transaction with the parent.
                    # A retired code racing this create makes the INSERT fail
                    # and rolls the parent back instead of becoming ambiguous.
                    PartyEveningCode.objects.create(
                        join_code=data["join_code"],
                        evening=evening,
                    )
                PartyEveningMember.objects.update_or_create(
                    evening=evening,
                    account=host,
                    defaults={"active": True, "left_at": None},
                )
                # Keep the fresh viewer identity and its privacy relationships
                # stable until the response payload has been assembled.
                payload = _serialize_evening(evening, host)
        except IntegrityError:
            return Response(
                {"detail": "Join code already exists.", "code": "join_code_taken"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            payload,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PartyEveningHistoryView(APIView):
    """GET /v1/party-evenings/history — recent ended tables this account joined."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        if request.user.ghost_mode:
            return Response({"evenings": [], "truncated": False})

        rows = list(
            PartyEvening.objects.select_related("host")
            .filter(
                Q(host__isnull=True)
                | Q(
                    host__status=Account.Status.ACTIVE,
                    host__ghost_mode=False,
                )
                | Q(host__status=Account.Status.PENDING_DELETION),
                active=False,
                ended_at__isnull=False,
                memberships__account=request.user,
            )
            .exclude(host_id__in=_blocked_account_ids(request.user))
            .order_by("-ended_at", "-id")[: PARTY_HISTORY_MAX_EVENINGS + 1]
        )
        truncated = len(rows) > PARTY_HISTORY_MAX_EVENINGS
        evenings = [
            {
                "id": str(evening.public_id),
                "join_code": evening.join_code,
                "pub_name": evening.pub_name,
                "pub_city": evening.pub_city,
                "started_at": evening.started_at.isoformat(),
                "ended_at": evening.ended_at.isoformat(),
                "is_host": evening.host_id == request.user.id,
            }
            for evening in rows[:PARTY_HISTORY_MAX_EVENINGS]
        ]
        return Response({"evenings": evenings, "truncated": truncated})


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
        evening = _evening_for_code(code)
        if (
            not evening
            or not evening.active
            or evening.host is None
            or evening.host.status != Account.Status.ACTIVE
        ):
            return Response(
                {"detail": "Party evening not found.", "code": "party_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if request.user.ghost_mode or evening.host.ghost_mode:
            return Response(
                {"detail": "Party evening is hidden by ghost mode.", "code": "ghost_mode"},
                status=status.HTTP_409_CONFLICT,
            )
        if request.user != evening.host and _blocked(request.user, evening.host):
            return Response(
                {"detail": "Party evening is unavailable.", "code": "party_blocked"},
                status=status.HTTP_403_FORBIDDEN,
            )
        optimistic_host_id = evening.host_id
        with transaction.atomic():
            locked_accounts = _lock_accounts_in_pk_order(
                {request.user.pk, optimistic_host_id}
            )
            host = locked_accounts.get(optimistic_host_id)
            account = locked_accounts.get(request.user.pk)
            if (
                account is None
                or host is None
                or account.status != Account.Status.ACTIVE
                or host.status != Account.Status.ACTIVE
            ):
                return Response(
                    {"detail": "Party evening not found.", "code": "party_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if account.ghost_mode or host.ghost_mode:
                return Response(
                    {
                        "detail": "Party evening is hidden by ghost mode.",
                        "code": "ghost_mode",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            evening = (
                PartyEvening.objects.select_for_update(of=("self",))
                .filter(pk=evening.pk)
                .first()
            )
            # The host can end the table after the optimistic lookup above but
            # before this transaction acquires the row lock. A concurrent
            # account merge can also replace or remove the host. Re-check the
            # locked row so a stale identity never joins the wrong table.
            if (
                evening is None
                or not evening.active
                or evening.host_id != optimistic_host_id
            ):
                return Response(
                    {"detail": "Party evening not found.", "code": "party_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            active_account_ids = list(
                evening.memberships.filter(active=True).values_list(
                    "account_id", flat=True
                )
            )
            if (
                request.user.pk not in active_account_ids
                and len(active_account_ids) >= PARTY_EVENING_MAX_MEMBERS
            ):
                return Response(
                    {
                        "detail": "U tohoto stolu už je maximum lidí.",
                        "code": "party_full",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if account != host and _blocked(account, host):
                return Response(
                    {
                        "detail": "Party evening is unavailable.",
                        "code": "party_blocked",
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            if _has_other_active_membership(account, evening):
                return _active_membership_conflict()
            now = timezone.now()
            PartyEveningMember.objects.update_or_create(
                evening=evening,
                account=account,
                defaults={"active": True, "left_at": None, "joined_at": now},
            )
            # The authenticated source account may be merged immediately after
            # commit. Serialize while its Account and the evening are locked so
            # a stale request.user cannot bypass a moved block relationship.
            payload = _serialize_evening(evening, account)
        return Response(payload)

    def delete(self, request: Request, code: str) -> Response:
        # Leaving must remain possible after a block or after enabling ghost
        # mode; otherwise an invisible active membership traps the account and
        # prevents it from joining another table.
        optimistic_evening = _evening_for_code(code)
        if optimistic_evening is None:
            return Response({"left": False})
        optimistic_host_id = optimistic_evening.host_id
        if optimistic_host_id is None:
            return Response({"left": False})
        with transaction.atomic():
            # Account PK order matches login merge. If merge already retired
            # this parent, return retryable auth so the durable client retries
            # the same code through its alias instead of dropping the leave.
            locked_accounts = _lock_accounts_in_pk_order(
                {request.user.pk, optimistic_host_id}
            )
            host = locked_accounts.get(optimistic_host_id)
            account = locked_accounts.get(request.user.pk)
            if (
                host is None
                or account is None
                or account.status != Account.Status.ACTIVE
            ):
                return Response(
                    {
                        "detail": "Account changed while leaving the evening.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            evening = (
                PartyEvening.objects.select_for_update(of=("self",))
                .filter(pk=optimistic_evening.pk, host_id=optimistic_host_id)
                .first()
            )
            if evening is None:
                return Response(
                    {
                        "detail": "Evening changed while leaving.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            membership = evening.memberships.filter(account=account, active=True).first()
            if membership is None:
                return Response({"left": False})
            if evening.host_id == account.id:
                return Response(
                    {"detail": "The host must end the evening.", "code": "host_must_end"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            updated = evening.memberships.filter(pk=membership.pk, active=True).update(
                active=False, left_at=timezone.now()
            )
        return Response({"left": updated > 0})


class PartyEveningEndView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, code: str) -> Response:
        optimistic_evening = _evening_for_code(code)
        if optimistic_evening is None:
            return Response(
                {"detail": "Party evening not found.", "code": "party_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        with transaction.atomic():
            account = (
                Account.objects.select_for_update()
                .filter(pk=request.user.pk, status=Account.Status.ACTIVE)
                .first()
            )
            if account is None:
                return Response(
                    {
                        "detail": "Account changed while ending the evening.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            evening = (
                PartyEvening.objects.select_for_update(of=("self",))
                .filter(pk=optimistic_evening.pk, host=account)
                .first()
            )
            if not evening:
                return Response(
                    {"detail": "Party evening not found.", "code": "party_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if evening.active:
                evening.active = False
                evening.ended_at = timezone.now()
                evening.save(update_fields=["active", "ended_at", "updated_at"])
            payload = _serialize_evening(evening, account)
        return Response(payload)


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
        if not request.user.share_drinks_with_parta:
            return Response(
                {
                    "detail": "Turn on drink sharing before sharing a drink.",
                    "code": "drink_sharing_disabled",
                },
                status=status.HTTP_409_CONFLICT,
            )
        data = serializer.validated_data
        optimistic_host_id = evening.host_id
        with transaction.atomic():
            locked_accounts = _lock_accounts_in_pk_order(
                {request.user.pk, optimistic_host_id}
            )
            host = locked_accounts.get(optimistic_host_id)
            account = locked_accounts.get(request.user.pk)
            if host is None or account is None or account.status != Account.Status.ACTIVE:
                return Response(
                    {
                        "detail": "Account changed while sharing a drink.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            locked_evening = (
                PartyEvening.objects.select_for_update(of=("self",))
                .select_related("host")
                .filter(pk=evening.pk, host_id=optimistic_host_id)
                .first()
            )
            if (
                locked_evening is None
                or not locked_evening.active
                or not _can_access(locked_evening, account)
            ):
                return Response(
                    {"detail": "Party evening is not active.", "code": "party_not_active"},
                    status=status.HTTP_409_CONFLICT,
                )
            if account.ghost_mode:
                return Response(
                    {
                        "detail": "Turn off ghost mode before sharing a drink.",
                        "code": "ghost_mode",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if not account.share_drinks_with_parta:
                return Response(
                    {
                        "detail": "Turn on drink sharing before sharing a drink.",
                        "code": "drink_sharing_disabled",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            drink, created = PartyEveningDrink.objects.update_or_create(
                account=account,
                client_id=data["client_id"],
                defaults={
                    "evening": locked_evening,
                    "beer_name": data["beer_name"],
                    "quantity": data["quantity"],
                    "shared_at": data.get("shared_at") or timezone.now(),
                },
            )
        return Response(
            {"drink_id": str(drink.id), "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Games
#
# The shape here is one contract for two transports. A client asks for
# everything after the cursor it already has; whether that answer arrives as a
# single JSON response or as frames on an open stream is the transport's
# business, not the client's. A reconnect is therefore not a special case — it
# is the same `since` the app used on first load, which is what keeps a dropped
# connection in a pub from being a bug report.
# ---------------------------------------------------------------------------


def _game_roster_profiles(game: PartyGame, viewer: Account) -> list[dict]:
    """The frozen lobby roster, filtered only by current privacy state.

    Active membership is deliberately not part of this read. Somebody leaving
    the table after question two must remain an entrant in the game that already
    started; somebody joining at question three must not appear in it.

    An empty snapshot is meaningful: the game is visible on the table, but its
    lobby has not bound a roster yet. Migration 0107 populated every legacy row,
    so no read-time fallback is needed and another phone cannot accidentally
    make a pending lobby look started.
    """
    snapshot = [str(value) for value in (game.roster_account_ids or [])]
    memberships = list(_visible_participant_rows(game.evening, viewer))
    profiles = {
        str(membership.account.public_id): _profile(membership.account)
        for membership in memberships
    }
    return [profiles[account_id] for account_id in snapshot if account_id in profiles]


def _serialize_game(game: PartyGame, viewer: Account) -> dict:
    return {
        "id": str(game.public_id),
        "catalog_key": game.catalog_key,
        "name": game.name,
        "scoring": game.scoring,
        "started_by": _profile(game.started_by),
        "roster": _game_roster_profiles(game, viewer),
        "started_at": game.started_at.isoformat(),
        "ended_at": game.ended_at.isoformat() if game.ended_at else None,
        # Known before an offline local-id -> server-id remap. Prompt decks use
        # it to deal the same order on every phone and after a cold restart.
        "seed": game.seed,
    }


def _game_payload_requires_redaction(
    game: PartyGame,
    visible_public_ids: set[str],
    all_participant_public_ids: set[str],
) -> bool:
    """Fail closed when an opaque payload may name a currently hidden entrant."""
    snapshot = {str(account_id) for account_id in (game.roster_account_ids or [])}
    if game.payloads_redacted:
        return True
    if snapshot:
        return not snapshot.issubset(visible_public_ids)
    # A legacy/unbound game has no safe identity scope. If this viewer cannot
    # see every table participant, its opaque payload must not cross the block,
    # ghost-mode or pending-deletion boundary.
    return not all_participant_public_ids.issubset(visible_public_ids)


def _game_identity_ids_for_accounts(account_ids: set[int]) -> set[str]:
    """Current and retired UUIDs that resolve to viewer-visible accounts."""
    return {
        *(
            str(public_id)
            for public_id in Account.objects.filter(pk__in=account_ids).values_list(
                "public_id",
                flat=True,
            )
        ),
        *(
            str(public_id)
            for public_id in AccountIdentityAlias.objects.filter(
                account_id__in=account_ids
            ).values_list("public_id", flat=True)
        ),
    }


def _evening_participant_public_ids(evening: PartyEvening) -> set[str]:
    return {
        str(public_id)
        for public_id in evening.memberships.values_list(
            "account__public_id",
            flat=True,
        )
    }


def _serialize_game_event(
    event: PartyGameEvent,
    *,
    redact_payload: bool = False,
) -> dict:
    return {
        # The row id IS the cursor. Clients store the highest one they have seen
        # and hand it straight back as `since`.
        "cursor": event.id,
        # Additive correlation for optimistic local folds.  A phone can replace
        # its queued copy with this echo without guessing from timestamps.
        "client_id": str(event.client_id),
        "game_id": str(event.game.public_id),
        "kind": event.kind,
        "account": _profile(event.account),
        "subject": _profile(event.subject) if event.subject else None,
        "delta": event.delta,
        "payload": {} if redact_payload else event.payload,
        "at": event.created_at.isoformat(),
    }


def _finish_superseded_games(
    evening: PartyEvening,
    selected_game: PartyGame | None,
) -> None:
    """Leave at most one unfinished game and publish that switch to every phone."""
    if selected_game is not None and selected_game.ended_at is not None:
        return
    switched_at = timezone.now()
    superseded_query = evening.games.select_for_update().filter(ended_at__isnull=True)
    if selected_game is not None:
        superseded_query = superseded_query.exclude(pk=selected_game.pk)
    superseded_games = list(superseded_query.order_by("started_at", "id"))
    for superseded in superseded_games:
        superseded.ended_at = switched_at
        superseded.save(update_fields=["ended_at"])
        PartyGameEvent.objects.get_or_create(
            game=superseded,
            client_id=uuid.uuid5(
                superseded.client_id,
                "na-pivo-party-game-superseded",
            ),
            defaults={
                # Keep the system finish visible to every viewer who could
                # already see the old game, even when they block the person
                # who selected its replacement.
                "account": superseded.started_by,
                "kind": PartyGameEvent.Kind.FINISH,
                "created_at": switched_at,
            },
        )


def _party_photo_url(photo: BeerPhoto, request: Request) -> str | None:
    try:
        return request.build_absolute_uri(photo.image.url)
    except AttributeError, ValueError:
        return None


def _party_pub(cache_key: str | None, name: str, city: str) -> dict | None:
    if not cache_key and not name and not city:
        return None
    return {
        "cache_key": cache_key or None,
        "name": name or None,
        "city": city or None,
    }


def _serialize_party_record(evening: PartyEvening, viewer: Account, request: Request) -> dict:
    """Build the private table record from source rows; never persist totals.

    Prices and phone coordinates deliberately never enter this shape. The
    record is members-only and may contain individual drink names because it is
    the table's private recap, not a PublishedNight payload.
    """
    participants, participants_truncated = _limited_rows(
        _visible_participant_rows(evening, viewer),
        PARTY_RECORD_MAX_PARTICIPANTS,
    )
    if not any(membership.account_id == viewer.pk for membership in participants):
        viewer_membership = (
            _visible_participant_rows(evening, viewer).filter(account=viewer).first()
        )
        if viewer_membership is not None:
            if participants:
                participants[-1] = viewer_membership
            else:
                participants.append(viewer_membership)
    participant_ids = {membership.account_id for membership in participants}
    profiles = {membership.account_id: _profile(membership.account) for membership in participants}
    visible_public_ids = _game_identity_ids_for_accounts(participant_ids)
    all_participant_public_ids = _evening_participant_public_ids(evening)

    visits, stops_truncated = _limited_rows(
        evening.party_visits.select_related("account")
        .filter(account_id__in=participant_ids)
        .order_by("started_at", "id"),
        PARTY_RECORD_MAX_STOPS,
    )
    stop_ids = {visit.pk: f"visit:{visit.account.public_id}:{visit.client_id}" for visit in visits}
    stops = [
        {
            "id": stop_ids[visit.pk],
            "by": str(visit.account.public_id),
            "account": profiles[visit.account_id],
            "pub_name": visit.name,
            "pub_city": visit.city or None,
            "cache_key": visit.cache_key,
            "arrived_at": visit.started_at.isoformat(),
            "left_at": visit.ended_at.isoformat() if visit.ended_at else None,
        }
        for visit in visits
    ]
    visits_by_account: dict[int, list[PubVisit]] = {}
    for visit in visits:
        visits_by_account.setdefault(visit.account_id, []).append(visit)

    def matching_stop_id(account_id: int, at, cache_key: str | None) -> str | None:
        if not cache_key:
            return None
        candidates = [
            visit
            for visit in visits_by_account.get(account_id, [])
            if visit.cache_key == cache_key
            and visit.started_at <= at
            and (visit.ended_at is None or at <= visit.ended_at)
        ]
        if not candidates:
            return None
        return stop_ids[max(candidates, key=lambda visit: visit.started_at).pk]

    drink_candidates: list[dict] = []
    diary_drinks, diary_drinks_truncated = _limited_rows(
        evening.logged_drinks.select_related("account")
        .filter(
            account_id__in=participant_ids,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
        )
        .filter(_drink_visible_to_viewer(viewer))
        .order_by("drank_at", "id"),
        PARTY_RECORD_MAX_DRINKS,
    )
    for drink in diary_drinks:
        drink_candidates.append(
            {
                "id": str(drink.client_id),
                "source": "diary",
                "at": drink.drank_at.isoformat(),
                "by": str(drink.account.public_id),
                "account": profiles[drink.account_id],
                "beer_name": drink.beer_name,
                "drink_type": drink.drink_type,
                "volume_ml": drink.volume_ml,
                "place_context": drink.place_context,
                "stop_id": matching_stop_id(
                    drink.account_id,
                    drink.drank_at,
                    drink.cache_key,
                ),
                "pub": _party_pub(drink.cache_key, drink.name, drink.city),
            }
        )

    legacy_drinks, legacy_rows_truncated = _limited_rows(
        evening.shared_drinks.select_related("account")
        .filter(
            account_id__in=participant_ids,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
        )
        .filter(_drink_visible_to_viewer(viewer))
        .order_by("shared_at", "id"),
        PARTY_RECORD_MAX_DRINKS,
    )
    legacy_candidates: list[dict] = []
    legacy_expansion_truncated = False
    for drink in legacy_drinks:
        available = PARTY_RECORD_MAX_DRINKS + 1 - len(legacy_candidates)
        if available <= 0:
            legacy_expansion_truncated = True
            break
        included_quantity = min(drink.quantity, available)
        if included_quantity < drink.quantity:
            legacy_expansion_truncated = True
        for index in range(included_quantity):
            legacy_candidates.append(
                {
                    "id": f"legacy:{drink.client_id}:{index}",
                    "source": "legacy_party",
                    "at": drink.shared_at.isoformat(),
                    "by": str(drink.account.public_id),
                    "account": profiles[drink.account_id],
                    "beer_name": drink.beer_name,
                    "drink_type": DrinkLog.DrinkType.BEER,
                    "volume_ml": None,
                    "place_context": DrinkLog.PlaceContext.PUB,
                    "stop_id": None,
                    "pub": None,
                }
            )
    drink_candidates.extend(legacy_candidates)
    drink_candidates.sort(key=lambda item: (item["at"], item["id"]))
    drinks_truncated = (
        diary_drinks_truncated
        or legacy_rows_truncated
        or legacy_expansion_truncated
        or len(drink_candidates) > PARTY_RECORD_MAX_DRINKS
    )
    drinks = drink_candidates[:PARTY_RECORD_MAX_DRINKS]

    photo_rows, photos_truncated = _limited_rows(
        evening.party_photos.select_related("account")
        .filter(
            account_id__in=participant_ids,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
        )
        .filter(
            Q(visibility=BeerPhoto.Visibility.FRIENDS)
            | Q(account=viewer, visibility=BeerPhoto.Visibility.PRIVATE)
        )
        .order_by("taken_at", "id"),
        PARTY_RECORD_MAX_PHOTOS,
    )
    photos = [
        {
            "id": str(photo.public_id),
            "url": _party_photo_url(photo, request),
            "caption": photo.caption,
            "at": photo.taken_at.isoformat(),
            "by": str(photo.account.public_id),
            "account": profiles[photo.account_id],
            "stop_id": matching_stop_id(
                photo.account_id,
                photo.taken_at,
                photo.pub_cache_key or None,
            ),
            "pub": _party_pub(photo.pub_cache_key, photo.pub_name, photo.pub_city),
        }
        for photo in photo_rows
    ]

    game_rows, games_truncated = _limited_rows(
        evening.games.select_related("started_by")
        .filter(started_by_id__in=participant_ids)
        .order_by("started_at", "id"),
        PARTY_RECORD_MAX_GAMES,
    )
    game_events: dict[int, list[PartyGameEvent]] = {game.pk: [] for game in game_rows}
    game_events_truncated = False
    if game_rows:
        event_rows, game_events_truncated = _limited_rows(
            PartyGameEvent.objects.filter(
                game_id__in=game_events,
                account_id__in=participant_ids,
            )
            .filter(Q(subject_id__isnull=True) | Q(subject_id__in=participant_ids))
            .select_related("game", "account", "subject")
            .order_by("id"),
            PARTY_RECORD_MAX_GAME_EVENTS,
        )
        for event in event_rows:
            game_events[event.game_id].append(event)

    games: list[dict] = []
    finish_by_game: dict[int, PartyGameEvent] = {}
    for game in game_rows:
        events = game_events[game.pk]
        redact_payload = _game_payload_requires_redaction(
            game,
            visible_public_ids,
            all_participant_public_ids,
        )
        finish = next(
            (event for event in reversed(events) if event.kind == PartyGameEvent.Kind.FINISH),
            None,
        )
        if finish is not None:
            finish_by_game[game.pk] = finish
        games.append(
            {
                "id": str(game.public_id),
                "key": game.catalog_key,
                "name": game.name,
                "scoring": game.scoring,
                "started_by": profiles.get(game.started_by_id, _profile(None)),
                "started_at": game.started_at.isoformat(),
                "ended_at": game.ended_at.isoformat() if game.ended_at else None,
                "result": (
                    {} if redact_payload else finish.payload
                ) if finish is not None else None,
                "events": [
                    _serialize_game_event(event, redact_payload=redact_payload)
                    for event in events
                ],
            }
        )

    timeline: list[dict] = []
    for membership in participants:
        profile = profiles[membership.account_id]
        timeline.append(
            {
                "id": f"join:{membership.id}",
                "kind": "joined",
                "at": membership.joined_at.isoformat(),
                "account": profile,
            }
        )
        if membership.left_at is not None:
            timeline.append(
                {
                    "id": f"left:{membership.id}",
                    "kind": "left",
                    "at": membership.left_at.isoformat(),
                    "account": profile,
                }
            )
    timeline.extend(
        {
            "id": f"drink:{drink['id']}",
            "kind": "drink",
            "at": drink["at"],
            "account": drink["account"],
            "drink": drink,
        }
        for drink in drinks
    )
    timeline.extend(
        {
            "id": f"photo:{photo['id']}",
            "kind": "photo",
            "at": photo["at"],
            "account": photo["account"],
            "photo": photo,
        }
        for photo in photos
    )
    timeline.extend(
        {
            "id": f"visit:{stop['id']}",
            "kind": "visit",
            "at": stop["arrived_at"],
            "account": stop["account"],
            "stop": stop,
        }
        for stop in stops
    )
    for game, game_item in zip(game_rows, games, strict=True):
        timeline.append(
            {
                "id": f"game:{game.public_id}:start",
                "kind": "game_started",
                "at": game_item["started_at"],
                "account": game_item["started_by"],
                "game": game_item,
            }
        )
        finish = finish_by_game.get(game.pk)
        if finish is not None:
            timeline.append(
                {
                    "id": f"game:{game.public_id}:finish:{finish.id}",
                    "kind": "game_finished",
                    "at": finish.created_at.isoformat(),
                    "account": _profile(finish.account),
                    "game": game_item,
                    "result": game_item["result"],
                }
            )
    timeline.sort(key=lambda event: (event["at"], event["id"]))
    timeline_truncated = len(timeline) > PARTY_RECORD_MAX_TIMELINE_EVENTS
    timeline = timeline[:PARTY_RECORD_MAX_TIMELINE_EVENTS]

    return {
        "id": str(evening.public_id),
        "code": evening.join_code,
        "active": evening.active,
        "started_at": evening.started_at.isoformat(),
        "ended_at": evening.ended_at.isoformat() if evening.ended_at else None,
        "participants": [_serialize_participant(membership) for membership in participants],
        "stops": stops,
        "drinks": drinks,
        "games": games,
        "photos": photos,
        "events": timeline,
        "truncated": {
            "participants": participants_truncated,
            "stops": stops_truncated,
            "drinks": drinks_truncated,
            "photos": photos_truncated,
            "games": games_truncated,
            "game_events": game_events_truncated,
            "events": timeline_truncated,
        },
    }


class PartyEveningRecordView(APIView):
    """GET /v1/party-evenings/<code>/record — private derived recap data."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request, code: str) -> Response:
        evening = _record_evening(code, request.user)
        if not evening:
            return Response(
                {"detail": "Party evening not found.", "code": "party_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_serialize_party_record(evening, request.user, request))


def _visible_party_account_ids(evening: PartyEvening, viewer: Account) -> set[int]:
    return set(_visible_participant_rows(evening, viewer).values_list("account_id", flat=True))


def _visible_game_event_rows(
    evening: PartyEvening,
    participant_ids: set[int],
):
    return (
        PartyGameEvent.objects.filter(
            game__evening=evening,
            game__started_by_id__in=participant_ids,
        )
        # account=NULL means the real author was purged. Never resurrect that
        # person's answers, actions or result payload through another visible
        # participant's game.
        .filter(account_id__in=participant_ids)
        .filter(Q(subject_id__isnull=True) | Q(subject_id__in=participant_ids))
        .select_related("game", "account", "subject")
    )


def game_events_since(
    evening: PartyEvening,
    viewer: Account,
    since: int,
    limit: int = 200,
    *,
    participant_ids: set[int] | None = None,
) -> list[PartyGameEvent]:
    """Visible events after ``since``; blocked or hidden profiles never serialize."""
    if participant_ids is None:
        participant_ids = _visible_party_account_ids(evening, viewer)
    return list(
        _visible_game_event_rows(evening, participant_ids)
        .filter(id__gt=since)
        .order_by("id")[:limit]
    )


class PartyGameCollectionView(APIView):
    """`GET` catches up, `POST` puts a game on the table."""

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
        try:
            since = int(request.query_params.get("since") or 0)
        except ValueError:
            since = 0

        participant_ids = _visible_party_account_ids(evening, request.user)
        visible_public_ids = _game_identity_ids_for_accounts(participant_ids)
        all_participant_public_ids = _evening_participant_public_ids(evening)
        events = game_events_since(
            evening,
            request.user,
            since,
            participant_ids=participant_ids,
        )
        games = evening.games.select_related("started_by", "evening").filter(
            started_by_id__in=participant_ids
        )
        if since:
            # After the first load the client already has the games it knows
            # about; only games represented in this visible catch-up batch need
            # to come down with their events.
            games = games.filter(pk__in={event.game_id for event in events})
        games = games.order_by("started_at", "id")
        latest = _visible_game_event_rows(evening, participant_ids).order_by("-id").first()
        return Response(
            {
                "cursor": events[-1].id if events else (latest.id if latest else since),
                "games": [_serialize_game(game, request.user) for game in games],
                "events": [
                    _serialize_game_event(
                        event,
                        redact_payload=_game_payload_requires_redaction(
                            event.game,
                            visible_public_ids,
                            all_participant_public_ids,
                        ),
                    )
                    for event in events
                ],
            }
        )

    def post(self, request: Request, code: str) -> Response:
        serializer = PartyGameCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        evening = _member_evening(code, request.user)
        if not evening or not evening.active:
            return Response(
                {"detail": "Party evening is not active.", "code": "party_not_active"},
                status=status.HTTP_409_CONFLICT,
            )
        data = serializer.validated_data
        optimistic_host_id = evening.host_id
        optimistic_starter_ids = set(
            evening.games.exclude(started_by_id__isnull=True).values_list(
                "started_by_id",
                flat=True,
            )
        )
        requested_roster_ids = data.get("roster_ids")
        optimistic_roster_accounts = (
            _roster_accounts_by_requested_id(requested_roster_ids)
            if requested_roster_ids is not None
            else {}
        )
        optimistic_roster_account_ids = {
            account.pk for account in optimistic_roster_accounts.values()
        }
        # The whole table plays one copy of a catalogue game per evening. Lock
        # every Account FK before the parent so login/delete cannot deadlock a
        # game start. Then the parent makes two phones opening the same game
        # converge without a legacy-breaking schema change.
        with transaction.atomic():
            account_ids = {
                optimistic_host_id,
                request.user.pk,
                *optimistic_starter_ids,
                *optimistic_roster_account_ids,
            }
            locked_accounts = _lock_accounts_in_pk_order(account_ids)
            locked_host = locked_accounts.get(optimistic_host_id)
            account = locked_accounts.get(request.user.pk)
            if (
                locked_host is None
                or account is None
                or account.status != Account.Status.ACTIVE
                or not optimistic_starter_ids.issubset(locked_accounts)
                or not optimistic_roster_account_ids.issubset(locked_accounts)
            ):
                return Response(
                    {
                        "detail": "Account changed while starting the game.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if (
                locked_host.status != Account.Status.ACTIVE
                or account.ghost_mode
            ):
                return Response(
                    {"detail": "Party evening is not active.", "code": "party_not_active"},
                    status=status.HTTP_409_CONFLICT,
                )
            locked_evening = (
                PartyEvening.objects.select_for_update(of=("self",))
                .select_related("host")
                .filter(pk=evening.pk)
                .first()
            )
            if locked_evening is None or locked_evening.host_id != optimistic_host_id:
                return Response(
                    {
                        "detail": "Evening changed while starting the game.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            current_starter_ids = set(
                locked_evening.games.exclude(started_by_id__isnull=True).values_list(
                    "started_by_id",
                    flat=True,
                )
            )
            if not current_starter_ids.issubset(locked_accounts):
                return Response(
                    {
                        "detail": "Game changed while starting the game.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if (
                not locked_evening.active
                or not _can_access(locked_evening, account)
            ):
                return Response(
                    {"detail": "Party evening is not active.", "code": "party_not_active"},
                    status=status.HTTP_409_CONFLICT,
                )
            participant_ids = _visible_party_account_ids(locked_evening, account)
            canonical_requested_roster_ids: list[str] | None = None
            if requested_roster_ids is not None:
                canonical_requested_roster_ids, missing_roster_ids = _canonical_roster_ids(
                    requested_roster_ids,
                    locked_accounts,
                )
                if missing_roster_ids:
                    return Response(
                        {
                            "detail": "Sestava obsahuje někoho, kdo už u stolu není.",
                            "code": "roster_member_not_active",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
            game = (
                locked_evening.games.filter(catalog_key=data["catalog_key"])
                .order_by("started_at", "id")
                .first()
            )
            if game is None:
                # Preserve released idempotency if a buggy retry changed its
                # catalogue payload while keeping the same client UUID.
                game = locked_evening.games.filter(client_id=data["client_id"]).first()
            created = game is None
            roster_bound = False
            if game is None:
                # Close the current game before inserting the replacement. The
                # database also enforces one unfinished game per evening, so
                # this order matters on every supported database.
                _finish_superseded_games(locked_evening, None)
                active_memberships = list(
                    _visible_participant_rows(locked_evening, account)
                    # Only membership rows are mutated/used for the frozen
                    # roster. Locking joined Account rows here would invert the
                    # global Account -> Evening order after Evening is already
                    # locked and can deadlock a concurrent merge or deletion.
                    .select_for_update(of=("self",))
                    .filter(active=True)
                )
                active_roster_ids = [
                    str(membership.account.public_id)
                    for membership in active_memberships
                ]
                if canonical_requested_roster_ids is not None:
                    roster_account_ids = canonical_requested_roster_ids
                    unknown_ids = set(roster_account_ids) - set(active_roster_ids)
                    if unknown_ids:
                        return Response(
                            {
                                "detail": "Sestava obsahuje někoho, kdo už u stolu není.",
                                "code": "roster_member_not_active",
                            },
                            status=status.HTTP_409_CONFLICT,
                        )
                else:
                    # Released clients have no lobby field on the wire. The
                    # server still freezes one canonical roster so every newer
                    # phone sees the same entrants.
                    roster_account_ids = active_roster_ids if len(active_roster_ids) >= 2 else []
                game = PartyGame.objects.create(
                    evening=locked_evening,
                    client_id=data["client_id"],
                    started_by=account,
                    catalog_key=data["catalog_key"],
                    name=data["name"],
                    scoring=data["scoring"],
                    seed=party_game_seed(
                        locked_evening.join_code,
                        data["catalog_key"],
                    ),
                    roster_account_ids=roster_account_ids,
                    started_at=bounded_client_time(
                        data.get("started_at"),
                        future_grace=CLIENT_FUTURE_GRACE,
                    ),
                )
            elif game.ended_at is None and (
                not game.roster_account_ids or _roster_needs_repair(game.roster_account_ids)
            ):
                # A new client first places the game with an explicit empty
                # roster, then the first confirmed lobby binds it. Locking the
                # evening above makes that first non-empty selection win even
                # when two phones open the lobby together. Released clients
                # omit the field, so they still get the whole active table.
                requested_roster = canonical_requested_roster_ids
                if requested_roster is None:
                    requested_roster = [
                        membership.account.public_id
                        for membership in _visible_members(locked_evening, account)
                    ]
                roster_account_ids = [str(value) for value in requested_roster]
                if len(roster_account_ids) == 1:
                    roster_account_ids = []
                roster_account_ids = list(dict.fromkeys(roster_account_ids))[:64]
                if roster_account_ids:
                    active_roster_ids = {
                        str(membership.account.public_id)
                        for membership in _visible_participant_rows(
                            locked_evening,
                            account,
                        ).filter(active=True)
                    }
                    unknown_ids = set(roster_account_ids) - active_roster_ids
                    if unknown_ids:
                        return Response(
                            {
                                "detail": "Sestava obsahuje někoho, kdo už u stolu není.",
                                "code": "roster_member_not_active",
                            },
                            status=status.HTTP_409_CONFLICT,
                        )
                    game.roster_account_ids = roster_account_ids
                    game.save(update_fields=["roster_account_ids"])
                    roster_bound = True
            if not created:
                _finish_superseded_games(locked_evening, game)
            # The event id is the shared cursor. Without an event, a game row
            # created after another phone's initial catch-up is invisible until
            # somebody actually plays. A deterministic system event makes the
            # creation observable through the existing SSE/catch-up contract
            # and keeps retries free. Old clients parse unknown kinds as a
            # zero-delta score, which is intentionally harmless.
            PartyGameEvent.objects.get_or_create(
                game=game,
                client_id=uuid.uuid5(game.client_id, "na-pivo-party-game-start"),
                defaults={
                    "account": game.started_by,
                    "kind": PartyGameEvent.Kind.START,
                    "created_at": game.started_at,
                },
            )
            if roster_bound:
                # Updating the frozen roster must move the same cursor that
                # drives both JSON catch-up and SSE. Reusing ``start`` is
                # deliberate: released clients already understand it as a
                # harmless zero-delta system envelope, while the new event id
                # makes the updated game snapshot observable immediately.
                PartyGameEvent.objects.get_or_create(
                    game=game,
                    client_id=uuid.uuid5(
                        game.client_id,
                        "na-pivo-party-game-roster-bound",
                    ),
                    defaults={
                        "account": game.started_by,
                        "kind": PartyGameEvent.Kind.START,
                    },
                )
            if game.started_by_id not in participant_ids:
                return Response(
                    {"detail": "Game not found.", "code": "game_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            payload = _serialize_game(game, account)
        return Response(
            payload,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PartyGameEventView(APIView):
    """Appending to a game: scores, and the one event that ends it."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, code: str, game_id: str) -> Response:
        serializer = PartyGameEventBatchSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        evening = _member_evening(code, request.user)
        if not evening or not evening.active:
            return Response(
                {"detail": "Party evening is not active.", "code": "party_not_active"},
                status=status.HTTP_409_CONFLICT,
            )
        participant_ids = _visible_party_account_ids(evening, request.user)
        game = evening.games.filter(
            public_id=game_id,
            started_by_id__in=participant_ids,
        ).first()
        if game is None:
            game = (
                PartyGame.objects.filter(
                    aliases__public_id=game_id,
                    evening=evening,
                    started_by_id__in=participant_ids,
                )
                .order_by("pk")
                .first()
            )
        if not game:
            return Response(
                {"detail": "Game not found.", "code": "game_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        optimistic_members = {
            str(member.account.public_id): member.account
            for member in _visible_participants(evening, request.user)
        }
        requested_subject_ids = {
            item["subject_id"]
            for item in serializer.validated_data["events"]
            if item.get("subject_id")
        }
        unknown_subject_ids = requested_subject_ids - {
            uuid.UUID(public_id) for public_id in optimistic_members
        }
        if unknown_subject_ids:
            optimistic_members.update(
                {
                    str(alias.public_id): alias.account
                    for alias in AccountIdentityAlias.objects.select_related("account")
                    .filter(
                        public_id__in=unknown_subject_ids,
                        account_id__in={
                            member.pk for member in optimistic_members.values()
                        },
                    )
                }
            )
        optimistic_subject_ids = {
            subject.pk
            for item in serializer.validated_data["events"]
            if item.get("subject_id")
            if (subject := optimistic_members.get(str(item["subject_id"]))) is not None
        }
        optimistic_host_id = evening.host_id

        written: list[PartyGameEvent] = []
        with transaction.atomic():
            account_ids = {
                optimistic_host_id,
                request.user.pk,
                *optimistic_subject_ids,
            }
            locked_accounts = _lock_accounts_in_pk_order(account_ids)
            # A merge can retire a subject after the optimistic roster read but
            # before these locks. Never acknowledge that durable score as an
            # empty success: the next retry will resolve its new identity alias.
            if not optimistic_subject_ids.issubset(locked_accounts):
                return Response(
                    {
                        "detail": "Account changed while saving the game.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            locked_host = locked_accounts.get(optimistic_host_id)
            account = locked_accounts.get(request.user.pk)
            if (
                locked_host is None
                or account is None
                or account.status != Account.Status.ACTIVE
            ):
                return Response(
                    {
                        "detail": "Account changed while saving the game.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if (
                locked_host.status != Account.Status.ACTIVE
                or account.ghost_mode
            ):
                return Response(
                    {"detail": "Party evening is not active.", "code": "party_not_active"},
                    status=status.HTTP_409_CONFLICT,
                )
            locked_evening = (
                PartyEvening.objects.select_for_update(of=("self",))
                .select_related("host")
                .filter(pk=evening.pk)
                .first()
            )
            if locked_evening is None or locked_evening.host_id != optimistic_host_id:
                return Response(
                    {
                        "detail": "Evening changed while saving the game.",
                        "code": "auth",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            if (
                not locked_evening.active
                or not _can_access(locked_evening, account)
            ):
                return Response(
                    {"detail": "Party evening is not active.", "code": "party_not_active"},
                    status=status.HTTP_409_CONFLICT,
                )
            participant_ids = _visible_party_account_ids(locked_evening, account)
            locked_game_id = (
                PartyGame.objects.filter(
                    public_id=game_id,
                    evening=locked_evening,
                )
                .values_list("pk", flat=True)
                .first()
            )
            if locked_game_id is None:
                locked_game_id = (
                    PartyGameAlias.objects.filter(
                        public_id=game_id,
                        game__evening=locked_evening,
                    )
                    .values_list("game_id", flat=True)
                    .first()
                )
            locked_game = (
                PartyGame.objects.select_for_update(of=("self",))
                .filter(pk=locked_game_id, evening=locked_evening)
                .first()
                if locked_game_id is not None
                else None
            )
            if locked_game is None or locked_game.started_by_id not in participant_ids:
                return Response(
                    {"detail": "Game not found.", "code": "game_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            participant_memberships = _visible_participants(locked_evening, account)
            frozen_roster_ids = {
                str(value) for value in (locked_game.roster_account_ids or [])
            }
            roster_ids = frozen_roster_ids or {
                str(member.account.public_id)
                for member in participant_memberships
                if member.active
            }
            roster_account_ids = {
                member.account_id
                for member in participant_memberships
                if str(member.account.public_id) in roster_ids
            }
            payload_identity_aliases = {
                str(alias.public_id): str(alias.account.public_id)
                for alias in AccountIdentityAlias.objects.select_related("account").filter(
                    account_id__in=roster_account_ids,
                )
            }
            # Scores may still name somebody who left after the game began. New
            # table members, on the other hand, do not join a quiz halfway through.
            members = {
                str(member.account.public_id): member.account
                for member in participant_memberships
                if str(member.account.public_id) in roster_ids
                and member.account_id in locked_accounts
            }
            stale_subject_ids = requested_subject_ids - {
                uuid.UUID(public_id) for public_id in members
            }
            if stale_subject_ids:
                for alias in AccountIdentityAlias.objects.filter(
                    public_id__in=stale_subject_ids,
                    account_id__in={member.pk for member in members.values()},
                ):
                    canonical_account = locked_accounts.get(alias.account_id)
                    if canonical_account is not None:
                        members[str(alias.public_id)] = canonical_account
            requester_is_entrant = str(account.public_id) in roster_ids
            requester_is_bound_entrant = str(account.public_id) in frozen_roster_ids
            outside_frozen_roster = (
                bool(frozen_roster_ids) and not requester_is_bound_entrant
            )
            candidate_items = []
            for item in serializer.validated_data["events"]:
                if outside_frozen_roster:
                    continue
                subject = (
                    members.get(str(item.get("subject_id")))
                    if item.get("subject_id")
                    else None
                )
                if item["kind"] == "score" and subject is None:
                    continue
                if item["kind"] == "answer" and not requester_is_entrant:
                    continue
                if item["kind"] == "action" and not requester_is_bound_entrant:
                    continue
                canonical_item = {
                    **item,
                    "payload": (
                        {}
                        if locked_game.payloads_redacted
                        else _canonicalize_identity_aliases_in_json(
                            item.get("payload") or {},
                            payload_identity_aliases,
                        )
                    ),
                }
                candidate_items.append((canonical_item, subject))

            # A finished game is an immutable log. Returning a successful empty
            # acceptance keeps released offline queues idempotent while making
            # every later score/finish a no-op.
            if locked_game.ended_at is not None:
                candidate_items = []
            else:
                canonical_items = []
                for candidate in candidate_items:
                    canonical_items.append(candidate)
                    if candidate[0]["kind"] == PartyGameEvent.Kind.FINISH:
                        break
                candidate_items = canonical_items

            requested_ids = {item["client_id"] for item, _subject in candidate_items}
            existing_ids = set(
                locked_game.events.filter(client_id__in=requested_ids).values_list(
                    "client_id", flat=True
                )
            )
            new_event_count = len(requested_ids - existing_ids)
            # The one server-owned start envelope is transport bookkeeping, not
            # part of the player's event allowance.
            game_event_count = locked_game.events.exclude(
                kind=PartyGameEvent.Kind.START
            ).count()
            if (
                new_event_count
                and game_event_count + new_event_count > PARTY_GAME_EVENT_MAX_PER_GAME
            ):
                return Response(
                    {
                        "detail": "Tahle hra už má maximum událostí.",
                        "code": "game_event_limit_reached",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            evening_event_count = PartyGameEvent.objects.filter(
                game__evening=locked_evening
            ).exclude(kind=PartyGameEvent.Kind.START).count()
            if (
                new_event_count
                and evening_event_count + new_event_count > PARTY_GAME_EVENT_MAX_PER_EVENING
            ):
                return Response(
                    {
                        "detail": "Tenhle večer už má maximum herních událostí.",
                        "code": "evening_event_limit_reached",
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            seen_ids = set(existing_ids)
            client_now = timezone.now()
            for item, subject in candidate_items:
                if item["client_id"] in seen_ids:
                    continue
                try:
                    with transaction.atomic():
                        event = PartyGameEvent.objects.create(
                            game=locked_game,
                            account=account,
                            client_id=item["client_id"],
                            kind=item["kind"],
                            subject=subject,
                            delta=item.get("delta") or 0,
                            payload=item.get("payload") or {},
                            created_at=bounded_client_time(
                                item.get("created_at"),
                                now=client_now,
                                future_grace=CLIENT_FUTURE_GRACE,
                            ),
                        )
                except IntegrityError:
                    # Already have it. A retried event must not double-count,
                    # which is the whole reason `client_id` is on the row.
                    continue
                seen_ids.add(item["client_id"])
                written.append(event)
                if event.kind == PartyGameEvent.Kind.FINISH and locked_game.ended_at is None:
                    locked_game.ended_at = event.created_at
                    locked_game.save(update_fields=["ended_at"])
            latest = _visible_game_event_rows(
                locked_evening,
                participant_ids,
            ).order_by("-id").first()
            payload = {
                "cursor": latest.id if latest else 0,
                "accepted": [_serialize_game_event(event) for event in written],
            }
        return Response(
            payload,
            status=status.HTTP_201_CREATED if written else status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# The live stream
#
# Server-sent events rather than polling: one connection per phone instead of a
# request every few seconds, and the table sees a point land in about a second.
#
# Three things make this safe to run on a small box:
#
#   1. It is an ASYNC view. Under a sync worker an open stream owns that worker
#      until it closes, so two people watching a game would take the whole API
#      down. On the event loop a stream costs a socket; the only thread it
#      borrows is for the query itself, and only while the query runs.
#   2. Every stream ENDS. After `_STREAM_SECONDS` it closes and tells the client
#      to come back, which bounds how long anything can leak and makes deploys
#      drain instead of hang.
#   3. There is no Redis. The generator asks the database what is new, which is
#      polling — but once, on the server, against one indexed `id > cursor`
#      query, instead of a full authenticated HTTP round trip per phone per
#      tick. If tables ever outgrow that, this is the seam where a pub/sub goes
#      in, and neither the client nor the contract changes.
#
# The contract is identical to the JSON catch-up above: the client sends the
# cursor it has, we send everything after it. A reconnect is a `since`.
# ---------------------------------------------------------------------------

_STREAM_SECONDS = 600
_TICK_SECONDS = 1.0
PARTY_STREAM_MAX_CONNECTIONS_PER_ACCOUNT = 3
PARTY_STREAM_MAX_CONNECTIONS_PER_PROCESS = 32
_stream_connection_lock = Lock()
_stream_connection_counts: dict[int, int] = {}
_stream_connection_total = 0
#: A comment frame often enough that proxies do not decide the connection died.
_HEARTBEAT_SECONDS = 15.0

_stream_db_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="party-sse-db")


def _call_stream_db(operation, *args, **kwargs):
    """Run one stream DB operation with clean connections; return its result as-is.

    Must stay sync: the caller is expected to finish all ORM work and any
    serialization inside the worker thread and hand back plain data. Exceptions
    propagate unchanged to the awaiting caller.
    """

    close_old_connections()
    try:
        return operation(*args, **kwargs)
    finally:
        close_old_connections()


async def _run_stream_db(operation, *args, **kwargs):
    """Await `_call_stream_db` off the event loop in the shared stream executor."""

    return await sync_to_async(_call_stream_db, thread_sensitive=False, executor=_stream_db_executor)(
        operation, *args, **kwargs
    )


def _frame(name: str, payload: dict, cursor: int | None = None) -> bytes:
    head = f"id: {cursor}\n" if cursor is not None else ""
    return f"{head}event: {name}\ndata: {json.dumps(payload)}\n\n".encode()


def _account_for_stream(request) -> Account | None:
    """
    Bearer auth, called from an async view.

    DRF's `APIView.dispatch` is synchronous in 3.17, so an `async def get` on one
    returns a coroutine that DRF then tries to render as a response. This is a
    plain Django async view instead, which means authenticating by hand — the
    same `AccountTokenAuthentication` DRF would have run, just called directly.
    """
    # Wrapped in a DRF `Request`: the authenticator stamps the account id onto
    # `request._request` for the log line, which a bare `ASGIRequest` does not
    # have. Wrapping also keeps this the same code path DRF would have run.
    try:
        result = AccountTokenAuthentication().authenticate(Request(request))
    except AuthenticationFailed:
        return None
    return result[0] if result else None


class _PartyStreamThrottlePolicy:
    throttle_scope = "friends"


def _stream_handshake(request) -> tuple[Account | None, int | None]:
    """Authenticate and charge one shared throttle token for this connection."""

    drf_request = Request(request)
    try:
        result = AccountTokenAuthentication().authenticate(drf_request)
    except AuthenticationFailed:
        return None, None
    if result is None:
        return None, None
    account, _raw_token = result
    drf_request.user = account
    throttle = ScopedRateThrottle()
    if not throttle.allow_request(drf_request, _PartyStreamThrottlePolicy()):
        return account, throttle.wait()
    return account, None


def _acquire_stream_slot(account_id: int) -> bool:
    global _stream_connection_total
    with _stream_connection_lock:
        account_count = _stream_connection_counts.get(account_id, 0)
        if (
            account_count >= PARTY_STREAM_MAX_CONNECTIONS_PER_ACCOUNT
            or _stream_connection_total >= PARTY_STREAM_MAX_CONNECTIONS_PER_PROCESS
        ):
            return False
        _stream_connection_counts[account_id] = account_count + 1
        _stream_connection_total += 1
        return True


def _release_stream_slot(account_id: int) -> None:
    global _stream_connection_total
    with _stream_connection_lock:
        account_count = _stream_connection_counts.get(account_id, 0)
        if account_count <= 1:
            _stream_connection_counts.pop(account_id, None)
        else:
            _stream_connection_counts[account_id] = account_count - 1
        _stream_connection_total = max(0, _stream_connection_total - 1)


def _stream_access_context(
    code: str,
    account: Account,
) -> tuple[PartyEvening, set[int], set[str], set[str]] | None:
    """Authorize a stream tick in two queries, including current block state."""
    if account.ghost_mode:
        return None
    evening = (
        PartyEvening.objects.select_related("host")
        .filter(
            memberships__account=account,
            memberships__active=True,
        )
        .filter(
            Q(join_code=code.upper())
            | Q(codes__join_code=code.upper())
        )
        .filter(Q(host__isnull=True) | Q(host__status=Account.Status.ACTIVE, host__ghost_mode=False))
        .exclude(
            Q(host__blocks_made__blocked=account)
            | Q(host__blocks_received__blocker=account)
        )
        .distinct()
        .first()
    )
    if evening is None:
        return None
    membership_rows = evening.memberships.annotate(
        viewer_blocked=Exists(
            FriendBlock.objects.filter(
                Q(blocker_id=OuterRef("account_id"), blocked=account)
                | Q(blocked_id=OuterRef("account_id"), blocker=account)
            )
        )
    ).values_list(
        "account_id",
        "account__public_id",
        "account__status",
        "account__ghost_mode",
        "viewer_blocked",
        "account__identity_aliases__public_id",
    )
    participant_ids: set[int] = set()
    visible_public_ids: set[str] = set()
    all_participant_public_ids: set[str] = set()
    for (
        participant_id,
        public_id,
        account_status,
        ghost_mode,
        viewer_blocked,
        alias_public_id,
    ) in membership_rows:
        all_participant_public_ids.add(str(public_id))
        if (
            account_status != Account.Status.ACTIVE
            or ghost_mode
            or viewer_blocked
        ):
            continue
        participant_ids.add(participant_id)
        visible_public_ids.add(str(public_id))
        if alias_public_id is not None:
            visible_public_ids.add(str(alias_public_id))
    return (
        evening,
        participant_ids,
        visible_public_ids,
        all_participant_public_ids,
    )


def _probe_stream_event_cursor(evening_id: int, cursor: int) -> int | None:
    """Return the newest raw event ID after the cursor, used to wake the stream."""
    return (
        PartyGameEvent.objects.filter(
            game__evening_id=evening_id,
            id__gt=cursor,
        )
        .order_by("-id")
        .values_list("id", flat=True)
        .first()
    )


def _stream_game_events(request, code: str, cursor: int) -> list[tuple[int, dict]] | None:
    """Reauthenticate and reauthorize immediately before every stream query,
    then return fully serialized plain event data from inside the DB worker."""
    account = _account_for_stream(request)
    if account is None:
        return None
    context = _stream_access_context(code, account)
    if context is None:
        return None
    evening, participant_ids, visible_public_ids, all_participant_public_ids = context
    events = game_events_since(evening, account, cursor, participant_ids=participant_ids)
    return [
        (
            event.id,
            _serialize_game_event(
                event,
                redact_payload=_game_payload_requires_redaction(
                    event.game,
                    visible_public_ids,
                    all_participant_public_ids,
                ),
            ),
        )
        for event in events
    ]


async def party_game_stream(request, code: str):
    """`GET .../games/stream?since=<cursor>` — the same events, as they happen."""
    account, retry_after = await _run_stream_db(_stream_handshake, request)
    if account is None:
        return JsonResponse(
            {
                "detail": "Authentication credentials were not provided.",
                "code": "not_authenticated",
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if retry_after is not None:
        response = JsonResponse(
            {"detail": "Request was throttled.", "code": "throttled"},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
        response["Retry-After"] = str(retry_after)
        return response

    evening = await _run_stream_db(_member_evening, code, account)
    if not evening:
        return JsonResponse(
            {"detail": "Party evening not found.", "code": "party_not_found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not _acquire_stream_slot(account.pk):
        return JsonResponse(
            {"detail": "Too many live game streams.", "code": "stream_limit_reached"},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # `Last-Event-ID` is what the EventSource contract sends on its own
    # reconnect; `since` is what our client sends on a cold start. Taking both
    # means the app does not have to care which one it is.
    raw = request.headers.get("Last-Event-ID") or request.GET.get("since") or "0"
    try:
        cursor = int(raw)
    except ValueError:
        cursor = 0

    async def frames():
        nonlocal cursor
        try:
            started = time.monotonic()
            last_beat = started
            last_auth_check = started
            probe_cursor = cursor
            # The opening frame carries the cursor, so a client that reconnected
            # with a stale one learns immediately where it actually is.
            yield _frame("open", {"cursor": cursor})

            while time.monotonic() - started < _STREAM_SECONDS:
                detected_cursor = await _run_stream_db(
                    _probe_stream_event_cursor,
                    evening.id,
                    probe_cursor,
                )
                if detected_cursor is not None:
                    probe_cursor = detected_cursor
                now = time.monotonic()
                full_due = detected_cursor is not None or (
                    now - last_auth_check >= _HEARTBEAT_SECONDS
                )
                if full_due:
                    events = await _run_stream_db(
                        _stream_game_events,
                        request,
                        code,
                        cursor,
                    )
                    last_auth_check = time.monotonic()
                    # Tokens can be revoked and memberships/access can change while an
                    # SSE response is open. Stop before querying or serializing another
                    # event as soon as any of those checks fails.
                    if events is None:
                        return
                    for event_id, payload in events:
                        yield _frame("game_event", payload, cursor=event_id)
                    if events:
                        cursor = events[-1][0]
                        if len(events) == 200:
                            probe_cursor = cursor
                        else:
                            probe_cursor = max(probe_cursor, cursor)
                        last_beat = time.monotonic()
                    elif time.monotonic() - last_beat >= _HEARTBEAT_SECONDS:
                        yield b": beat\n\n"
                        last_beat = time.monotonic()
                await asyncio.sleep(_TICK_SECONDS)

            # Not an error: a bounded stream is how this stays cheap. The client
            # reconnects with the cursor it now holds and misses nothing.
            yield _frame("reconnect", {"cursor": cursor})
        finally:
            _release_stream_slot(account.pk)

    response = StreamingHttpResponse(frames(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    # Caddy and nginx both buffer proxied responses by default, which turns a
    # stream into one long silence followed by everything at once.
    response["X-Accel-Buffering"] = "no"
    return response

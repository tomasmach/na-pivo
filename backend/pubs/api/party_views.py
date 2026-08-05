import asyncio
import json
import time

from asgiref.sync import sync_to_async
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.party_serializers import (
    PartyEveningCreateSerializer,
    PartyEveningDrinkSerializer,
    PartyGameCreateSerializer,
    PartyGameEventBatchSerializer,
)
from pubs.models import (
    Account,
    FriendBlock,
    Friendship,
    PartyEvening,
    PartyEveningDrink,
    PartyEveningMember,
    PartyGame,
    PartyGameEvent,
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
        blocked_id if blocker_id == account.id else blocker_id for blocker_id, blocked_id in rows
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
    # The same evening, from the diary. Two sources, one timeline:
    #
    #   PartyEveningDrink   released apps, which POST a beer here as well as
    #                       into their diary. Untouched — they cannot be updated.
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


def _serialize_game(game: PartyGame) -> dict:
    return {
        "id": str(game.public_id),
        "catalog_key": game.catalog_key,
        "name": game.name,
        "scoring": game.scoring,
        "started_by": _profile(game.started_by),
        "started_at": game.started_at.isoformat(),
        "ended_at": game.ended_at.isoformat() if game.ended_at else None,
    }


def _serialize_game_event(event: PartyGameEvent) -> dict:
    return {
        # The row id IS the cursor. Clients store the highest one they have seen
        # and hand it straight back as `since`.
        "cursor": event.id,
        "game_id": str(event.game.public_id),
        "kind": event.kind,
        "account": _profile(event.account),
        "subject": _profile(event.subject) if event.subject else None,
        "delta": event.delta,
        "payload": event.payload,
        "at": event.created_at.isoformat(),
    }


def game_events_since(evening: PartyEvening, since: int, limit: int = 200) -> list[PartyGameEvent]:
    """Everything that happened in this evening's games after `since`, in order."""
    return list(
        PartyGameEvent.objects.filter(game__evening=evening, id__gt=since)
        .select_related("game", "account", "subject")
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

        events = game_events_since(evening, since)
        games = (
            evening.games.select_related("started_by").order_by("started_at", "id")
            if since == 0
            # After the first load the client already has the games it knows
            # about; only ones started since need to come down with the events.
            else evening.games.select_related("started_by")
            .filter(events__id__gt=since)
            .distinct()
            .order_by("started_at", "id")
        )
        latest = PartyGameEvent.objects.filter(game__evening=evening).order_by("-id").first()
        return Response(
            {
                "cursor": events[-1].id if events else (latest.id if latest else since),
                "games": [_serialize_game(game) for game in games],
                "events": [_serialize_game_event(event) for event in events],
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
        # Idempotent by (evening, client_id): a retry from a phone that never saw
        # our 201 must not put the same game on the table twice.
        game, created = PartyGame.objects.get_or_create(
            evening=evening,
            client_id=data["client_id"],
            defaults={
                "started_by": request.user,
                "catalog_key": data["catalog_key"],
                "name": data["name"],
                "scoring": data["scoring"],
                "started_at": data.get("started_at") or timezone.now(),
            },
        )
        return Response(
            _serialize_game(game),
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
        game = evening.games.filter(public_id=game_id).first()
        if not game:
            return Response(
                {"detail": "Game not found.", "code": "game_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        members = {
            str(member.account.public_id): member.account for member in _visible_members(evening)
        }
        written: list[PartyGameEvent] = []
        for item in serializer.validated_data["events"]:
            subject = members.get(str(item.get("subject_id"))) if item.get("subject_id") else None
            if item["kind"] == "score" and subject is None:
                # Scoring for somebody who is not at the table is not an error
                # worth failing the batch over — it is a stale phone. Skip it and
                # let the rest through, or one departed member jams the queue.
                continue
            try:
                with transaction.atomic():
                    event = PartyGameEvent.objects.create(
                        game=game,
                        account=request.user,
                        client_id=item["client_id"],
                        kind=item["kind"],
                        subject=subject,
                        delta=item.get("delta") or 0,
                        payload=item.get("payload") or {},
                        created_at=item.get("created_at") or timezone.now(),
                    )
            except IntegrityError:
                # Already have it. A retried event must not double-count, which
                # is the whole reason `client_id` is on the row.
                continue
            written.append(event)
            if event.kind == PartyGameEvent.Kind.FINISH and game.ended_at is None:
                game.ended_at = event.created_at
                game.save(update_fields=["ended_at"])

        latest = PartyGameEvent.objects.filter(game__evening=evening).order_by("-id").first()
        return Response(
            {
                "cursor": latest.id if latest else 0,
                "accepted": [_serialize_game_event(event) for event in written],
            },
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
#: A comment frame often enough that proxies do not decide the connection died.
_HEARTBEAT_SECONDS = 15.0


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


async def party_game_stream(request, code: str):
    """`GET .../games/stream?since=<cursor>` — the same events, as they happen."""
    account = await sync_to_async(_account_for_stream, thread_sensitive=True)(request)
    if account is None:
        return JsonResponse(
            {
                "detail": "Authentication credentials were not provided.",
                "code": "not_authenticated",
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )

    evening = await sync_to_async(_member_evening, thread_sensitive=True)(code, account)
    if not evening:
        return JsonResponse(
            {"detail": "Party evening not found.", "code": "party_not_found"},
            status=status.HTTP_404_NOT_FOUND,
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
        started = time.monotonic()
        last_beat = started
        # The opening frame carries the cursor, so a client that reconnected
        # with a stale one learns immediately where it actually is.
        yield _frame("open", {"cursor": cursor})

        while time.monotonic() - started < _STREAM_SECONDS:
            events = await sync_to_async(game_events_since, thread_sensitive=True)(evening, cursor)
            if events:
                for event in events:
                    payload = await sync_to_async(_serialize_game_event, thread_sensitive=True)(
                        event
                    )
                    yield _frame("game_event", payload, cursor=event.id)
                cursor = events[-1].id
                last_beat = time.monotonic()
            elif time.monotonic() - last_beat >= _HEARTBEAT_SECONDS:
                yield b": beat\n\n"
                last_beat = time.monotonic()
            await asyncio.sleep(_TICK_SECONDS)

        # Not an error: a bounded stream is how this stays cheap. The client
        # reconnects with the cursor it now holds and misses nothing.
        yield _frame("reconnect", {"cursor": cursor})

    response = StreamingHttpResponse(frames(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    # Caddy and nginx both buffer proxied responses by default, which turns a
    # stream into one long silence followed by everything at once.
    response["X-Accel-Buffering"] = "no"
    return response

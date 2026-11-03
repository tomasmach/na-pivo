"""Parta endpoints for the new look: plans v2, plan detail, reminders, direct
pings and the friend's-home evening ("Večer u Kláry").

Everything here is additive. A request without ``place_kind`` still runs the
released ``FriendActivityView`` path byte for byte, and plans created here keep
showing up in the released ``plans`` / ``my_plan`` dashboard slices on their day.

Privacy rules this module keeps:

* A home or custom plan stores its address as free text. Only people who can see
  the plan read it (the host and the invitees), and it never reaches the live
  slices, notifications or pushes. Those only ever carry the plan's ``name``.
* Friends who are not invited see a guest or host of a home evening only as
  "u někoho doma": no host, no place, no address (``home_presence_slice``).
* A home plan stores no pub identity: no geohash ``cache_key`` and no catalogue pub.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone as dj_timezone
from django.utils.translation import gettext, gettext_lazy
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.i18n import LocalizedText
from pubs.models import (
    Account,
    DrinkLog,
    FriendActivityResponse,
    FriendHomeCheckin,
    FriendNotification,
    FriendPubActivity,
    FriendPubActivityRecipient,
)

from .authentication import AccountTokenAuthentication
from .serializers import (
    FriendProfileSerializer,
    FriendPubActivitySerializer,
    _LatLngBoundsValidationMixin,
    _Pub200NameValidationMixin,
)
from .views import (
    _DRINKING_DAY_SHIFT,
    FRIEND_ACTIVITY_DEFAULT_TTL,
    FRIEND_ACTIVITY_MAX_TTL,
    PRAGUE_TZ,
    FriendActivityView,
    _accepted_friend_ids,
    _apply_friend_activity_visibility,
    _blocked_account_ids,
    _bulk_create_friend_notifications,
    _create_friend_notification,
    _friend_activity_context,
    _friend_activity_prefetches,
    _friend_activity_visible_to,
    _friend_display_name,
    _friend_profile_context,
    _internal_error,
    _requested_activity_recipient_ids,
    _resolve_pub_input,
    _send_friend_push,
)

logger = logging.getLogger("pubs.friends")

PLACE_KINDS = ("pub", "home", "custom")
PLAN_MAX_AHEAD = timedelta(days=14)
# Bounds spam: nobody plans more than this many evenings in two weeks.
MAX_OPEN_PLANS = 10
REMIND_COOLDOWN = timedelta(hours=1)
PING_COOLDOWN = timedelta(minutes=30)
# A guest can say "I'm here" a little before the planned time.
HOME_CHECKIN_EARLY = timedelta(hours=2)
PLANS_LIMIT = 30


def _not_found() -> Response:
    return Response(
        {"detail": gettext("Tenhle plán už neplatí."), "code": "plan_not_found"},
        status=status.HTTP_404_NOT_FOUND,
    )


def _local_day_time(value: datetime) -> tuple[str, str]:
    local = dj_timezone.localtime(value, PRAGUE_TZ)
    return f"{local.day}. {local.month}.", local.strftime("%H:%M")


def _has_coordinates(activity: FriendPubActivity) -> bool:
    # Home and custom places may come without coordinates; the NOT NULL columns
    # then hold 0/0, which is never a valid place in the app's coverage.
    return not (activity.place_kind in ("home", "custom") and activity.lat == 0 and activity.lng == 0)


def _is_open(activity: FriendPubActivity, now: datetime) -> bool:
    return activity.active and activity.expires_at > now


def _has_started(activity: FriendPubActivity, now: datetime) -> bool:
    return activity.kind == FriendPubActivity.Kind.LIVE or (
        activity.scheduled_for is not None and activity.scheduled_for <= now
    )


def _can_see(activity: FriendPubActivity, viewer: Account) -> bool:
    """Owner, or an invited accepted friend while the owner is visible."""

    if activity.account_id == viewer.pk:
        return True
    owner = activity.account
    if owner.status != Account.Status.ACTIVE or owner.ghost_mode:
        return False
    if owner.id in _blocked_account_ids(viewer):
        return False
    if owner.id not in _accepted_friend_ids(viewer):
        return False
    return _friend_activity_visible_to(activity, viewer)


def _invitee_ids(activity: FriendPubActivity) -> list[int]:
    """Who the plan is for: its explicit targets, or all of the host's friends."""

    owner = activity.account
    blocked = _blocked_account_ids(owner)
    friend_ids = [fid for fid in _accepted_friend_ids(owner) if fid not in blocked]
    targets = list(
        FriendPubActivityRecipient.objects.filter(activity=activity).values_list(
            "account_id", flat=True
        )
    )
    if not targets:
        return friend_ids
    allowed = set(friend_ids)
    return [fid for fid in targets if fid in allowed]


def _visible_person(account: Account, viewer: Account) -> bool:
    return (
        account.status == Account.Status.ACTIVE
        and not account.ghost_mode
        and account.id not in _blocked_account_ids(viewer)
    )


class PartaPlanSerializer(FriendPubActivitySerializer):
    """A plan as the new look reads it: the released shape plus the place."""

    place_kind = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    invitee_count = serializers.SerializerMethodField()

    class Meta(FriendPubActivitySerializer.Meta):
        fields = [
            *FriendPubActivitySerializer.Meta.fields,
            "place_kind",
            "address",
            "lat",
            "lng",
            "is_mine",
            "invitee_count",
        ]
        read_only_fields = fields

    def get_place_kind(self, obj: FriendPubActivity) -> str:
        return obj.place_kind or "pub"

    def get_address(self, obj: FriendPubActivity) -> str:
        # Every caller of this serializer already passed _can_see for the row.
        return obj.address if obj.place_kind in ("home", "custom") else ""

    def get_lat(self, obj: FriendPubActivity) -> float | None:
        return obj.lat if _has_coordinates(obj) else None

    def get_lng(self, obj: FriendPubActivity) -> float | None:
        return obj.lng if _has_coordinates(obj) else None

    def get_is_mine(self, obj: FriendPubActivity) -> bool:
        account = self.context.get("account")
        return account is not None and obj.account_id == account.pk

    def get_invitee_count(self, obj: FriendPubActivity) -> int | None:
        if not self.get_is_mine(obj):
            return None
        targets = getattr(obj, "target_count", None)
        if targets is None:
            targets = FriendPubActivityRecipient.objects.filter(activity=obj).count()
        if targets:
            return int(targets)
        return len(self.context.get("my_friend_ids") or [])


def _plan_context(request: Request) -> dict:
    blocked = _blocked_account_ids(request.user)
    return {
        **_friend_activity_context(request, blocked),
        "my_friend_ids": [fid for fid in _accepted_friend_ids(request.user) if fid not in blocked],
    }


class PartaPlanWriteSerializer(
    _Pub200NameValidationMixin, _LatLngBoundsValidationMixin, serializers.Serializer
):
    """Body of a new-look plan. ``place_kind`` is what tells it from a released client."""

    client_id = serializers.UUIDField()
    place_kind = serializers.ChoiceField(choices=PLACE_KINDS)
    name = serializers.CharField(max_length=255)
    lat = serializers.FloatField(required=False, allow_null=True)
    lng = serializers.FloatField(required=False, allow_null=True)
    city = serializers.CharField(max_length=128, required=False, allow_blank=True, allow_null=True)
    external_id = serializers.CharField(
        max_length=128, required=False, allow_blank=True, allow_null=True
    )
    address = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    message = serializers.CharField(
        max_length=160, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    scheduled_for = serializers.DateTimeField(required=False, allow_null=True)
    recipient_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_empty=False
    )

    def validate(self, attrs: dict) -> dict:
        has_lat = attrs.get("lat") is not None
        if has_lat != (attrs.get("lng") is not None):
            raise serializers.ValidationError({"lat": "Send both lat and lng, or neither."})
        if attrs.get("place_kind") == "pub":
            if not has_lat and not self.partial:
                raise serializers.ValidationError({"lat": "A pub needs its coordinates."})
            attrs["address"] = ""
        return attrs


class PartaPlanPatchSerializer(PartaPlanWriteSerializer):
    client_id = serializers.UUIDField(required=False)
    place_kind = serializers.ChoiceField(choices=PLACE_KINDS, required=False)
    name = serializers.CharField(max_length=255, required=False)


def _plan_texts(actor, activity: FriendPubActivity, *, changed: bool = False):
    when = activity.scheduled_for or activity.started_at
    day, clock = _local_day_time(when)
    params = {"name": actor, "place": activity.name, "day": day, "time": clock}
    if changed:
        return (
            LocalizedText(gettext_lazy("Změna plánu")),
            LocalizedText(gettext_lazy("%(name)s mění plán: %(place)s, %(day)s v %(time)s."), params),
        )
    return (
        LocalizedText(gettext_lazy("Kamarád plánuje pivo")),
        LocalizedText(
            gettext_lazy("%(name)s zve na pivo: %(place)s, %(day)s v %(time)s. Přidáš se?"), params
        ),
    )


def _notify(activity: FriendPubActivity, recipient_ids: list[int], title, body) -> None:
    owner = activity.account
    if not recipient_ids or owner.ghost_mode:
        return
    _bulk_create_friend_notifications(
        recipient_ids=recipient_ids,
        actor=owner,
        kind=FriendNotification.Kind.FRIEND_PLAN,
        title=title,
        body=body,
        activity=activity,
        pub_cache_key=activity.cache_key,
        pub_name=activity.name[:200],
    )
    # Released apps open Parta for friend_plan, so taps land in the right place.
    _send_friend_push(
        recipient_ids,
        title,
        body,
        {
            "kind": "friend_plan",
            "activity_id": str(activity.public_id),
            "pub_cache_key": activity.cache_key,
        },
    )


def _place_fields(data: dict, place_kind: str) -> dict:
    """Pub identity for a pub, free text (and optional point) for home/custom."""

    if place_kind == "pub":
        identity = _resolve_pub_input(data)
        return {
            "cache_key": identity.cache_key,
            "lat": data["lat"],
            "lng": data["lng"],
            "city": data.get("city") or "",
            "external_id": data.get("external_id") or "",
            "address": "",
        }
    return {
        "cache_key": "",
        "lat": data.get("lat") or 0.0,
        "lng": data.get("lng") or 0.0,
        "city": data.get("city") or "",
        "external_id": "",
        "address": data.get("address") or "",
    }


def _ttl(place_kind: str) -> timedelta:
    # An evening at somebody's place usually outlasts a pub round.
    return FRIEND_ACTIVITY_MAX_TTL if place_kind in ("home", "custom") else FRIEND_ACTIVITY_DEFAULT_TTL


def _set_targets(activity: FriendPubActivity, target_ids: list[int] | None) -> None:
    FriendPubActivityRecipient.objects.filter(activity=activity).delete()
    if target_ids is not None:
        FriendPubActivityRecipient.objects.bulk_create(
            [FriendPubActivityRecipient(activity=activity, account_id=fid) for fid in target_ids],
            ignore_conflicts=True,
        )


def _fresh(activity_pk: int) -> FriendPubActivity:
    return (
        FriendPubActivity.objects.select_related("account")
        .prefetch_related(*_friend_activity_prefetches())
        .get(pk=activity_pk)
    )


def _people(activity: FriendPubActivity, viewer: Account, context: dict) -> dict:
    """Who answered what. The host sees everyone, invitees see who goes."""

    is_owner = activity.account_id == viewer.pk
    buckets: dict[str, list[Account]] = {"going": [], "maybe": [], "cant": []}
    responded: set[int] = set()
    for row in activity.responses.all():
        responded.add(row.account_id)
        if row.response in buckets and _visible_person(row.account, viewer):
            buckets[row.response].append(row.account)

    def profiles(accounts: list[Account]) -> list[dict]:
        return FriendProfileSerializer(accounts, many=True, context=context).data

    body = {
        "going": profiles(buckets["going"]),
        "maybe": profiles(buckets["maybe"]) if is_owner else [],
        "cant": profiles(buckets["cant"]) if is_owner else [],
        "maybe_count": len(buckets["maybe"]),
        "cant_count": len(buckets["cant"]),
        "silent": [],
    }
    if is_owner:
        silent_ids = [fid for fid in _invitee_ids(activity) if fid not in responded]
        silent = [
            account
            for account in Account.objects.filter(id__in=silent_ids).order_by("nickname", "id")
            if _visible_person(account, viewer)
        ]
        body["silent"] = profiles(silent)
    return body


def _home_block(activity: FriendPubActivity, viewer: Account, context: dict, now) -> dict | None:
    if activity.place_kind != "home":
        return None
    started = _has_started(activity, now)
    present: list[Account] = [activity.account] if started else []
    present_ids = {activity.account_id} if started else set()
    my_checkin = False
    checkins = (
        FriendHomeCheckin.objects.filter(activity=activity, left_at__isnull=True)
        .select_related("account")
        .order_by("joined_at")
    )
    for checkin in checkins:
        if checkin.account_id == viewer.pk:
            my_checkin = True
        if checkin.account_id in present_ids:
            continue
        if checkin.account_id == viewer.pk or _visible_person(checkin.account, viewer):
            present.append(checkin.account)
            present_ids.add(checkin.account_id)
    coming = [
        row.account
        for row in activity.responses.all()
        if row.response == FriendActivityResponse.Response.GOING
        and row.account_id not in present_ids
        and (row.account_id == viewer.pk or _visible_person(row.account, viewer))
    ]
    return {
        "started": started,
        "present": FriendProfileSerializer(present, many=True, context=context).data,
        "coming": FriendProfileSerializer(coming, many=True, context=context).data,
        "my_checkin": my_checkin,
        "can_check_in": activity.account_id != viewer.pk
        and (started or (activity.scheduled_for is not None and activity.scheduled_for - HOME_CHECKIN_EARLY <= now)),
    }


def _detail_payload(activity: FriendPubActivity, request: Request) -> dict:
    now = dj_timezone.now()
    context = _plan_context(request)
    profile_context = _friend_profile_context(request)
    return {
        **PartaPlanSerializer(activity, context=context).data,
        "people": _people(activity, request.user, profile_context),
        "home": _home_block(activity, request.user, profile_context, now),
    }


class PartaActivityView(FriendActivityView):
    """``friends/pub-activity`` (POST) and ``friends/pub-activity/<id>`` (GET/PATCH/DELETE).

    POST without ``place_kind`` is the released broadcast/plan path, untouched.
    With it, a plan can be up to 14 days ahead, at a home or custom place, and an
    account may hold several of them.
    """

    def post(self, request: Request) -> Response:
        if "place_kind" not in request.data:
            return super().post(request)
        serializer = PartaPlanWriteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        data = serializer.validated_data
        now = dj_timezone.now()
        place_kind = data["place_kind"]

        scheduled_for = data.get("scheduled_for")
        is_plan = scheduled_for is not None and scheduled_for > now
        if is_plan and scheduled_for > now + PLAN_MAX_AHEAD:
            return Response(
                {"detail": gettext("Plán je moc daleko. Zkus dřívější čas."), "code": "invalid_schedule"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_plan:
            kind, started_at = FriendPubActivity.Kind.PLAN, scheduled_for
        else:
            kind, started_at, scheduled_for = FriendPubActivity.Kind.LIVE, now, None
        expires_at = started_at + _ttl(place_kind)

        requested = data.get("recipient_ids")
        target_ids = _requested_activity_recipient_ids(
            requested,
            friend_ids=_accepted_friend_ids(request.user),
            blocked_ids=_blocked_account_ids(request.user),
        )
        if requested is not None and not target_ids:
            return Response(
                {"detail": gettext("Vyber aspoň jednoho kámoše z party."), "code": "no_recipients"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        place = _place_fields(data, place_kind)

        created = False
        try:
            with transaction.atomic():
                Account.objects.select_for_update().get(pk=request.user.pk)
                activity = (
                    FriendPubActivity.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                if activity is None:
                    open_plans = (
                        FriendPubActivity.objects.filter(
                            account=request.user, active=True, expires_at__gt=now
                        )
                        .exclude(place_kind="")
                        .count()
                    )
                    if open_plans >= MAX_OPEN_PLANS:
                        return Response(
                            {
                                "detail": gettext("Máš naplánováno dost. Nějaký plán nejdřív zruš."),
                                "code": "too_many_plans",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    activity = FriendPubActivity(account=request.user, client_id=data["client_id"])
                    created = True
                activity.name = data["name"]
                activity.message = data.get("message") or ""
                activity.place_kind = place_kind
                activity.kind = kind
                activity.scheduled_for = scheduled_for
                activity.started_at = started_at
                activity.expires_at = expires_at
                activity.active = True
                for field, value in place.items():
                    setattr(activity, field, value)
                activity.save()
                if kind == FriendPubActivity.Kind.LIVE:
                    # One live row per account, as the released live path keeps it.
                    FriendPubActivity.objects.filter(
                        account=request.user, active=True, expires_at__gt=now, kind=kind
                    ).exclude(pk=activity.pk).update(active=False, updated_at=now)
                _set_targets(activity, target_ids if requested is not None else None)
        except Exception as exc:  # noqa: BLE001
            logger.error("parta: plan create failed: %s", exc.__class__.__name__)
            return _internal_error()

        if created:
            title, body = _plan_texts(_friend_display_name(request.user), activity)
            _notify(activity, target_ids, title, body)
        return Response(
            _detail_payload(_fresh(activity.pk), request),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def get(self, request: Request, activity_id=None) -> Response:
        if activity_id is None:
            return self.http_method_not_allowed(request)
        activity = (
            FriendPubActivity.objects.select_related("account")
            .prefetch_related(*_friend_activity_prefetches())
            .filter(public_id=activity_id)
            .first()
        )
        if activity is None or not _is_open(activity, dj_timezone.now()) or not _can_see(activity, request.user):
            return _not_found()
        return Response(_detail_payload(activity, request), status=status.HTTP_200_OK)

    def patch(self, request: Request, activity_id=None) -> Response:
        if activity_id is None:
            return self.http_method_not_allowed(request)
        now = dj_timezone.now()
        activity = (
            FriendPubActivity.objects.select_related("account")
            .filter(public_id=activity_id, account=request.user)
            .first()
        )
        # A released live broadcast (no place_kind) is presence, not a plan to edit.
        editable = activity is not None and (
            activity.kind == FriendPubActivity.Kind.PLAN or activity.place_kind != ""
        )
        if not editable or not _is_open(activity, now):
            return _not_found()
        serializer = PartaPlanPatchSerializer(data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        data = serializer.validated_data

        place_kind = data.get("place_kind") or activity.place_kind or "pub"
        if place_kind == "pub" and data.get("lat") is None and activity.place_kind in ("home", "custom"):
            return Response({"lat": ["A pub needs its coordinates."]}, status=status.HTTP_400_BAD_REQUEST)
        # No time means the plan is on now, exactly like a plan created without one.
        scheduled_for = data.get("scheduled_for", activity.scheduled_for)
        if scheduled_for is not None and (scheduled_for <= now or scheduled_for > now + PLAN_MAX_AHEAD):
            return Response(
                {"detail": gettext("Plán je moc daleko. Zkus dřívější čas."), "code": "invalid_schedule"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        requested = data.get("recipient_ids")
        target_ids = None
        if requested is not None:
            target_ids = _requested_activity_recipient_ids(
                requested,
                friend_ids=_accepted_friend_ids(request.user),
                blocked_ids=_blocked_account_ids(request.user),
            )
            if not target_ids:
                return Response(
                    {"detail": gettext("Vyber aspoň jednoho kámoše z party."), "code": "no_recipients"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        place_changed = any(key in data for key in ("place_kind", "name", "lat", "lng", "address"))
        with transaction.atomic():
            Account.objects.select_for_update().get(pk=request.user.pk)
            if place_changed:
                merged = {
                    "name": data.get("name", activity.name),
                    "lat": data.get("lat", activity.lat if _has_coordinates(activity) else None),
                    "lng": data.get("lng", activity.lng if _has_coordinates(activity) else None),
                    "city": data.get("city", activity.city),
                    "external_id": data.get("external_id", activity.external_id),
                    "address": data.get("address", activity.address),
                }
                for field, value in _place_fields(merged, place_kind).items():
                    setattr(activity, field, value)
                activity.name = merged["name"]
            activity.place_kind = place_kind
            if "message" in data:
                activity.message = data["message"]
            if scheduled_for is not None:
                if scheduled_for != activity.scheduled_for:
                    activity.reminder_sent_at = None
                activity.kind = FriendPubActivity.Kind.PLAN
                activity.scheduled_for = scheduled_for
                activity.started_at = scheduled_for
                activity.expires_at = scheduled_for + _ttl(place_kind)
            elif activity.kind == FriendPubActivity.Kind.PLAN:
                activity.kind = FriendPubActivity.Kind.LIVE
                activity.scheduled_for = None
                activity.started_at = now
                activity.expires_at = now + _ttl(place_kind)
                # One live row per account, as the create path keeps it.
                FriendPubActivity.objects.filter(
                    account=request.user, active=True, expires_at__gt=now, kind=FriendPubActivity.Kind.LIVE
                ).exclude(pk=activity.pk).update(active=False, updated_at=now)
            activity.save()
            if target_ids is not None:
                _set_targets(activity, target_ids)

        fresh = _fresh(activity.pk)
        title, body = _plan_texts(_friend_display_name(request.user), fresh, changed=True)
        _notify(fresh, _invitee_ids(fresh), title, body)
        return Response(_detail_payload(fresh, request), status=status.HTTP_200_OK)

    def delete(self, request: Request, activity_id=None) -> Response:
        if activity_id is None:
            return self.http_method_not_allowed(request)
        now = dj_timezone.now()
        activity = (
            FriendPubActivity.objects.select_related("account")
            .filter(account=request.user, public_id=activity_id, active=True)
            .first()
        )
        response = super().delete(request, activity_id)
        # Released clients end their own rows without a word, as before. A
        # new-look plan that is called off tells the invitees it is not on.
        if activity is not None and activity.place_kind and activity.expires_at > now:
            day, clock = _local_day_time(activity.scheduled_for or activity.started_at)
            title = LocalizedText(gettext_lazy("Plán se ruší"))
            body = LocalizedText(
                gettext_lazy("%(name)s ruší %(place)s, %(day)s v %(time)s."),
                {"name": _friend_display_name(request.user), "place": activity.name, "day": day, "time": clock},
            )
            cant = set(
                FriendActivityResponse.objects.filter(
                    activity=activity, response=FriendActivityResponse.Response.CANT
                ).values_list("account_id", flat=True)
            )
            _notify(activity, [fid for fid in _invitee_ids(activity) if fid not in cant], title, body)
        return response


class PartaPlansView(APIView):
    """GET /v1/friends/plans — every open invitation I host or am invited to.

    Plans up to 14 days ahead plus new-look evenings that already started (a
    home evening tonight). Released live broadcasts are presence, not here.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        now = dj_timezone.now()
        blocked = _blocked_account_ids(request.user)
        friend_ids = [fid for fid in _accepted_friend_ids(request.user) if fid not in blocked]
        open_rows = Q(active=True, expires_at__gt=now) & (
            Q(kind=FriendPubActivity.Kind.PLAN) | (Q(kind=FriendPubActivity.Kind.LIVE) & ~Q(place_kind=""))
        )
        prefetches = _friend_activity_prefetches()
        mine = (
            FriendPubActivity.objects.filter(open_rows, account=request.user)
            .annotate(target_count=Count("target_recipients", distinct=True))
            .select_related("account")
            .prefetch_related(*prefetches)
        )
        theirs = (
            _apply_friend_activity_visibility(
                FriendPubActivity.objects.filter(
                    open_rows,
                    account_id__in=friend_ids,
                    account__status=Account.Status.ACTIVE,
                ),
                request.user,
            )
            .exclude(account__ghost_mode=True)
            .select_related("account")
            .prefetch_related(*prefetches)
        )
        rows = sorted([*mine, *theirs], key=lambda row: (row.scheduled_for or row.started_at, row.pk))
        context = _plan_context(request)
        return Response(
            {
                "plans": PartaPlanSerializer(rows[:PLANS_LIMIT], many=True, context=context).data,
                "server_time": now.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class PartaPlanRemindView(APIView):
    """POST /v1/friends/pub-activity/<id>/remind — the host nudges the silent invitees."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, activity_id) -> Response:
        now = dj_timezone.now()
        if request.user.ghost_mode:
            return Response(
                {"detail": gettext("Jsi neviditelný, nikomu nic nepípne."), "code": "ghost_mode"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            activity = (
                FriendPubActivity.objects.select_for_update(of=("self",))
                .select_related("account")
                .filter(public_id=activity_id, account=request.user, active=True, expires_at__gt=now)
                .first()
            )
            if activity is None:
                return _not_found()
            if activity.last_reminded_at and activity.last_reminded_at > now - REMIND_COOLDOWN:
                wait = int((activity.last_reminded_at + REMIND_COOLDOWN - now).total_seconds())
                return Response(
                    {
                        "detail": gettext("Připomenutí šlo před chvílí. Dej jim chvíli."),
                        "code": "remind_too_soon",
                        "retry_after": wait,
                    },
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            responded = set(
                FriendActivityResponse.objects.filter(activity=activity).values_list("account_id", flat=True)
            )
            silent = [fid for fid in _invitee_ids(activity) if fid not in responded]
            if silent:
                activity.last_reminded_at = now
                activity.save(update_fields=["last_reminded_at", "updated_at"])

        if silent:
            day, clock = _local_day_time(activity.scheduled_for or activity.started_at)
            title = LocalizedText(gettext_lazy("Dorazíš?"))
            body = LocalizedText(
                gettext_lazy("%(name)s se ptá: %(place)s, %(day)s v %(time)s."),
                {"name": _friend_display_name(request.user), "place": activity.name, "day": day, "time": clock},
            )
            _notify(activity, silent, title, body)
        return Response({"reminded": len(silent)}, status=status.HTTP_200_OK)


class PartaHomeCheckinSerializer(serializers.Serializer):
    client_id = serializers.UUIDField()


class PartaHomeCheckinView(APIView):
    """POST/DELETE /v1/friends/pub-activity/<id>/checkin — "Jsem u Kláry" and leaving.

    Both are idempotent so the offline queue can replay them.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def _load(self, activity_id) -> FriendPubActivity | None:
        return (
            FriendPubActivity.objects.select_related("account")
            .prefetch_related(*_friend_activity_prefetches())
            .filter(public_id=activity_id, place_kind="home")
            .first()
        )

    def post(self, request: Request, activity_id) -> Response:
        serializer = PartaHomeCheckinSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        now = dj_timezone.now()
        activity = self._load(activity_id)
        if activity is None or not _is_open(activity, now) or not _can_see(activity, request.user):
            return _not_found()
        if activity.account_id == request.user.pk:
            return Response(
                {"detail": gettext("Tohle je tvůj večer, jsi tu doma."), "code": "own_evening"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not _has_started(activity, now) and activity.scheduled_for - HOME_CHECKIN_EARLY > now:
            return Response(
                {"detail": gettext("Na tenhle večer je ještě brzo."), "code": "too_early"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        checkin, created = FriendHomeCheckin.objects.get_or_create(
            activity=activity,
            account=request.user,
            defaults={"client_id": serializer.validated_data["client_id"], "joined_at": now},
        )
        if not created and checkin.left_at is not None:
            checkin.left_at = None
            checkin.joined_at = now
            checkin.client_id = serializer.validated_data["client_id"]
            checkin.save(update_fields=["left_at", "joined_at", "client_id"])
        return Response(
            _home_block(activity, request.user, _friend_profile_context(request), now),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request: Request, activity_id) -> Response:
        left = FriendHomeCheckin.objects.filter(
            activity__public_id=activity_id, account=request.user, left_at__isnull=True
        ).update(left_at=dj_timezone.now())
        return Response({"left": left > 0}, status=status.HTTP_200_OK)


class FriendPingSerializer(serializers.Serializer):
    message = serializers.CharField(
        max_length=120, required=False, allow_blank=True, default="", trim_whitespace=True
    )


class FriendPingView(APIView):
    """POST /v1/friends/<id>/ping — a cinknutí to one friend, without a pub.

    Accepted, unblocked friends only. A ghost sender sends nothing. One ping per
    pair per 30 minutes. The recipient's quiet hours mute the push but keep the
    in-app row, like every other Parta push.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, account_id) -> Response:
        serializer = FriendPingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        friend = Account.objects.filter(public_id=account_id, status=Account.Status.ACTIVE).first()
        if (
            friend is None
            or friend.id in _blocked_account_ids(request.user)
            or friend.id not in _accepted_friend_ids(request.user)
        ):
            return Response(
                {"detail": gettext("Tenhle kámoš tu není."), "code": "friend_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if request.user.ghost_mode:
            return Response(
                {"detail": gettext("Jsi neviditelný, nikomu nic nepípne."), "code": "ghost_mode"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        now = dj_timezone.now()
        if FriendNotification.objects.filter(
            recipient=friend,
            actor=request.user,
            kind=FriendNotification.Kind.FRIEND_PING,
            created_at__gt=now - PING_COOLDOWN,
        ).exists():
            return Response(
                {"detail": gettext("Cinknutí šlo před chvílí. Zkus to za půl hodiny."), "code": "ping_too_soon"},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        actor = _friend_display_name(request.user)
        title = LocalizedText(gettext_lazy("%(name)s ti cinká"), {"name": actor})
        message = serializer.validated_data["message"]
        body = message or LocalizedText(gettext_lazy("Chybíš u stolu. Dáš si jedno?"))
        _create_friend_notification(
            recipient=friend,
            actor=request.user,
            kind=FriendNotification.Kind.FRIEND_PING,
            title=title,
            body=body,
        )
        _send_friend_push(
            [friend.id],
            title,
            body,
            {"kind": "friend_ping", "actor_id": str(request.user.public_id)},
        )
        return Response({"sent": True}, status=status.HTTP_201_CREATED)


def home_presence_slice(viewer: Account, friend_ids: list[int], now) -> list[dict]:
    """Friends at a home evening right now, as "u někoho doma".

    Same consent as pub presence: active, not ghost, sharing drinks with the
    party. A viewer invited to that evening also gets its ``activity_id``; for
    everyone else the row says nothing about whose home it is.
    """

    if not friend_ids:
        return []
    evenings = FriendPubActivity.objects.filter(
        active=True, expires_at__gt=now, place_kind="home"
    ).filter(Q(kind=FriendPubActivity.Kind.LIVE) | Q(scheduled_for__lte=now))
    visible_ids = set(
        _apply_friend_activity_visibility(
            evenings.filter(account_id__in=friend_ids, account__ghost_mode=False), viewer
        ).values_list("id", flat=True)
    ) | set(evenings.filter(account=viewer).values_list("id", flat=True))

    found: dict[int, tuple[datetime, int]] = {}
    for account_id, started_at, activity_pk in evenings.filter(account_id__in=friend_ids).values_list(
        "account_id", "started_at", "id"
    ):
        found[account_id] = (started_at, activity_pk)
    for account_id, joined_at, activity_pk in FriendHomeCheckin.objects.filter(
        account_id__in=friend_ids, left_at__isnull=True, activity__in=evenings
    ).values_list("account_id", "joined_at", "activity_id"):
        if account_id not in found or joined_at > found[account_id][0]:
            found[account_id] = (joined_at, activity_pk)
    if not found:
        return []

    accounts = Account.objects.filter(
        id__in=found,
        status=Account.Status.ACTIVE,
        ghost_mode=False,
        share_drinks_with_parta=True,
    )
    public_ids = dict(FriendPubActivity.objects.filter(id__in=visible_ids).values_list("id", "public_id"))
    rows = []
    for account in accounts:
        since, activity_pk = found[account.id]
        rows.append(
            {
                "account": FriendProfileSerializer(account).data,
                "place": "home",
                "since": since.isoformat(),
                "activity_id": str(public_ids[activity_pk]) if activity_pk in public_ids else None,
            }
        )
    rows.sort(key=lambda row: row["since"], reverse=True)
    return rows


def recent_together_with_beers(account: Account, evenings: list[dict]) -> list[dict]:
    """``recent_together`` rows plus how many beers *I* logged that evening there.

    My own diary only: the friend's count would need their consent. The evening
    is the drinking day (rolls at 04:00 Prague) at that pub, as in the duel.
    """

    if not evenings:
        return []

    def drinking_day(value: datetime) -> date:
        return dj_timezone.localtime(value - _DRINKING_DAY_SHIFT, PRAGUE_TZ).date()

    days = [drinking_day(item["at"]) for item in evenings]
    since = datetime.combine(min(days), time(hour=4), tzinfo=PRAGUE_TZ)
    until = datetime.combine(max(days) + timedelta(days=1), time(hour=4), tzinfo=PRAGUE_TZ)
    counts: dict[tuple[str, date], int] = {}
    for cache_key, drank_at in DrinkLog.objects.filter(
        account=account,
        drink_type=DrinkLog.DrinkType.BEER,
        is_suspect=False,
        cache_key__in={item["cache_key"] for item in evenings},
        drank_at__gte=since,
        drank_at__lt=until,
    ).values_list("cache_key", "drank_at"):
        key = (cache_key, drinking_day(drank_at))
        counts[key] = counts.get(key, 0) + 1
    return [
        {
            "pub_name": item["pub_name"],
            "cache_key": item["cache_key"],
            "at": item["at"].isoformat(),
            "beers": counts.get((item["cache_key"], day), 0),
        }
        for item, day in zip(evenings, days, strict=True)
    ]


def duel_month_start(now) -> datetime:
    """Start of the current calendar month, on the 04:00 drinking-day roll."""

    local = dj_timezone.localtime(now - _DRINKING_DAY_SHIFT, PRAGUE_TZ)
    return datetime.combine(local.date().replace(day=1), time(hour=4), tzinfo=PRAGUE_TZ)

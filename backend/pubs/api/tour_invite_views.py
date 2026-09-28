"""Parta invites to a tour: the owner asks accepted friends, each friend answers.

The invite carries no copy of the tour. The invitee opens it through the plan's
share link, so an invite needs an active share, and the push names the link.
"""

from django.db import transaction
from django.db.models import Q
from django.utils import dateformat, timezone
from django.utils.translation import gettext as _
from django.utils.translation import gettext_lazy, pgettext
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.i18n import LocalizedText
from pubs.models import Account, FriendBlock, FriendNotification, TourInvite, TourPlan, TourShare
from pubs.tours import protect_response, share_token, token_hash

from .authentication import AccountTokenAuthentication
from .serializers import FriendProfileSerializer
from .throttling import SharedScopedRateThrottle
from .tour_views import _error, _locked_account
from .views import (
    _accepted_friend_ids,
    _bulk_create_friend_notifications,
    _dispatch_friend_push,
    _friend_display_name,
)

# A tour walks with a table of friends, not a whole contact list.
INVITES_PER_TOUR = 50


class InviteCreateSerializer(serializers.Serializer):
    recipient_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=INVITES_PER_TOUR)


class InviteAnswerSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[TourInvite.Status.GOING, TourInvite.Status.DECLINED])


class _InviteDate:
    """The meetup day, rendered in the reader's language when the push is written for them."""

    def __init__(self, day):
        self.day = day

    def __str__(self):
        # Translators: Django date format for the day in a tour invite push, e.g. "pá 2. 10."
        return dateformat.format(self.day, pgettext("tour invite date", "D j. n."))


def _invite_text(owner, plan):
    params = {"name": _friend_display_name(owner), "tour": plan.title}
    if plan.scheduled_date and plan.scheduled_time:
        body = LocalizedText(gettext_lazy("%(name)s tě zve na tour „%(tour)s“, %(date)s v %(time)s. Jdeš?"),
                             {**params, "date": _InviteDate(plan.scheduled_date), "time": plan.scheduled_time.strftime("%H:%M")})
    elif plan.scheduled_date:
        body = LocalizedText(gettext_lazy("%(name)s tě zve na tour „%(tour)s“, %(date)s. Jdeš?"),
                             {**params, "date": _InviteDate(plan.scheduled_date)})
    else:
        body = LocalizedText(gettext_lazy("%(name)s tě zve na tour „%(tour)s“. Jdeš?"), params)
    return LocalizedText(gettext_lazy("Pozvánka na tour")), body


def _active_share_token(plan):
    share = TourShare.objects.filter(plan=plan, revoked_at__isnull=True, expires_at__gt=timezone.now()).first()
    if not share:
        return None
    token = share_token(share)
    return token if token_hash(token) == share.token_hash else None


def _blocked_between(account, other_ids):
    """Who of `other_ids` blocked the account or was blocked by it; a block hides both ways."""
    pairs = FriendBlock.objects.filter(
        Q(blocker=account, blocked_id__in=other_ids) | Q(blocked=account, blocker_id__in=other_ids),
    ).values_list("blocker_id", "blocked_id")
    return {other for pair in pairs for other in pair if other != account.pk}


def _roster(plan, request):
    invites = list(plan.invites.select_related("invitee").filter(invitee__status=Account.Status.ACTIVE).order_by("created_at", "pk"))
    blocked = _blocked_between(plan.owner, [invite.invitee_id for invite in invites]) if invites else set()
    context = {"request": request}
    return {"invites": [{
        "account": FriendProfileSerializer(invite.invitee, context=context).data,
        "status": invite.status,
        "invited_at": invite.created_at.isoformat(),
        "responded_at": invite.responded_at.isoformat() if invite.responded_at else None,
    } for invite in invites if invite.invitee_id not in blocked]}


class _InviteView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "tour_invite_read"
    write_scope = "tour_invite"

    def finalize_response(self, request, response, *args, **kwargs):
        return protect_response(super().finalize_response(request, response, *args, **kwargs))

    def get_throttles(self):
        self.throttle_scope = "tour_invite_read" if self.request.method == "GET" else self.write_scope
        return super().get_throttles()


class TourInvitesView(_InviteView):
    """GET the owner's roster; POST invites accepted friends (repeating an invite changes nothing)."""

    def get(self, request, plan_id):
        plan = TourPlan.objects.select_related("owner").filter(pk=plan_id, owner=request.user, deleted_at__isnull=True).first()
        if not plan:
            return _error("not_found", _("Tuhle tour nenacházím."), 404)
        return Response(_roster(plan, request))

    def post(self, request, plan_id):
        serializer = InviteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested = set(serializer.validated_data["recipient_ids"])
        with transaction.atomic():
            account = _locked_account(request)
            plan = TourPlan.objects.select_for_update().filter(pk=plan_id, owner=account, deleted_at__isnull=True).first()
            if not plan:
                return _error("not_found", _("Tuhle tour nenacházím."), 404)
            # Invisible mode tells nobody anything, an invite included.
            if account.ghost_mode:
                return _error("ghost_mode", _("Máš zapnutý neviditelný režim, pozvánka by nikomu nepřišla."), 409)
            token = _active_share_token(plan)
            if not token:
                return _error("share_required", _("Tour nemá platný odkaz. Vytvoř ho a pozvi je znovu."), 409)
            friends = set(_accepted_friend_ids(account))
            targets = list(Account.objects.filter(id__in=friends, public_id__in=requested, status=Account.Status.ACTIVE)
                           .values_list("id", flat=True))
            if not targets:
                return _error("not_friends", _("Pozvat jde jen kámoše z party."), 400)
            invited = set(plan.invites.values_list("invitee_id", flat=True))
            new = [target for target in targets if target not in invited]
            if len(invited) + len(new) > INVITES_PER_TOUR:
                return _error("invite_limit", _("Na jednu tour pozveš nejvýš %(count)s kámošů.") % {"count": INVITES_PER_TOUR}, 400,
                              limit=INVITES_PER_TOUR)
            TourInvite.objects.bulk_create([TourInvite(plan=plan, invitee_id=target) for target in new])
            if new:
                title, body = _invite_text(account, plan)
                _bulk_create_friend_notifications(recipient_ids=new, actor=account, kind=FriendNotification.Kind.FRIEND_TOUR_INVITE,
                                                  title=title, body=body)
                # Older apps know no such kind and only light the Parta dot; newer ones open the tour.
                data = {"kind": "friend_tour_invite", "plan_id": str(plan.pk), "tour_token": token}
                transaction.on_commit(lambda: _dispatch_friend_push(new, title, body, data))
        plan = TourPlan.objects.select_related("owner").get(pk=plan.pk)
        return Response({**_roster(plan, request), "invited": len(new)}, status=201 if new else 200)


def _my_invite(request, plan_id, lock=False):
    rows = TourInvite.objects.select_related("plan__owner").filter(
        plan_id=plan_id, invitee=request.user, plan__deleted_at__isnull=True, plan__owner__status=Account.Status.ACTIVE)
    invite = (rows.select_for_update(of=("self",)) if lock else rows).first()
    if invite and _blocked_between(request.user, [invite.plan.owner_id]):
        return None
    return invite


def _invite_payload(invite, request):
    return {
        "plan_id": str(invite.plan_id), "status": invite.status,
        "inviter": FriendProfileSerializer(invite.plan.owner, context={"request": request}).data,
        "invited_at": invite.created_at.isoformat(),
        "responded_at": invite.responded_at.isoformat() if invite.responded_at else None,
    }


class MyTourInviteView(_InviteView):
    """GET or PUT the signed-in friend's own answer to an invite; anyone else gets a 404."""

    write_scope = "tour_rsvp"

    def get(self, request, plan_id):
        invite = _my_invite(request, plan_id)
        if not invite:
            return _error("not_found", _("Na tuhle tour pozvánku nemáš."), 404)
        return Response(_invite_payload(invite, request))

    def put(self, request, plan_id):
        serializer = InviteAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            invite = _my_invite(request, plan_id, lock=True)
            if not invite:
                return _error("not_found", _("Na tuhle tour pozvánku nemáš."), 404)
            if invite.status != serializer.validated_data["status"]:
                invite.status = serializer.validated_data["status"]
                invite.responded_at = timezone.now()
                invite.save(update_fields=["status", "responded_at"])
        return Response(_invite_payload(invite, request))

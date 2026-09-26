"""Joint runs of public tours: who walks together, never which stops, beers or where."""

from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.community_trust import is_quorum_trusted
from pubs.models import Account, FriendBlock, TourRun, TourRunMember
from pubs.tours import author_payload, fresh_people_count, protect_response, readable_publications

from .authentication import AccountTokenAuthentication
from .throttling import SharedScopedRateThrottle
from .tour_views import _error, _locked_account

MAX_MEMBERS = 20
DAILY_COMPLETIONS = 3
# The party sees each other until the day after; joining closes once the organizer ends.
ROSTER_VISIBLE_AFTER_END = timedelta(hours=24)
# A run nobody ended is over after two days all the same.
ROSTER_MAX_AGE = timedelta(hours=48)
JOIN_WINDOW = timedelta(hours=12)


def _eligible(account):
    return account.is_claimed and bool(account.nickname)


def _hidden_from(viewer):
    """Accounts the viewer blocked or was blocked by; neither side sees the other in a party."""
    pairs = FriendBlock.objects.filter(Q(blocker=viewer) | Q(blocked=viewer)).values_list("blocker_id", "blocked_id")
    return {account_id for pair in pairs for account_id in pair} - {viewer.pk}


def _run_payload(run, viewer, request):
    hidden = _hidden_from(viewer)
    # Someone deleting their account leaves the party at once, like every other social view.
    members = [m for m in run.members.select_related("account").filter(account__status=Account.Status.ACTIVE).order_by("joined_at")
               if m.account_id not in hidden]
    me = next((m for m in members if m.account_id == viewer.pk), None)
    return {
        "id": str(run.id), "publication_id": str(run.publication.public_id), "ended": run.ended_at is not None,
        "organizer_id": str(run.organizer.public_id) if run.organizer else None,
        # Only the walker learns their own completion; the party sees who walks, the public only the number.
        "members": [{**author_payload(m.account, request), "left": m.left_at is not None,
                     "completed": m.account_id == viewer.pk and m.completed_at is not None} for m in members],
        "me": {"completed": bool(me and me.completed_at), "left": bool(me and me.left_at)},
        "people_count": fresh_people_count(run.publication),
    }


class TourRunBase(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "tour_run"

    def finalize_response(self, request, response, *args, **kwargs):
        return protect_response(super().finalize_response(request, response, *args, **kwargs))


class RegisterSerializer(serializers.Serializer):
    publication_id = serializers.UUIDField()
    ended = serializers.BooleanField(default=False)


class TourRunView(TourRunBase):
    """PUT registers (the phone made the id, so the QR works offline) or ends a run; GET is the roster."""

    def put(self, request, run_id):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            account = _locked_account(request)
            # 400 on purpose: offline queues drop it instead of retrying forever.
            if not _eligible(account):
                return _error("sign_in_required", _("Připojit partu může jen přihlášený s přezdívkou."), 400)
            run = TourRun.objects.select_for_update(of=("self",)).select_related("publication", "organizer").filter(pk=run_id).first()
            if run is None:
                publication = readable_publications().filter(public_id=data["publication_id"]).first()
                if publication is None:
                    return _error("unknown_tour", _("Tahle veřejná tour už není."), 400)
                run = TourRun.objects.create(id=run_id, publication=publication, organizer=account)
                TourRunMember.objects.create(run=run, account=account)
            elif run.organizer_id != account.pk:
                return _error("run_taken", _("Tenhle průchod patří někomu jinému."), 400)
            if data["ended"] and run.ended_at is None:
                run.ended_at = timezone.now()
                run.save(update_fields=["ended_at"])
        return Response(_run_payload(run, account, request))

    def get(self, request, run_id):
        run = TourRun.objects.select_related("publication", "organizer").filter(pk=run_id).first()
        now = timezone.now()
        if (run is None or not run.members.filter(account=request.user).exists() or run.registered_at <= now - ROSTER_MAX_AGE
                or (run.ended_at and run.ended_at <= now - ROSTER_VISIBLE_AFTER_END)):
            return Response(status=404)
        return Response(_run_payload(run, request.user, request))


class TourRunPreviewView(TourRunBase):
    """What someone who scanned the QR sees before joining: who invites and how many already go."""

    def get(self, request, run_id):
        run = TourRun.objects.select_related("publication", "organizer").filter(pk=run_id, ended_at__isnull=True).first()
        hidden = _hidden_from(request.user)
        expected = request.query_params.get("publication")
        if (run is None or run.organizer is None or run.organizer.status != Account.Status.ACTIVE or run.registered_at <= timezone.now() - JOIN_WINDOW
                or run.organizer_id in hidden or (expected and expected != str(run.publication.public_id))):
            return Response(status=404)
        members = [m.account for m in run.members.select_related("account").filter(left_at__isnull=True, account__status=Account.Status.ACTIVE)
                   .order_by("joined_at")]
        visible = [account for account in members if account.pk not in hidden]
        # Blocked people stay out of the count too, or "3 going" next to two faces gives them away.
        return Response({"organizer": author_payload(run.organizer, request), "going": len(visible),
                         "members": [author_payload(account, request) for account in visible[:4]]})


class MemberSerializer(serializers.Serializer):
    # "uncounted" takes back a completion after "Nezapočítávat mě".
    state = serializers.ChoiceField(choices=["joined", "left", "completed", "uncounted"])
    # The public tour the joiner saw next to the QR; optional so a join without it still works.
    publication_id = serializers.UUIDField(required=False)


class TourRunMemberView(TourRunBase):
    def put(self, request, run_id):
        serializer = MemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        state = serializer.validated_data["state"]
        now = timezone.now()
        with transaction.atomic():
            account = _locked_account(request)
            if not _eligible(account):
                return _error("sign_in_required", _("Připojit se může jen přihlášený s přezdívkou."), 400)
            run = TourRun.objects.select_for_update(of=("self",)).select_related("publication", "organizer").filter(pk=run_id).first()
            if run is None:
                # The organizer's registration may still wait in their offline queue.
                return Response(status=404)
            member = TourRunMember.objects.select_for_update().filter(run=run, account=account).first()
            if state == "joined":
                if member is None or member.left_at:
                    # Someone outside the party learns only that joining did not work, never who went.
                    if run.ended_at or run.registered_at <= now - JOIN_WINDOW:
                        return Response({"joined": False, "reason": "closed"})
                    if run.organizer is None or run.organizer_id in _hidden_from(account):
                        return _error("blocked", _("K tomuhle průchodu se připojit nejde."), 400)
                    expected = serializer.validated_data.get("publication_id")
                    if expected and expected != run.publication.public_id:
                        return _error("wrong_tour", _("K tomuhle průchodu se připojit nejde."), 400)
                    if run.members.filter(left_at__isnull=True).count() >= MAX_MEMBERS:
                        return Response({"joined": False, "reason": "full"})
                    if member is None:
                        member = TourRunMember.objects.create(run=run, account=account)
                    else:
                        member.left_at = None
                        member.save(update_fields=["left_at"])
            elif member is None:
                # A leave or completion never arrives before its join; keep it for a retry.
                return Response(status=404)
            elif state == "left":
                if member.left_at is None:
                    member.left_at = now
                    member.save(update_fields=["left_at"])
            elif state == "uncounted":
                if member.completed_at is not None:
                    member.completed_at = None
                    member.save(update_fields=["completed_at"])
            elif member.completed_at is None:
                day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
                done_today = TourRunMember.objects.filter(account=account, completed_at__gte=day_start).count()
                if done_today < DAILY_COMPLETIONS:
                    member.completed_at = now
                    member.save(update_fields=["completed_at"])
            # "Counted" means this walker will be in the public number; it shows up there
            # half an hour after joining, so a quick fake walk never bumps it at once.
            counted = bool(member and member.completed_at and is_quorum_trusted(account, now)
                           and not account.ghost_mode and not account.excluded_from_leaderboards
                           and run.registered_at >= run.publication.count_since)
        if state in ("completed", "uncounted"):
            fresh_people_count(run.publication, force=True)
        return Response({**_run_payload(run, account, request), "joined": state != "left", "counted": counted})

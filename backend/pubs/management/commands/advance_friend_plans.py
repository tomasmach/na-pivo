"""
advance_friend_plans — move Parta "plans" through their lifecycle.

A ``FriendPubActivity`` with ``kind=plan`` is a future "Dnes v 20:00" intent. This
command, run every worker tick (5-min granularity is fine — a 20:00 plan converts
by 20:05), does two time-sensitive things:

1. **Afternoon reminder** — when a plan's ``scheduled_for`` is within
   ``FRIEND_PLAN_REMINDER_LEAD_HOURS`` of now (and still in the future, today),
   push the *creator* once ("Večer se schází parta — {pub} v {HH:MM}") and stamp
   ``reminder_sent_at`` so it never re-fires. The self-reminder ignores ghost mode
   but honours the creator's quiet hours (the push is dropped inside
   ``_send_friend_push``; the row is stamped regardless so we don't retry forever).

2. **Conversion** — when a plan's ``scheduled_for`` has passed *and its window has
   not fully elapsed*, flip it to ``kind=live`` (fresh ``started_at`` /
   ``expires_at``), deactivate the account's other live rows (the per-kind
   single-active-row invariant), and fan a normal ``friend_at_pub`` broadcast out
   to non-ghost / non-blocked friends. Reusing the live kind means released mobile
   clients experience the conversion as an ordinary "friend is at the pub now"
   card. A ghost creator keeps their own live row but broadcasts nothing (mirrors
   the POST /pub-activity path). A plan whose whole window already elapsed (e.g. a
   worker outage longer than the plan spanned its evening) is deactivated quietly
   instead of being resurrected as a stale broadcast.

Usage:
    python manage.py advance_friend_plans            # remind + convert due plans
    python manage.py advance_friend_plans --dry-run  # report only, write nothing
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

# Reuse the exact, already-tested fanout / helper stack from the API layer so a
# converted plan is indistinguishable from a live broadcast made via HTTP.
from pubs.api.views import (
    FRIEND_ACTIVITY_DEFAULT_TTL,
    PRAGUE_TZ,
    _accepted_friend_ids,
    _blocked_account_ids,
    _bulk_create_friend_notifications,
    _friend_display_name,
    _prague_today_bounds,
    _send_friend_push,
)
from pubs.models import FriendNotification, FriendPubActivity

logger = logging.getLogger("pubs.friends")


class Command(BaseCommand):
    help = "Send afternoon reminders for today's plans and convert due plans to live."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be reminded / converted without writing anything.",
        )

    def handle(self, *args, **options) -> None:
        dry_run: bool = options["dry_run"]
        now = timezone.now()

        reminded = self._send_reminders(now, dry_run)
        converted = self._convert_due_plans(now, dry_run)

        verb = "(dry-run) " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb}Reminded {reminded} plan(s); converted {converted} plan(s) to live."
            )
        )

    # ------------------------------------------------------------------
    # Phase 1: afternoon reminder to the creator
    # ------------------------------------------------------------------

    def _send_reminders(self, now, dry_run: bool) -> int:
        day_start, day_end = _prague_today_bounds(now)
        lead = timedelta(hours=settings.FRIEND_PLAN_REMINDER_LEAD_HOURS)
        due = (
            FriendPubActivity.objects.filter(
                kind=FriendPubActivity.Kind.PLAN,
                active=True,
                reminder_sent_at__isnull=True,
                scheduled_for__gte=day_start,
                scheduled_for__lt=day_end,
                scheduled_for__gt=now,
                scheduled_for__lte=now + lead,
            )
            .select_related("account")
            .order_by("scheduled_for")
        )

        reminded = 0
        for plan in due.iterator():
            local_time = timezone.localtime(plan.scheduled_for, PRAGUE_TZ).strftime("%H:%M")
            if dry_run:
                self.stdout.write(
                    f"  would remind {plan.public_id} ({plan.name} v {local_time})"
                )
                reminded += 1
                continue

            title = "Večer se schází parta"
            body = f"{plan.name} v {local_time}. Nezapomeň se ukázat."
            # Self-reminder: ignores ghost, honours the creator's quiet hours (the
            # push is dropped inside _send_friend_push; we stamp the row regardless
            # so the reminder is never retried on the next tick).
            _send_friend_push(
                [plan.account_id],
                title,
                body,
                {
                    "kind": "friend_plan",
                    "activity_id": str(plan.public_id),
                    "pub_cache_key": plan.cache_key,
                },
            )
            plan.reminder_sent_at = now
            plan.save(update_fields=["reminder_sent_at", "updated_at"])
            reminded += 1

        return reminded

    # ------------------------------------------------------------------
    # Phase 2: convert plans whose time has come into live broadcasts
    # ------------------------------------------------------------------

    def _convert_due_plans(self, now, dry_run: bool) -> int:
        due = FriendPubActivity.objects.filter(
            kind=FriendPubActivity.Kind.PLAN,
            active=True,
            scheduled_for__lte=now,
        )
        # Staleness bound: a plan whose whole window has already elapsed (a worker
        # outage longer than the plan's TTL spanning its evening) must NOT be
        # resurrected as a fresh live broadcast + fanout — that would blast the
        # parta with a stale "je na pivu" for an evening that is already over.
        # Deactivate those quietly (same effect as prune's straggler step) and
        # convert only plans still inside their window.
        convert_ids = list(due.filter(expires_at__gt=now).values_list("pk", flat=True))
        stale_ids = list(due.filter(expires_at__lte=now).values_list("pk", flat=True))

        if dry_run:
            for plan in FriendPubActivity.objects.filter(pk__in=convert_ids):
                self.stdout.write(
                    f"  would convert {plan.public_id} ({plan.name}) to live"
                )
            for plan in FriendPubActivity.objects.filter(pk__in=stale_ids):
                self.stdout.write(
                    f"  would deactivate stale plan {plan.public_id} ({plan.name})"
                )
            return len(convert_ids)

        if stale_ids:
            FriendPubActivity.objects.filter(pk__in=stale_ids, active=True).update(
                active=False, updated_at=now
            )

        converted = 0
        for plan_id in convert_ids:
            plan = self._convert_one(plan_id, now)
            if plan is None:
                continue
            self._fanout_conversion(plan)
            converted += 1

        return converted

    @staticmethod
    def _convert_one(plan_id: int, now) -> FriendPubActivity | None:
        """Flip one plan row to live inside a transaction; return it or None."""
        with transaction.atomic():
            plan = (
                FriendPubActivity.objects.select_for_update()
                .select_related("account")
                .filter(
                    pk=plan_id,
                    kind=FriendPubActivity.Kind.PLAN,
                    active=True,
                )
                .first()
            )
            if plan is None:
                return None

            plan.kind = FriendPubActivity.Kind.LIVE
            plan.started_at = now
            # Guarantee a fresh live window even if the plan sat past its own TTL
            # during downtime; never shorten an already-longer expiry.
            plan.expires_at = max(plan.expires_at, now + FRIEND_ACTIVITY_DEFAULT_TTL)
            # A live row carries no scheduled_for (see FriendPubActivity docstring).
            plan.scheduled_for = None
            plan.save(
                update_fields=[
                    "kind",
                    "started_at",
                    "expires_at",
                    "scheduled_for",
                    "updated_at",
                ]
            )

            # Per-kind single-active-row invariant: retire the account's other live
            # rows so the converted plan is the one live broadcast.
            FriendPubActivity.objects.filter(
                account_id=plan.account_id,
                active=True,
                expires_at__gt=now,
                kind=FriendPubActivity.Kind.LIVE,
            ).exclude(pk=plan.pk).update(active=False, updated_at=now)

        return plan

    @staticmethod
    def _fanout_conversion(plan: FriendPubActivity) -> None:
        """Broadcast a converted plan as a normal live activity (bulk + push)."""
        owner = plan.account
        # Ghost keeps the owner's own live row but broadcasts nothing.
        if bool(getattr(owner, "ghost_mode", False)):
            return
        blocked_ids = _blocked_account_ids(owner)
        friend_ids = [fid for fid in _accepted_friend_ids(owner) if fid not in blocked_ids]
        if not friend_ids:
            return

        actor = _friend_display_name(owner)
        title = "Kamarád je na pivu"
        body = f"{actor} sedí v {plan.name}. Nechceš se přidat?"
        _bulk_create_friend_notifications(
            recipient_ids=friend_ids,
            actor=owner,
            kind=FriendNotification.Kind.FRIEND_AT_PUB,
            title=title,
            body=body,
            activity=plan,
            pub_cache_key=plan.cache_key,
            pub_name=plan.name[:200],
        )
        _send_friend_push(
            friend_ids,
            title,
            body,
            {
                "kind": "friend_at_pub",
                "activity_id": str(plan.public_id),
                "pub_cache_key": plan.cache_key,
            },
        )

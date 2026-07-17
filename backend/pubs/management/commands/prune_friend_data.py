"""
prune_friend_data — retention + privacy cleanup for the Parta friend graph.

Run every worker tick. Every step is an indexed ``.filter(...).delete()`` (or a
bulk ``.update()``) so a no-op tick is cheap. What it does, in order:

1. **Deactivate stragglers** — any ``FriendPubActivity`` still ``active=True`` whose
   ``expires_at`` has passed (a live row past its TTL, or a plan that expired
   unconverted during downtime) is flipped to ``active=False``.
2. **Hard-delete old activities** — rows whose ``expires_at`` is older than
   ``FRIEND_ACTIVITY_RETENTION_DAYS`` are deleted outright. This drops the pub
   name / lat / lng / geohash (privacy) and cascades responses, reactions and
   activity-linked notifications.
3. **Delete old notifications** — ``FriendNotification`` older than
   ``FRIEND_NOTIFICATION_RETENTION_DAYS``.
4. **Delete spent invite codes** — ``FriendInviteCode`` that are expired or revoked.
5. **Delete stale declined requests** — ``Friendship`` rows left ``declined`` past
   ``FRIEND_DECLINE_COOLDOWN_DAYS``, which naturally re-enables a clean fresh
   request later.

Usage:
    python manage.py prune_friend_data            # prune expired / old rows
    python manage.py prune_friend_data --dry-run  # report counts, delete nothing
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from pubs.models import (
    FriendInviteCode,
    FriendNotification,
    FriendPubActivity,
    Friendship,
)

logger = logging.getLogger("pubs.friends")


class Command(BaseCommand):
    help = "Prune expired friend activities, old notifications, spent invite codes and stale declines."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be pruned without deleting or deactivating anything.",
        )

    def handle(self, *args, **options) -> None:
        dry_run: bool = options["dry_run"]
        now = timezone.now()

        activity_retention = timedelta(days=settings.FRIEND_ACTIVITY_RETENTION_DAYS)
        notification_retention = timedelta(days=settings.FRIEND_NOTIFICATION_RETENTION_DAYS)
        decline_cooldown = timedelta(days=settings.FRIEND_DECLINE_COOLDOWN_DAYS)

        # 1. Deactivate stragglers (any kind): active rows whose window has passed.
        straggler_qs = FriendPubActivity.objects.filter(active=True, expires_at__lte=now)
        # 2. Hard-delete activities expired beyond the retention window (privacy).
        old_activity_qs = FriendPubActivity.objects.filter(
            expires_at__lt=now - activity_retention
        )
        # 3. Old notifications.
        old_notification_qs = FriendNotification.objects.filter(
            created_at__lt=now - notification_retention
        )
        # 4. Spent invite codes (expired or revoked).
        spent_code_qs = FriendInviteCode.objects.filter(
            Q(expires_at__lt=now) | Q(revoked=True)
        )
        # 5. Stale declined requests past the cooldown.
        stale_declined_qs = Friendship.objects.filter(
            status=Friendship.Status.DECLINED,
            responded_at__lt=now - decline_cooldown,
        )

        if dry_run:
            self.stdout.write(
                f"(dry-run) would deactivate {straggler_qs.count()} straggler "
                f"activity(ies); hard-delete {old_activity_qs.count()} old "
                f"activity(ies); delete {old_notification_qs.count()} notification(s), "
                f"{spent_code_qs.count()} invite code(s), "
                f"{stale_declined_qs.count()} declined request(s)."
            )
            return

        deactivated = straggler_qs.update(active=False, updated_at=now)
        # .delete() returns a cascade-inclusive total; report the primary-model
        # count from the per-model detail so the numbers stay honest.
        _, activity_detail = old_activity_qs.delete()
        deleted_activities = activity_detail.get(FriendPubActivity._meta.label, 0)
        _, notification_detail = old_notification_qs.delete()
        deleted_notifications = notification_detail.get(FriendNotification._meta.label, 0)
        deleted_codes, _ = spent_code_qs.delete()
        _, declined_detail = stale_declined_qs.delete()
        deleted_declined = declined_detail.get(Friendship._meta.label, 0)

        self.stdout.write(
            self.style.SUCCESS(
                f"Deactivated {deactivated} straggler activity(ies); hard-deleted "
                f"{deleted_activities} old activity(ies); deleted "
                f"{deleted_notifications} notification(s), {deleted_codes} invite "
                f"code(s), {deleted_declined} declined request(s)."
            )
        )

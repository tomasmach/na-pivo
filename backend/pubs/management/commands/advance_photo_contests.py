"""
advance_photo_contests — close ended FotoPivař rounds and open the next one.

Run every worker tick (5-min granularity is fine — a round that ended at
00:00 UTC closes by 00:05). For every open :class:`PhotoContest` whose
``period_end`` has passed, the domain logic in ``pubs.photo_contest``:

* stamps the final top-3 ranks (vote count, earlier entry wins ties);
* pays ``PHOTO_CONTEST_XP_FIRST/SECOND/THIRD`` onto ``mapper_xp`` with F()
  increments and bumps the winner's monotonic ``photo_contest_wins_count``;
* flips the round to ``closed`` (inside a ``select_for_update()`` transaction
  with a status re-check, so repeated / concurrent runs are idempotent);
* lazily ensures the next open round exists.

Usage:
    python manage.py advance_photo_contests            # close due rounds
    python manage.py advance_photo_contests --dry-run  # report only
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.models import PhotoContest
from pubs.photo_contest import close_due_contests


class Command(BaseCommand):
    help = "Close ended FotoPivař photo-contest rounds and open the next one."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report which rounds would close without writing anything.",
        )

    def handle(self, *args, **options) -> None:
        now = timezone.now()

        if options["dry_run"]:
            due = PhotoContest.objects.filter(
                status=PhotoContest.Status.OPEN, period_end__lte=now
            ).order_by("period_start")
            for contest in due:
                self.stdout.write(
                    f"  would close {contest.public_id} "
                    f"({contest.period_start:%Y-%m-%d} → {contest.period_end:%Y-%m-%d})"
                )
            self.stdout.write(
                self.style.SUCCESS(f"(dry-run) Would close {due.count()} contest round(s).")
            )
            return

        closed = close_due_contests(now)
        self.stdout.write(self.style.SUCCESS(f"Closed {len(closed)} contest round(s)."))

from __future__ import annotations

from collections import defaultdict, deque
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.api.stats import drinking_day, drinking_day_bounds
from pubs.models import DrinkLog

AUTO_REASONS = {"daily_cap", "burst", "backdated"}


class Command(BaseCommand):
    help = "Recompute automatic abuse flags for recent drink logs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--since",
            type=int,
            default=7,
            metavar="DAYS",
            help="Recompute rows drunk within this many days (default: 7).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report changes without writing DrinkLog rows.",
        )

    def handle(self, *args, **options):
        days = max(1, int(options["since"]))
        dry_run = bool(options["dry_run"])
        now = timezone.now()
        since = now - timedelta(days=days)
        context_start = drinking_day_bounds(since)[0] - timedelta(
            minutes=settings.DRINK_BURST_WINDOW_MINUTES
        )

        rows = list(
            DrinkLog.objects.filter(drank_at__gte=context_start)
            .only(
                "id",
                "account_id",
                "drink_type",
                "drank_at",
                "created_at",
                "is_suspect",
                "suspect_reason",
            )
            .order_by("account_id", "drank_at", "id")
        )
        daily_counts: defaultdict[tuple[int, object], int] = defaultdict(int)
        burst_windows: defaultdict[int, deque] = defaultdict(deque)
        updates = []
        scanned = 0
        skipped_manual = 0
        set_count = 0
        cleared_count = 0
        reason_changed_count = 0

        for row in rows:
            is_beer = row.drink_type == DrinkLog.DrinkType.BEER
            day_key = (row.account_id, drinking_day(row.drank_at))
            prior_daily_count = daily_counts[day_key]
            burst_window = burst_windows[row.account_id]
            burst_start = row.drank_at - timedelta(minutes=settings.DRINK_BURST_WINDOW_MINUTES)
            if is_beer:
                while burst_window and burst_window[0] <= burst_start:
                    burst_window.popleft()
                prior_burst_count = len(burst_window)
                daily_counts[day_key] += 1
                burst_window.append(row.drank_at)
            else:
                prior_burst_count = 0

            if row.drank_at < since:
                continue
            scanned += 1
            if row.suspect_reason == "manual":
                skipped_manual += 1
                continue

            desired_reason = ""
            if row.drank_at < row.created_at - timedelta(days=settings.DRINK_BACKDATE_FLAG_DAYS):
                desired_reason = "backdated"
            elif is_beer and prior_daily_count + 1 >= settings.DRINK_DAILY_FLAG_CAP:
                desired_reason = "daily_cap"
            elif is_beer and prior_burst_count >= settings.DRINK_BURST_LIMIT:
                desired_reason = "burst"

            desired_suspect = bool(desired_reason)
            if not desired_suspect and row.suspect_reason not in AUTO_REASONS:
                continue
            if row.is_suspect == desired_suspect and row.suspect_reason == desired_reason:
                continue

            if desired_suspect and not row.is_suspect:
                set_count += 1
            elif not desired_suspect and row.is_suspect:
                cleared_count += 1
            else:
                reason_changed_count += 1
            row.is_suspect = desired_suspect
            row.suspect_reason = desired_reason
            updates.append(row)

        if updates and not dry_run:
            DrinkLog.objects.bulk_update(updates, ["is_suspect", "suspect_reason"])

        mode = "Dry run" if dry_run else "Recomputed"
        self.stdout.write(
            self.style.SUCCESS(
                f"{mode} drink flags: "
                f"scanned={scanned}, changed={len(updates)}, set={set_count}, "
                f"cleared={cleared_count}, reason_changed={reason_changed_count}, "
                f"manual_skipped={skipped_manual}."
            )
        )

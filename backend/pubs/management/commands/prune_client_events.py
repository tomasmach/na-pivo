"""Delete event-level client telemetry after the configured retention window."""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.models import ClientEvent


class Command(BaseCommand):
    help = "Delete old client telemetry while retaining aggregate account counters."

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=5000,
            help="Maximum number of rows deleted per run.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report eligible rows without deleting them.",
        )

    def handle(self, *args, **options):
        retention_days = max(1, int(settings.CLIENT_EVENT_RETENTION_DAYS))
        batch_size = max(1, int(options["batch_size"]))
        cutoff = timezone.now() - timedelta(days=retention_days)
        old_events = ClientEvent.objects.filter(created_at__lt=cutoff)

        if options["dry_run"]:
            count = old_events.count()
            self.stdout.write(
                f"{count} client events are older than {retention_days} days."
            )
            return

        event_ids = list(
            old_events.order_by("created_at").values_list("id", flat=True)[:batch_size]
        )
        deleted, _ = ClientEvent.objects.filter(id__in=event_ids).delete()
        if deleted:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Deleted {deleted} client events older than {retention_days} days."
                )
            )

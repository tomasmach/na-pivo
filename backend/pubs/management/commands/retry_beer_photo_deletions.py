"""Drain durable account-media deletions left by transient storage failures."""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import F, Q
from django.utils import timezone

from pubs.beer_photo_deletions import retry_beer_photo_file_deletion
from pubs.models import BeerPhotoFileDeletion

RETRY_COOLDOWN = timedelta(minutes=15)


class Command(BaseCommand):
    help = "Retry pending account-media file deletions from the durable outbox."

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=200,
            help="Maximum number of pending files attempted per run.",
        )

    def handle(self, *args, **options):
        batch_size = max(1, int(options["batch_size"]))
        retry_before = timezone.now() - RETRY_COOLDOWN
        cleanup_ids = list(
            BeerPhotoFileDeletion.objects.filter(
                Q(last_attempted_at__isnull=True)
                | Q(last_attempted_at__lte=retry_before)
            )
            .order_by(
                F("last_attempted_at").asc(nulls_first=True),
                "created_at",
                "pk",
            )
            .values_list("pk", flat=True)[:batch_size]
        )
        deleted = 0
        for cleanup_id in cleanup_ids:
            if retry_beer_photo_file_deletion(cleanup_id):
                deleted += 1

        pending = len(cleanup_ids) - deleted
        if cleanup_ids:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Cleaned {deleted} account-media files; {pending} attempts remain pending."
                )
            )

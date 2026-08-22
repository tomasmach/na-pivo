from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q, QuerySet
from django.utils import timezone

from pubs.models import AccountExportJob, ApiRateLimitBucket


class Command(BaseCommand):
    help = "Prune bounded batches of expired throttle buckets and terminal exports."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--batch-size", type=int, default=1000)

    def handle(self, *args, **options) -> None:
        now = timezone.now()
        batch_size = max(1, min(int(options["batch_size"]), 10_000))
        bucket_cutoff = now - timedelta(days=settings.API_RATE_LIMIT_RETENTION_DAYS)
        export_cutoff = now - timedelta(days=settings.ACCOUNT_EXPORT_JOB_RETENTION_DAYS)
        buckets = self._delete_batch(
            ApiRateLimitBucket.objects.filter(window_started_at__lt=bucket_cutoff),
            batch_size=batch_size,
        )
        exports = self._delete_batch(
            AccountExportJob.objects.filter(
                Q(
                    status=AccountExportJob.Status.DELIVERED,
                    delivered_at__lt=export_cutoff,
                )
                | Q(
                    status=AccountExportJob.Status.FAILED,
                    failed_at__lt=export_cutoff,
                )
            ),
            batch_size=batch_size,
        )
        self.stdout.write(f"rate_limit_buckets={buckets} export_jobs={exports}")

    @staticmethod
    def _delete_batch(queryset: QuerySet, *, batch_size: int) -> int:
        ids = list(queryset.order_by("id").values_list("id", flat=True)[:batch_size])
        if ids:
            queryset.model.objects.filter(pk__in=ids).delete()
        return len(ids)

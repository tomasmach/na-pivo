from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q, QuerySet
from django.utils import timezone

from pubs.models import (
    AccountDeletionOperation,
    AccountExportJob,
    AccountMergeOperation,
    ApiRateLimitBucket,
    ContentReport,
    FeedbackReport,
)


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

        proof_cutoff = now - timedelta(
            days=settings.ACCOUNT_OPERATION_PROOF_RETENTION_DAYS
        )
        deletions = self._delete_batch(
            AccountDeletionOperation.objects.filter(completed_at__lt=proof_cutoff),
            batch_size=batch_size,
        )
        merges = self._delete_batch(
            AccountMergeOperation.objects.filter(completed_at__lt=proof_cutoff),
            batch_size=batch_size,
        )
        self.stdout.write(
            f"account_deletion_operations={deletions} "
            f"account_merge_operations={merges}"
        )

        report_cutoff = now - timedelta(days=settings.UGC_REPORT_RETENTION_DAYS)
        content_reports = self._delete_batch(
            ContentReport.objects.filter(created_at__lt=report_cutoff),
            batch_size=batch_size,
        )
        feedback_reports = self._delete_feedback_batch(
            FeedbackReport.objects.filter(created_at__lt=report_cutoff),
            batch_size=batch_size,
        )
        self.stdout.write(
            f"content_reports={content_reports} feedback_reports={feedback_reports}"
        )

    @staticmethod
    def _delete_feedback_batch(queryset: QuerySet, *, batch_size: int) -> int:
        reports = list(queryset.order_by("pk")[:batch_size])
        deleted = 0
        for report in reports:
            try:
                if report.attachment:
                    report.attachment.delete(save=False)
            except Exception:
                continue
            report.delete()
            deleted += 1
        return deleted

    @staticmethod
    def _delete_batch(queryset: QuerySet, *, batch_size: int) -> int:
        pk_name = queryset.model._meta.pk.name
        ids = list(queryset.order_by(pk_name).values_list(pk_name, flat=True)[:batch_size])
        if ids:
            queryset.model.objects.filter(pk__in=ids).delete()
        return len(ids)

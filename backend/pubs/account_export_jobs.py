"""Durable account-export queue shared by web and worker processes."""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from pubs.models import AccountExportJob

EXPORT_JOB_LEASE = timedelta(minutes=15)
RETRYABLE_EXPORT_ERROR_CODES = frozenset(
    {
        "email_delivery_failed",
        "worker_exception",
    }
)


def claim_account_export_job(*, job_id: int | None = None) -> AccountExportJob | None:
    """Lease one ready job, including work abandoned by a dead process."""

    max_attempts = max(1, int(settings.ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS))
    while True:
        now = timezone.now()
        ready = Q(
            status=AccountExportJob.Status.PENDING,
            next_attempt_at__lte=now,
        ) | Q(
            status=AccountExportJob.Status.PROCESSING,
            lease_expires_at__lte=now,
        )
        with transaction.atomic():
            queryset = AccountExportJob.objects.filter(ready).order_by(
                "next_attempt_at", "id"
            )
            if job_id is not None:
                queryset = queryset.filter(pk=job_id)
            if connection.features.has_select_for_update_skip_locked:
                queryset = queryset.select_for_update(skip_locked=True)
            else:
                queryset = queryset.select_for_update()
            job = queryset.first()
            if job is None:
                return None
            if job.attempt_count >= max_attempts:
                job.status = AccountExportJob.Status.FAILED
                job.failed_at = now
                job.lease_expires_at = None
                job.lease_token = None
                job.last_error_code = "max_attempts_exceeded"
                job.save(
                    update_fields=[
                        "status",
                        "failed_at",
                        "lease_expires_at",
                        "lease_token",
                        "last_error_code",
                        "updated_at",
                    ]
                )
                if job_id is not None:
                    return None
                continue
            job.status = AccountExportJob.Status.PROCESSING
            job.attempt_count += 1
            job.lease_expires_at = now + EXPORT_JOB_LEASE
            job.lease_token = uuid.uuid4()
            job.save(
                update_fields=[
                    "status",
                    "attempt_count",
                    "lease_expires_at",
                    "lease_token",
                    "updated_at",
                ]
            )
            return job


def mark_account_export_delivered(job: AccountExportJob) -> bool:
    now = timezone.now()
    updated = AccountExportJob.objects.filter(
        pk=job.pk,
        status=AccountExportJob.Status.PROCESSING,
        lease_token=job.lease_token,
    ).update(
        status=AccountExportJob.Status.DELIVERED,
        delivered_at=now,
        failed_at=None,
        lease_expires_at=None,
        lease_token=None,
        last_error_code="",
        updated_at=now,
    )
    return updated == 1


def retry_account_export(job: AccountExportJob, *, error_code: str) -> bool:
    now = timezone.now()
    safe_error_code = error_code[:64]
    max_attempts = max(1, int(settings.ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS))
    terminal = (
        safe_error_code not in RETRYABLE_EXPORT_ERROR_CODES
        or job.attempt_count >= max_attempts
    )
    filters = {
        "pk": job.pk,
        "status": AccountExportJob.Status.PROCESSING,
        "lease_token": job.lease_token,
    }
    if terminal:
        updated = AccountExportJob.objects.filter(**filters).update(
            status=AccountExportJob.Status.FAILED,
            failed_at=now,
            lease_expires_at=None,
            lease_token=None,
            last_error_code=safe_error_code,
            updated_at=now,
        )
        return updated == 1

    delay_minutes = min(24 * 60, 2 ** min(job.attempt_count, 10))
    updated = AccountExportJob.objects.filter(**filters).update(
        status=AccountExportJob.Status.PENDING,
        next_attempt_at=now + timedelta(minutes=delay_minutes),
        lease_expires_at=None,
        lease_token=None,
        last_error_code=safe_error_code,
        updated_at=now,
    )
    return updated == 1

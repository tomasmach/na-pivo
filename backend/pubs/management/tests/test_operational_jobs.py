from __future__ import annotations

import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.account_export_jobs import (
    claim_account_export_job,
    mark_account_export_delivered,
    retry_account_export,
)
from pubs.api.views import deliver_account_export_job, process_account_export_jobs
from pubs.models import (
    Account,
    AccountDeletionOperation,
    AccountExportJob,
    AccountMergeOperation,
    ApiRateLimitBucket,
    ContentReport,
    EmailCredential,
    FeedbackReport,
)


@pytest.mark.django_db
def test_async_export_is_durable_and_worker_delivers_it(client, monkeypatch, settings) -> None:
    settings.ACCOUNT_EXPORT_ASYNC = True
    client = APIClient()
    account_response = client.post(
        "/v1/account",
        data={"device_id": "4f8b1c2e-4d5a-4789-8abc-def012345678"},
        format="json",
    )
    account = Account.objects.get(public_id=account_response.json()["id"])
    EmailCredential.objects.create(
        account=account,
        email="durable@example.com",
        password="!",
        email_verified=True,
    )
    sent: list[str] = []
    monkeypatch.setattr(
        "pubs.emailer.send_account_export_email",
        lambda *args, **kwargs: sent.append(kwargs["idempotency_key"]) or True,
    )

    queued = client.post(
        "/v1/account/export",
        data={},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {account_response.json()['token']}",
    )

    assert queued.status_code == 202
    job = AccountExportJob.objects.get()
    assert job.status == AccountExportJob.Status.PENDING
    assert sent == []

    assert process_account_export_jobs(limit=10) == (1, 0)
    job.refresh_from_db()
    assert job.status == AccountExportJob.Status.DELIVERED
    assert sent == [f"account-export/{job.public_id}"]


@pytest.mark.django_db
def test_export_worker_reclaims_expired_lease(monkeypatch) -> None:
    account = Account.objects.create(device_id="lease-test")
    EmailCredential.objects.create(
        account=account,
        email="lease@example.com",
        password="!",
        email_verified=True,
    )
    job = AccountExportJob.objects.create(
        account=account,
        status=AccountExportJob.Status.PROCESSING,
        lease_expires_at=timezone.now() - timedelta(seconds=1),
    )
    monkeypatch.setattr("pubs.emailer.send_account_export_email", lambda *a, **kw: True)

    assert process_account_export_jobs(limit=1) == (1, 0)
    job.refresh_from_db()
    assert job.status == AccountExportJob.Status.DELIVERED
    assert job.attempt_count == 1


@pytest.mark.django_db
def test_stale_export_worker_cannot_overwrite_a_successor_lease(settings) -> None:
    settings.ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS = 8
    account = Account.objects.create(device_id="lease-cas-test")
    job = AccountExportJob.objects.create(account=account)

    stale_worker = claim_account_export_job()
    assert stale_worker is not None
    stale_token = stale_worker.lease_token
    AccountExportJob.objects.filter(pk=job.pk).update(
        lease_expires_at=timezone.now() - timedelta(seconds=1)
    )
    successor = claim_account_export_job()
    assert successor is not None
    assert successor.lease_token != stale_token

    assert retry_account_export(stale_worker, error_code="worker_exception") is False
    assert mark_account_export_delivered(stale_worker) is False
    job.refresh_from_db()
    assert job.status == AccountExportJob.Status.PROCESSING
    assert job.lease_token == successor.lease_token

    assert mark_account_export_delivered(successor) is True
    job.refresh_from_db()
    assert job.status == AccountExportJob.Status.DELIVERED


@pytest.mark.django_db
def test_permanent_export_error_fails_without_retry() -> None:
    account = Account.objects.create(device_id="permanent-export-error")
    job = AccountExportJob.objects.create(account=account)
    claimed = claim_account_export_job()
    assert claimed is not None

    assert deliver_account_export_job(claimed) is False

    job.refresh_from_db()
    assert job.status == AccountExportJob.Status.FAILED
    assert job.failed_at is not None
    assert job.last_error_code == "verified_email_missing"


@pytest.mark.django_db
def test_transient_export_error_stops_at_max_attempts(settings) -> None:
    settings.ACCOUNT_EXPORT_JOB_MAX_ATTEMPTS = 2
    account = Account.objects.create(device_id="max-export-attempts")
    job = AccountExportJob.objects.create(account=account)

    first = claim_account_export_job()
    assert first is not None
    assert retry_account_export(first, error_code="worker_exception") is True
    AccountExportJob.objects.filter(pk=job.pk).update(next_attempt_at=timezone.now())

    second = claim_account_export_job()
    assert second is not None
    assert retry_account_export(second, error_code="worker_exception") is True

    job.refresh_from_db()
    assert job.attempt_count == 2
    assert job.status == AccountExportJob.Status.FAILED
    assert job.failed_at is not None


@pytest.mark.django_db
def test_operational_prune_is_bounded_and_removes_failed_exports(settings) -> None:
    now = timezone.now()
    settings.API_RATE_LIMIT_RETENTION_DAYS = 2
    settings.ACCOUNT_EXPORT_JOB_RETENTION_DAYS = 30
    old_bucket = ApiRateLimitBucket.objects.create(
        scope="account",
        identity_hash="a" * 64,
        window_started_at=now - timedelta(days=3),
        request_count=1,
    )
    fresh_bucket = ApiRateLimitBucket.objects.create(
        scope="account",
        identity_hash="b" * 64,
        window_started_at=now,
        request_count=1,
    )
    account = Account.objects.create(device_id="prune-test")
    old_delivered = AccountExportJob.objects.create(
        account=account,
        status=AccountExportJob.Status.DELIVERED,
        delivered_at=now - timedelta(days=31),
    )
    old_failed = AccountExportJob.objects.create(
        account=account,
        status=AccountExportJob.Status.FAILED,
        failed_at=now - timedelta(days=31),
    )
    second_old_bucket = ApiRateLimitBucket.objects.create(
        scope="account",
        identity_hash="c" * 64,
        window_started_at=now - timedelta(days=3),
        request_count=1,
    )
    second_old_export = AccountExportJob.objects.create(
        account=account,
        status=AccountExportJob.Status.DELIVERED,
        delivered_at=now - timedelta(days=31),
    )
    pending = AccountExportJob.objects.create(account=account)

    call_command("prune_operational_data", batch_size=1, stdout=StringIO())

    assert (
        ApiRateLimitBucket.objects.filter(pk__in=[old_bucket.pk, second_old_bucket.pk]).count()
        == 1
    )
    assert ApiRateLimitBucket.objects.filter(pk=fresh_bucket.pk).exists()
    assert (
        AccountExportJob.objects.filter(
            pk__in=[old_delivered.pk, old_failed.pk, second_old_export.pk]
        ).count()
        == 2
    )
    assert AccountExportJob.objects.filter(pk=pending.pk).exists()


@pytest.mark.django_db
def test_operational_prune_keeps_400_day_account_proofs_and_removes_401_day_proofs(
    settings, monkeypatch
) -> None:
    now = timezone.now()
    monkeypatch.setattr("pubs.management.commands.prune_operational_data.timezone.now", lambda: now)
    settings.ACCOUNT_OPERATION_PROOF_RETENTION_DAYS = 400

    kept_deletion = AccountDeletionOperation.objects.create(
        operation_id=uuid.uuid4(),
        account_fingerprint="a" * 64,
    )
    removed_deletion = AccountDeletionOperation.objects.create(
        operation_id=uuid.uuid4(),
        account_fingerprint="b" * 64,
    )
    kept_merge = AccountMergeOperation.objects.create(
        operation_id=uuid.uuid4(),
        source_account_fingerprint="c" * 64,
        target_account_fingerprint="d" * 64,
    )
    removed_merge = AccountMergeOperation.objects.create(
        operation_id=uuid.uuid4(),
        source_account_fingerprint="e" * 64,
        target_account_fingerprint="f" * 64,
    )

    AccountDeletionOperation.objects.filter(pk=kept_deletion.pk).update(
        completed_at=now - timedelta(days=400)
    )
    AccountDeletionOperation.objects.filter(pk=removed_deletion.pk).update(
        completed_at=now - timedelta(days=401)
    )
    AccountMergeOperation.objects.filter(pk=kept_merge.pk).update(
        completed_at=now - timedelta(days=400)
    )
    AccountMergeOperation.objects.filter(pk=removed_merge.pk).update(
        completed_at=now - timedelta(days=401)
    )

    call_command("prune_operational_data", batch_size=100, stdout=StringIO())

    assert AccountDeletionOperation.objects.filter(pk=kept_deletion.pk).exists()
    assert not AccountDeletionOperation.objects.filter(pk=removed_deletion.pk).exists()
    assert AccountMergeOperation.objects.filter(pk=kept_merge.pk).exists()
    assert not AccountMergeOperation.objects.filter(pk=removed_merge.pk).exists()


@pytest.mark.django_db
def test_operational_prune_removes_401_day_ugc_reports_and_feedback_attachment(
    settings, monkeypatch, tmp_path
) -> None:
    now = timezone.now()
    settings.UGC_REPORT_RETENTION_DAYS = 400
    settings.MEDIA_ROOT = str(tmp_path)
    monkeypatch.setattr("pubs.management.commands.prune_operational_data.timezone.now", lambda: now)

    reporter = Account.objects.create(device_id="ugc-prune-reporter")
    target = Account.objects.create(device_id="ugc-prune-target")

    kept_report = ContentReport.objects.create(
        reporter=reporter,
        target_account=target,
        reason=ContentReport.Reason.SPAM,
    )
    kept_feedback = FeedbackReport.objects.create(
        account=reporter,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.BUG,
        message="kept",
    )
    removed_report = ContentReport.objects.create(
        reporter=reporter,
        target_account=target,
        reason=ContentReport.Reason.SPAM,
    )
    attachment_file = SimpleUploadedFile("old_attachment.png", b"fake-image-bytes")
    removed_feedback = FeedbackReport.objects.create(
        account=reporter,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.OTHER,
        message="removed",
        contact="removed@example.com",
        attachment=attachment_file,
        attachment_url="https://example.com/media/old_attachment.png",
    )

    ContentReport.objects.filter(pk=kept_report.pk).update(created_at=now - timedelta(days=400))
    FeedbackReport.objects.filter(pk=kept_feedback.pk).update(
        created_at=now - timedelta(days=400)
    )
    ContentReport.objects.filter(pk=removed_report.pk).update(
        created_at=now - timedelta(days=401)
    )
    FeedbackReport.objects.filter(pk=removed_feedback.pk).update(
        created_at=now - timedelta(days=401)
    )

    old_attachment_name = removed_feedback.attachment.name
    assert default_storage.exists(old_attachment_name)

    try:
        call_command("prune_operational_data", batch_size=100, stdout=StringIO())

        assert ContentReport.objects.filter(pk=kept_report.pk).exists()
        assert FeedbackReport.objects.filter(pk=kept_feedback.pk).exists()
        assert not ContentReport.objects.filter(pk=removed_report.pk).exists()
        assert not FeedbackReport.objects.filter(pk=removed_feedback.pk).exists()
        assert not default_storage.exists(old_attachment_name)
    finally:
        if default_storage.exists(old_attachment_name):
            default_storage.delete(old_attachment_name)


@pytest.mark.django_db
def test_operational_prune_keeps_feedback_row_when_attachment_delete_fails(
    settings, monkeypatch, tmp_path
) -> None:
    now = timezone.now()
    settings.UGC_REPORT_RETENTION_DAYS = 400
    settings.MEDIA_ROOT = str(tmp_path)
    monkeypatch.setattr("pubs.management.commands.prune_operational_data.timezone.now", lambda: now)

    account = Account.objects.create(device_id="ugc-prune-failing-delete")
    attachment_file = SimpleUploadedFile("stuck_attachment.png", b"fake-image-bytes")
    report = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.BUG,
        message="attachment delete fails",
        contact="stuck@example.com",
        attachment=attachment_file,
        attachment_url="https://example.com/media/stuck_attachment.png",
    )
    FeedbackReport.objects.filter(pk=report.pk).update(created_at=now - timedelta(days=401))

    stuck_attachment_name = report.attachment.name
    assert default_storage.exists(stuck_attachment_name)

    def failing_delete(self, name):  # noqa: ANN001, ARG001
        raise OSError("simulated storage outage")

    monkeypatch.setattr(type(default_storage._wrapped), "delete", failing_delete)

    try:
        call_command("prune_operational_data", batch_size=100, stdout=StringIO())

        assert FeedbackReport.objects.filter(pk=report.pk).exists()
        assert default_storage.exists(stuck_attachment_name)
    finally:
        monkeypatch.undo()
        if default_storage.exists(stuck_attachment_name):
            default_storage.delete(stuck_attachment_name)

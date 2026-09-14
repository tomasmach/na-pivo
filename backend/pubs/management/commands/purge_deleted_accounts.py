"""
purge_deleted_accounts — hard-delete accounts whose soft-delete grace window has
elapsed.

Account deletion is a two-step process (see pubs.accounts):
1. The user deletes in-app → the account is marked PENDING_DELETION, all tokens
   are revoked, the Apple token is revoked, and a cancel-by email is sent. Signing
   back in within the window reactivates the account.
2. This command, run on a schedule (cron on the Hetzner box), hard-purges any
   account still pending past ACCOUNT_DELETION_GRACE_DAYS. The delete cascades
   credentials / identities / tokens and the CASCADE-bound personal data
   (drinks, ratings, visits, usage stats). Authored unverified contribution,
   report, feedback and telemetry rows are removed outright; current community
   state and its indexes are rebuilt from the surviving contributors;
   independently verified external pub facts survive without an author link;
   necessary moderation records keep their content but have reporter/target
   identity scrubbed. Remotely synced feedback deletion is fail-closed before
   any local purge runs.

Usage:
    python manage.py purge_deleted_accounts            # purge expired
    python manage.py purge_deleted_accounts --dry-run  # report only
    python manage.py purge_deleted_accounts --grace-days 30
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs import accounts
from pubs.models import Account

logger = logging.getLogger("pubs.accounts")

PURGE_BATCH_SIZE = 100


class Command(BaseCommand):
    help = "Hard-delete accounts pending deletion past the grace window."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--grace-days",
            type=int,
            default=None,
            help="Override ACCOUNT_DELETION_GRACE_DAYS for this run.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be purged without deleting anything.",
        )

    def handle(self, *args, **options) -> None:
        grace_days = options["grace_days"]
        if grace_days is None:
            grace_days = settings.ACCOUNT_DELETION_GRACE_DAYS
        dry_run = options["dry_run"]

        cutoff = timezone.now() - timedelta(days=grace_days)
        expired = Account.objects.filter(
            status=Account.Status.PENDING_DELETION,
            deleted_at__lte=cutoff,
        )

        total = expired.count()
        self.stdout.write(
            f"{total} account(s) pending deletion older than {grace_days} day(s)."
        )
        if total == 0:
            return

        purged = 0
        last_pk = 0
        while True:
            candidates = list(
                expired.filter(pk__gt=last_pk)
                .order_by("pk")
                .values("pk", "public_id", "deleted_at", "deletion_epoch")[:PURGE_BATCH_SIZE]
            )
            if not candidates:
                break
            last_pk = candidates[-1]["pk"]

            for candidate in candidates:
                if dry_run:
                    self.stdout.write(
                        "  would purge "
                        f"{candidate['public_id']} (deleted_at={candidate['deleted_at']})"
                    )
                    continue
                try:
                    if accounts.hard_delete_expired_account(
                        candidate["pk"],
                        cutoff=cutoff,
                        expected_deletion_epoch=candidate["deletion_epoch"],
                    ):
                        purged += 1
                except Exception as exc:  # noqa: BLE001
                    # Storage/database errors may echo private values. The
                    # public account UUID plus exception class is enough to
                    # operate the retryable batch without logging those values.
                    logger.error(
                        "purge: failed to delete account %s (%s)",
                        candidate["public_id"],
                        type(exc).__name__,
                    )

        if not dry_run:
            self.stdout.write(self.style.SUCCESS(f"Purged {purged}/{total} account(s)."))

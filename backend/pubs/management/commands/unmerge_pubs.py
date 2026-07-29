"""Reverse one pub merge by reactivating rows and disabling its aliases."""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import transaction
from django.utils import timezone

from pubs.models import PubDirectory, PubMergeAudit, UserAddedPub


class Command(BaseCommand):
    help = "Reverse one merge without deleting its aliases or audit history."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--audit-id", required=True, type=int)
        parser.add_argument("--actor", required=True)

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        try:
            audit = (
                PubMergeAudit.objects.select_for_update()
                .select_related("canonical_pub")
                .get(pk=options["audit_id"])
            )
        except PubMergeAudit.DoesNotExist as exc:
            raise CommandError("Merge audit does not exist.") from exc
        if audit.reverted_at is not None:
            raise CommandError("Merge audit has already been reverted.")
        if audit.canonical_pub.merge_audits.filter(reverted_at__isnull=True).count() != 1:
            raise CommandError(
                "Canonical pub has multiple active merge audits; reverse them in dependency order."
            )
        if not options["actor"].strip():
            raise CommandError("Actor is required.")

        PubDirectory.objects.filter(
            pk__in=audit.deactivated_directory_ids,
        ).update(active=True)
        UserAddedPub.objects.filter(
            pk__in=audit.deactivated_user_added_ids,
        ).update(active=True)
        audit.canonical_pub.aliases.update(active=False)
        audit.canonical_pub.active = False
        audit.canonical_pub.save(update_fields=["active", "updated_at"])
        audit.reverted_at = timezone.now()
        audit.reverted_by = options["actor"].strip()
        audit.save(update_fields=["reverted_at", "reverted_by"])
        self.stdout.write(
            self.style.SUCCESS(
                f"Reverted merge audit {audit.pk}; no database rows were deleted."
            )
        )

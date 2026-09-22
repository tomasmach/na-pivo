"""Restore the last attempt consumed by the historical Firmy budget bug."""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import F

from pubs.models import EnrichTask

# Match only the exact message emitted by FirmyHoursSource._get. A real
# exhausted failure is done=True (and an unexpected error has a prefix).
_CAP_ERROR_PATTERN = (
    r"^firmy: daily request cap of [0-9]+ exceeded — "
    r"not making further requests today[.]$"
)


class Command(BaseCommand):
    help = (
        "Preview tasks stranded by the historical Firmy daily-cap bug. "
        "Use --apply to restore one retry, without fetching or changing pub data."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--limit", type=int, default=1000)

    def handle(self, *args, **options):
        limit = options["limit"]
        if not 1 <= limit <= 10_000:
            raise CommandError("--limit must be between 1 and 10000.")

        # The old worker only picked attempts < max_attempts, then incremented
        # once before the denied fetch. Other over-limit states are not this bug.
        candidates = EnrichTask.objects.filter(
            done=False,
            max_attempts__gt=0,
            attempts=F("max_attempts"),
            error__regex=_CAP_ERROR_PATTERN,
        )
        task_ids = list(candidates.order_by("pk").values_list("pk", flat=True)[:limit])
        if not options["apply"]:
            self.stdout.write(f"Dry run: {len(task_ids)} task(s) eligible; no changes.")
            return

        # Keep the eligibility predicate on UPDATE too: another process may
        # complete/fail/recover a selected task after the preview. One atomic
        # decrement preserves prior real failures and makes reruns idempotent.
        recovered = candidates.filter(pk__in=task_ids).update(attempts=F("attempts") - 1)
        self.stdout.write(f"Recovered {recovered} task(s); no external requests made.")

from django.core.management.base import BaseCommand

from pubs.api.views import process_account_export_jobs


class Command(BaseCommand):
    help = "Deliver queued account exports and reclaim expired jobs."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--limit", type=int, default=10)

    def handle(self, *args, **options) -> None:
        delivered, retried = process_account_export_jobs(limit=max(0, options["limit"]))
        self.stdout.write(f"delivered={delivered} retried={retried}")

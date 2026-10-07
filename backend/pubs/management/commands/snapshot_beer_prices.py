"""Compute today's public beer price map for na-pivo.cz/ceny.

The worker runs this every tick; it does the work once per Prague day and
otherwise exits right away.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.models import PubPriceSnapshot
from pubs.price_map import save_price_snapshot


class Command(BaseCommand):
    help = "Compute today's public beer price map (medians per city and Prague district)."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--force",
            action="store_true",
            help="Recompute even when today's snapshot already exists.",
        )

    def handle(self, *args, **options) -> None:
        day = timezone.localdate()
        if not options["force"] and PubPriceSnapshot.objects.filter(day=day).exists():
            self.stdout.write(f"price snapshot {day}: already computed")
            return
        data = save_price_snapshot().data
        country = data["country"]
        self.stdout.write(
            f"price snapshot {day}: pubs={country['pubs'] if country else 0} "
            f"cities={len(data['cities'])} districts={len(data['prague_districts'])} "
            f"cheapest={len(data['cheapest'])}"
        )

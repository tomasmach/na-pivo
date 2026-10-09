"""Compute today's public beer price map for na-pivo.cz/ceny and beer pages for na-pivo.cz/pivo.

The worker runs this every tick; it does each part once per Prague day and
otherwise exits right away.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.beer_pages import save_beer_pages
from pubs.models import BeerPage, PubPriceSnapshot
from pubs.price_map import save_price_snapshot


class Command(BaseCommand):
    help = "Compute today's public beer price map and the pages of beers people find on tap."

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
        else:
            data = save_price_snapshot().data
            country = data["country"]
            self.stdout.write(
                f"price snapshot {day}: pubs={country['pubs'] if country else 0} "
                f"cities={len(data['cities'])} districts={len(data['prague_districts'])} "
                f"cheapest={len(data['cheapest'])}"
            )
        # The list page exists after every run, even with no beer over the threshold.
        if not options["force"] and BeerPage.objects.filter(kind=BeerPage.Kind.LIST, day=day).exists():
            self.stdout.write(f"beer pages {day}: already computed")
            return
        pages = save_beer_pages()
        self.stdout.write(f"beer pages {day}: beers={len(pages['beers'])} brands={len(pages['brands'])}")

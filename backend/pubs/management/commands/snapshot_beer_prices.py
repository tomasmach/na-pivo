"""Compute today's public pages: the price map at /ceny, the beer pages at /pivo and the pubs at /hospody.

The worker runs this every tick; it does each part once per Prague day and
otherwise exits right away.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.beer_pages import save_beer_pages
from pubs.models import BeerPage, PubPriceSnapshot, WebPub
from pubs.price_map import save_price_snapshot
from pubs.web_pubs import save_web_pubs


class Command(BaseCommand):
    help = "Compute today's public price map, beer pages and pub pages."

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
        else:
            pages = save_beer_pages()
            self.stdout.write(f"beer pages {day}: beers={len(pages['beers'])} brands={len(pages['brands'])}")
        if not options["force"] and WebPub.objects.filter(day=day).exists():
            self.stdout.write(f"web pubs {day}: already computed")
            return
        self.stdout.write(f"web pubs {day}: listed={save_web_pubs()}")

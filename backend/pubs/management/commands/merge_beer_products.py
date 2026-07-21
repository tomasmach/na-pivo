from django.core.management.base import BaseCommand, CommandError

from pubs.beer_catalog_merge import merge_beer_products
from pubs.models import BeerProduct


class Command(BaseCommand):
    help = "Merge a duplicate beer product into its canonical target."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--source", required=True, help="Duplicate BeerProduct.key")
        parser.add_argument("--target", required=True, help="Canonical BeerProduct.key")
        parser.add_argument("--actor", default="", help="Administrator identity for the audit")

    def handle(self, *args, **options) -> None:
        try:
            audit = merge_beer_products(
                source_key=options["source"],
                target_key=options["target"],
                actor=options["actor"],
            )
        except (BeerProduct.DoesNotExist, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"Merged {audit.source_key} -> {audit.target_key}: {audit.rewired}"
            )
        )

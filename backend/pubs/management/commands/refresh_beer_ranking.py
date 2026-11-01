"""Rebuild the national beer ranking. The worker runs it every tick; it works at most once an hour."""

from django.core.management.base import BaseCommand

from pubs.beer_ranking import refresh_beer_ranking


class Command(BaseCommand):
    help = "Rebuild the national beer ranking and the global numbers of beer pages."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--force", action="store_true", help="Rebuild even when the ranking is fresh."
        )

    def handle(self, *args, **options) -> None:
        ranked = refresh_beer_ranking(force=options["force"])
        if ranked is None:
            self.stdout.write("beer ranking: fresh")
        else:
            self.stdout.write(f"beer ranking: ranked={ranked}")

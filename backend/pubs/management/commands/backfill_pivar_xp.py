from __future__ import annotations

from collections import defaultdict

from django.conf import settings
from django.core.management.base import BaseCommand

from pubs.api.stats import drinking_day
from pubs.models import (
    Account,
    AccountUsageStats,
    BeerCheckIn,
    BeerPhoto,
    DrinkLog,
    PubVisit,
)


def replay_pivar_xp(
    drinks: list[DrinkLog],
    *,
    visited_pub_keys: set[str],
    photo_days: set,
    checkin_days: set,
) -> int:
    """Replay live Pivař rules in chronological order without database queries."""
    total = 0
    day_drinks: defaultdict[object, int] = defaultdict(int)
    day_beers: defaultdict[object, int] = defaultdict(int)
    seen_drink_pubs: set[str] = set()
    seen_brands: set[int] = set()
    seen_contexts: set[str] = set()

    for drink in drinks:
        day = drinking_day(drink.drank_at)
        if not drink.is_suspect:
            if day_drinks[day] == 0:
                total += settings.PIVAR_XP_EVENING
            if (
                drink.drink_type == DrinkLog.DrinkType.BEER
                and day_drinks[day] > 0
                and 1 <= day_beers[day] < settings.PIVAR_XP_EXTRA_BEER_DAILY_CAP + 1
            ):
                total += settings.PIVAR_XP_EXTRA_BEER
            if (
                drink.cache_key is not None
                and drink.cache_key not in seen_drink_pubs
                and drink.cache_key not in visited_pub_keys
            ):
                total += settings.PIVAR_XP_NEW_PUB
            if drink.beer_brand_id is not None and drink.beer_brand_id not in seen_brands:
                total += settings.PIVAR_XP_NEW_BRAND
            if (
                drink.place_context != DrinkLog.PlaceContext.PUB
                and drink.place_context not in seen_contexts
            ):
                total += settings.PIVAR_XP_CONTEXT_FIRST

        day_drinks[day] += 1
        if drink.drink_type == DrinkLog.DrinkType.BEER:
            day_beers[day] += 1
        if drink.cache_key is not None:
            seen_drink_pubs.add(drink.cache_key)
        if drink.beer_brand_id is not None:
            seen_brands.add(drink.beer_brand_id)
        seen_contexts.add(drink.place_context)

    total += len(photo_days) * settings.PIVAR_XP_PHOTO
    total += len(checkin_days) * settings.PIVAR_XP_CHECKIN
    return total


class Command(BaseCommand):
    help = "Recompute every account's Pivař XP from drink, photo and check-in history."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print recomputed totals without writing AccountUsageStats.",
        )

    def handle(self, *args, **options):
        dry_run = bool(options["dry_run"])
        updated: list[AccountUsageStats] = []
        count = 0

        for account in Account.objects.order_by("id").iterator(chunk_size=250):
            drinks = list(
                DrinkLog.objects.filter(account=account)
                .only(
                    "id",
                    "drank_at",
                    "drink_type",
                    "cache_key",
                    "beer_brand_id",
                    "place_context",
                    "is_suspect",
                )
                .order_by("drank_at", "id")
            )
            visited_pub_keys = set(
                PubVisit.objects.filter(account=account).values_list("cache_key", flat=True)
            )
            photo_days = {
                drinking_day(value)
                for value in BeerPhoto.objects.filter(account=account).values_list(
                    "taken_at", flat=True
                )
            }
            checkin_days = {
                drinking_day(value)
                for value in BeerCheckIn.objects.filter(account=account).values_list(
                    "checked_in_at", flat=True
                )
            }
            total = replay_pivar_xp(
                drinks,
                visited_pub_keys=visited_pub_keys,
                photo_days=photo_days,
                checkin_days=checkin_days,
            )
            self.stdout.write(f"{account.public_id}: {total} XP")
            count += 1
            if dry_run:
                continue
            stats, _ = AccountUsageStats.objects.get_or_create(account=account)
            stats.pivar_xp = total
            updated.append(stats)

        if updated:
            AccountUsageStats.objects.bulk_update(updated, ["pivar_xp"], batch_size=250)
        mode = "Dry run" if dry_run else "Backfill"
        self.stdout.write(self.style.SUCCESS(f"{mode} complete: accounts={count}."))

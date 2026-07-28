from __future__ import annotations

import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from pubs.api.views import (
    PRAGUE_TZ,
    _leaderboard_cache_key,
    _leaderboard_drink_scores,
    _leaderboard_period_start,
)
from pubs.models import Account, DrinkLog

SEED_NAMESPACE = uuid.UUID("8a335f2c-935e-4e9c-9df7-4e9a39024ff2")
SEED_DEVICE_PREFIX = "dev-leaderboard-"
SEED_PROFILES = (
    ("KralVycepu", "Král výčepu", 19),
    ("StaryMazak", "Starý mazák", 17),
    ("PenaAzNahoru", "Pěna až nahoru", 15),
    ("PepikOdPipy", "Pepík od pípy", 13),
    ("ZiznivyKarel", "Žíznivý Karel", 11),
    ("PulitrVenca", "Půllitr Venca", 9),
    ("BranikBoss", "Braník boss", 7),
    ("HospodskaMura", "Hospodská můra", 5),
    ("JednoRychly", "Jedno rychlý", 2),
)


class Command(BaseCommand):
    help = "Seed the local development database with weekly beer leaderboard data."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete previously seeded leaderboard accounts before recreating them.",
        )

    def handle(self, *args, **options) -> None:
        self._assert_safe_database()

        now = timezone.now()
        period_start, period_start_utc = _leaderboard_period_start("week", now)
        assert period_start is not None
        assert period_start_utc is not None

        with transaction.atomic():
            if options["reset"]:
                deleted, _ = Account.objects.filter(
                    device_id__startswith=SEED_DEVICE_PREFIX
                ).delete()
                self.stdout.write(f"Deleted {deleted} previously seeded row(s).")

            accounts = self._seed_accounts_and_drinks(period_start, now)

        cache.delete(_leaderboard_cache_key("beers", "week", period_start))
        scores = _leaderboard_drink_scores(period_start_utc)
        leaderboard = sorted(
            (
                (account.nickname or "", scores.get(account.id, 0))
                for account in accounts
            ),
            key=lambda row: (-row[1], row[0]),
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(accounts)} accounts for the week starting "
                f"{period_start.date().isoformat()} (Europe/Prague)."
            )
        )
        for rank, (nickname, score) in enumerate(leaderboard, start=1):
            self.stdout.write(f"{rank:>2}. @{nickname}: {score} beers")

    def _assert_safe_database(self) -> None:
        if not settings.DEBUG:
            raise CommandError(
                "Refusing to seed leaderboard data because settings.DEBUG is not True."
            )
        if connection.vendor != "sqlite":
            raise CommandError(
                "Refusing to seed leaderboard data because the default database is not SQLite."
            )

    def _seed_accounts_and_drinks(self, period_start, now) -> list[Account]:
        accounts = []
        for nickname, display_name, beer_count in SEED_PROFILES:
            device_id = f"{SEED_DEVICE_PREFIX}{nickname.lower()}"
            account, _ = Account.objects.update_or_create(
                device_id=device_id,
                defaults={
                    "nickname": nickname,
                    "display_name": display_name,
                    "status": Account.Status.ACTIVE,
                    "is_public": True,
                    "ghost_mode": False,
                    "excluded_from_leaderboards": False,
                },
            )
            accounts.append(account)

            for index, drank_at in enumerate(
                self._drink_timestamps(period_start, now, beer_count)
            ):
                client_id = uuid.uuid5(SEED_NAMESPACE, f"{device_id}:beer:{index}")
                DrinkLog.objects.update_or_create(
                    account=account,
                    client_id=client_id,
                    defaults={
                        "cache_key": None,
                        "name": "",
                        "lat": None,
                        "lng": None,
                        "city": "",
                        "external_id": "",
                        "place_context": DrinkLog.PlaceContext.PRIVATE,
                        "serving_type": DrinkLog.ServingType.BOTTLE,
                        "drink_type": DrinkLog.DrinkType.BEER,
                        "beer_name": "Testovací ležák",
                        "price_czk": 55,
                        "volume_ml": 500,
                        "is_suspect": False,
                        "suspect_reason": "",
                        "drank_at": drank_at,
                    },
                )

        return accounts

    @staticmethod
    def _drink_timestamps(period_start, now, count: int):
        local_now = timezone.localtime(now, PRAGUE_TZ)
        last_drink = max(period_start, local_now - timedelta(minutes=5))
        first_drink = min(period_start + timedelta(minutes=30), last_drink)
        interval = (last_drink - first_drink) / max(count - 1, 1)
        return [first_drink + interval * index for index in range(count)]

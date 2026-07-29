from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    BeerCheckIn,
    DrinkLog,
    FriendPubActivity,
    Friendship,
    PubVisit,
)

SEED_NAMESPACE = uuid.UUID("2ea43742-2677-4be5-988c-6193e209be20")
SEED_DEVICE_PREFIX = "dev-parta-"
SEED_PROFILES = (
    ("TondaNaTahu", "Tonda na tahu"),
    ("MirekPodTackem", "Mirek pod táckem"),
    ("LojzaBezPeny", "Lojza bez pěny"),
    ("BaraUStamgastu", "Bára u štamgastů"),
    ("RadekPosledni", "Radek poslední"),
)
PUBS = (
    ("U Zlatého tygra", "Praha", 50.0876, 14.4211),
    ("Lokál Dlouhááá", "Praha", 50.0904, 14.4256),
    ("U Pinkasů", "Praha", 50.0824, 14.4227),
    ("Hostinec U Bláhovky", "Brno", 49.2052, 16.5944),
    ("Pivnice Pegas", "Brno", 49.1972, 16.6072),
    ("Hospoda Na Spilce", "Plzeň", 49.7476, 13.3864),
    ("U Černého vola", "Praha", 50.0890, 14.3983),
)
DRINKS = (
    ("Pilsner Urquell 12°", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.DRAFT),
    ("Staropramen 10°", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.BOTTLE),
    ("Fernet Stock", DrinkLog.DrinkType.SHOT, DrinkLog.ServingType.BOTTLE),
    ("Veltlínské zelené", DrinkLog.DrinkType.WINE, DrinkLog.ServingType.DRAFT),
    ("Kofola", DrinkLog.DrinkType.SOFT_DRINK, DrinkLog.ServingType.DRAFT),
    ("Radegast Rázná 10", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.CAN),
    ("Budvar 33", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.BOTTLE),
)


class Command(BaseCommand):
    help = "Seed the local development database with realistic Parta data."

    def add_arguments(self, parser) -> None:
        selector = parser.add_mutually_exclusive_group(required=True)
        selector.add_argument(
            "--nickname",
            help="Nickname of the existing account whose party should be seeded.",
        )
        selector.add_argument(
            "--device-id",
            help="Device ID of the existing account whose party should be seeded.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete previously seeded Parta accounts before recreating them.",
        )

    def handle(self, *args, **options) -> None:
        self._assert_safe_database()
        target = self._target_account(options)
        if target.device_id.startswith(SEED_DEVICE_PREFIX):
            raise CommandError("The target account cannot be a Parta seed account.")

        now = timezone.now()
        with transaction.atomic():
            if options["reset"]:
                deleted, _ = Account.objects.filter(
                    device_id__startswith=SEED_DEVICE_PREFIX
                ).delete()
                self.stdout.write(f"Deleted {deleted} previously seeded row(s).")

            accounts = self._seed_accounts(target, now)
            historical_sessions = self._seed_history(accounts, now)
            recent_sessions = self._seed_presence(accounts, now)
            checkins = self._seed_checkins(accounts, now)

        visible_sessions = historical_sessions - 7 + 2
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(accounts)} friends, "
                f"{historical_sessions + recent_sessions} sessions, and "
                f"{checkins} beer check-ins for "
                f"@{target.nickname or target.device_id}."
            )
        )
        self.stdout.write(
            f"Visible feed sessions: at least {visible_sessions} "
            "(the ghost account is intentionally excluded)."
        )
        self.stdout.write(
            "Právě sedí: @TondaNaTahu (s aktivitou), @MirekPodTackem."
        )
        self.stdout.write("Ghost mód: @BaraUStamgastu (čerstvá návštěva je schovaná).")

    def _assert_safe_database(self) -> None:
        if not settings.DEBUG:
            raise CommandError(
                "Refusing to seed Parta data because settings.DEBUG is not True."
            )
        if connection.vendor != "sqlite":
            raise CommandError(
                "Refusing to seed Parta data because the default database is not SQLite."
            )

    @staticmethod
    def _target_account(options) -> Account:
        if options["nickname"]:
            try:
                return Account.objects.get(nickname=options["nickname"])
            except Account.DoesNotExist as exc:
                raise CommandError(
                    f'No account with nickname "{options["nickname"]}" exists.'
                ) from exc
        try:
            return Account.objects.get(device_id=options["device_id"])
        except Account.DoesNotExist as exc:
            raise CommandError(
                f'No account with device ID "{options["device_id"]}" exists.'
            ) from exc

    def _seed_accounts(
        self,
        target: Account,
        now,
    ) -> list[Account]:
        accounts = []
        for index, (nickname, display_name) in enumerate(SEED_PROFILES):
            device_id = f"{SEED_DEVICE_PREFIX}{index + 1}"
            account, _ = Account.objects.update_or_create(
                device_id=device_id,
                defaults={
                    "nickname": nickname,
                    "display_name": display_name,
                    "status": Account.Status.ACTIVE,
                    "is_public": True,
                    "ghost_mode": index == 3,
                    "share_drinks_with_parta": True,
                    "excluded_from_leaderboards": True,
                },
            )
            accounts.append(account)
            Friendship.objects.update_or_create(
                requester=target,
                recipient=account,
                defaults={
                    "status": Friendship.Status.ACCEPTED,
                    "responded_at": now,
                },
            )
            Friendship.objects.filter(
                requester=account,
                recipient=target,
            ).delete()
        return accounts

    def _seed_history(self, accounts: list[Account], now) -> int:
        for account_index, account in enumerate(accounts):
            for session_index in range(7):
                day_offset = 1 + session_index * 2
                session_at = now - timedelta(
                    days=day_offset,
                    hours=(account_index + session_index) % 4,
                    minutes=account_index * 7,
                )
                place_context = DrinkLog.PlaceContext.PUB
                pub = PUBS[(account_index + session_index) % len(PUBS)]
                if session_index == 5:
                    place_context = DrinkLog.PlaceContext.PRIVATE
                elif session_index == 6:
                    place_context = DrinkLog.PlaceContext.OUTDOORS

                drink = DRINKS[(account_index * 2 + session_index) % len(DRINKS)]
                count = 3 if session_index == 1 else 2
                if drink[1] != DrinkLog.DrinkType.BEER:
                    count = 1
                for drink_index in range(count):
                    self._upsert_drink(
                        account=account,
                        identity=f"history:{session_index}:{drink_index}",
                        drank_at=session_at + timedelta(minutes=drink_index * 24),
                        pub=pub if place_context == DrinkLog.PlaceContext.PUB else None,
                        place_context=place_context,
                        drink=drink,
                    )
        return len(accounts) * 7

    def _seed_presence(self, accounts: list[Account], now) -> int:
        recent_specs = (
            (0, PUBS[0], 82, 7, ("Pilsner Urquell 12°", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.DRAFT), 3),
            (1, PUBS[1], 48, 4, ("Staropramen 10°", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.BOTTLE), 3),
            (3, PUBS[3], 61, 3, ("Radegast Rázná 10", DrinkLog.DrinkType.BEER, DrinkLog.ServingType.CAN), 2),
        )
        for account_index, pub, minutes_ago, ended_minutes_ago, drink, count in recent_specs:
            account = accounts[account_index]
            started_at = now - timedelta(minutes=minutes_ago)
            self._upsert_visit(
                account,
                pub,
                started_at,
                now - timedelta(minutes=ended_minutes_ago),
            )
            for drink_index in range(count):
                self._upsert_drink(
                    account=account,
                    identity=f"presence:{drink_index}",
                    drank_at=started_at + timedelta(minutes=12 + drink_index * 16),
                    pub=pub,
                    place_context=DrinkLog.PlaceContext.PUB,
                    drink=drink,
                )

        account = accounts[0]
        pub = PUBS[0]
        FriendPubActivity.objects.update_or_create(
            account=account,
            client_id=self._uuid(account.device_id, "activity"),
            defaults={
                "cache_key": geohash8(pub[2], pub[3]),
                "name": pub[0],
                "lat": pub[2],
                "lng": pub[3],
                "city": pub[1],
                "external_id": "",
                "message": "Ještě jedno a jdu.",
                "kind": FriendPubActivity.Kind.LIVE,
                "scheduled_for": None,
                "started_at": now - timedelta(minutes=82),
                "expires_at": now + timedelta(hours=2),
                "active": True,
            },
        )
        return len(recent_specs)

    def _seed_checkins(self, accounts: list[Account], now) -> int:
        specs = (
            (0, 0, "Pilsner Urquell 12°", "Plzeňský Prazdroj", "Světlý ležák", "Výborně ošetřené.", Decimal("4.5"), ["říz", "hořkost"]),
            (1, 3, "Radegast Rázná 10", "Radegast", "Světlé výčepní", "Příjemně hořké.", Decimal("4.0"), ["hořké"]),
            (2, 2, "Budvar 33", "Budějovický Budvar", "Světlý ležák", "Na doma akorát.", Decimal("4.0"), ["sladové", "voňavé"]),
            (4, 4, "Radegast Rázná 10", "Radegast", "Světlé výčepní", "Hořkost drží.", Decimal("4.5"), ["hořké"]),
        )
        for account_index, session_index, beer, brewery, style, note, rating, tags in specs:
            account = accounts[account_index]
            day_offset = 1 + session_index * 2
            pub = PUBS[(account_index + session_index) % len(PUBS)]
            checked_in_at = now - timedelta(
                days=day_offset,
                hours=(account_index + session_index) % 4,
                minutes=account_index * 7,
            ) + timedelta(minutes=15)
            BeerCheckIn.objects.update_or_create(
                account=account,
                client_id=self._uuid(account.device_id, f"checkin:{session_index}"),
                defaults={
                    "beer_name": beer,
                    "brewery_name": brewery,
                    "beer_style": style,
                    "quantity": 1,
                    "rating": rating,
                    "tags": tags,
                    "note": note,
                    "pub_cache_key": geohash8(pub[2], pub[3]),
                    "pub_name": pub[0],
                    "pub_city": pub[1],
                    "visibility": BeerCheckIn.Visibility.FRIENDS,
                    "beer_key": beer.casefold().replace(" ", "-"),
                    "brewery_key": brewery.casefold().replace(" ", "-"),
                    "checked_in_at": checked_in_at,
                    "ended_at": checked_in_at + timedelta(minutes=25),
                },
            )
        return len(specs)

    def _upsert_visit(self, account, pub, started_at, ended_at) -> None:
        PubVisit.objects.update_or_create(
            account=account,
            client_id=self._uuid(account.device_id, "presence:visit"),
            defaults={
                "cache_key": geohash8(pub[2], pub[3]),
                "name": pub[0],
                "lat": pub[2],
                "lng": pub[3],
                "city": pub[1],
                "external_id": "",
                "started_at": started_at,
                "ended_at": ended_at,
                "client_updated_at": ended_at,
            },
        )

    def _upsert_drink(
        self,
        *,
        account,
        identity,
        drank_at,
        pub,
        place_context,
        drink,
    ) -> None:
        name, drink_type, serving_type = drink
        DrinkLog.objects.update_or_create(
            account=account,
            client_id=self._uuid(account.device_id, identity),
            defaults={
                "cache_key": geohash8(pub[2], pub[3]) if pub else None,
                "name": pub[0] if pub else "",
                "lat": pub[2] if pub else None,
                "lng": pub[3] if pub else None,
                "city": pub[1] if pub else "",
                "external_id": "",
                "place_context": place_context,
                "serving_type": serving_type,
                "drink_type": drink_type,
                "beer_name": name,
                "price_czk": 59 if pub else None,
                "volume_ml": 40 if drink_type == DrinkLog.DrinkType.SHOT else 500,
                "is_suspect": False,
                "suspect_reason": "",
                "drank_at": drank_at,
            },
        )

    @staticmethod
    def _uuid(device_id: str, identity: str) -> uuid.UUID:
        return uuid.uuid5(SEED_NAMESPACE, f"{device_id}:{identity}")

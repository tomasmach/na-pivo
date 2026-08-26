from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from pubs.community_events import (
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
)
from pubs.enrichment import geohash8
from pubs.identity import normalize_pub_name
from pubs.models import (
    Account,
    DrinkLog,
    Friendship,
    PubCommunityData,
    PubDirectory,
    PubHours,
    PublishedNight,
    PubVisit,
)

SEED_NAMESPACE = uuid.UUID("2a4d8089-ed3f-43e3-8ca3-f401173701bf")
SEED_DEVICE_PREFIX = "dev-3-0-"
SEED_CLIENT_PREFIX = "seed-dev-3-0:"
SEED_DIRECTORY_SOURCE = "seed-dev-3-0"
PRAGUE = ZoneInfo("Europe/Prague")


@dataclass(frozen=True)
class SeedProfile:
    nickname: str
    display_name: str
    relationship: str


@dataclass(frozen=True)
class SeedPub:
    name: str
    city: str
    lat: float
    lng: float
    beers: tuple[str, ...]


SEED_PROFILES = (
    SeedProfile("KlaraNaCepu", "Klára na čepu", "accepted"),
    SeedProfile("MarekStamgast", "Marek štamgast", "accepted"),
    SeedProfile("SonaPivniMapa", "Soňa — pivní mapa", "pending_incoming"),
    SeedProfile("PavelNovyStul", "Pavel od nového stolu", "none"),
)

SEED_PUBS = (
    SeedPub(
        "U Zlatého tygra",
        "Praha",
        50.08759,
        14.42108,
        ("Pilsner Urquell 12°",),
    ),
    SeedPub(
        "Lokál Dlouhááá",
        "Praha",
        50.09037,
        14.42557,
        ("Kozel 11°", "Pilsner Urquell 12°"),
    ),
    SeedPub(
        "U Pinkasů",
        "Praha",
        50.08237,
        14.42274,
        ("Pilsner Urquell 12°",),
    ),
    SeedPub(
        "U Černého vola",
        "Praha",
        50.08896,
        14.39825,
        ("Kozel 12°",),
    ),
)


class Command(BaseCommand):
    help = (
        "Seed a local SQLite database with internally consistent Na Pivo 3.0 "
        "release-verification data."
    )

    def add_arguments(self, parser) -> None:
        selector = parser.add_mutually_exclusive_group(required=True)
        selector.add_argument(
            "--nickname",
            help="Nickname of the existing local account to populate.",
        )
        selector.add_argument(
            "--account-id",
            help="Public account UUID of the existing local account to populate.",
        )
        selector.add_argument(
            "--device-id",
            help="Device ID of the existing local account to populate.",
        )
        selector.add_argument(
            "--list-accounts",
            action="store_true",
            help="List eligible local accounts by nickname and public UUID, then exit.",
        )

    def handle(self, *args, **options) -> None:
        self._assert_safe_database()
        if options["list_accounts"]:
            self._list_accounts()
            return

        target = self._target_account(options)
        if target.device_id.startswith(SEED_DEVICE_PREFIX):
            raise CommandError("A Na Pivo 3.0 seed account cannot be used as the target.")

        now = timezone.now()
        local_today = now.astimezone(PRAGUE).date()
        with transaction.atomic():
            accounts = self._seed_accounts(target, now)
            self._seed_pub_catalog(target, now)
            nights_seeded = 0
            nights_skipped = 0
            for index, account in enumerate((target, *accounts)):
                seeded, skipped = self._seed_account_history(
                    account,
                    account_index=index,
                    today=local_today,
                )
                nights_seeded += seeded
                nights_skipped += skipped
            self._seed_challenge_visits(target, local_today, now)
            events_seeded = self._seed_community_events(target, accounts, now)

        label = f"@{target.nickname}" if target.nickname else str(target.public_id)
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded Na Pivo 3.0 data for {label}: "
                f"{len(accounts)} profiles, {nights_seeded} published nights, "
                f"{len(SEED_PUBS)} pubs and {events_seeded} community events."
            )
        )
        if nights_skipped:
            self.stdout.write(
                self.style.WARNING(
                    f"Preserved {nights_skipped} existing local night(s) on conflicting days."
                )
            )
        self.stdout.write(
            "Pro mapu nastav simulátor poblíž 50.0876, 14.4211. "
            "Ve schválené události čekají dva týmy s volnými místy."
        )

    @staticmethod
    def _assert_safe_database() -> None:
        if not settings.DEBUG:
            raise CommandError(
                "Refusing to seed Na Pivo 3.0 data because settings.DEBUG is not True."
            )
        if connection.vendor != "sqlite":
            raise CommandError(
                "Refusing to seed Na Pivo 3.0 data because the default database is not SQLite."
            )

    def _list_accounts(self) -> None:
        rows = Account.objects.filter(status=Account.Status.ACTIVE).exclude(
            device_id__startswith=SEED_DEVICE_PREFIX
        )
        rows = rows.order_by("nickname", "public_id")
        if not rows.exists():
            self.stdout.write("No eligible local accounts found. Open the app once first.")
            return
        for account in rows:
            label = f"@{account.nickname}" if account.nickname else "bez přezdívky"
            self.stdout.write(f"{label} — {account.public_id}")

    @staticmethod
    def _target_account(options) -> Account:
        accounts = Account.objects.filter(status=Account.Status.ACTIVE)
        try:
            if options.get("nickname"):
                return accounts.get(nickname=options["nickname"])
            if options.get("account_id"):
                return accounts.get(public_id=options["account_id"])
            return accounts.get(device_id=options["device_id"])
        except (Account.DoesNotExist, ValidationError, ValueError, TypeError) as exc:
            raise CommandError("No active local account matches the selected identifier.") from exc

    def _seed_accounts(self, target: Account, now: datetime) -> list[Account]:
        accounts: list[Account] = []
        for index, profile in enumerate(SEED_PROFILES, start=1):
            account, _ = Account.objects.update_or_create(
                device_id=f"{SEED_DEVICE_PREFIX}{index}",
                defaults={
                    "nickname": profile.nickname,
                    "display_name": profile.display_name,
                    "status": Account.Status.ACTIVE,
                    "deleted_at": None,
                    "is_public": True,
                    "ghost_mode": False,
                    "share_drinks_with_parta": True,
                    "excluded_from_leaderboards": True,
                },
            )
            accounts.append(account)
            self._seed_relationship(target, account, profile.relationship, now)
        return accounts

    @staticmethod
    def _seed_relationship(
        target: Account,
        account: Account,
        relationship: str,
        now: datetime,
    ) -> None:
        if relationship == "accepted":
            Friendship.objects.filter(requester=account, recipient=target).delete()
            Friendship.objects.update_or_create(
                requester=target,
                recipient=account,
                defaults={
                    "status": Friendship.Status.ACCEPTED,
                    "responded_at": now,
                },
            )
            return
        if relationship == "pending_incoming":
            Friendship.objects.filter(requester=target, recipient=account).delete()
            Friendship.objects.update_or_create(
                requester=account,
                recipient=target,
                defaults={
                    "status": Friendship.Status.PENDING,
                    "responded_at": None,
                },
            )
            return
        Friendship.objects.filter(
            requester__in=(target, account), recipient__in=(target, account)
        ).delete()

    def _seed_pub_catalog(self, target: Account, now: datetime) -> None:
        for pub in SEED_PUBS:
            cache_key = geohash8(pub.lat, pub.lng)
            name_key = normalize_pub_name(pub.name)
            directory, created = PubDirectory.objects.get_or_create(
                cache_key=cache_key,
                name_key=name_key,
                defaults={
                    "name": pub.name,
                    "lat": pub.lat,
                    "lng": pub.lng,
                    "city": pub.city,
                    "country": "cz",
                    "venue_kind": PubHours.VenueKind.PUB,
                    "discovery_kind": PubDirectory.DiscoveryKind.PUB,
                    "has_beer_signal": True,
                    "source": SEED_DIRECTORY_SOURCE,
                    "active": True,
                    "refreshed_at": now,
                },
            )
            if not created and directory.source == SEED_DIRECTORY_SOURCE:
                directory.name = pub.name
                directory.lat = pub.lat
                directory.lng = pub.lng
                directory.city = pub.city
                directory.country = "cz"
                directory.venue_kind = PubHours.VenueKind.PUB
                directory.discovery_kind = PubDirectory.DiscoveryKind.PUB
                directory.has_beer_signal = True
                directory.active = True
                directory.refreshed_at = now
                directory.save()

            PubCommunityData.objects.get_or_create(
                cache_key=cache_key,
                defaults={
                    "name": pub.name,
                    "lat": pub.lat,
                    "lng": pub.lng,
                    "city": pub.city,
                    "external_id": "",
                    "beers": [
                        {"name": beer, "price_czk": None, "volume_ml": 500}
                        for beer in pub.beers
                    ],
                    "account": target,
                    "beers_updated_at": now,
                },
            )

    def _seed_account_history(
        self,
        account: Account,
        *,
        account_index: int,
        today: date,
    ) -> tuple[int, int]:
        recent_pub_indexes = (account_index % len(SEED_PUBS), (account_index + 1) % len(SEED_PUBS))
        patterns = (
            {
                "identity": "recent",
                "day": today - timedelta(days=account_index + 1),
                "pub_indexes": recent_pub_indexes,
                "drinks": (
                    (DrinkLog.DrinkType.BEER, "Pilsner Urquell 12°", "plzensky-prazdroj"),
                    (DrinkLog.DrinkType.BEER, "Pilsner Urquell 12°", "plzensky-prazdroj"),
                    (DrinkLog.DrinkType.BEER, "Kozel 11°", "velkopopovicky-kozel"),
                    (DrinkLog.DrinkType.SOFT_DRINK, "Kofola", ""),
                ),
                "visibility": PublishedNight.Visibility.PUBLIC,
            },
            {
                "identity": "older",
                "day": today - timedelta(days=account_index + 8),
                "pub_indexes": ((account_index + 2) % len(SEED_PUBS),),
                "drinks": (
                    (DrinkLog.DrinkType.BEER, "Kozel 12°", "velkopopovicky-kozel"),
                    (DrinkLog.DrinkType.BEER, "Kozel 12°", "velkopopovicky-kozel"),
                    (DrinkLog.DrinkType.WINE, "Veltlínské zelené", ""),
                    (DrinkLog.DrinkType.SHOT, "Fernet Stock", ""),
                ),
                "visibility": PublishedNight.Visibility.FRIENDS,
            },
        )

        seeded = 0
        skipped = 0
        for pattern in patterns:
            start = datetime.combine(pattern["day"], time(hour=18, minute=30), PRAGUE)
            end = start + timedelta(hours=4, minutes=45)
            pubs = [SEED_PUBS[index] for index in pattern["pub_indexes"]]
            self._seed_visits(account, pattern["identity"], pubs, start, end)
            self._seed_drinks(account, pattern["identity"], pubs, pattern["drinks"], start, end)
            if self._seed_published_night(
                account,
                identity=pattern["identity"],
                day=pattern["day"],
                pubs=pubs,
                drinks=pattern["drinks"],
                start=start,
                end=end,
                visibility=pattern["visibility"],
            ):
                seeded += 1
            else:
                skipped += 1
        return seeded, skipped

    def _seed_visits(
        self,
        account: Account,
        identity: str,
        pubs: list[SeedPub],
        start: datetime,
        end: datetime,
    ) -> None:
        visit_span = (end - start) / len(pubs)
        for index, pub in enumerate(pubs):
            visit_start = start + visit_span * index
            visit_end = start + visit_span * (index + 1) - timedelta(minutes=10)
            PubVisit.objects.update_or_create(
                account=account,
                client_id=self._uuid(account.device_id, f"{identity}:visit:{index}"),
                defaults={
                    "cache_key": geohash8(pub.lat, pub.lng),
                    "name": pub.name,
                    "lat": pub.lat,
                    "lng": pub.lng,
                    "city": pub.city,
                    "external_id": "",
                    "started_at": visit_start,
                    "ended_at": visit_end,
                    "client_updated_at": end,
                },
            )

    def _seed_drinks(
        self,
        account: Account,
        identity: str,
        pubs: list[SeedPub],
        drinks: tuple[tuple[str, str, str], ...],
        start: datetime,
        end: datetime,
    ) -> None:
        interval = (end - start) / (len(drinks) + 1)
        for index, (drink_type, name, brand_key) in enumerate(drinks):
            pub = pubs[min(index * len(pubs) // len(drinks), len(pubs) - 1)]
            DrinkLog.objects.update_or_create(
                account=account,
                client_id=self._uuid(account.device_id, f"{identity}:drink:{index}"),
                defaults={
                    "cache_key": geohash8(pub.lat, pub.lng),
                    "name": pub.name,
                    "lat": pub.lat,
                    "lng": pub.lng,
                    "city": pub.city,
                    "external_id": "",
                    "place_context": DrinkLog.PlaceContext.PUB,
                    "serving_type": (
                        DrinkLog.ServingType.BOTTLE
                        if drink_type == DrinkLog.DrinkType.WINE
                        else DrinkLog.ServingType.DRAFT
                    ),
                    "drink_type": drink_type,
                    "beer_name": name,
                    "beer_brand_key": brand_key,
                    "beer_brand_name": self._brand_name(brand_key),
                    "price_czk": None,
                    "volume_ml": 40 if drink_type == DrinkLog.DrinkType.SHOT else 500,
                    "is_suspect": False,
                    "suspect_reason": "",
                    "drank_at": start + interval * (index + 1),
                },
            )

    def _seed_published_night(
        self,
        account: Account,
        *,
        identity: str,
        day: date,
        pubs: list[SeedPub],
        drinks: tuple[tuple[str, str, str], ...],
        start: datetime,
        end: datetime,
        visibility: str,
    ) -> bool:
        client_id = f"{SEED_CLIENT_PREFIX}{identity}"
        by_client = PublishedNight.objects.filter(account=account, client_id=client_id).first()
        by_day = PublishedNight.objects.filter(account=account, drinking_day=day).first()
        if by_day is not None and by_client is not None and by_day.pk != by_client.pk:
            return False
        existing = by_client or by_day
        if existing is not None and not existing.client_id.startswith(SEED_CLIENT_PREFIX):
            return False

        counts = {
            kind: sum(1 for drink_type, _name, _brand in drinks if drink_type == kind)
            for kind in DrinkLog.DrinkType.values
        }
        defaults = {
            "client_id": client_id,
            "drinking_day": day,
            "started_at": start,
            "ended_at": end,
            "beer_count": counts[DrinkLog.DrinkType.BEER],
            "wine_count": counts[DrinkLog.DrinkType.WINE],
            "soft_drink_count": counts[DrinkLog.DrinkType.SOFT_DRINK],
            "shot_count": counts[DrinkLog.DrinkType.SHOT],
            "pub_names": [pub.name for pub in pubs],
            "city": pubs[0].city,
            "duration_minutes": int((end - start).total_seconds() // 60),
            "visibility": visibility,
            "updated_at": end,
            "is_removed": False,
        }
        if existing is None:
            night = PublishedNight.objects.create(account=account, **defaults)
        else:
            for field, value in defaults.items():
                setattr(existing, field, value)
            existing.save(update_fields=list(defaults))
            night = existing
        PublishedNight.objects.filter(pk=night.pk).update(created_at=end)
        return True

    def _seed_challenge_visits(
        self,
        target: Account,
        today: date,
        now: datetime,
    ) -> None:
        last_thursday = today - timedelta(days=(today.weekday() - 3) % 7)
        for index in range(3):
            day = last_thursday - timedelta(days=7 * index)
            start = datetime.combine(day, time(hour=18), PRAGUE)
            if start > now:
                start = now - timedelta(minutes=30)
            pub = SEED_PUBS[index]
            client_id = self._uuid(target.device_id, f"challenge:thursday:{index}")
            cache_key = geohash8(pub.lat, pub.lng)
            for _attempt in range(2):
                end = start + timedelta(hours=2)
                overlaps = (
                    PubVisit.objects.filter(
                        account=target,
                        cache_key=cache_key,
                        name=pub.name,
                        started_at__lt=end,
                        ended_at__gt=start,
                    )
                    .exclude(client_id=client_id)
                    .exists()
                )
                if not overlaps:
                    break
                start -= timedelta(days=7)
            else:
                PubVisit.objects.filter(account=target, client_id=client_id).delete()
                continue

            PubVisit.objects.update_or_create(
                account=target,
                client_id=client_id,
                defaults={
                    "cache_key": cache_key,
                    "name": pub.name,
                    "lat": pub.lat,
                    "lng": pub.lng,
                    "city": pub.city,
                    "external_id": "",
                    "started_at": start,
                    "ended_at": end,
                    "client_updated_at": now,
                },
            )

    def _seed_community_events(
        self,
        target: Account,
        accounts: list[Account],
        now: datetime,
    ) -> int:
        joined_event = self._upsert_event(
            host=accounts[0],
            identity="joined",
            title="Pivo a deskovky",
            description="Malý stůl, pár her a dobře ošetřený ležák.",
            pub=SEED_PUBS[1],
            exact_address="Dlouhá 33, Praha 1",
            starts_at=now + timedelta(days=2),
            capacity=8,
        )
        CommunityEventMembership.objects.update_or_create(
            event=joined_event,
            account=target,
            defaults={
                "message": "Přinesu jednu rychlou hru.",
                "status": CommunityEventMembership.Status.APPROVED,
                "decided_at": now,
            },
        )
        self._seed_event_teams(joined_event, target, accounts[0])

        self._upsert_event(
            host=accounts[3],
            identity="discover",
            title="Čtvrteční pivní kvíz",
            description="Čtyři kola, žádné googlení pod stolem.",
            pub=SEED_PUBS[2],
            exact_address="Jungmannovo náměstí 15/16, Praha 1",
            starts_at=now + timedelta(days=4),
            capacity=12,
        )

        hosted_event = self._upsert_event(
            host=target,
            identity="hosted",
            title="Sraz Na Pivo",
            description="Klidný stůl pro partu a jedno na cestu.",
            pub=SEED_PUBS[0],
            exact_address="Husova 17, Praha 1",
            starts_at=now + timedelta(days=6),
            capacity=10,
        )
        CommunityEventMembership.objects.update_or_create(
            event=hosted_event,
            account=accounts[2],
            defaults={
                "message": "Je u stolu ještě místo?",
                "status": CommunityEventMembership.Status.PENDING,
                "decided_at": None,
            },
        )
        return 3

    def _seed_event_teams(
        self,
        event: CommunityEvent,
        target: Account,
        host: Account,
    ) -> None:
        foam_team, _ = CommunityEventTeam.objects.update_or_create(
            event=event,
            client_id=self._uuid(host.device_id, "event:joined:team:foam"),
            defaults={
                "created_by": host,
                "name": "Pěna",
            },
        )
        bite_team, _ = CommunityEventTeam.objects.update_or_create(
            event=event,
            client_id=self._uuid(host.device_id, "event:joined:team:bite"),
            defaults={
                "created_by": host,
                "name": "Říz",
            },
        )
        self._upsert_team_member(foam_team, target, slot=1)
        self._upsert_team_member(bite_team, host, slot=1)

    @staticmethod
    def _upsert_team_member(
        team: CommunityEventTeam,
        account: Account,
        *,
        slot: int,
    ) -> None:
        CommunityEventTeamMembership.objects.filter(team=team, slot=slot).exclude(
            account=account
        ).delete()
        CommunityEventTeamMembership.objects.update_or_create(
            event=team.event,
            account=account,
            defaults={
                "team": team,
                "slot": slot,
            },
        )

    def _upsert_event(
        self,
        *,
        host: Account,
        identity: str,
        title: str,
        description: str,
        pub: SeedPub,
        exact_address: str,
        starts_at: datetime,
        capacity: int,
    ) -> CommunityEvent:
        event, _ = CommunityEvent.objects.update_or_create(
            host=host,
            client_id=self._uuid(host.device_id, f"event:{identity}"),
            defaults={
                "title": title,
                "description": description,
                "city": pub.city,
                "area_label": "Praha 1",
                "exact_address": exact_address,
                "lat": pub.lat,
                "lng": pub.lng,
                "starts_at": starts_at,
                "ends_at": starts_at + timedelta(hours=4),
                "capacity": capacity,
                "adults_only": True,
                "status": CommunityEvent.Status.ACTIVE,
                "cancelled_at": None,
            },
        )
        return event

    @staticmethod
    def _brand_name(brand_key: str) -> str:
        names = {
            "plzensky-prazdroj": "Plzeňský Prazdroj",
            "velkopopovicky-kozel": "Velkopopovický Kozel",
        }
        return names.get(brand_key, "")

    @staticmethod
    def _uuid(device_id: str, identity: str) -> uuid.UUID:
        return uuid.uuid5(SEED_NAMESPACE, f"{device_id}:{identity}")

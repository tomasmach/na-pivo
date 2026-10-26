"""Fill a local SQLite database with pubs, menus, amenities and events for the public web pages."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from pubs.accounts import issue_token
from pubs.models import (
    Account,
    EmailCredential,
    PubAmenity,
    PubCommunityData,
    PubContributionLog,
    PubDirectory,
    PubEvent,
    PubHours,
    PubPriceIndex,
    TourPlan,
)
from pubs.price_index import upsert_pub_price_index

SOURCE = "seed-dev-web"
PRAGUE = ZoneInfo("Europe/Prague")
CITIES = {
    "Brno": (49.1990, 16.6070, 70),
    "Praha 2": (50.0760, 14.4330, 60),
    "Praha 3": (50.0840, 14.4500, 40),
    "Plzeň": (49.7470, 13.3780, 30),
    "Ostrava": (49.8350, 18.2920, 20),
}
FIRST = ["U", "Pivnice U", "Hostinec U", "Výčep U", "Restaurace U", "Hospůdka U"]
SECOND = [
    "Zeleného stolu", "Tří kohoutů", "Lípy", "Kolečka", "Sudu", "Kance", "Medvídka", "Kotvy",
    "Mlýna", "Zvonu", "Jelena", "Pivoňky", "Kalicha", "Rohu", "Bílé růže", "Kovárny", "Nádraží",
    "Splavu", "Hrušky", "Kominíka", "Tří lilií", "Pštrosa", "Fleků", "Čápa", "Rarášků", "Vejvodů",
]
STANDALONE = ["Lokál pod hradbami", "Výčep Kolečko", "Pivní bar Raptor", "Na Palouku", "Bar Pod Mostem"]
BEERS = [
    ("Pilsner Urquell", 59, 69), ("Velkopopovický Kozel 11°", 45, 55), ("Gambrinus 10°", 42, 52),
    ("Radegast Rázná 10°", 42, 50), ("Bernard 11°", 46, 56), ("Bernard 12°", 52, 62),
    ("Starobrno Medium", 45, 52), ("Budweiser Budvar 33", 48, 58), ("Svijany Máz 11°", 46, 54),
    ("Staropramen 11°", 48, 58), ("Matuška Raptor", 65, 79), ("Krušovice 12°", 50, 58),
]
AMENITIES = [
    "seating_garden", "payment_card", "game_darts", "seating_barrier_free", "practical_tank_beer",
    "game_billiards", "atmosphere_sports_tv", "practical_wifi",
]
EVENTS = [
    ("Hospodský kvíz", "Šest kol, týmy do pěti lidí.", 19, 3),
    ("Narážíme sud", "Svatomartinský speciál, dokud teče.", 17, 5),
    ("Živá muzika", "Bluegrass u čepu.", 20, 3),
    ("Degustace jedenáctek", "Pět piv, pět minut o každém.", 16, 4),
    ("Šipkový turnaj", "Přihlášky u výčepu.", 18, 4),
]


class Command(BaseCommand):
    help = "Seed local pubs with menus, prices, amenities, hours and events for na-pivo.cz pages."

    def handle(self, *args, **options) -> None:
        if not settings.DEBUG or connection.vendor != "sqlite":
            raise CommandError("Refusing to seed: needs DEBUG and the local SQLite database.")
        rng = random.Random(42)
        now = timezone.now()
        with transaction.atomic():
            self._clear()
            author = Account.objects.create(
                device_id=f"{SOURCE}-{uuid.uuid4()}",
                ugc_terms_accepted_at=now - timedelta(days=500),
            )
            pool = [f"{first} {second}" for first in FIRST for second in SECOND] + STANDALONE
            pubs = 0
            for city, (lat, lng, count) in CITIES.items():
                for name in rng.sample(pool, count):
                    self._pub(rng, author, name, city, lat, lng, now)
                    pubs += 1
            self._tours(rng)
        call_command("snapshot_beer_prices", "--force", stdout=self.stdout)
        self.stdout.write(f"Seeded {pubs} pubs. Open http://localhost:8012/hospody")

    @staticmethod
    def _tours(rng) -> None:
        """Public routes, published through the API the app uses."""

        from rest_framework.test import APIClient

        for index, (city, title) in enumerate(
            [("Brno", "Večer kolem Veveří"), ("Praha 2", "Vinohradská klasika"), ("Praha 3", "Žižkovem přes pět hospod")]
        ):
            author = Account.objects.create(
                device_id=f"{SOURCE}-tour-{index}", nickname=f"trasar{index}", is_public=True,
            )
            EmailCredential.objects.create(
                account=author, email=f"{SOURCE}-{index}@example.com", password="x", email_verified=True
            )
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(author)}")
            rows = list(PubDirectory.objects.filter(source=SOURCE, city=city).order_by("lat")[: rng.randint(3, 5)])
            stops = [
                {
                    "id": str(uuid.uuid4()), "pub_id": f"directory:{row.cache_key}:{row.name_key}",
                    "cache_key": row.cache_key, "name": row.name, "address": row.city, "lat": row.lat,
                    "lon": row.lng, "challenge": "",
                }
                for row in rows
            ]
            plan_id = str(uuid.uuid4())
            saved = client.put(f"/v1/tours/{plan_id}", {
                "operation_id": str(uuid.uuid4()), "base_revision": 0, "title": title, "scheduled_date": None,
                "scheduled_time": None, "timezone": "Europe/Prague", "stops": stops,
            }, format="json")
            revision = saved.json()["tour"]["revision"]
            published = client.put(
                f"/v1/tours/{plan_id}/publication", {"revision": revision, "accept_rules": True}, format="json"
            )
            if published.status_code not in (200, 201):
                raise CommandError(f"Publishing a route failed: {published.content!r}")

    @staticmethod
    def _clear() -> None:
        keys = list(PubDirectory.objects.filter(source=SOURCE).values_list("cache_key", flat=True))
        for model in (PubCommunityData, PubContributionLog, PubAmenity, PubEvent, PubPriceIndex, PubHours):
            model.objects.filter(cache_key__in=keys).delete()
        PubDirectory.objects.filter(source=SOURCE).delete()
        TourPlan.objects.filter(owner__device_id__startswith=SOURCE).delete()
        Account.objects.filter(device_id__startswith=SOURCE).delete()

    def _pub(self, rng, author, name, city, lat, lng, now) -> None:
        lat, lng = lat + rng.uniform(-0.018, 0.018), lng + rng.uniform(-0.028, 0.028)
        directory = PubDirectory.objects.create(
            name=name, lat=lat, lng=lng, city=city, country="cz", venue_kind=PubHours.VenueKind.PUB,
            source=SOURCE, active=True, refreshed_at=now,
        )
        key = directory.cache_key
        menu = []
        for beer, low, high in rng.sample(BEERS, rng.randint(2, 5)):
            volume = 400 if beer == "Matuška Raptor" else 500
            menu.append({"name": beer, "price_czk": rng.randint(low, high), "volume_ml": volume})
        days_ago = rng.choice([1, 2, 3, 5, 8, 12, 20, 40, 75, 120, 200])
        written = now - timedelta(days=days_ago)
        week = None
        if rng.random() < 0.5:
            evening = [["15:00", "23:00"]]
            week = {day: evening for day in ("mo", "tu", "we", "th")} | {
                "fr": [["15:00", "01:00"]], "sa": [["15:00", "01:00"]], "su": [],
            }
        PubCommunityData.objects.create(
            cache_key=key, name=name, lat=lat, lng=lng, city=city, beers=menu, beers_updated_at=written,
            hours_json=week, account=author,
        )
        log = PubContributionLog.objects.create(
            cache_key=key, name=name, lat=lat, lng=lng, kind=PubContributionLog.Kind.BEERS,
            payload={"beers": menu}, client_id=uuid.uuid4(), account=author,
        )
        PubContributionLog.objects.filter(pk=log.pk).update(created_at=written)
        upsert_pub_price_index(
            cache_key=key, name=name, lat=lat, lng=lng, beers=menu, observed_at=written,
            source=PubPriceIndex.Source.COMMUNITY, city=city,
        )
        for amenity in rng.sample(AMENITIES, rng.randint(0, 4)):
            yes = rng.random() < 0.75
            voters = rng.randint(3, 9)
            PubAmenity.objects.create(
                cache_key=key, pub_identity_key=f"{key}::{directory.name_key}", amenity_key=amenity, name=name,
                lat=lat, lng=lng, city=city, yes_count=voters if yes else 0, no_count=0 if yes else voters,
                distinct_voter_count=voters, status=PubAmenity.Status.YES if yes else PubAmenity.Status.NO,
                confidence=voters / (voters + 2),
            )
        if rng.random() < 0.15:
            title, details, hour, length = rng.choice(EVENTS)
            day = timezone.localdate(now) + timedelta(days=rng.randint(0, 20))
            starts = datetime.combine(day, time(hour), tzinfo=PRAGUE)
            PubEvent.objects.create(
                account=author, client_id=uuid.uuid4(), cache_key=key, name=name, lat=lat, lng=lng, city=city,
                title=title, details=details, starts_at=starts, ends_at=starts + timedelta(hours=length),
                status=PubEvent.Status.VERIFIED, verified_at=now,
            )

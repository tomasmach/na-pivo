import os

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    DrinkLog,
    EmailCredential,
    PubCommunityData,
    PubDirectory,
    PubHours,
)

# Synthetic fixtures around a fixed Prague simulator location, never a user's GPS.
LOCATION = (50.08759, 14.42108)


def seed():
    account = Account.objects.create(
        device_id="e2e-seeded-member", nickname="E2EPivar", display_name="E2E Pivař"
    )
    EmailCredential.objects.create(
        account=account,
        email=os.environ["NA_PIVO_E2E_EMAIL"],
        password=make_password(os.environ["NA_PIVO_E2E_PASSWORD"]),
        email_verified=True,
    )
    now = timezone.now()
    for index, name in enumerate(("E2E U Testera", "E2E Druhá hospoda", "E2E Třetí hospoda")):
        lat, lng = LOCATION[0] + index * 0.001, LOCATION[1] + index * 0.001
        key = geohash8(lat, lng)
        PubDirectory.objects.create(
            name=name,
            lat=lat,
            lng=lng,
            city="Praha",
            country="CZ",
            source="e2e",
            venue_kind="pub",
            has_beer_signal=True,
            refreshed_at=now,
        )
        PubHours.objects.create(
            cache_key=key,
            name=name,
            lat=lat,
            lng=lng,
            opening_hours_raw="24/7",
            fetched_at=now,
            confidence=1.0,
            status="ok",
            venue_kind="pub",
        )
        PubCommunityData.objects.create(
            cache_key=key,
            name=name,
            lat=lat,
            lng=lng,
            city="Praha",
            beers=[{"name": "E2E Ležák", "price_czk": 41, "volume_ml": 500}],
        )


def observe():
    return {
        "primaryDrinkPubNames": list(
            DrinkLog.objects.filter(account__nickname="E2EPivar")
            .order_by("pk")
            .values_list("name", flat=True)
        )
    }

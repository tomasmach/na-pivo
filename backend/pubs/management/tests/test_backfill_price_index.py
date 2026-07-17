from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.enrichment import geohash8
from pubs.models import PubCommunityData, PubExternalBeerMenu, PubPriceIndex


@pytest.mark.django_db
def test_backfill_price_index_is_idempotent():
    now = timezone.now()
    community_lat, community_lng = 50.0812, 14.4182
    external_lat, external_lng = 49.1951, 16.6068
    PubCommunityData.objects.create(
        cache_key=geohash8(community_lat, community_lng),
        name="Komunitní hospoda",
        lat=community_lat,
        lng=community_lng,
        city="Praha",
        beers=[{"name": "Ležák", "price_czk": 48, "volume_ml": 500}],
        beers_updated_at=now,
    )
    PubExternalBeerMenu.objects.create(
        cache_key=geohash8(external_lat, external_lng),
        name="Externí hospoda",
        lat=external_lat,
        lng=external_lng,
        city="Brno",
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="external-1",
        source_url="https://example.com/pub",
        beers=[{"name": "Desítka", "price_czk": 39, "volume_ml": 500}],
        verified_at=now,
    )

    first_stdout = StringIO()
    call_command("backfill_price_index", stdout=first_stdout)
    first = list(
        PubPriceIndex.objects.order_by("cache_key").values(
            "cache_key",
            "price_czk",
            "volume_ml",
            "observed_at",
            "source",
            "active",
        )
    )

    second_stdout = StringIO()
    call_command("backfill_price_index", stdout=second_stdout)
    second = list(
        PubPriceIndex.objects.order_by("cache_key").values(
            "cache_key",
            "price_czk",
            "volume_ml",
            "observed_at",
            "source",
            "active",
        )
    )

    assert first == second
    assert len(second) == 2
    assert {row["source"] for row in second} == {
        PubPriceIndex.Source.COMMUNITY,
        PubPriceIndex.Source.EXTERNAL,
    }
    assert "total=2" in first_stdout.getvalue()
    assert "total=2" in second_stdout.getvalue()

from datetime import timedelta

import pytest
from django.utils import timezone

from pubs.models import PubPriceIndex
from pubs.price_index import compute_reference_price, upsert_pub_price_index


def test_reference_price_uses_cheapest_large_or_unknown_volume_row():
    beers = [
        {"name": "Small", "price_czk": 25, "volume_ml": 300},
        {"name": "Unpriced", "price_czk": None, "volume_ml": 500},
        {"name": "Invalid low", "price_czk": 0, "volume_ml": 500},
        {"name": "Invalid high", "price_czk": 1001, "volume_ml": 500},
        {"name": "Half", "price_czk": 52, "volume_ml": 500},
        {"name": "Unknown", "price_czk": 45, "volume_ml": None},
        {"name": "Four deci", "price_czk": 49, "volume_ml": 400},
    ]

    assert compute_reference_price(beers) == (45, None)


def test_reference_price_returns_none_without_qualifying_row():
    assert compute_reference_price(
        [
            {"name": "Small", "price_czk": 30, "volume_ml": 330},
            {"name": "Unknown price", "price_czk": None, "volume_ml": 500},
        ]
    ) is None


@pytest.mark.django_db
def test_newer_higher_priority_price_replaces_lower_priority_price():
    now = timezone.now()
    PubPriceIndex.objects.create(
        cache_key="u2fkbnvy",
        name="U Testu",
        lat=50.08,
        lng=14.42,
        price_czk=48,
        volume_ml=500,
        observed_at=now - timedelta(days=2),
        source=PubPriceIndex.Source.DRINK,
    )

    result = upsert_pub_price_index(
        cache_key="u2fkbnvy",
        name="U Testu",
        lat=50.08,
        lng=14.42,
        beers=[{"name": "Ležák", "price_czk": 44, "volume_ml": 500}],
        observed_at=now - timedelta(days=1),
        source=PubPriceIndex.Source.COMMUNITY,
    )

    assert result is not None
    assert result.price_czk == 44
    assert result.source == PubPriceIndex.Source.COMMUNITY


@pytest.mark.django_db
def test_lower_priority_price_cannot_replace_fresh_community_price():
    now = timezone.now()
    PubPriceIndex.objects.create(
        cache_key="u2fkbnvy",
        name="U Testu",
        lat=50.08,
        lng=14.42,
        price_czk=44,
        volume_ml=500,
        observed_at=now - timedelta(days=2),
        source=PubPriceIndex.Source.COMMUNITY,
    )

    result = upsert_pub_price_index(
        cache_key="u2fkbnvy",
        name="U Testu",
        lat=50.08,
        lng=14.42,
        beers=[{"name": "Ležák", "price_czk": 48, "volume_ml": 500}],
        observed_at=now - timedelta(days=1),
        source=PubPriceIndex.Source.DRINK,
    )

    assert result is not None
    assert result.price_czk == 44
    assert result.source == PubPriceIndex.Source.COMMUNITY


@pytest.mark.django_db
def test_older_observation_never_rolls_price_index_back():
    now = timezone.now()
    PubPriceIndex.objects.create(
        cache_key="u2fkbnvy",
        name="U Testu",
        lat=50.08,
        lng=14.42,
        price_czk=48,
        volume_ml=500,
        observed_at=now - timedelta(days=1),
        source=PubPriceIndex.Source.DRINK,
    )

    result = upsert_pub_price_index(
        cache_key="u2fkbnvy",
        name="U Testu",
        lat=50.08,
        lng=14.42,
        beers=[{"name": "Ležák", "price_czk": 44, "volume_ml": 500}],
        observed_at=now - timedelta(days=2),
        source=PubPriceIndex.Source.COMMUNITY,
    )

    assert result is not None
    assert result.price_czk == 48
    assert result.source == PubPriceIndex.Source.DRINK

from __future__ import annotations

import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.beer_catalog_merge import merge_beer_products
from pubs.models import (
    Account,
    BeerBrand,
    BeerCheckIn,
    BeerProduct,
    BeerProductMergeAudit,
    DrinkLog,
    PubBeerProduct,
    PubCommunityData,
    PubExternalBeerMenu,
)


@pytest.mark.django_db
def test_merge_rewires_user_records_and_menu_links_without_loss():
    brand = BeerBrand.objects.create(key="merge-brewery", name="Merge Brewery")
    source = BeerProduct.objects.create(
        key="merge-ipa-duplicate",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Merge IPA dup",
        aliases=["Merge IPA duplicate"],
    )
    target = BeerProduct.objects.create(
        key="merge-ipa",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Merge IPA",
        aliases=[],
    )
    account = Account.objects.create(device_id=str(uuid.uuid4()))
    checkin = BeerCheckIn.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        beer_name=source.name,
        brewery_name=brand.name,
        beer_product=source,
        beer_key=source.key,
        brewery_key=brand.key,
    )
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name="U Tygra",
        lat=50.0,
        lng=14.0,
        city="Praha",
        external_id="",
        beer_name=source.name,
        beer_brand=brand,
        beer_brand_key=brand.key,
        beer_brand_name=brand.name,
        beer_product=source,
        beer_product_key=source.key,
        beer_product_name=source.name,
        price_czk=60,
        volume_ml=500,
        drank_at=timezone.now(),
    )
    link = PubBeerProduct.objects.create(
        cache_key="u2fkbn1z",
        name="U Tygra",
        lat=50.0,
        lng=14.0,
        city="Praha",
        external_id="",
        brand=brand,
        product=source,
        brand_key=brand.key,
        brand_name=brand.name,
        product_key=source.key,
        product_name=source.name,
        last_price_czk=60,
        last_volume_ml=500,
        source=PubBeerProduct.Source.DRINK,
        account=account,
    )
    community = PubCommunityData.objects.create(
        cache_key="u2fkbn1z",
        name="U Tygra",
        lat=50.0,
        lng=14.0,
        city="Praha",
        beers=[{"name": "Merge IPA duplicate", "price_czk": 60, "volume_ml": 500}],
        historical_beers=[{"name": source.name, "price_czk": 55, "volume_ml": 500}],
    )
    external = PubExternalBeerMenu.objects.create(
        cache_key="u2fkbn1z",
        name="U Tygra",
        lat=50.0,
        lng=14.0,
        city="Praha",
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="merge-menu",
        source_url="https://example.com/menu",
        beers=[{"name": source.name, "price_czk": 61, "volume_ml": 500}],
    )

    audit = merge_beer_products(
        source_key=source.key,
        target_key=target.key,
        actor="admin@example.com",
    )

    assert not BeerProduct.objects.filter(pk=source.pk).exists()
    checkin.refresh_from_db()
    drink.refresh_from_db()
    link.refresh_from_db()
    community.refresh_from_db()
    external.refresh_from_db()
    target.refresh_from_db()
    assert checkin.beer_product == target
    assert (checkin.beer_key, checkin.brewery_key) == (target.key, brand.key)
    assert drink.beer_product == target
    assert drink.beer_product_key == target.key
    assert link.product == target
    assert community.beers[0]["name"] == target.name
    assert community.historical_beers[0]["name"] == target.name
    assert external.beers[0]["name"] == target.name
    assert source.name in target.aliases
    assert audit.actor == "admin@example.com"
    assert audit.rewired["beer_checkins"] == 1
    assert audit.rewired["drink_logs"] == 1


@pytest.mark.django_db
def test_merge_is_idempotent_and_command_reports_the_existing_audit(capsys):
    brand = BeerBrand.objects.create(key="idem-brewery", name="Idem Brewery")
    source = BeerProduct.objects.create(
        key="idem-source",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Idem source",
    )
    target = BeerProduct.objects.create(
        key="idem-target",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Idem target",
    )

    first = merge_beer_products(source_key=source.key, target_key=target.key, actor="first")
    second = merge_beer_products(source_key=source.key, target_key=target.key, actor="second")
    call_command(
        "merge_beer_products",
        source=source.key,
        target=target.key,
        actor="third",
    )

    assert first.pk == second.pk
    assert BeerProductMergeAudit.objects.filter(source_key=source.key).count() == 1
    assert "Merged idem-source -> idem-target" in capsys.readouterr().out

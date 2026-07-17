# Hand-written: backfill canonical beer catalog fields and pub beer indexes.

from __future__ import annotations

import re
import unicodedata

from django.db import migrations
from django.utils import timezone

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def normalize_beer_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_text = decomposed.encode("ascii", "ignore").decode("ascii")
    return " ".join(_TOKEN_RE.findall(ascii_text.casefold()))


def alias_candidates(item) -> list[str]:
    values = [item.name, *(item.aliases or [])]
    normalized = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            continue
        candidate = normalize_beer_text(value)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def find_match(name: str, products: list, brands: list):
    normalized = normalize_beer_text(str(name or "").strip())
    if not normalized:
        return None

    best_product = None
    for product in products:
        for alias in alias_candidates(product):
            exact = normalized == alias
            prefix = normalized.startswith(f"{alias} ")
            contained = f" {alias} " in f" {normalized} "
            if not (exact or prefix or contained):
                continue
            score = 0 if exact else 1 if prefix else 2
            candidate = (score, product.rank, product)
            if best_product is None or candidate[:2] < best_product[:2]:
                best_product = candidate

    if best_product is not None:
        product = best_product[2]
        return product.brand, product

    best_brand = None
    for brand in brands:
        for alias in alias_candidates(brand):
            exact = normalized == alias
            prefix = normalized.startswith(f"{alias} ")
            contained = f" {alias} " in f" {normalized} "
            if not (exact or prefix or contained):
                continue
            score = 0 if exact else 1 if prefix else 2
            candidate = (score, brand.rank, brand)
            if best_brand is None or candidate[:2] < best_brand[:2]:
                best_brand = candidate

    if best_brand is None:
        return None
    return best_brand[2], None


def load_catalog(apps):
    BeerBrand = apps.get_model("pubs", "BeerBrand")
    BeerProduct = apps.get_model("pubs", "BeerProduct")
    products = list(
        BeerProduct.objects.select_related("brand")
        .filter(active=True, brand__active=True)
        .order_by("rank", "name")
    )
    brands = list(BeerBrand.objects.filter(active=True).order_by("rank", "name"))
    return products, brands


def upsert_pub_indexes(
    *,
    pub_beer_brand_model,
    pub_beer_product_model,
    cache_key: str,
    row,
    beer: dict,
    brand,
    product,
    seen_at,
) -> None:
    pub_beer_brand_model.objects.update_or_create(
        cache_key=cache_key,
        brand=brand,
        defaults={
            "name": row.name,
            "lat": row.lat,
            "lng": row.lng,
            "city": row.city or "",
            "external_id": row.external_id or "",
            "brand_key": brand.key,
            "brand_name": brand.name,
            "last_price_czk": beer.get("price_czk"),
            "last_volume_ml": beer.get("volume_ml"),
            "source": "community",
            "active": True,
            "account_id": row.account_id,
            "last_seen_at": seen_at,
        },
    )

    if product is None:
        return

    pub_beer_product_model.objects.update_or_create(
        cache_key=cache_key,
        product=product,
        defaults={
            "name": row.name,
            "lat": row.lat,
            "lng": row.lng,
            "city": row.city or "",
            "external_id": row.external_id or "",
            "brand": brand,
            "brand_key": brand.key,
            "brand_name": brand.name,
            "product_key": product.key,
            "product_name": product.name,
            "last_price_czk": beer.get("price_czk"),
            "last_volume_ml": beer.get("volume_ml"),
            "source": "community",
            "active": True,
            "account_id": row.account_id,
            "last_seen_at": seen_at,
        },
    )


def backfill_beer_catalog_indexes(apps, schema_editor):
    DrinkLog = apps.get_model("pubs", "DrinkLog")
    PubBeerBrand = apps.get_model("pubs", "PubBeerBrand")
    PubBeerProduct = apps.get_model("pubs", "PubBeerProduct")
    PubCommunityData = apps.get_model("pubs", "PubCommunityData")
    products, brands = load_catalog(apps)

    for drink in DrinkLog.objects.all().iterator(chunk_size=500):
        match = find_match(drink.beer_name, products, brands)
        if match is None:
            continue
        brand, product = match
        drink.beer_brand = brand
        drink.beer_brand_key = brand.key
        drink.beer_brand_name = brand.name
        drink.beer_product = product
        drink.beer_product_key = product.key if product is not None else ""
        drink.beer_product_name = product.name if product is not None else ""
        drink.save(
            update_fields=[
                "beer_brand",
                "beer_brand_key",
                "beer_brand_name",
                "beer_product",
                "beer_product_key",
                "beer_product_name",
            ]
        )

    for row in PubCommunityData.objects.all().iterator(chunk_size=200):
        active_brand_keys = set()
        active_product_keys = set()
        seen_at = row.beers_updated_at or row.updated_at or timezone.now()
        beers = row.beers if isinstance(row.beers, list) else []

        for beer in beers:
            if not isinstance(beer, dict):
                continue
            match = find_match(beer.get("name"), products, brands)
            if match is None:
                continue
            brand, product = match
            active_brand_keys.add(brand.key)
            if product is not None:
                active_product_keys.add(product.key)
            upsert_pub_indexes(
                pub_beer_brand_model=PubBeerBrand,
                pub_beer_product_model=PubBeerProduct,
                cache_key=row.cache_key,
                row=row,
                beer=beer,
                brand=brand,
                product=product,
                seen_at=seen_at,
            )

        stale_brands = PubBeerBrand.objects.filter(cache_key=row.cache_key, active=True)
        if active_brand_keys:
            stale_brands = stale_brands.exclude(brand_key__in=active_brand_keys)
        stale_brands.update(active=False, last_seen_at=seen_at)

        stale_products = PubBeerProduct.objects.filter(cache_key=row.cache_key, active=True)
        if active_product_keys:
            stale_products = stale_products.exclude(product_key__in=active_product_keys)
        stale_products.update(active=False, last_seen_at=seen_at)


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0033_seed_beer_products"),
    ]

    operations = [
        migrations.RunPython(backfill_beer_catalog_indexes, migrations.RunPython.noop),
    ]

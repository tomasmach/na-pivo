"""Transactional, audit-friendly canonical beer-product merges."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Case, Q, Value, When

from pubs.beer_catalog import normalize_beer_text
from pubs.models import (
    BeerCheckIn,
    BeerProduct,
    BeerProductMergeAudit,
    DrinkLog,
    PubBeerProduct,
    PubCommunityData,
    PubExternalBeerMenu,
)


def _source_candidates(product: BeerProduct) -> set[str]:
    brand_values = [product.brand.name, *(product.brand.aliases or [])]
    product_values = [product.name, *(product.aliases or [])]
    candidates = {normalize_beer_text(value) for value in product_values if isinstance(value, str)}
    candidates.update(
        normalize_beer_text(f"{brand} {beer}")
        for brand in brand_values
        for beer in product_values
        if isinstance(brand, str) and isinstance(beer, str)
    )
    return {value for value in candidates if value}


def _matching_legacy_checkin_ids(source: BeerProduct, candidates: set[str]) -> list[int]:
    ids: list[int] = []
    rows = BeerCheckIn.objects.filter(beer_product__isnull=True).only(
        "id", "beer_name", "brewery_name", "beer_key"
    )
    for row in rows.iterator(chunk_size=500):
        beer = normalize_beer_text(row.beer_name)
        combined = normalize_beer_text(f"{row.brewery_name} {row.beer_name}")
        if row.beer_key == source.key or beer in candidates or combined in candidates:
            ids.append(row.id)
    return ids


def _matching_legacy_drink_ids(source: BeerProduct, candidates: set[str]) -> list[int]:
    ids: list[int] = []
    rows = DrinkLog.objects.filter(beer_product__isnull=True).only(
        "id", "beer_name", "beer_product_key"
    )
    for row in rows.iterator(chunk_size=500):
        if row.beer_product_key == source.key or normalize_beer_text(row.beer_name) in candidates:
            ids.append(row.id)
    return ids


def _rewrite_menu_rows(model, candidates: set[str], target_name: str) -> tuple[int, int]:
    changed_rows = 0
    changed_items = 0
    fields = ("beers", "historical_beers") if model is PubCommunityData else ("beers",)
    for row in model.objects.all().iterator(chunk_size=200):
        update_fields: list[str] = []
        for field in fields:
            items = getattr(row, field, None)
            if not isinstance(items, list):
                continue
            changed = False
            updated: list = []
            for item in items:
                if not isinstance(item, dict):
                    updated.append(item)
                    continue
                name = item.get("name")
                if isinstance(name, str) and normalize_beer_text(name) in candidates:
                    item = {**item, "name": target_name}
                    changed = True
                    changed_items += 1
                updated.append(item)
            if changed:
                setattr(row, field, updated)
                update_fields.append(field)
        if update_fields:
            row.save(update_fields=[*update_fields, "updated_at"])
            changed_rows += 1
    return changed_rows, changed_items


@transaction.atomic
def merge_beer_products(*, source_key: str, target_key: str, actor: str = "") -> BeerProductMergeAudit:
    """Merge ``source`` into ``target`` once and return the durable audit row."""

    existing = BeerProductMergeAudit.objects.filter(source_key=source_key).first()
    if existing is not None:
        if existing.target_key != target_key:
            raise ValueError(
                f"{source_key} was already merged into {existing.target_key}, not {target_key}."
            )
        return existing
    if source_key == target_key:
        raise ValueError("Source and target beer products must be different.")

    products = {
        product.key: product
        for product in BeerProduct.objects.select_for_update()
        .select_related("brand")
        .filter(key__in=(source_key, target_key))
    }
    source = products.get(source_key)
    target = products.get(target_key)
    if source is None:
        raise BeerProduct.DoesNotExist(f"Unknown source beer product: {source_key}")
    if target is None:
        raise BeerProduct.DoesNotExist(f"Unknown target beer product: {target_key}")

    candidates = _source_candidates(source)
    target.aliases = list(
        dict.fromkeys(
            [
                *(target.aliases or []),
                source.name,
                *(source.aliases or []),
            ]
        )
    )
    target.save(update_fields=["aliases", "updated_at"])

    legacy_checkins = _matching_legacy_checkin_ids(source, candidates)
    checkins = BeerCheckIn.objects.filter(
        Q(beer_product=source) | Q(beer_key=source.key) | Q(id__in=legacy_checkins)
    ).update(
        beer_product=target,
        beer_key=target.key,
        brewery_key=Case(
            When(brewery_name="", then=Value("")),
            default=Value(target.brand.key),
        ),
    )
    legacy_drinks = _matching_legacy_drink_ids(source, candidates)
    drinks = DrinkLog.objects.filter(
        Q(beer_product=source) | Q(beer_product_key=source.key) | Q(id__in=legacy_drinks)
    ).update(
        beer_product=target,
        beer_product_key=target.key,
        beer_product_name=target.name,
        beer_brand=target.brand,
        beer_brand_key=target.brand.key,
        beer_brand_name=target.brand.name,
    )

    pub_links = 0
    for link in PubBeerProduct.objects.select_for_update().filter(product=source):
        existing_link = PubBeerProduct.objects.filter(
            cache_key=link.cache_key,
            product=target,
        ).first()
        if existing_link is not None:
            if link.last_seen_at > existing_link.last_seen_at:
                existing_link.last_price_czk = link.last_price_czk
                existing_link.last_volume_ml = link.last_volume_ml
                existing_link.last_seen_at = link.last_seen_at
                existing_link.source = link.source
                existing_link.account = link.account
            existing_link.active = existing_link.active or link.active
            existing_link.save()
            link.delete()
        else:
            link.product = target
            link.product_key = target.key
            link.product_name = target.name
            link.brand = target.brand
            link.brand_key = target.brand.key
            link.brand_name = target.brand.name
            link.save()
        pub_links += 1

    community_rows, community_items = _rewrite_menu_rows(
        PubCommunityData, candidates, target.name
    )
    external_rows, external_items = _rewrite_menu_rows(
        PubExternalBeerMenu, candidates, target.name
    )
    audit = BeerProductMergeAudit.objects.create(
        source_product_id=source.id,
        source_key=source.key,
        source_name=source.name,
        target_product_id=target.id,
        target_key=target.key,
        target_name=target.name,
        actor=actor.strip()[:160],
        rewired={
            "drink_logs": drinks,
            "beer_checkins": checkins,
            "pub_product_links": pub_links,
            "community_menu_rows": community_rows,
            "community_menu_items": community_items,
            "external_menu_rows": external_rows,
            "external_menu_items": external_items,
        },
    )
    source.delete()
    return audit

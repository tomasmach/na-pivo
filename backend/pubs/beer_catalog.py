"""Beer catalogue helpers for suggestions and name normalization."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from django.utils import timezone

from pubs.models import BeerBrand, BeerProduct, PubBeerBrand, PubBeerProduct

_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class BeerMatch:
    brand: BeerBrand
    product: BeerProduct | None
    submitted_name: str

    @property
    def beer_name(self) -> str:
        return self.product.name if self.product else self.brand.name


@dataclass(frozen=True)
class BeerSuggestion:
    slug: str
    name: str
    kind: str
    brand_slug: str
    brand_name: str


def normalize_beer_text(value: str) -> str:
    """Return an accent-insensitive token string for beer-brand matching."""
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_text = decomposed.encode("ascii", "ignore").decode("ascii")
    return " ".join(_TOKEN_RE.findall(ascii_text.casefold()))


def _alias_candidates(brand: BeerBrand) -> list[str]:
    values = [brand.name, *(brand.aliases or [])]
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        candidate = normalize_beer_text(value)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _product_alias_candidates(product: BeerProduct) -> list[str]:
    values = [product.name, *(product.aliases or [])]
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        candidate = normalize_beer_text(value)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def match_beer(name: str, *, fuzzy: bool = True) -> BeerMatch | None:
    """Find a canonical product/brand for a submitted beer name, if recognized."""
    submitted = name.strip()
    normalized = normalize_beer_text(submitted)
    if not normalized:
        return None

    best_product: tuple[int, int, BeerProduct] | None = None
    products = BeerProduct.objects.select_related("brand").filter(active=True, brand__active=True)
    for product in products.order_by("rank", "name"):
        for alias in _product_alias_candidates(product):
            exact = normalized == alias
            prefix = normalized.startswith(f"{alias} ")
            contained = f" {alias} " in f" {normalized} "
            if not (exact or (fuzzy and (prefix or contained))):
                continue
            score = 0 if exact else 1 if prefix else 2
            candidate = (score, product.rank, product)
            if best_product is None or candidate[:2] < best_product[:2]:
                best_product = candidate

    if best_product is not None:
        product = best_product[2]
        return BeerMatch(brand=product.brand, product=product, submitted_name=submitted)

    best_brand: tuple[int, int, BeerBrand] | None = None
    for brand in BeerBrand.objects.filter(active=True).order_by("rank", "name"):
        for alias in _alias_candidates(brand):
            exact = normalized == alias
            prefix = normalized.startswith(f"{alias} ")
            # Covers common free-text names such as "tanková Plzeň" without
            # matching tiny aliases inside unrelated words.
            contained = f" {alias} " in f" {normalized} "
            if not (exact or (fuzzy and (prefix or contained))):
                continue
            score = 0 if exact else 1 if prefix else 2
            candidate = (score, brand.rank, brand)
            if best_brand is None or candidate[:2] < best_brand[:2]:
                best_brand = candidate

    if best_brand is None:
        return None
    return BeerMatch(brand=best_brand[2], product=None, submitted_name=submitted)


def match_beer_brand(name: str, *, fuzzy: bool = True) -> BeerMatch | None:
    """Compatibility wrapper for callers that only need the parent brand."""
    return match_beer(name, fuzzy=fuzzy)


def normalize_beer_payload(beer: dict) -> dict:
    """Return a canonical beer dict, preserving optional price/volume fields."""
    raw_name = str(beer["name"]).strip()
    out = {
        "name": raw_name,
        "price_czk": beer.get("price_czk"),
        "volume_ml": beer.get("volume_ml"),
    }
    match = match_beer(raw_name, fuzzy=False)
    if match is None:
        return out

    out["name"] = match.beer_name
    return out


def upsert_pub_beer_brand(
    *,
    cache_key: str,
    data: dict,
    beer: dict,
    source: str,
    account,
) -> BeerMatch | None:
    """Update the queryable per-pub brand index for a normalized beer payload."""
    match = match_beer(str(beer.get("name") or ""))
    if match is None:
        return None

    brand = match.brand
    now = timezone.now()

    PubBeerBrand.objects.update_or_create(
        cache_key=cache_key,
        brand=brand,
        defaults={
            "name": data["name"],
            "lat": data["lat"],
            "lng": data["lng"],
            "city": data.get("city") or "",
            "external_id": data.get("external_id") or "",
            "brand_key": brand.key,
            "brand_name": brand.name,
            "last_price_czk": beer.get("price_czk"),
            "last_volume_ml": beer.get("volume_ml"),
            "source": source,
            "active": True,
            "account": account,
            "last_seen_at": now,
        },
    )

    if match.product is None:
        return match

    product = match.product
    PubBeerProduct.objects.update_or_create(
        cache_key=cache_key,
        product=product,
        defaults={
            "name": data["name"],
            "lat": data["lat"],
            "lng": data["lng"],
            "city": data.get("city") or "",
            "external_id": data.get("external_id") or "",
            "brand": brand,
            "brand_key": brand.key,
            "brand_name": brand.name,
            "product_key": product.key,
            "product_name": product.name,
            "last_price_czk": beer.get("price_czk"),
            "last_volume_ml": beer.get("volume_ml"),
            "source": source,
            "active": True,
            "account": account,
            "last_seen_at": now,
        },
    )
    return match


def sync_pub_beer_indexes_for_menu(
    *,
    cache_key: str,
    data: dict,
    beers: list[dict],
    source: str,
    account,
) -> None:
    """Make the active per-pub beer indexes match a full community menu write."""
    active_brand_keys: set[str] = set()
    active_product_keys: set[str] = set()

    for beer in beers:
        match = upsert_pub_beer_brand(
            cache_key=cache_key,
            data=data,
            beer=beer,
            source=source,
            account=account,
        )
        if match is None:
            continue
        active_brand_keys.add(match.brand.key)
        if match.product is not None:
            active_product_keys.add(match.product.key)

    now = timezone.now()
    stale_brands = PubBeerBrand.objects.filter(cache_key=cache_key, active=True)
    if active_brand_keys:
        stale_brands = stale_brands.exclude(brand_key__in=active_brand_keys)
    stale_brands.update(active=False, last_seen_at=now)

    stale_products = PubBeerProduct.objects.filter(cache_key=cache_key, active=True)
    if active_product_keys:
        stale_products = stale_products.exclude(product_key__in=active_product_keys)
    stale_products.update(active=False, last_seen_at=now)


def suggest_beers(query: str, *, limit: int = 12) -> list[BeerSuggestion]:
    """Return active product-first suggestions for beer autocomplete."""
    normalized_query = normalize_beer_text(query)
    products = BeerProduct.objects.select_related("brand").filter(active=True, brand__active=True)
    if len(normalized_query) < 2:
        return [
            BeerSuggestion(
                slug=product.key,
                name=product.name,
                kind="product",
                brand_slug=product.brand.key,
                brand_name=product.brand.name,
            )
            for product in products.order_by("rank", "name")[:limit]
        ]

    scored: list[tuple[int, int, str, BeerSuggestion]] = []
    for product in products.order_by("rank", "name"):
        aliases = _product_alias_candidates(product)
        if not aliases:
            continue
        score = 3
        for alias in aliases:
            if alias == normalized_query:
                score = min(score, 0)
            elif alias.startswith(normalized_query) or normalized_query.startswith(f"{alias} "):
                score = min(score, 1)
            elif normalized_query in alias:
                score = min(score, 2)
        if score < 3:
            scored.append(
                (
                    score,
                    product.rank,
                    product.name,
                    BeerSuggestion(
                        slug=product.key,
                        name=product.name,
                        kind="product",
                        brand_slug=product.brand.key,
                        brand_name=product.brand.name,
                    ),
                )
            )

    for brand in BeerBrand.objects.filter(active=True).order_by("rank", "name"):
        aliases = _alias_candidates(brand)
        if not aliases:
            continue
        score = 7
        for alias in aliases:
            if alias == normalized_query:
                score = min(score, 4)
            elif alias.startswith(normalized_query) or normalized_query.startswith(f"{alias} "):
                score = min(score, 5)
            elif normalized_query in alias:
                score = min(score, 6)
        if score < 7:
            scored.append(
                (
                    score,
                    brand.rank,
                    brand.name,
                    BeerSuggestion(
                        slug=brand.key,
                        name=brand.name,
                        kind="brand",
                        brand_slug=brand.key,
                        brand_name=brand.name,
                    ),
                )
            )

    scored.sort(key=lambda item: (item[0], item[1], item[2]))
    return [item for _, _, _, item in scored[:limit]]


def suggest_beer_brands(query: str, *, limit: int = 12) -> list[BeerSuggestion]:
    """Compatibility wrapper: endpoint now suggests concrete beers first."""
    return suggest_beers(query, limit=limit)

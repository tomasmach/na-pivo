"""Beer brand catalogue helpers for suggestions and name normalization."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from pubs.models import BeerBrand, PubBeerBrand

_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class BeerBrandMatch:
    brand: BeerBrand
    submitted_name: str

    @property
    def beer_name(self) -> str:
        return self.brand.name


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


def match_beer_brand(name: str, *, fuzzy: bool = True) -> BeerBrandMatch | None:
    """Find a canonical brand for a submitted beer name, if recognized."""
    submitted = name.strip()
    normalized = normalize_beer_text(submitted)
    if not normalized:
        return None

    best: tuple[int, int, BeerBrand] | None = None
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
            if best is None or candidate[:2] < best[:2]:
                best = candidate

    if best is None:
        return None
    return BeerBrandMatch(brand=best[2], submitted_name=submitted)


def normalize_beer_payload(beer: dict) -> dict:
    """Return a canonical beer dict, preserving optional price/volume fields."""
    raw_name = str(beer["name"]).strip()
    out = {
        "name": raw_name,
        "price_czk": beer.get("price_czk"),
        "volume_ml": beer.get("volume_ml"),
    }
    match = match_beer_brand(raw_name, fuzzy=False)
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
) -> None:
    """Update the queryable per-pub brand index for a normalized beer payload."""
    match = match_beer_brand(str(beer.get("name") or ""))
    if match is None:
        return

    brand = match.brand

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
        },
    )


def suggest_beer_brands(query: str, *, limit: int = 12) -> list[BeerBrand]:
    """Return active brands ranked for a short autocomplete query."""
    normalized_query = normalize_beer_text(query)
    qs = BeerBrand.objects.filter(active=True).order_by("rank", "name")
    if len(normalized_query) < 2:
        return list(qs[:limit])

    scored: list[tuple[int, int, BeerBrand]] = []
    for brand in qs:
        aliases = _alias_candidates(brand)
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
            scored.append((score, brand.rank, brand))

    scored.sort(key=lambda item: (item[0], item[1], item[2].name))
    return [brand for _, _, brand in scored[:limit]]

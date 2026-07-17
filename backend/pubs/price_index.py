"""Reference-price computation and the materialized per-pub price index."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from pubs.enrichment import names_match
from pubs.models import PubCommunityData, PubPriceIndex

logger = logging.getLogger(__name__)

_IN_APP_SOURCES = {PubPriceIndex.Source.COMMUNITY, PubPriceIndex.Source.DRINK}
_DRINK_OUTLIER_MAX_AGE = timedelta(days=180)
_PRICE_EXPIRY = timedelta(days=365)
_SOURCE_PRIORITY = {
    PubPriceIndex.Source.EXTERNAL: 1,
    PubPriceIndex.Source.DRINK: 2,
    PubPriceIndex.Source.COMMUNITY: 3,
}


def compute_reference_price(beers: list[dict] | None) -> tuple[int, int | None] | None:
    """Return the cheapest valid Czech half-litre-equivalent menu row."""
    candidates: list[tuple[int, int | None]] = []
    for beer in beers or []:
        price = beer.get("price_czk")
        volume = beer.get("volume_ml")
        if isinstance(price, bool) or not isinstance(price, int) or not 1 <= price <= 1000:
            continue
        if volume is not None and (
            isinstance(volume, bool) or not isinstance(volume, int) or volume < 400
        ):
            continue
        candidates.append((price, volume))
    return min(candidates, key=lambda candidate: candidate[0], default=None)


def has_user_beer_menu(*, cache_key: str, name: str) -> bool:
    """Whether an app user has supplied or explicitly cleared this pub's menu."""
    for row in PubCommunityData.objects.filter(cache_key=cache_key):
        if not names_match(name, row.name):
            continue
        if row.beers_updated_at is not None or bool(row.beers):
            return True
    return False


def _is_drink_outlier(existing: PubPriceIndex, new_price: int) -> bool:
    if not existing.active or timezone.now() - existing.observed_at >= _DRINK_OUTLIER_MAX_AGE:
        return False
    return new_price > existing.price_czk * 3 or existing.price_czk > new_price * 3


def _keeps_precedence(
    existing: PubPriceIndex,
    *,
    source: str,
    observed_at,
) -> bool:
    """Whether an existing observation must survive this incoming write.

    Older observations never roll the index back. Among observations that are
    at least as new, a fresh active higher-trust source wins until its hard
    one-year expiry. An inactive row still records an explicit menu clear, so
    an older write must not resurrect it.
    """
    if observed_at < existing.observed_at:
        return True
    if not existing.active:
        return False
    if timezone.now() - existing.observed_at >= _PRICE_EXPIRY:
        return False
    return _SOURCE_PRIORITY[existing.source] > _SOURCE_PRIORITY[source]


def upsert_pub_price_index(
    *,
    cache_key: str,
    name: str,
    lat: float,
    lng: float,
    beers: list[dict] | None,
    observed_at,
    source: str,
    city: str = "",
    external_id: str = "",
) -> PubPriceIndex | None:
    """Recompute and persist the current reference price for one pub."""
    if source not in PubPriceIndex.Source.values:
        raise ValueError(f"Unsupported pub price source: {source}")
    if observed_at is None:
        return None
    if source == PubPriceIndex.Source.EXTERNAL and has_user_beer_menu(
        cache_key=cache_key,
        name=name,
    ):
        return None

    reference = compute_reference_price(beers)
    with transaction.atomic():
        existing = (
            PubPriceIndex.objects.select_for_update().filter(cache_key=cache_key).first()
        )
        if (
            existing is not None
            and source == PubPriceIndex.Source.DRINK
            and reference is not None
            and _is_drink_outlier(existing, reference[0])
        ):
            logger.warning(
                "pub-price-index: rejected drink outlier for cache key %s (%s -> %s CZK)",
                cache_key,
                existing.price_czk,
                reference[0],
            )
            return existing
        if existing is not None and _keeps_precedence(
            existing,
            source=source,
            observed_at=observed_at,
        ):
            return existing

        if reference is None:
            if source in _IN_APP_SOURCES and existing is not None:
                existing.name = name
                existing.lat = lat
                existing.lng = lng
                existing.city = city or ""
                existing.external_id = external_id or ""
                existing.observed_at = observed_at
                existing.source = source
                existing.active = False
                existing.save(
                    update_fields=[
                        "name",
                        "lat",
                        "lng",
                        "city",
                        "external_id",
                        "observed_at",
                        "source",
                        "active",
                        "updated_at",
                    ]
                )
            return existing

        price_czk, volume_ml = reference
        values = {
            "name": name,
            "lat": lat,
            "lng": lng,
            "city": city or "",
            "external_id": external_id or "",
            "price_czk": price_czk,
            "volume_ml": volume_ml,
            "observed_at": observed_at,
            "source": source,
            "active": True,
        }
        if existing is not None:
            for field, value in values.items():
                setattr(existing, field, value)
            existing.save(update_fields=[*values, "updated_at"])
            return existing

        try:
            with transaction.atomic():
                return PubPriceIndex.objects.create(cache_key=cache_key, **values)
        except IntegrityError:
            existing = PubPriceIndex.objects.select_for_update().get(cache_key=cache_key)
            if _keeps_precedence(
                existing,
                source=source,
                observed_at=observed_at,
            ):
                return existing
            for field, value in values.items():
                setattr(existing, field, value)
            existing.save(update_fields=[*values, "updated_at"])
            return existing

"""Beer watch: tell people when a beer they watch newly appears on a pub menu nearby."""

from __future__ import annotations

import math

from pubs.models import BeerTapEvent, PubBeerProduct

# ~500 m cells; the app snaps with the same steps, so precise coordinates never leave the phone.
GRID_LAT_STEP = 0.0045
GRID_LNG_STEP = 0.007
RADIUS_CHOICES_M = (1000, 3000, 5000, 10000)
MAX_WATCHES = 50


def snap_to_grid(value: float, step: float) -> float:
    return round((math.floor(value / step) + 0.5) * step, 5)


def snap_location(lat: float, lng: float) -> tuple[float, float]:
    return snap_to_grid(lat, GRID_LAT_STEP), snap_to_grid(lng, GRID_LNG_STEP)


def pub_product_ids(cache_keys) -> set[int]:
    """Every catalogue product the pub ever had in the index, served now or not."""
    return set(
        PubBeerProduct.objects.filter(cache_key__in=cache_keys).values_list("product_id", flat=True)
    )


def record_new_tap_events(
    *,
    cache_keys,
    known_product_ids: set[int],
    cache_key: str,
    pub_name: str,
    lat: float,
    lng: float,
    contributor,
    observed_at,
) -> int:
    """Create an event for each product now served at the pub that it never had before."""
    new_ids = (
        set(
            PubBeerProduct.objects.filter(cache_key__in=cache_keys, active=True).values_list(
                "product_id", flat=True
            )
        )
        - known_product_ids
    )
    if not new_ids:
        return 0
    BeerTapEvent.objects.bulk_create(
        [
            BeerTapEvent(
                cache_key=cache_key,
                pub_name=pub_name,
                lat=lat,
                lng=lng,
                product_id=product_id,
                contributor=contributor,
                observed_at=observed_at,
            )
            for product_id in sorted(new_ids)
        ],
        ignore_conflicts=True,
    )
    return len(new_ids)

"""Czech regions (kraje) of a pub cell, for the regional beer ranking.

Boundaries come from ČÚZK INSPIRE administrative units (CC BY 4.0) via
siwekm/czech-geojson, simplified to ~200 m in ``data/cz_regions.json``.
Only a pub's geohash cell is looked up; no person's location is involved.
"""

from __future__ import annotations

import json
from functools import cache, lru_cache
from pathlib import Path

import geohash2

_DATA = Path(__file__).with_name("data") / "cz_regions.json"


@cache
def _regions() -> list[tuple[str, tuple[float, float, float, float], list[list[list[float]]]]]:
    raw = json.loads(_DATA.read_text(encoding="utf-8"))
    out = []
    for region in raw["regions"]:
        outer = region["rings"][0]
        xs = [point[0] for point in outer]
        ys = [point[1] for point in outer]
        out.append((region["code"], (min(xs), min(ys), max(xs), max(ys)), region["rings"]))
    return out


REGION_CODES = (
    "CZ010",
    "CZ020",
    "CZ031",
    "CZ032",
    "CZ041",
    "CZ042",
    "CZ051",
    "CZ052",
    "CZ053",
    "CZ063",
    "CZ064",
    "CZ071",
    "CZ072",
    "CZ080",
)


def _inside(lng: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def region_of(lat: float, lng: float) -> str | None:
    """NUTS 3 code of the Czech region containing the point, or None outside Czechia."""
    for code, (min_x, min_y, max_x, max_y), rings in _regions():
        if not (min_x <= lng <= max_x and min_y <= lat <= max_y):
            continue
        # Rings after the first are holes (Praha inside Středočeský kraj).
        if _inside(lng, lat, rings[0]) and not any(_inside(lng, lat, hole) for hole in rings[1:]):
            return code
    return None


@lru_cache(maxsize=50_000)
def region_of_cell(cache_key: str | None) -> str | None:
    """Region of a pub's geohash cell, or None for an empty or foreign cell."""
    if not cache_key:
        return None
    try:
        lat, lng, _lat_err, _lng_err = geohash2.decode_exactly(cache_key)
    except KeyError, ValueError:
        return None
    return region_of(float(lat), float(lng))

"""Which of Prague's 22 administrative districts (Praha 1–22) a pub's position lies in.

Boundaries live in ``data/prague_districts.json``; ``data/README.md`` says where they
come from, under which licence and how to rebuild them.
"""

from __future__ import annotations

import json
import math
from functools import cache
from pathlib import Path

from pubs.regions import _inside

_DATA = Path(__file__).with_name("data") / "prague_districts.json"
# How far a pub may stand outside the district its address names and still be there:
# the simplified line is off by up to 5 m and geocoded positions by a few tens.
ADDRESS_SLACK_M = 50
_METRES_PER_DEGREE = 111_320
_ON_BORDER_M = 0.5


@cache
def _districts() -> dict[str, tuple[tuple[float, float, float, float], list[list[list[float]]]]]:
    raw = json.loads(_DATA.read_text(encoding="utf-8"))
    out = {}
    for district in raw["districts"]:
        outer = district["rings"][0]
        xs = [point[0] for point in outer]
        ys = [point[1] for point in outer]
        out[district["name"]] = ((min(xs), min(ys), max(xs), max(ys)), district["rings"])
    return out


def _contains(rings: list[list[list[float]]], lat: float, lng: float) -> bool:
    return _inside(lng, lat, rings[0]) and not any(_inside(lng, lat, hole) for hole in rings[1:])


def district_at(lat: float | None, lng: float | None) -> str:
    """"Praha 7" for a point in Prague 7, "" outside Prague or without a position."""

    if lat is None or lng is None:
        return ""
    for name, ((min_x, min_y, max_x, max_y), rings) in _districts().items():
        if min_x <= lng <= max_x and min_y <= lat <= max_y and _contains(rings, lat, lng):
            return name
    # A point on the line two districts share is inside neither ring; the first of them takes it.
    return next((name for name in _districts() if near_district(name, lat, lng, _ON_BORDER_M)), "")


def _metres_to_edge(rings: list[list[list[float]]], lat: float, lng: float) -> float:
    scale = math.cos(math.radians(lat))
    best = math.inf
    for ring in rings:
        previous = ring[-1]
        for current in ring:
            ax, ay = (previous[0] - lng) * scale, previous[1] - lat
            bx, by = (current[0] - lng) * scale, current[1] - lat
            dx, dy = bx - ax, by - ay
            length = dx * dx + dy * dy
            t = 0.0 if length == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length))
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
            previous = current
    return best * _METRES_PER_DEGREE


def near_district(name: str, lat: float, lng: float, slack_m: float = ADDRESS_SLACK_M) -> bool:
    """Whether the point lies in the named district or within ``slack_m`` of its border."""

    found = _districts().get(name)
    if found is None:
        return False
    (min_x, min_y, max_x, max_y), rings = found
    pad = slack_m / _METRES_PER_DEGREE
    if not (min_x - pad * 2 <= lng <= max_x + pad * 2 and min_y - pad <= lat <= max_y + pad):
        return False
    return _contains(rings, lat, lng) or _metres_to_edge(rings, lat, lng) <= slack_m

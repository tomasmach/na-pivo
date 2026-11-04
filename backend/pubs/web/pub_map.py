"""Data of the web maps: the street map in the browser and its fallback drawn on the server.

``live_map`` feeds ``web/components/map.html``: MapLibre (served by us) draws
OpenFreeMap tiles in the browser. ``pub_map`` draws the same pins as inline SVG
on top of the density of pubs around; the page shows that drawing without
JavaScript, before the tiles arrive and when they never do.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from django.utils.safestring import mark_safe

WIDTH, HEIGHT = 668, 568
_CELL = 9
_PAD = 0.14
# At least about 700 m across, so one pub does not fill the frame.
_MIN_SPAN_LAT = 0.0065
_SCALES = (50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000)
# Width of one character of the 12 px bold label, generous for capitals.
_CHAR = 7.8
_BEER = mark_safe((Path(__file__).resolve().parent / "icons" / "beer.svg").read_text().strip())


def _scale_label(metres: int) -> str:
    return f"{metres // 1000}\u00a0km" if metres >= 1000 else f"{metres}\u00a0m"


def pub_map(
    points: list[dict],
    background: list[tuple[float, float]] | None = None,
    focus: bool = False,
    size: tuple[int, int] = (WIDTH, HEIGHT),
) -> dict | None:
    """SVG geometry for ``web/pubs/_map.html``.

    ``points`` are ``{"lat", "lng", "label", "url"}``; a point without a label is a
    small dot. ``background`` are other pubs, drawn as density. ``focus`` draws the
    one point as the big pin of a pub page.
    """

    if not points:
        return None
    width, height = size
    lats = [point["lat"] for point in points]
    lngs = [point["lng"] for point in points]
    mid_lat = (min(lats) + max(lats)) / 2
    squeeze = math.cos(math.radians(mid_lat))
    span_lat = max(max(lats) - min(lats), _MIN_SPAN_LAT)
    span_x = max((max(lngs) - min(lngs)) * squeeze, _MIN_SPAN_LAT)
    # Fit both spans into the frame with the same scale, then pad.
    scale = min(width / span_x, height / span_lat) * (1 - 2 * _PAD)
    centre_x = (min(lngs) + max(lngs)) / 2 * squeeze
    centre_y = (min(lats) + max(lats)) / 2

    def project(lat: float, lng: float) -> tuple[float, float]:
        return width / 2 + (lng * squeeze - centre_x) * scale, height / 2 - (lat - centre_y) * scale

    cells: dict[tuple[int, int], int] = {}
    for lat, lng in background or []:
        x, y = project(lat, lng)
        if 0 <= x < width and 0 <= y < height:
            cell = (int(x // _CELL), int(y // _CELL))
            cells[cell] = cells.get(cell, 0) + 1
    density = [
        {"x": cx * _CELL + 1.5, "y": cy * _CELL + 1.5, "level": 1 if count == 1 else 2 if count < 4 else 3}
        for (cx, cy), count in sorted(cells.items())
    ]

    pins = []
    for index, point in enumerate(points):
        x, y = project(point["lat"], point["lng"])
        label = point.get("label") or ""
        pill = round(len(label) * _CHAR + 34) if label else 0
        pins.append({
            **point,
            "x": round(x, 1),
            "y": round(y, 1),
            "width": pill,
            "left": round(-pill / 2, 1),
            "icon_x": round(-pill / 2 + 10, 1),
            "text_x": round(-pill / 2 + 28, 1),
            "first": index == 0,
        })
    # The first pin is drawn last, so no other pin covers it.
    pins.reverse()

    metres_per_px = 111_320 / scale
    metres = next((m for m in _SCALES if m / metres_per_px >= 70), _SCALES[-1])
    return {
        "width": width,
        "height": height,
        "density": density,
        "pins": pins,
        "focus": focus,
        "icon": _BEER,
        # Centred, so a frame cropped on a narrow screen keeps it.
        "scale": {"px": round(metres / metres_per_px), "x": round(width / 2 - metres / metres_per_px / 2), "label": _scale_label(metres)},
    }


def live_map(points: list[dict], kind: str = "pins", centre: tuple[float, float] | None = None) -> str:
    """JSON for ``data-map`` of ``web/components/map.html``.

    ``points`` are ``{"lat", "lng", "label", "url", "name", "selected"}`` in priority
    order. ``kind``: ``pins`` (pills with the label, the selected one yellow),
    ``focus`` (one big pin), ``route`` (numbered stops joined in order, label is the
    name) or ``decor`` (pins without links and controls). ``centre`` is ``(lat, lng)``
    for a map without points.
    """

    return json.dumps(
        {
            "kind": kind,
            "centre": [centre[1], centre[0]] if centre else None,
            "points": [
                {
                    "lat": round(point["lat"], 6),
                    "lng": round(point["lng"], 6),
                    "label": point.get("label") or "",
                    "url": point.get("url") or "",
                    "name": point.get("name") or "",
                    "selected": bool(point.get("selected")),
                }
                for point in points
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )

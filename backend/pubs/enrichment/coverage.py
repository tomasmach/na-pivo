"""Coarse country coverage polygons shared by directory tooling and API reads."""

from __future__ import annotations

CZ_POLYGON = [
    (12.09, 50.25),
    (12.55, 50.40),
    (13.02, 50.50),
    (14.30, 50.88),
    (14.99, 51.05),
    (15.54, 50.78),
    (16.20, 50.66),
    (16.68, 50.10),
    (17.72, 50.32),
    (18.56, 49.90),
    (18.85, 49.52),
    (18.16, 49.27),
    (17.55, 48.82),
    (16.94, 48.62),
    (16.06, 48.75),
    (15.16, 48.94),
    (14.70, 48.58),
    (13.83, 48.77),
    (12.67, 49.43),
]

SK_POLYGON = [
    (16.94, 48.62),
    (16.98, 48.13),
    (17.25, 47.99),
    (18.30, 47.73),
    (18.72, 47.79),
    (19.60, 48.20),
    (20.50, 48.30),
    (21.60, 48.33),
    (22.15, 48.38),
    (22.55, 48.80),
    (22.55, 49.10),
    (22.00, 49.30),
    (21.00, 49.48),
    (20.10, 49.42),
    (19.45, 49.62),
    (18.85, 49.52),
    (18.16, 49.27),
    (17.55, 48.82),
]


def point_in_polygon(
    lng: float,
    lat: float,
    polygon: list[tuple[float, float]],
) -> bool:
    """Return whether a point is inside a polygon using an even-odd ray cast."""
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > lat) != (y2 > lat):
            crossing_x = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lng < crossing_x:
                inside = not inside
        previous = current
    return inside


def coverage_country(lat: float, lng: float) -> str | None:
    """Return the directory country code for a covered coordinate."""
    if point_in_polygon(lng, lat, CZ_POLYGON):
        return "cz"
    if point_in_polygon(lng, lat, SK_POLYGON):
        return "sk"
    return None

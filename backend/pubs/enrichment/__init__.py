"""
pubs.enrichment — public contract for the enrichment subsystem.

This package re-exports the canonical surface that the API layer and management
commands code against.

Public surface
--------------
RawHours            — dataclass returned by FirmyHoursSource.fetch()
FirmyHoursSource    — scraper; see firmy.py
normalize_to_osm    — converts Firmy.cz openingHours to OSM grammar; see normalizer.py
is_open_now         — evaluates OSM hours string at a given moment; see is_open.py
next_change         — next open/close transition; see is_open.py
verify_match        — name+geo confidence scoring; see matcher.py
geohash8            — canonical cache-key helper; see matcher.py
"""

from .firmy import FirmyHoursSource, RawHours  # noqa: F401
from .is_open import is_open_now, next_change  # noqa: F401
from .matcher import geohash8, verify_match  # noqa: F401
from .normalizer import normalize_to_osm  # noqa: F401

__all__ = [
    "RawHours",
    "FirmyHoursSource",
    "normalize_to_osm",
    "is_open_now",
    "next_change",
    "verify_match",
    "geohash8",
]

"""
pubs.enrichment — public contract for the enrichment subsystem.

This package re-exports the canonical surface that the API layer and management
commands code against.

Public surface
--------------
RawHours            — dataclass returned by FirmyHoursSource.fetch()
FirmyHoursSource    — scraper; see firmy.py
normalize_to_osm    — converts Firmy.cz openingHours to OSM grammar; see normalizer.py
community_hours_to_osm — converts structured community hours to OSM grammar; see normalizer.py
is_open_now         — evaluates OSM hours string at a given moment; see is_open.py
next_change         — next open/close transition; see is_open.py
verify_match        — name+geo confidence scoring; see matcher.py
classify_venue      — classify draft-beer venue from categories/tags; see venue.py
names_match         — name-only gate for cache-read collision guard; see matcher.py
geohash8            — canonical PubHours cache-key helper (precision 8); see matcher.py
geohash6            — cache-cell helper for the Mapy 'pubs near' cache; see matcher.py
geohash5            — legacy coarse cell helper; see matcher.py
geohash5_center     — legacy (lat, lng) centre of a geohash-5 cell; see matcher.py
TransientFetchError — raised by FirmyHoursSource on a retryable network/proxy error
MapySuggestSource   — server-side Mapy.cz /v1/suggest 'pubs near' proxy; see mapy.py
MapyDailyCapExceededError — raised by MapySuggestSource when the daily cap is hit
MapyAllQueriesFailedError — raised by MapySuggestSource when every query failed
"""

from .firmy import FirmyHoursSource, RawHours, TransientFetchError  # noqa: F401
from .is_open import is_open_now, next_change  # noqa: F401
from .mapy import (  # noqa: F401
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestResult,
    MapySuggestSource,
)
from .matcher import (  # noqa: F401
    geohash5,
    geohash5_center,
    geohash6,
    geohash8,
    names_match,
    verify_match,
)
from .normalizer import community_hours_to_osm, normalize_to_osm  # noqa: F401
from .venue import classify_venue  # noqa: F401

__all__ = [
    "RawHours",
    "FirmyHoursSource",
    "TransientFetchError",
    "MapySuggestSource",
    "MapySuggestResult",
    "MapyDailyCapExceededError",
    "MapyAllQueriesFailedError",
    "normalize_to_osm",
    "community_hours_to_osm",
    "is_open_now",
    "next_change",
    "verify_match",
    "names_match",
    "geohash8",
    "geohash6",
    "geohash5",
    "geohash5_center",
    "classify_venue",
]

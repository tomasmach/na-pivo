"""
pubs.enrichment.matcher — name+geo confidence scoring and geohash helpers.

verify_match blends:
  * rapidfuzz token-sort-ratio name similarity (0-100 → 0-1)
  * haversine distance falloff (full credit <100 m, decays to ~0 at ~1 km)

geohash8 returns a Geohash string at precision 8 (~38 m × 19 m cell)
used as the canonical PubHours.cache_key.
"""

from __future__ import annotations

import math

import geohash2
from rapidfuzz import fuzz

# ---------------------------------------------------------------------------
# Geohash
# ---------------------------------------------------------------------------

def geohash8(lat: float, lng: float) -> str:
    """Return a Geohash string at precision 8 (~38 m accuracy)."""
    return geohash2.encode(lat, lng, precision=8)


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------

_EARTH_RADIUS_M = 6_371_000.0  # metres


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return the great-circle distance in metres between two WGS-84 points."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Distance falloff
# ---------------------------------------------------------------------------

def _distance_score(distance_m: float) -> float:
    """
    Map a distance (metres) to a [0, 1] confidence score.

    * 0–100 m  → score ≥ 0.9  (full credit — essentially same location)
    * 100–500 m → smooth decay via sigmoid-like curve
    * ≥ 1 000 m  → score < 0.1  (very unlikely match)
    """
    if distance_m <= 0:
        return 1.0
    # Exponential decay: score = exp(-k * d) tuned so:
    #   d=100 m  → 0.90   → k = -ln(0.90)/100  ≈ 0.00105
    #   d=500 m  → 0.59
    #   d=1000 m → 0.35  ... but we want near-zero there so use stronger k
    # We'll use a piecewise that stays near 1 until 100 m then drops sharply
    # k = ln(10) / 1000 ≈ 0.0023 → at 1000 m gives 0.10
    k = math.log(10) / 1_000.0
    return math.exp(-k * distance_m)


# ---------------------------------------------------------------------------
# verify_match
# ---------------------------------------------------------------------------

# Hard minimum name similarity required for ANY match, independent of geo.
# Below this, two listings are considered different businesses no matter how
# close they sit (multiple unrelated businesses share a geohash cell / address).
# Tuned so the genuine "U Fleků" vs "Restaurace U Fleků" match (name_sim ≈ 0.56)
# clears it while unrelated names at the same spot (≤ 0.35) are rejected.
MIN_NAME_SIM = 0.5


def name_similarity(a: str, b: str) -> float:
    """Return the [0, 1] token-sort-ratio similarity of two business names."""
    return fuzz.token_sort_ratio((a or "").lower(), (b or "").lower()) / 100.0


def names_match(a: str, b: str) -> bool:
    """
    True if two business names are similar enough to be the same business.

    Uses the same hard name-similarity gate (MIN_NAME_SIM) as verify_match.
    Used on cache READ to reject a geohash-8 collision: two DISTINCT businesses
    in the same ~38 m cell share one PubHours.cache_key, so without this gate a
    nearby different business would be served the cached pub's opening hours.
    """
    return name_similarity(a, b) >= MIN_NAME_SIM


def verify_match(
    q_name: str,
    q_lat: float,
    q_lng: float,
    c_name: str,
    c_lat: float | None,
    c_lng: float | None,
) -> float:
    """
    Return a confidence score in [0, 1] for whether the candidate is the
    same pub as the query.

    Parameters
    ----------
    q_*  : query (what the mobile app sent us)
    c_*  : candidate (what Firmy.cz returned)

    Algorithm
    ---------
    name_score  = rapidfuzz.fuzz.token_sort_ratio / 100  (0-1)
    geo_score   = distance falloff (0-1); 1.0 if no candidate coords

    A hard name-similarity gate is applied FIRST: if name_score < MIN_NAME_SIM
    the match is rejected (confidence 0.0) regardless of distance — geo alone
    must never clear the acceptance bar. Otherwise the score is a name-weighted
    blend that keeps geo from dominating:

        confidence = 0.7 * name_score + 0.3 * geo_score
    """
    # Name similarity
    name_sim = fuzz.token_sort_ratio(q_name.lower(), c_name.lower()) / 100.0

    # Hard name gate — independent of geo. A different name is a different
    # business even at the exact same coordinates.
    if name_sim < MIN_NAME_SIM:
        return 0.0

    # Geo score
    if c_lat is not None and c_lng is not None:
        dist = _haversine_m(q_lat, q_lng, c_lat, c_lng)
        geo = _distance_score(dist)
    else:
        geo = 0.5  # no coords → neutral

    return 0.7 * name_sim + 0.3 * geo

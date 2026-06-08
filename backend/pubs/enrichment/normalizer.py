"""
pubs.enrichment.normalizer — convert Firmy.cz openingHours to OSM opening_hours grammar.

Firmy.cz serves opening hours in three shapes:
  (a) A string: "Mo,Tu,We,Th,Fr,Sa,Su 10:00–23:00"  (en-dash between times)
  (b) A list of such strings
  (c) An openingHoursSpecification list of {dayOfWeek, opens, closes} objects

This module normalises all three to OSM grammar (hyphen as time separator,
semicolon-space join for lists).
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# All dash-like characters that appear in Firmy hours strings
_DASH_CHARS = (
    "–",  # en dash    –
    "—",  # em dash    —
    "−",  # minus sign −
)

# Schema.org full day-of-week URIs (or short names) → OSM two-letter codes
_DOW_MAP: dict[str, str] = {
    "Monday": "Mo",
    "Tuesday": "Tu",
    "Wednesday": "We",
    "Thursday": "Th",
    "Friday": "Fr",
    "Saturday": "Sa",
    "Sunday": "Su",
    # Short schema.org
    "http://schema.org/Monday": "Mo",
    "http://schema.org/Tuesday": "Tu",
    "http://schema.org/Wednesday": "We",
    "http://schema.org/Thursday": "Th",
    "http://schema.org/Friday": "Fr",
    "http://schema.org/Saturday": "Sa",
    "http://schema.org/Sunday": "Su",
    # Short URIs as used in some implementations
    "https://schema.org/Monday": "Mo",
    "https://schema.org/Tuesday": "Tu",
    "https://schema.org/Wednesday": "We",
    "https://schema.org/Thursday": "Th",
    "https://schema.org/Friday": "Fr",
    "https://schema.org/Saturday": "Sa",
    "https://schema.org/Sunday": "Su",
    # Czech two-letter abbreviations (a Czech site can emit these directly)
    "Po": "Mo",
    "Út": "Tu",
    "Ut": "Tu",
    "St": "We",
    "Čt": "Th",
    "Ct": "Th",
    "Pá": "Fr",
    "Pa": "Fr",
    "So": "Sa",
    "Ne": "Su",
}


def _normalise_dashes(value: str) -> str:
    """Replace all dash variants with a plain hyphen-minus."""
    for ch in _DASH_CHARS:
        value = value.replace(ch, "-")
    return value


def _normalise_string(value: str) -> str:
    return _normalise_dashes(value.strip())


def _trim_time(t: str | None) -> str:
    """Strip a seconds component ("HH:MM:SS" → "HH:MM"); tolerate None/empty."""
    if not t:
        return ""
    parts = str(t).split(":")
    return ":".join(parts[:2]) if len(parts) >= 2 else str(t)


def _spec_to_osm(spec: dict) -> str | None:
    """Convert a single openingHoursSpecification object → OSM string, or None."""
    day_raw = spec.get("dayOfWeek")
    opens = spec.get("opens")
    closes = spec.get("closes")

    if not day_raw:
        return None

    # dayOfWeek can be a string or a list
    days_list = day_raw if isinstance(day_raw, list) else [day_raw]

    osm_days: list[str] = []
    for d in days_list:
        if not isinstance(d, str):
            logger.warning("normalizer: unmappable dayOfWeek token %r — skipping", d)
            continue
        # Strip trailing slash segment (e.g. "http://schema.org/Monday" → "Monday")
        short = d.rstrip("/").rsplit("/", 1)[-1]
        osm = _DOW_MAP.get(d) or _DOW_MAP.get(short)
        if osm:
            osm_days.append(osm)
        else:
            logger.warning("normalizer: unmappable dayOfWeek token %r — skipping", d)

    if not osm_days:
        return None

    day_part = ",".join(osm_days)

    opens_t = _trim_time(opens)
    closes_t = _trim_time(closes)

    # NOTE: Firmy.cz never serves openingHoursSpecification in practice — it uses
    # the string/list openingHours form, and a closed day is conveyed by OMITTING
    # the day (verified against live data). This branch is therefore defensive
    # only. We emit hours faithfully and deliberately do NOT treat opens==closes
    # as a "closed" marker: the evaluator reads "00:00-00:00" as open-24h, so such
    # a guess would invert genuine nonstop venues.
    if opens_t and closes_t:
        return f"{day_part} {opens_t}-{closes_t}"
    if opens_t:
        return f"{day_part} {opens_t}"
    # No usable time component — emit the bare day(s); the evaluator treats this as
    # open all day, matching Firmy's nonstop convention (day list with no times).
    return day_part


def normalize_to_osm(value: object) -> str | None:
    """
    Normalise a Firmy.cz openingHours value to OSM opening_hours grammar.

    Parameters
    ----------
    value:
        - str  → normalise dashes
        - list[str] → normalise each, join with "; "
        - list[dict] → openingHoursSpecification objects, convert + join
        - None / empty → returns None

    Returns
    -------
    str | None
        Normalised OSM hours string, or None if value is absent/empty.
    """
    if value is None:
        return None

    # Plain string
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        return _normalise_string(v)

    # List — could be list of strings or list of spec dicts
    if isinstance(value, list):
        if not value:
            return None

        # Detect shape from first element
        if isinstance(value[0], dict):
            # openingHoursSpecification
            parts: list[str] = []
            for item in value:
                osm = _spec_to_osm(item)
                if osm:
                    parts.append(osm)
            return "; ".join(parts) if parts else None
        else:
            # List of strings
            parts = [_normalise_string(str(s)) for s in value if str(s).strip()]
            return "; ".join(parts) if parts else None

    return None

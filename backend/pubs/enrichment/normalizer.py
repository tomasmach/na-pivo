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


# ---------------------------------------------------------------------------
# Structured community hours → OSM grammar
# ---------------------------------------------------------------------------

# Day keys in the structured community ``hours_json`` → OSM two-letter codes,
# in calendar order (the OSM string is emitted Mo..Su).
_COMMUNITY_DAY_ORDER: tuple[tuple[str, str], ...] = (
    ("mo", "Mo"),
    ("tu", "Tu"),
    ("we", "We"),
    ("th", "Th"),
    ("fr", "Fr"),
    ("sa", "Sa"),
    ("su", "Su"),
)


def community_hours_to_osm(hours: dict | None) -> str:
    """
    Convert a structured community ``hours_json`` dict to an OSM opening_hours
    string the is_open evaluator understands.

    Parameters
    ----------
    hours:
        ``{"mo": [["11:00","23:00"]], "tu": [], ...}`` — all 7 keys
        mo/tu/we/th/fr/sa/su. An empty list means closed that day. Overnight
        intervals (end < start, e.g. ``["16:00","01:00"]``) are passed straight
        through as ``16:00-01:00``; the Rust ``opening_hours`` evaluator handles
        them. Up to 3 intervals per day are supported (comma-joined).

    Returns
    -------
    str
        Per-day OSM string, e.g. "Mo 11:00-23:00; We 11:00-23:00; ...". Empty
        string if *hours* is None/empty (no day produces any token).

    Notes
    -----
    Closed days are OMITTED from the string rather than emitted as
    ``<Day> off``. The evaluator already reads any day with no rule as closed,
    so omission has the same "closed" meaning — but it avoids a subtle bug: an
    explicit ``Sa off`` token SUPPRESSES the spillover of a Friday overnight
    interval (``Fr 16:00-01:00``) into early Saturday, whereas omitting Saturday
    lets the overnight interval evaluate correctly. The only behavioural
    difference from the input is therefore desirable.

    This emits one segment per day (no Mo-Fr range grouping); the evaluator
    treats the per-day form identically, and keeping it explicit makes the
    derived string trivially auditable in the admin against ``hours_json``.
    Input is assumed already validated by the serializer (HH:MM format,
    interval count).
    """
    if not hours:
        return ""

    segments: list[str] = []
    for key, osm_day in _COMMUNITY_DAY_ORDER:
        intervals = hours.get(key)
        if not intervals:
            # Closed (empty list) or missing — omit the day; the evaluator reads
            # an unmentioned day as closed, and omission preserves overnight
            # spillover from the previous day (see Notes).
            continue
        parts = [f"{start}-{end}" for start, end in intervals]
        segments.append(f"{osm_day} {','.join(parts)}")

    return "; ".join(segments)

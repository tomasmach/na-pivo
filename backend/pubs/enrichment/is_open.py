"""
pubs.enrichment.is_open — evaluate OSM opening_hours strings.

Uses the ``opening-hours-py`` Rust-backed library (pip name: opening-hours-py,
import name: opening_hours).  The OpeningHours object accepts an OSM
opening_hours expression and can evaluate is_open(dt) and next_change(dt)
at a given datetime.

The library's OpeningHours constructor takes a ``timezone`` kwarg that must be
a ``zoneinfo.ZoneInfo`` object (not a plain string).

If the library fails to parse the expression (ParserError / SyntaxError),
the functions return None rather than raising.
"""

from __future__ import annotations

import zoneinfo
from datetime import datetime

try:
    from opening_hours import (
        OpeningHours,  # type: ignore[import-untyped]
        ParserError,  # type: ignore[import-untyped]
    )
    _LIBRARY_AVAILABLE = True
except ImportError:  # pragma: no cover
    _LIBRARY_AVAILABLE = False
    OpeningHours = None  # type: ignore[assignment,misc]
    ParserError = Exception  # type: ignore[assignment,misc]


def _localize(when: datetime | None, tz: str) -> datetime:
    """Return *when* as a timezone-aware datetime in *tz*."""
    zi = zoneinfo.ZoneInfo(tz)
    if when is None:
        return datetime.now(tz=zi)
    if when.tzinfo is None:
        return when.replace(tzinfo=zi)
    return when.astimezone(zi)


def is_open_now(
    osm_hours: str,
    when: datetime | None = None,
    tz: str = "Europe/Prague",
) -> bool | None:
    """
    Evaluate whether a pub is open at *when* (default: now).

    Parameters
    ----------
    osm_hours : str
        OSM opening_hours expression, e.g. "Mo-Fr 09:00-22:00".
    when : datetime | None
        Point in time to evaluate. None → current system time.
    tz : str
        IANA timezone name (default "Europe/Prague").

    Returns
    -------
    bool | None
        True if open, False if closed, None if expression cannot be parsed.
    """
    if not osm_hours or not osm_hours.strip():
        return None

    if not _LIBRARY_AVAILABLE:
        return None  # pragma: no cover

    dt = _localize(when, tz)
    zi = zoneinfo.ZoneInfo(tz)

    try:
        oh = OpeningHours(osm_hours, timezone=zi)
        return oh.is_open(dt)
    except (ParserError, SyntaxError, TypeError, ValueError, Exception):
        return None


def next_change(
    osm_hours: str,
    when: datetime | None = None,
    tz: str = "Europe/Prague",
) -> datetime | None:
    """
    Return the next open/close transition after *when*.

    Parameters
    ----------
    osm_hours : str
        OSM opening_hours expression.
    when : datetime | None
        Start of the search window. None → current system time.
    tz : str
        IANA timezone name (default "Europe/Prague").

    Returns
    -------
    datetime | None
        The next transition as a timezone-aware datetime, or None if the
        expression is permanent (e.g. "24/7"), unparseable, or the library
        returns no result.
    """
    if not osm_hours or not osm_hours.strip():
        return None

    if not _LIBRARY_AVAILABLE:
        return None  # pragma: no cover

    dt = _localize(when, tz)
    zi = zoneinfo.ZoneInfo(tz)

    try:
        oh = OpeningHours(osm_hours, timezone=zi)
        result = oh.next_change(dt)
        return result
    except (ParserError, SyntaxError, TypeError, ValueError, Exception):
        return None

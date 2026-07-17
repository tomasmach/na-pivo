"""Pure Pivař XP ladder math shared by drink writes and account reads."""

from __future__ import annotations

from django.conf import settings

from pubs.ladder import Ladder

PIVAR_LEVEL_TITLES: tuple[str, ...] = (
    "Zelenáč",
    "Ochutnávač",
    "Pivní tovaryš",
    "Výčepní",
    "Sládek",
    "Pivní mistr",
    "Pivní legenda",
)


def _ladder() -> Ladder:
    return Ladder(
        PIVAR_LEVEL_TITLES,
        getattr(settings, "PIVAR_LEVEL_THRESHOLDS", [0, 150, 500, 1500, 4000, 9000, 18000]),
    )


def pivar_levels() -> list[dict]:
    """Return the full wire ladder as ``{level, title, xp}`` rows."""
    return _ladder().levels()


def pivar_progress(xp: int) -> dict:
    """Derive level, title and within-level progress from durable XP."""
    return _ladder().progress(xp)


def pivar_snapshot(xp: int) -> dict:
    """Return the compact Pivař wire envelope derived from stored XP."""
    return _ladder().snapshot(xp)


def pivar_xp_rules() -> dict:
    """Expose env-tunable awards so clients share the server's rule values."""
    return {
        "evening": settings.PIVAR_XP_EVENING,
        "new_pub": settings.PIVAR_XP_NEW_PUB,
        "new_brand": settings.PIVAR_XP_NEW_BRAND,
        "extra_beer": settings.PIVAR_XP_EXTRA_BEER,
        "extra_beer_daily_cap": settings.PIVAR_XP_EXTRA_BEER_DAILY_CAP,
        "context_first": settings.PIVAR_XP_CONTEXT_FIRST,
        "photo": settings.PIVAR_XP_PHOTO,
        "checkin": settings.PIVAR_XP_CHECKIN,
    }

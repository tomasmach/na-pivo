"""Pure Pivař XP ladder math shared by drink writes and account reads."""

from __future__ import annotations

from django.conf import settings

PIVAR_LEVEL_TITLES: tuple[str, ...] = (
    "Zelenáč",
    "Ochutnávač",
    "Pivní tovaryš",
    "Výčepní",
    "Sládek",
    "Pivní mistr",
    "Pivní legenda",
)


def _level_thresholds() -> list[int]:
    """Return defensive, non-decreasing thresholds aligned with fixed titles."""
    raw = list(getattr(settings, "PIVAR_LEVEL_THRESHOLDS", [0, 150, 500, 1500, 4000, 9000, 18000]))
    if not raw:
        raw = [0]
    raw = raw[: len(PIVAR_LEVEL_TITLES)]
    thresholds: list[int] = []
    previous = 0
    for index, value in enumerate(raw):
        threshold = max(0, int(value))
        if index == 0:
            threshold = 0
        threshold = max(threshold, previous)
        thresholds.append(threshold)
        previous = threshold
    return thresholds


def pivar_levels() -> list[dict]:
    """Return the full wire ladder as ``{level, title, xp}`` rows."""
    return [
        {"level": index + 1, "title": PIVAR_LEVEL_TITLES[index], "xp": threshold}
        for index, threshold in enumerate(_level_thresholds())
    ]


def pivar_progress(xp: int) -> dict:
    """Derive level, title and within-level progress from durable XP."""
    xp = max(0, int(xp))
    thresholds = _level_thresholds()
    level_index = 0
    for index, threshold in enumerate(thresholds):
        if xp >= threshold:
            level_index = index
        else:
            break

    current_threshold = thresholds[level_index]
    next_level = level_index + 1
    return {
        "level": level_index + 1,
        "title": PIVAR_LEVEL_TITLES[level_index],
        "xp_into_level": xp - current_threshold,
        "xp_for_next_level": (
            thresholds[next_level] - current_threshold if next_level < len(thresholds) else None
        ),
    }


def pivar_snapshot(xp: int) -> dict:
    """Return the compact Pivař wire envelope derived from stored XP."""
    progress = pivar_progress(xp)
    return {
        "xp": max(0, int(xp)),
        "level": progress["level"],
        "title": progress["title"],
        "xp_into_level": progress["xp_into_level"],
        "xp_for_next_level": progress["xp_for_next_level"],
    }


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

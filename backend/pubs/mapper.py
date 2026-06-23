"""
Mapér gamification helpers ("Zmapuj hospodu", §7).

Pure, server-authoritative XP → level/title math shared by the vote write path
(PUT /v1/pub-amenities/votes ``mapper`` snapshot) and the GET /v1/account/me
``mapper`` block. XP totals + counters live on AccountUsageStats (stored, F()-
incremented in the vote transaction); everything here is DERIVED from the stored
``mapper_xp`` so the two endpoints can never disagree.

The level ladder is the env-tunable ``MAPER_LEVEL_THRESHOLDS`` (five min-XP
thresholds, lowest first); the titles are fixed because the client maps a level
to a Czech title for the optimistic level-up toast and must agree with the
server on reconcile (§7.2). No level title reuses a badge name (disjointness is
locked in the spec).
"""

from __future__ import annotations

from django.conf import settings

# Fixed Czech titles, lowest level first (§7.2). Disjoint from the badge names
# {Prvomapér, Objevitel, Kartograf, Pořádkumil, Pivní detektiv}.
MAPER_LEVEL_TITLES: tuple[str, ...] = (
    "Nováček",
    "Všímálek",
    "Štamgast",
    "Znalec",
    "Hospodský mudrc",
)


def _level_thresholds() -> list[int]:
    """The min-XP threshold per level, lowest first, defensively normalised.

    Reads the env-tunable ``MAPER_LEVEL_THRESHOLDS`` but tolerates a short/long
    or out-of-order list so a bad env value can never crash the read path: the
    ladder is clamped to the number of fixed titles and forced non-decreasing.
    """
    raw = list(getattr(settings, "MAPER_LEVEL_THRESHOLDS", [0, 50, 150, 400, 900]))
    if not raw:
        raw = [0]
    # Clamp to the fixed title count (extra thresholds have no title to show).
    raw = raw[: len(MAPER_LEVEL_TITLES)]
    # Force non-decreasing so the "highest threshold <= xp" scan is well-defined.
    thresholds: list[int] = []
    prev = 0
    for i, value in enumerate(raw):
        v = max(0, int(value))
        if i == 0:
            v = 0  # level 1 always starts at 0 XP
        v = max(v, prev)
        thresholds.append(v)
        prev = v
    return thresholds


def maper_levels() -> list[dict]:
    """The full ladder for the wire ``levels`` array: {level, title, xp} x5.

    ``xp`` is the min-XP entry threshold for that level. Returned so the client
    can map an optimistic XP estimate to a level+title locally for the level-up
    toast; the server-derived level/title are the truth on reconcile.
    """
    thresholds = _level_thresholds()
    return [
        {"level": i + 1, "title": MAPER_LEVEL_TITLES[i], "xp": threshold}
        for i, threshold in enumerate(thresholds)
    ]


def maper_progress(xp: int) -> dict:
    """Derive {level, title, xp_into_level, xp_for_next_level} from a stored XP.

    ``level`` is the highest ladder level whose threshold is <= ``xp`` (1-indexed).
    ``xp_into_level`` is XP earned past the current level's threshold;
    ``xp_for_next_level`` is the gap to the next level's threshold, or ``None`` at
    the max level (no further level to reach).
    """
    xp = max(0, int(xp))
    thresholds = _level_thresholds()

    level_index = 0
    for i, threshold in enumerate(thresholds):
        if xp >= threshold:
            level_index = i
        else:
            break

    current_threshold = thresholds[level_index]
    xp_into_level = xp - current_threshold

    if level_index + 1 < len(thresholds):
        xp_for_next_level = thresholds[level_index + 1] - current_threshold
    else:
        xp_for_next_level = None  # already at the top level

    return {
        "level": level_index + 1,
        "title": MAPER_LEVEL_TITLES[level_index],
        "xp_into_level": xp_into_level,
        "xp_for_next_level": xp_for_next_level,
    }


def maper_snapshot(xp: int) -> dict:
    """The compact ``mapper`` envelope returned on the vote PUT (§4.2 / §7.2).

    { xp, level, title, xp_into_level, xp_for_next_level } — derived purely
    from the stored ``mapper_xp`` so Profile updates without a second GET. The
    full ``levels`` ladder + ``xp_rules`` + counters are only on GET /account/me.
    The wire key is ``xp`` (NOT ``mapper_xp``) so it is identical to the §7.2
    GET /account/me snapshot — the two endpoints must never disagree.
    """
    progress = maper_progress(xp)
    return {
        "xp": max(0, int(xp)),
        "level": progress["level"],
        "title": progress["title"],
        "xp_into_level": progress["xp_into_level"],
        "xp_for_next_level": progress["xp_for_next_level"],
    }


def maper_xp_rules() -> dict:
    """The four env-default XP constants, so the mobile optimistic-XP toast
    estimates from a shared source of truth (§7.2)."""
    return {
        "first_fact": settings.MAPER_XP_FIRST_FACT,
        "first_mapper_bonus": settings.MAPER_XP_FIRST_MAPPER_BONUS,
        "confirm": settings.MAPER_XP_CONFIRM,
        "pub_complete_bonus": settings.MAPER_XP_PUB_COMPLETE_BONUS,
    }

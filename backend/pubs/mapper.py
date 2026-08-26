"""
Mapér gamification helpers ("Zmapuj hospodu", §7).

Pure, server-authoritative XP → level/title math shared by the vote write path
(PUT /v1/pub-amenities/votes ``mapper`` snapshot) and the GET /v1/account/me
``mapper`` block. XP totals + counters live on AccountUsageStats (stored, F()-
incremented in the vote transaction); everything here is DERIVED from the stored
``mapper_xp`` so the two endpoints can never disagree.

The level ladder is the env-tunable ``MAPER_LEVEL_THRESHOLDS`` (seven min-XP
thresholds, lowest first); the titles are fixed because the client maps a level
to a Czech title for the optimistic level-up toast and must agree with the
server on reconcile (§7.2). No level title reuses a badge name (disjointness is
locked in the spec).
"""

from __future__ import annotations

from django.conf import settings
from django.utils.translation import gettext_lazy

from pubs.ladder import Ladder

# Fixed titles, lowest level first (§7.2). Disjoint from the badge names
# {Prvomapér, Objevitel, Kartograf, Pořádkumil, Pivní detektiv}. Lazy msgids:
# this table is imported once, so every reader must str() a title at the moment
# it serializes, when the request language is known.
MAPER_LEVEL_TITLES: tuple[str, ...] = (
    gettext_lazy("Nováček"),
    gettext_lazy("Všímálek"),
    gettext_lazy("Štamgast"),
    gettext_lazy("Znalec"),
    gettext_lazy("Hospodský mudrc"),
    gettext_lazy("Pivní kartograf"),
    gettext_lazy("Legenda lokálu"),
)


def _ladder() -> Ladder:
    return Ladder(
        MAPER_LEVEL_TITLES,
        getattr(settings, "MAPER_LEVEL_THRESHOLDS", [0, 300, 900, 2500, 6000, 12000, 24000]),
    )


def maper_levels() -> list[dict]:
    """The full ladder for the wire ``levels`` array: {level, title, xp} x7.

    ``xp`` is the min-XP entry threshold for that level. Returned so the client
    can map an optimistic XP estimate to a level+title locally for the level-up
    toast; the server-derived level/title are the truth on reconcile.
    """
    return _ladder().levels()


def maper_progress(xp: int) -> dict:
    """Derive {level, title, xp_into_level, xp_for_next_level} from a stored XP.

    ``level`` is the highest ladder level whose threshold is <= ``xp`` (1-indexed).
    ``xp_into_level`` is XP earned past the current level's threshold;
    ``xp_for_next_level`` is the gap to the next level's threshold, or ``None`` at
    the max level (no further level to reach).
    """
    return _ladder().progress(xp)


def maper_snapshot(xp: int, counters: dict | None = None) -> dict:
    """The compact ``mapper`` envelope returned on the vote PUT (§4.2 / §7.2).

    { xp, level, title, xp_into_level, xp_for_next_level } — derived purely
    from the stored ``mapper_xp`` so Profile updates without a second GET.
    Fresh counter fields may be attached additively on write responses so the
    client can unlock Mapér badges immediately; the full ``levels`` ladder +
    ``xp_rules`` stay only on GET /account/me.
    The wire key is ``xp`` (NOT ``mapper_xp``) so it is identical to the §7.2
    GET /account/me snapshot — the two endpoints must never disagree.
    """
    snapshot = _ladder().snapshot(xp)
    if counters:
        snapshot.update(
            {
                "distinct_mapped_pubs": int(counters.get("mapped_pubs_count", 0) or 0),
                "amenity_votes_count": int(counters.get("amenity_votes_count", 0) or 0),
                "first_mapper_count": int(counters.get("first_mapper_count", 0) or 0),
                "completed_pubs_count": int(counters.get("completed_pubs_count", 0) or 0),
            }
        )
    return snapshot


def maper_xp_rules() -> dict:
    """The four env-default XP constants, so the mobile optimistic-XP toast
    estimates from a shared source of truth (§7.2)."""
    return {
        "first_fact": settings.MAPER_XP_FIRST_FACT,
        "first_mapper_bonus": settings.MAPER_XP_FIRST_MAPPER_BONUS,
        "confirm": settings.MAPER_XP_CONFIRM,
        "pub_complete_bonus": settings.MAPER_XP_PUB_COMPLETE_BONUS,
    }

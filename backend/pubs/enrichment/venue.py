"""
pubs.enrichment.venue — classify whether a Firmy.cz listing serves draft beer.

The Firmy.cz detail page exposes a venue's **categories** (link texts under
``div.list.lcat``) and **tags** (``/stitek/{slug}`` slugs under
``div.list.ltag``); both are extracted by ``firmy.py``. ``classify_venue``
turns those into one of four verdicts the API surfaces as ``venueKind``:

    'pub'      — confidently a place that serves draft beer.
    'not_pub'  — confidently NOT a beer pub (sushi, café, bistro, …).
    'maybe'    — has categories but none decide it either way.
    'unknown'  — no categories at all (nothing to go on).

Signal quality (live-verified 2026-06):
  * The 'tocene-pivo' (draft beer) TAG is a strong positive — but tags have
    poor recall, so a clear pub category alone is enough.
  * The generic 'pivo' tag is NOT a signal: a sushi bistro carries it too. Only
    'tocene-pivo' counts.
  * Generic parent categories ('Restaurace', 'Restaurační a pohostinské
    služby') are carried by almost every listing and must never match.
"""

from __future__ import annotations

import unicodedata

# ---------------------------------------------------------------------------
# Verdict constants
# ---------------------------------------------------------------------------

PUB = "pub"
MAYBE = "maybe"
NOT_PUB = "not_pub"
UNKNOWN = "unknown"

# The draft-beer tag is the single positive tag signal (poor recall but high
# precision). The bare 'pivo' tag is intentionally excluded — see module docs.
_DRAFT_BEER_TAG = "tocene-pivo"

# Category substrings (normalised: lowercase, diacritics stripped) that mark a
# place as a beer pub. Matched as substrings so e.g. "pivovar" covers
# "Pivovary" and "Minipivovary".
_PUB_CATEGORY_SUBSTRINGS = (
    "hospody a hostince",
    "pivnice",
    "pivovar",
    "pivoteka",
    "ceske a staroceske restaurace",
    "bary",
)

# Category substrings that mark a place as NOT a beer pub. Checked only after
# the PUB rules have been ruled out.
_NOT_PUB_CATEGORY_SUBSTRINGS = (
    "bistr",  # covers both "Bistra" and "Bistro"
    "kavarn",
    "cukrarn",
    "cajovn",
    "vinarn",
    "vinoteka",
    "rychle obcerstveni",
    "pizzeri",
    "sushi",
    "kebab",
    "japonske restaurace",
    "cinske restaurace",
    "thajske restaurace",
    "vietnamske restaurace",
    "korejske restaurace",
    "indicke restaurace",
    "asijske",
    "zmrzlin",
    "pekarstvi",
    "fast food",
)


def _normalize(text: str) -> str:
    """Lowercase and strip diacritics (Unicode NFD) for accent-insensitive matching."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def classify_venue(categories: list[str], tags: list[str]) -> str:
    """Classify a venue as 'pub' | 'maybe' | 'not_pub' | 'unknown'.

    Parameters
    ----------
    categories : list of Firmy.cz category names (link texts), e.g.
        ["České a staročeské restaurace", "Restaurace"].
    tags : list of Firmy.cz tag slugs, e.g. ["jitrnice", "tocene-pivo"].

    Rules (evaluated in order):
      1. draft-beer tag OR a category in the PUB set → 'pub'.
      2. otherwise a category in the NOT_PUB set → 'not_pub'.
      3. otherwise non-empty categories → 'maybe'; empty → 'unknown'.
    """
    norm_categories = [_normalize(c) for c in categories]
    norm_tags = [_normalize(t) for t in tags]

    # Rule 1: positive signals.
    if _DRAFT_BEER_TAG in norm_tags:
        return PUB
    for cat in norm_categories:
        if any(sub in cat for sub in _PUB_CATEGORY_SUBSTRINGS):
            return PUB

    # Rule 2: negative signals.
    for cat in norm_categories:
        if any(sub in cat for sub in _NOT_PUB_CATEGORY_SUBSTRINGS):
            return NOT_PUB

    # Rule 3: indecisive.
    if norm_categories:
        return MAYBE
    return UNKNOWN

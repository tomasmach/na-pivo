"""Narrow discovery policy for non-pub places that can still pour beer."""

from __future__ import annotations

import re
import unicodedata

PRIMARY_PUB = "pub"
SEASONAL_STAND = "seasonal_stand"
CAMPSITE = "campsite"
SPORTS_VENUE = "sports_venue"

OTHER_TAP_PLACE_KINDS = frozenset({SEASONAL_STAND, CAMPSITE, SPORTS_VENUE})
SUPPORTED_DISCOVERY_KINDS = frozenset({PRIMARY_PUB, *OTHER_TAP_PLACE_KINDS})

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_CATEGORY_SIGNALS = {
    SEASONAL_STAND: (
        "stanek",
        "stanky",
        "rychle obcerstveni",
        "obcerstveni",
        "kiosk",
    ),
    CAMPSITE: ("kemp", "kempy", "autokemp", "camping"),
    SPORTS_VENUE: (
        "sportovni areal",
        "sportovni centrum",
        "sportovni klub",
        "stadion",
        "fotbalove hriste",
    ),
}
_BEER_TEXT_TOKENS = frozenset(
    {
        "bar",
        "bary",
        "beer",
        "hospoda",
        "hospudka",
        "hostinec",
        "pivnice",
        "pivni",
        "pivo",
        "pivovar",
        "pub",
        "senk",
        "tankovna",
        "vycep",
    }
)
_BEER_TAGS = frozenset({"tocene pivo", "draft beer", "beer", "pivo"})


def normalize_discovery_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_text = decomposed.encode("ascii", "ignore").decode("ascii")
    return " ".join(_TOKEN_RE.findall(ascii_text.casefold()))


def discovery_kind_for_categories(categories: list[object] | tuple[object, ...]) -> str:
    """Map reviewed source categories onto the three supported secondary kinds."""

    normalized = [normalize_discovery_text(category) for category in categories]
    for kind in (SEASONAL_STAND, CAMPSITE, SPORTS_VENUE):
        if any(
            signal in category
            for category in normalized
            for signal in _CATEGORY_SIGNALS[kind]
        ):
            return kind
    return PRIMARY_PUB


def has_explicit_beer_signal(
    *,
    name: str,
    categories: list[object] | tuple[object, ...],
    tags: list[object] | tuple[object, ...],
) -> bool:
    """Require a source-backed draft-beer/bar/pub signal for secondary places."""

    normalized_tags = {normalize_discovery_text(tag) for tag in tags}
    if normalized_tags & _BEER_TAGS:
        return True

    text_tokens: set[str] = set(normalize_discovery_text(name).split())
    for category in categories:
        text_tokens.update(normalize_discovery_text(category).split())
    return bool(text_tokens & _BEER_TEXT_TOKENS)


def discovery_metadata(
    *,
    name: str,
    categories: list[object] | tuple[object, ...],
    tags: list[object] | tuple[object, ...],
) -> tuple[str, bool]:
    """Return the reviewed discovery kind and whether it clears the beer gate."""

    kind = discovery_kind_for_categories(categories)
    return kind, has_explicit_beer_signal(name=name, categories=categories, tags=tags)

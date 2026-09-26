"""Server-owned text rules for public tours; changing them needs a deploy, not an app release."""

import re
import unicodedata

from django.conf import settings

# Folded text: lower case without diacritics, so "Panák" and "panak" match alike.
_PATTERNS = [
    # Speed, quantity and forced drinking.
    r"\bna ex\b",
    r"\bexn\w*",
    r"\bkdo (driv|drive|rychlej\w*|nejrychlej\w*|vic|nejvic) (vy|do)?pij\w*",
    r"\b\d+\s*(piv|piva|pivo|panak\w*|shot\w*|drink\w*|beers?)\b",
    r"\b(panak\w*|shots?|shotu|chug\w*|shotgun\w*|beer ?bong|drinking games?|down it)\b",
    # Links and phone numbers are spam or doxxing, never a pub challenge.
    r"https?://|www\.|\b[a-z0-9-]+\.(cz|sk|com|net|org|eu)\b",
    r"(\+?\d[\s-]?){9,}",
]
_COMPILED = [re.compile(pattern) for pattern in _PATTERNS]


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).split())


def _extra_patterns() -> list[re.Pattern]:
    return [re.compile(re.escape(_fold(word))) for word in getattr(settings, "TOUR_TEXT_BLOCKLIST", []) if word.strip()]


def rejected_text(text: str) -> bool:
    folded = _fold(text)
    return any(pattern.search(folded) for pattern in [*_COMPILED, *_extra_patterns()])

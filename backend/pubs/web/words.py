"""Czech has three plural forms and gettext only two, so web pages pick the form here."""

from __future__ import annotations


def plural(number: int, one: str, few: str, many: str) -> str:
    """1 hospoda, 3 hospody, 5 hospod. Each form is translated on its own; English gives few and many alike."""

    return one if number == 1 else few if 2 <= number <= 4 else many

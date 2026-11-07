"""Words that depend on a number: Czech has three plural forms and gettext only two, so web pages pick the form here."""

from __future__ import annotations

from django.utils import formats
from django.utils.translation import gettext


def plural(number: int, one: str, few: str, many: str) -> str:
    """1 hospoda, 3 hospody, 5 hospod. Each form is translated on its own; English gives few and many alike."""

    return one if number == 1 else few if 2 <= number <= 4 else many


def list_count(start: int, shown: int, total: int) -> dict:
    """The count under a list that goes on over pages: "50 z 157" on its first page, "51–100 z 157" on the next.

    The two formats with {first} and {last} let web.js rewrite it once it has appended more pages.
    """

    def grouped(number: int | str) -> str:
        return number if isinstance(number, str) else formats.number_format(number, 0, force_grouping=True)

    def from_start(last, total) -> str:
        return gettext("%(shown)s z %(total)s") % {"shown": grouped(last), "total": grouped(total)}

    def span(first, last, total) -> str:
        return gettext("%(first)s–%(last)s z %(total)s") % {"first": grouped(first), "last": grouped(last), "total": grouped(total)}

    last = start + shown
    return {
        "label": from_start(last, total) if start == 0 else span(start + 1, last, total),
        "from_start": from_start("{last}", total),
        "range": span("{first}", "{last}", total),
    }

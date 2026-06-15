"""
firmy_query_probe — find a query form that makes Firmy.cz search return a hit.

The miss diagnosis showed 7/8 no-matches were FIRMY-GAP: the `?q={name} {city}`
search returned NO detail link. Hypothesis: punctuation / long English
subtitles / over-specific queries break firmy.cz's search tokenizer (it answers
410 for zero results). This probe tries several query rewrites per failing name
and reports which forms surface a detail link + the first candidate name.

Output drives the search-query fix (strip punctuation, drop subtitle after
':' / ' - ', try name-without-city, etc).

Run: cd na-pivo-backend && uv run python scripts/firmy_query_probe.py
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import quote_plus

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from pubs.enrichment.firmy import _DETAIL_RE, FirmyHoursSource, TransientFetchError  # noqa: E402

# Failing names from the diagnosis (name, city).
CASES = [
    ("Golden Kettle Irish Pub", "Praha"),
    ("Pivnice U Zlatého slona", "Praha"),
    ("Pilsner Urquell: The Original Beer Experience", "Praha"),
    ("Švejk restaurant Malostranská pivnice", "Praha"),
    ("PLNÝ PEKÁČ - restaurace a pivnice", "Praha"),
    ("Pivovar U Tří růží", "Praha"),
    ("Purkrabský pivovar", "Praha"),
    ("Pivovar Staré Město", "Praha"),
]

_PUNCT = re.compile(r"[:\-–—&/|,.()]+")
_WS = re.compile(r"\s+")


def clean(s: str) -> str:
    return _WS.sub(" ", _PUNCT.sub(" ", s)).strip()


def core(s: str) -> str:
    """Name up to the first ':' or ' - ' separator (drops subtitle)."""
    for sep in (":", " - ", " – "):
        if sep in s:
            return s.split(sep, 1)[0].strip()
    return s.strip()


def variants(name: str, city: str) -> list[tuple[str, str]]:
    """(label, query) forms to try, in order."""
    forms = [
        ("raw+city", f"{name} {city}"),
        ("name-only", name),
        ("clean+city", f"{clean(name)} {city}"),
        ("clean-only", clean(name)),
        ("core+city", f"{core(name)} {city}"),
        ("core-clean", clean(core(name))),
    ]
    # dedupe by query text, keep first label
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for label, q in forms:
        if q and q not in seen:
            seen.add(q)
            out.append((label, q))
    return out


def first_hit(firmy: FirmyHoursSource, query: str) -> str | None:
    """Return the slug of the first detail link, or None / status string."""
    url = f"https://www.firmy.cz/?q={quote_plus(query)}"
    try:
        resp = firmy._get(url)
    except TransientFetchError as exc:
        return f"<transient {exc}>"
    except Exception as exc:  # noqa: BLE001
        return f"<err {exc}>"
    if 400 <= resp.status_code < 500 and resp.status_code != 429:
        return None  # 410/404 zero-result
    if resp.status_code >= 400:
        return f"<http {resp.status_code}>"
    m = _DETAIL_RE.search(resp.text)
    if not m:
        return None
    return m.group(2)  # slug


def main() -> int:
    firmy = FirmyHoursSource(
        proxy_url=None, min_interval=float(os.environ.get("MIN_INTERVAL", "3"))
    )
    for name, city in CASES:
        print(f"\n=== {name}  [{city}] ===")
        for label, q in variants(name, city):
            slug = first_hit(firmy, q)
            mark = "HIT " if (slug and not slug.startswith("<")) else "miss"
            shown = slug if slug else "(410/no result)"
            print(f"  [{mark}] {label:11} q={q!r}\n             -> {shown}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

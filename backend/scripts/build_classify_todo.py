#!/usr/bin/env python3
"""
build_classify_todo.py — quality-pass prep for the venue-name classifier.

Selects the catalogue entries that still need an LLM name verdict: CZ entries
whose bulk PubHours row is an UNMATCHED no-match (status=unknown, no
source_ref). Matched entries already carry a firmy-category venue_kind, which
beats name guessing, so they are skipped.

Obvious non-venue names (shelters, weirs, churches, streets, defunct
breweries…) are pre-seeded into the verdicts file as static not_pub verdicts so
the LLM never sees them; everything else goes to
scripts/venue_todo_unmatched.json for classify_venues.py --catalogue.

Run:  uv run python scripts/build_classify_todo.py
Then: uv run python scripts/classify_venues.py \
          --catalogue scripts/venue_todo_unmatched.json
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from pubs.enrichment.matcher import geohash8  # noqa: E402

CATALOGUE = REPO / "scripts" / "pub_catalogue_cz.json"
BULK_DB = REPO / "bulk.sqlite3"
TODO_OUT = REPO / "scripts" / "venue_todo_unmatched.json"
VERDICTS = REPO / "scripts" / "venue_verdicts.json"

# Names that are clearly not drinking venues — no LLM needed. Anchored,
# case-insensitive. Deliberately conservative: a generic-but-plausible pub name
# ("Hospoda", "Bar") is NOT here; the LLM judges those (keep-biased).
_STATIC_NOT_VENUE = [
    r"přístřešek",
    r"přístřešek - chatka",
    r"jez",
    r"jeskyně",
    r"kříž",
    r"studánka",
    r"pramen( .*)?",
    r"kaple( sv\..*)?",
    r"kostel( sv\..*)?",
    r"socha( sv\..*)?",
    r"zvonice",
    r"rozhledna( .*)?",
    r"zřícenina( .*)?",
    r"pomník( .*)?",
    r"památník( .*)?",
    r"vodojem",
    r"trafostanice",
    r"hřbitov",
    r"boží muka",
    r"mohyla( .*)?",
    r"štola( .*)?",
    r"bývalý pivovar",
    r"bývalý panský pivovar",
    r"pivovarský rybník",
    r"pivovarské rybníky",
    r"parkoviště( .*)?",
    r"autobusová zastávka( .*)?",
    r"dětské hřiště",
    r"nabíjecí stanice( .*)?",
    r".* \(\d{3,4}(,\d)? m\)",  # peaks: "Bartoňova hora (510 m)"
]
_STATIC_RE = re.compile("^(" + "|".join(_STATIC_NOT_VENUE) + ")$", re.IGNORECASE)


def main() -> int:
    catalogue = json.loads(CATALOGUE.read_text())
    db = sqlite3.connect(BULK_DB)
    unmatched_keys = {
        row[0]
        for row in db.execute(
            "SELECT cache_key FROM pubs_pubhours "
            "WHERE status='unknown' AND source_ref IS NULL"
        )
    }
    print(f"catalogue entries: {len(catalogue)}, unmatched no-match rows: {len(unmatched_keys)}")

    verdicts: dict[str, dict] = {}
    if VERDICTS.exists():
        verdicts = json.loads(VERDICTS.read_text())
    pre = len(verdicts)

    todo: list[dict] = []
    seen: set[str] = set()
    static_hits = 0
    for item in catalogue:
        name = (item.get("name") or "").strip()
        if not name:
            continue
        try:
            key8 = geohash8(item["lat"], item["lng"])
        except (KeyError, TypeError):
            continue
        if key8 not in unmatched_keys:
            continue
        vkey = f"{name}|{(item.get('city') or '').strip()}"
        if vkey in seen:
            continue
        seen.add(vkey)
        if _STATIC_RE.match(name):
            static_hits += 1
            verdicts.setdefault(
                vkey, {"verdict": "not_pub", "reason": "static blocklist (non-venue name)"}
            )
            continue
        todo.append({"name": name, "city": (item.get("city") or "").strip()})

    VERDICTS.write_text(json.dumps(verdicts, ensure_ascii=False, indent=1))
    TODO_OUT.write_text(json.dumps(todo, ensure_ascii=False, indent=1))
    print(f"static not_pub verdicts seeded: {static_hits} (verdicts file {pre} -> {len(verdicts)})")
    print(f"LLM todo written: {len(todo)} -> {TODO_OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
build_classify_todo_matched_maybe.py — LLM-judge firmy-MATCHED 'maybe' venues.

The quality pass only name-judged UNMATCHED catalogue entries; matched entries
trusted the firmy-category classifier. But firmy's 'maybe' bucket (inconclusive
categories) also contains lawyers, photographers and hairdressers with great
ratings. This preps those names for the LLM so the export can hide non-venues.

Run:  uv run python scripts/build_classify_todo_matched_maybe.py
Then: uv run python scripts/classify_venues.py \
          --catalogue scripts/venue_todo_matched_maybe.json
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from pubs.enrichment.matcher import geohash8  # noqa: E402

BULK_DB = REPO / "bulk.sqlite3"
CATALOGUES = [REPO / "scripts" / "pub_catalogue_cz.json", REPO / "scripts" / "pub_catalogue_sk.json"]
TODO_OUT = REPO / "scripts" / "venue_todo_matched_maybe.json"
VERDICTS = REPO / "scripts" / "venue_verdicts.json"


def main() -> int:
    db = sqlite3.connect(BULK_DB)
    maybe_keys = {
        row[0]
        for row in db.execute(
            "SELECT cache_key FROM pubs_pubhours "
            "WHERE source_ref IS NOT NULL AND venue_kind='maybe'"
        )
    }
    print(f"matched 'maybe' rows in bulk db: {len(maybe_keys)}")

    verdicts: dict[str, dict] = {}
    if VERDICTS.exists():
        verdicts = json.loads(VERDICTS.read_text())

    todo: list[dict] = []
    seen: set[str] = set()
    already = 0
    for path in CATALOGUES:
        for item in json.loads(path.read_text()):
            name = (item.get("name") or "").strip()
            if not name:
                continue
            try:
                if geohash8(item["lat"], item["lng"]) not in maybe_keys:
                    continue
            except (KeyError, TypeError):
                continue
            vkey = f"{name}|{(item.get('city') or '').strip()}"
            if vkey in seen:
                continue
            seen.add(vkey)
            if vkey in verdicts:
                already += 1
                continue
            todo.append({"name": name, "city": (item.get("city") or "").strip()})

    TODO_OUT.write_text(json.dumps(todo, ensure_ascii=False, indent=1))
    print(f"already judged: {already} | LLM todo: {len(todo)} -> {TODO_OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

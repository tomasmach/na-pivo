#!/usr/bin/env python3
"""
build_classify_todo_sk.py — quality-pass prep for the SLOVAK catalogue.

The SK sweep bbox is a rectangle, so pub_catalogue_sk.json also swept northern
Hungary (Miskolc, Nyíregyháza), southern Poland and eastern CZ (Zlín). This
script keeps only entries inside a coarse Slovakia polygon (CZ entries are
covered by the CZ pipeline), seeds static not_pub verdicts for obvious
non-venue names (Czech + Slovak patterns), and writes the LLM todo file.

SK entries have no firmy match (firmy.cz is CZ-only), so ALL surviving names
go to the LLM.

Run:  uv run python scripts/build_classify_todo_sk.py
Then: uv run python scripts/classify_venues.py \
          --catalogue scripts/venue_todo_sk.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "scripts" / "pub_catalogue_sk.json"
TODO_OUT = REPO / "scripts" / "venue_todo_sk.json"
VERDICTS = REPO / "scripts" / "venue_verdicts.json"

# Deliberately coarse Slovakia outline, (lng, lat). Border pubs may slip either
# way; the map serves both countries so a few km of slack is harmless.
_SK_BORDER_POLYGON = (
    (16.94, 48.62),   # CZ/AT/SK tri-border (Kúty)
    (16.98, 48.13),   # Devín / Bratislava SW
    (17.25, 47.99),   # Danube, below Bratislava
    (18.30, 47.73),   # HU border low point (Patince)
    (18.72, 47.79),   # Štúrovo
    (19.60, 48.20),   # HU border, Lučenec south
    (20.50, 48.30),   # HU border, Rimavská south
    (21.60, 48.33),   # Tokaj corner
    (22.15, 48.38),   # Čierna nad Tisou (UA corner)
    (22.55, 48.80),   # UA border east
    (22.55, 49.10),   # UA/PL corner
    (22.00, 49.30),   # PL border, Carpathians
    (21.00, 49.48),   # PL border
    (20.10, 49.42),   # Tatry
    (19.45, 49.62),   # Orava
    (18.85, 49.52),   # Kysuce (shared with CZ polygon)
    (18.16, 49.27),
    (17.55, 48.82),
)

# Czech + Slovak obvious non-venue names (anchored, case-insensitive).
_STATIC_NOT_VENUE = [
    # Czech (kept for the CZ-overlap slack inside the coarse polygon)
    r"přístřešek( .*)?", r"jez", r"jeskyně", r"kříž", r"studánka",
    r"kaple( .*)?", r"kostel( .*)?", r"socha( .*)?", r"pomník( .*)?",
    # Slovak
    r"prístrešok( .*)?", r"útulňa( .*)?", r"studňa", r"prameň( .*)?",
    r"kaplnka( .*)?", r"kostol( .*)?", r"kríž", r"cintorín( .*)?",
    r"pamätník( .*)?", r"rozhľadňa( .*)?", r"zrúcanina( .*)?",
    r"jaskyňa( .*)?", r"vyhliadka( .*)?", r"zvonica( .*)?",
    r"autobusová zastávka( .*)?", r"železničná stanica( .*)?",
    r"detské ihrisko", r"parkovisko( .*)?", r"bývalý pivovar( .*)?",
    r".* \(\d{3,4}(,\d)? m\)",  # peaks
]
_STATIC_RE = re.compile("^(" + "|".join(_STATIC_NOT_VENUE) + ")$", re.IGNORECASE)


def _inside_sk(lng: float, lat: float) -> bool:
    inside = False
    p_lng, p_lat = _SK_BORDER_POLYGON[-1]
    for c_lng, c_lat in _SK_BORDER_POLYGON:
        if (c_lat > lat) != (p_lat > lat):
            x = (p_lng - c_lng) * (lat - c_lat) / (p_lat - c_lat) + c_lng
            if lng < x:
                inside = not inside
        p_lng, p_lat = c_lng, c_lat
    return inside


def main() -> int:
    catalogue = json.loads(CATALOGUE.read_text())
    verdicts: dict[str, dict] = {}
    if VERDICTS.exists():
        verdicts = json.loads(VERDICTS.read_text())
    pre = len(verdicts)

    todo: list[dict] = []
    seen: set[str] = set()
    outside = static_hits = already = 0
    for item in catalogue:
        name = (item.get("name") or "").strip()
        if not name:
            continue
        try:
            if not _inside_sk(float(item["lng"]), float(item["lat"])):
                outside += 1
                continue
        except (KeyError, TypeError, ValueError):
            continue
        vkey = f"{name}|{(item.get('city') or '').strip()}"
        if vkey in seen:
            continue
        seen.add(vkey)
        if vkey in verdicts:
            already += 1
            continue
        if _STATIC_RE.match(name):
            static_hits += 1
            verdicts[vkey] = {"verdict": "not_pub", "reason": "static blocklist (non-venue name)"}
            continue
        todo.append({"name": name, "city": (item.get("city") or "").strip()})

    VERDICTS.write_text(json.dumps(verdicts, ensure_ascii=False, indent=1))
    TODO_OUT.write_text(json.dumps(todo, ensure_ascii=False, indent=1))
    print(f"catalogue: {len(catalogue)} | outside SK polygon: {outside} | already judged: {already}")
    print(f"static not_pub seeded: {static_hits} (verdicts {pre} -> {len(verdicts)})")
    print(f"LLM todo: {len(todo)} -> {TODO_OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

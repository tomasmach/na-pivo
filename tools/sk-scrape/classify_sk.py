# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Classify scraped SK places into pub / maybe / not_pub from Google categories.

Deterministic and free: Google returns a localized category list per place
(e.g. "Krčma", "Reštaurácia", "Zmrzlináreň") that is a strong beer-serving
signal. This mirrors the backend's pub/maybe/not_pub venue_kind used by
/v1/pubs/near (it surfaces pub + maybe).

Rules, in priority order per place:
  1. any PUB category            -> pub      (beer-first / pub identity)
  2. any DISQUALIFYING category  -> not_pub  (unless already pub above)
  3. any MAYBE category          -> maybe    (food-first, usually has draft beer)
  4. otherwise                   -> unknown  (no category / unrecognized;
                                              candidate for an LLM name pass)

Output: sk_venue_kind.jsonl -> {"feature_id":..., "venue_kind":..., "categories":[...]}
Also prints a summary so we can size the hours phase (pub + maybe).
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent
RAW = BASE / "sk_places_raw.jsonl"
OUT = BASE / "sk_venue_kind.jsonl"

# Beer-first / drinking venues. Any of these -> pub.
PUB = {
    "krčma", "gastronomická krčma", "piváreň", "hostinec", "pivovar",
    "pivnica", "pivničný bar", "pub", "bar", "bar a gril", "koktejlový bar",
    "kokteilový bar", "športový bar", "bar so šípkami", "vináreň", "nočný klub",
    "gastro pub", "pivný bar", "hospoda", "výčap",
}

# Food-first but in SK/CZ culture typically serves draft beer -> maybe (still shown).
MAYBE = {
    "reštaurácia", "rodinná reštaurácia", "bistro", "pizzeria",
    "hamburgerová reštaurácia", "ázijská reštaurácia", "talianska reštaurácia",
    "slovenská reštaurácia", "grilovacia reštaurácia", "gril", "gastronomia",
    "reštaurácia s tradičnou kuchyňou", "európska reštaurácia",
    "mexická reštaurácia", "vietnamská reštaurácia", "čínska reštaurácia",
}

# Clearly not a beer venue -> not_pub (accommodation, shops, sweets, takeaway...).
NOT_PUB = {
    "kaviareň", "zmrzlináreň", "cukráreň", "rýchle občerstvenie", "bufet",
    "penzión", "hotel", "ubytovanie", "nocľah a raňajky",
    "ubytovanie s izbovou službou", "obchod", "obchod s vínom",
    "obchod s potravinami", "čerpacia stanica", "detské ihrisko",
    "turistická atrakcia", "dodávateľ cateringových služieb", "rozvoz jedla",
    "rozvoz pizzy", "pizza so sebou", "raňajková reštaurácia", "vinotéka",
    "obchod s alkoholom", "supermarket", "pekáreň", "lekáreň", "banka",
    "kostol", "múzeum", "park", "parkovisko", "čajovňa",
}


def classify(categories: list[str]) -> str:
    cats = {c.strip().casefold() for c in categories if c}
    if cats & PUB:
        return "pub"
    # takeaway/delivery variants of otherwise-fine names disqualify
    if any("so sebou" in c or "donáš" in c or "rozvoz" in c for c in cats):
        return "not_pub"
    if cats & NOT_PUB:
        return "not_pub"
    if cats & MAYBE:
        return "maybe"
    return "unknown"


def main() -> int:
    summary: Counter = Counter()
    with RAW.open(encoding="utf-8") as fin, OUT.open("w", encoding="utf-8") as fout:
        for line in fin:
            if not line.strip():
                continue
            rec = json.loads(line)
            cats = rec.get("categories") or []
            kind = classify(cats)
            summary[kind] += 1
            fout.write(json.dumps(
                {"feature_id": rec.get("feature_id"), "venue_kind": kind, "categories": cats},
                ensure_ascii=False,
            ) + "\n")

    total = sum(summary.values())
    print(f"classified {total} places -> {OUT.name}")
    for kind in ("pub", "maybe", "not_pub", "unknown"):
        c = summary[kind]
        print(f"  {kind:8} {c:6}  ({100*c/total:.1f}%)")
    print(f"\nhours phase target (pub + maybe): {summary['pub'] + summary['maybe']}")
    print(f"unknown (candidates for LLM name pass): {summary['unknown']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

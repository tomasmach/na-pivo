# /// script
# requires-python = ">=3.14"
# dependencies = ["geohash2>=1.1"]
# ///
"""Build the deduplicated pub universe for Google Places matching.

Sources (dumped from production):
- pubdirectory.csv    (active directory pubs; has cache_key + name_key)
- useraddedpub.csv    (active user-added pubs)
- searchcache_items.jsonl (Mapy.com suggest items cached per cell)
- pubhours.csv        (enrichment rows keyed by cache_key; extra name variants)

Identity matches backend pubs.identity: cache_key(geohash8) + casefolded
whitespace-normalized name. Output: universe.jsonl with one pub per identity.
"""

import csv
import json
import re
from pathlib import Path

import geohash2

_SPACE_RE = re.compile(r"\s+")

BASE = Path(__file__).parent


def name_key(name: str) -> str:
    return _SPACE_RE.sub(" ", (name or "").strip().casefold())


def geohash8(lat: float, lng: float) -> str:
    return geohash2.encode(lat, lng, precision=8)


universe: dict[tuple[str, str], dict] = {}


def add(cache_key: str, name: str, lat: float, lng: float, city: str, source: str):
    nk = name_key(name)
    if not nk:
        return
    key = (cache_key, nk)
    existing = universe.get(key)
    if existing is None:
        universe[key] = {
            "cache_key": cache_key,
            "name_key": nk,
            "name": name.strip(),
            "lat": lat,
            "lng": lng,
            "city": city or "",
            "sources": [source],
        }
    else:
        if source not in existing["sources"]:
            existing["sources"].append(source)
        if not existing["city"] and city:
            existing["city"] = city


with open(BASE / "pubdirectory.csv", newline="") as f:
    for row in csv.DictReader(f):
        add(
            row["cache_key"],
            row["name"],
            float(row["lat"]),
            float(row["lng"]),
            row["city"],
            "directory",
        )

with open(BASE / "useraddedpub.csv", newline="") as f:
    for row in csv.DictReader(f):
        add(
            row["cache_key"],
            row["name"],
            float(row["lat"]),
            float(row["lng"]),
            row["city"],
            "user_added",
        )

seen_items = 0
with open(BASE / "searchcache_items.jsonl") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        nm = item.get("name") or ""
        pos = item.get("position") or {}
        lat, lon = pos.get("lat"), pos.get("lon")
        if not nm or lat is None or lon is None:
            continue
        city = ""
        for part in item.get("regionalStructure") or []:
            if part.get("type") == "regional.municipality":
                city = part.get("name") or ""
                break
        add(geohash8(lat, lon), nm, lat, lon, city, "searchcache")
        seen_items += 1

with open(BASE / "pubhours.csv", newline="") as f:
    for row in csv.DictReader(f):
        if row["status"] not in ("ok", "unknown"):
            continue
        try:
            lat, lng = float(row["lat"]), float(row["lng"])
        except ValueError:
            continue
        add(row["cache_key"], row["name"], lat, lng, row["city"], "pubhours")

with open(BASE / "universe.jsonl", "w") as out:
    for rec in universe.values():
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")

by_source: dict[str, int] = {}
for rec in universe.values():
    for s in rec["sources"]:
        by_source[s] = by_source.get(s, 0) + 1

print(f"searchcache items scanned: {seen_items}")
print(f"unique identities: {len(universe)}")
print(f"per source: {by_source}")

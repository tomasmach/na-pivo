"""Build the reviewed pub-directory JSONL export without loading Django."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import geohash2

try:
    from pubs.enrichment.coverage import coverage_country
except ImportError:  # Direct invocation: python scripts/build_pub_directory_export.py
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from pubs.enrichment.coverage import coverage_country

OUTPUT_FIELDS = (
    "country", "name", "lat", "lng", "cache_key", "city", "venue_kind",
    "opening_hours_raw", "rating_value", "rating_count", "rating_label",
    "source_ref", "confidence", "status",
)


def geohash8(lat: float, lng: float) -> str:
    return geohash2.encode(lat, lng, precision=8)


def _country(lat: float, lng: float) -> str | None:
    return coverage_country(lat, lng)


def _load_catalogue(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _load_verdicts(path: Path) -> dict[str, dict]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _load_bulk_rows(path: Path) -> dict[str, dict]:
    columns = (
        "cache_key", "name", "lat", "lng", "opening_hours_raw", "source",
        "source_ref", "confidence", "status", "venue_kind", "venue_categories",
        "rating_value", "rating_count", "rating_label", "fetched_at",
    )
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(f"SELECT {', '.join(columns)} FROM pubs_pubhours")
        return {row["cache_key"]: dict(row) for row in rows}


def build_export(cz_catalogue: Path, sk_catalogue: Path, bulk_db: Path, verdicts_path: Path, out: Path) -> dict[str, Counter]:
    """Build an export and return per-country counters."""
    verdicts = _load_verdicts(verdicts_path)
    bulk_rows = _load_bulk_rows(bulk_db)
    stats: dict[str, Counter] = defaultdict(Counter)
    seen: set[tuple[str, str]] = set()

    with out.open("w", encoding="utf-8") as output:
        for catalogue_country, path in (("cz", cz_catalogue), ("sk", sk_catalogue)):
            for entry in _load_catalogue(path):
                name = str(entry["name"])
                city = str(entry.get("city") or "")
                lat, lng = float(entry["lat"]), float(entry["lng"])
                country = _country(lat, lng)
                if country is None or (catalogue_country == "sk" and country == "cz"):
                    stats[catalogue_country]["skipped_noise"] += 1
                    continue

                cache_key = geohash8(lat, lng)
                identity = (cache_key, name)
                if identity in seen:
                    stats[country]["skipped_noise"] += 1
                    continue

                bulk = bulk_rows.get(cache_key) if catalogue_country == "cz" else None
                matched = bulk if bulk and bulk.get("source_ref") else None
                if matched:
                    venue_kind = matched.get("venue_kind") or "unknown"
                else:
                    verdict = verdicts.get(f"{name}|{city}", {}).get("verdict")
                    venue_kind = {"pub": "pub", "unsure": "maybe"}.get(verdict)
                    if venue_kind is None:
                        stats[country]["skipped_noise"] += 1
                        continue

                row = {
                    "country": country,
                    "name": name,
                    "lat": lat,
                    "lng": lng,
                    "cache_key": cache_key,
                    "city": city,
                    "venue_kind": venue_kind,
                    "opening_hours_raw": matched.get("opening_hours_raw") if matched else None,
                    "rating_value": matched.get("rating_value") if matched else None,
                    "rating_count": matched.get("rating_count") if matched else None,
                    "rating_label": matched.get("rating_label") if matched else None,
                    "source_ref": matched.get("source_ref") if matched else None,
                    "confidence": matched.get("confidence") if matched else None,
                    "status": matched.get("status") if matched else None,
                }
                output.write(json.dumps({field: row[field] for field in OUTPUT_FIELDS}, ensure_ascii=False) + "\n")
                seen.add(identity)
                stats[country][venue_kind] += 1
                stats[country]["hours"] += bool(row["opening_hours_raw"])
                stats[country]["rating"] += any(row[field] is not None for field in ("rating_value", "rating_count", "rating_label"))
    return stats


def print_stats(stats: dict[str, Counter]) -> None:
    print("country  pub  maybe  not_pub  skipped_noise  hours  rating")
    for country in ("cz", "sk"):
        row = stats[country]
        print(f"{country:7} {row['pub']:4} {row['maybe']:6} {row['not_pub']:8} {row['skipped_noise']:14} {row['hours']:6} {row['rating']:7}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cz-catalogue", type=Path, default=Path("scripts/pub_catalogue_cz.json"))
    parser.add_argument("--sk-catalogue", type=Path, default=Path("scripts/pub_catalogue_sk.json"))
    parser.add_argument("--bulk-db", type=Path, default=Path("bulk.sqlite3"))
    parser.add_argument("--verdicts", type=Path, default=Path("scripts/venue_verdicts.json"))
    parser.add_argument("--out", type=Path, default=Path("scripts/pub_directory_export.jsonl"))
    args = parser.parse_args()
    print_stats(build_export(args.cz_catalogue, args.sk_catalogue, args.bulk_db, args.verdicts, args.out))


if __name__ == "__main__":
    main()

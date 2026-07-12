"""Build the reviewed pub-directory JSONL export without loading Django."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import geohash2

CZ_POLYGON = [(12.09, 50.25), (12.55, 50.40), (13.02, 50.50), (14.30, 50.88), (14.99, 51.05), (15.54, 50.78), (16.20, 50.66), (16.68, 50.10), (17.72, 50.32), (18.56, 49.90), (18.85, 49.52), (18.16, 49.27), (17.55, 48.82), (16.94, 48.62), (16.06, 48.75), (15.16, 48.94), (14.70, 48.58), (13.83, 48.77), (12.67, 49.43)]
SK_POLYGON = [(16.94, 48.62), (16.98, 48.13), (17.25, 47.99), (18.30, 47.73), (18.72, 47.79), (19.60, 48.20), (20.50, 48.30), (21.60, 48.33), (22.15, 48.38), (22.55, 48.80), (22.55, 49.10), (22.00, 49.30), (21.00, 49.48), (20.10, 49.42), (19.45, 49.62), (18.85, 49.52), (18.16, 49.27), (17.55, 48.82)]

OUTPUT_FIELDS = (
    "country", "name", "lat", "lng", "cache_key", "city", "venue_kind",
    "opening_hours_raw", "rating_value", "rating_count", "rating_label",
    "source_ref", "confidence", "status",
)


def geohash8(lat: float, lng: float) -> str:
    return geohash2.encode(lat, lng, precision=8)


def point_in_polygon(lng: float, lat: float, polygon: list[tuple[float, float]]) -> bool:
    """Return whether a point is inside a polygon using an even-odd ray cast."""
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > lat) != (y2 > lat):
            crossing_x = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lng < crossing_x:
                inside = not inside
        previous = current
    return inside


def _country(lat: float, lng: float) -> str | None:
    if point_in_polygon(lng, lat, CZ_POLYGON):
        return "cz"
    if point_in_polygon(lng, lat, SK_POLYGON):
        return "sk"
    return None


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

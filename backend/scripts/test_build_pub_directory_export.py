from __future__ import annotations

import json
import sqlite3

from scripts.build_pub_directory_export import build_export, geohash8


def test_polygon_catalogue_skip_and_tier_mapping(tmp_path):
    cz_entries = [
        {"name": "Verdict Pub", "lat": 50.08, "lng": 14.42, "city": "Praha"},
        {"name": "Unsure Pub", "lat": 49.20, "lng": 16.60, "city": "Brno"},
        {"name": "Noise", "lat": 49.75, "lng": 13.38, "city": "Plzeň"},
        {"name": "Matched Shop", "lat": 49.59, "lng": 17.25, "city": "Olomouc"},
        {"name": "Matched Lawyer", "lat": 50.21, "lng": 15.83, "city": "Hradec Králové"},
    ]
    sk_entries = [
        {"name": "Overlap", "lat": 49.20, "lng": 16.60, "city": "Brno"},
        {"name": "SK Pub", "lat": 48.15, "lng": 17.11, "city": "Bratislava"},
    ]
    cz = tmp_path / "cz.json"
    sk = tmp_path / "sk.json"
    verdicts = tmp_path / "verdicts.json"
    database = tmp_path / "bulk.sqlite3"
    output = tmp_path / "out.jsonl"
    cz.write_text(json.dumps(cz_entries), encoding="utf-8")
    sk.write_text(json.dumps(sk_entries), encoding="utf-8")
    verdicts.write_text(json.dumps({
        "Verdict Pub|Praha": {"verdict": "pub", "reason": ""},
        "Unsure Pub|Brno": {"verdict": "unsure", "reason": ""},
        "Noise|Plzeň": {"verdict": "not_pub", "reason": ""},
        "Matched Lawyer|Hradec Králové": {"verdict": "not_pub", "reason": "lawyer office"},
        "Overlap|Brno": {"verdict": "pub", "reason": ""},
        "SK Pub|Bratislava": {"verdict": "pub", "reason": ""},
    }), encoding="utf-8")
    with sqlite3.connect(database) as connection:
        connection.execute("""CREATE TABLE pubs_pubhours (
            cache_key TEXT, name TEXT, lat REAL, lng REAL, opening_hours_raw TEXT,
            source TEXT, source_ref TEXT, confidence REAL, status TEXT, venue_kind TEXT,
            venue_categories TEXT, venue_tags TEXT, rating_value REAL, rating_count INTEGER,
            rating_label TEXT, fetched_at TEXT)""")
        matched = cz_entries[3]
        connection.execute(
            "INSERT INTO pubs_pubhours VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (geohash8(matched["lat"], matched["lng"]), matched["name"], matched["lat"],
             matched["lng"], None, "firmy", "firm-1", 0.9, "unknown", "not_pub",
             "[]", "[]", 3.0, 2, "Dobré", "2026-01-01"),
        )
        # Firmy-matched 'maybe' with a not_pub name verdict → downgraded to not_pub.
        lawyer = cz_entries[4]
        connection.execute(
            "INSERT INTO pubs_pubhours VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (geohash8(lawyer["lat"], lawyer["lng"]), lawyer["name"], lawyer["lat"],
             lawyer["lng"], None, "firmy", "firm-2", 0.99, "unknown", "maybe",
             "[]", "[]", 4.4, 1, "Výborné", "2026-01-01"),
        )

    stats = build_export(cz, sk, database, verdicts, output)
    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    by_name = {row["name"]: row for row in rows}
    assert set(by_name) == {"Verdict Pub", "Unsure Pub", "Matched Shop", "Matched Lawyer", "SK Pub"}
    assert by_name["Verdict Pub"]["country"] == "cz"
    assert by_name["Unsure Pub"]["venue_kind"] == "maybe"
    assert by_name["Matched Shop"]["venue_kind"] == "not_pub"
    # LLM not_pub verdict downgrades a firmy-matched 'maybe' but keeps enrichment.
    assert by_name["Matched Lawyer"]["venue_kind"] == "not_pub"
    assert by_name["Matched Lawyer"]["rating_value"] == 4.4
    assert by_name["SK Pub"]["country"] == "sk"
    assert stats["cz"]["not_pub"] == 2

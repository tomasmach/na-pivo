# /// script
# requires-python = ">=3.14"
# dependencies = ["geohash2==1.1"]
# ///
"""Normalize the raw Slovakia Google Maps scrape for import_pub_directory."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable

import geohash2

BASE = Path(__file__).resolve().parent
RAW_PATH = BASE / "sk_places_raw.jsonl"
HOURS_PATH = BASE / "sk_hours_by_day.jsonl"
IMPORT_PATH = BASE / "sk_import.jsonl"

SPACE_RE = re.compile(r"\s+")
POSTAL_RE = re.compile(r"^(?:SK-)?\d{3}\s?\d{2}\s+")
TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?")
DAY_NAMES = {
    "monday": 0,
    "pondelok": 0,
    "po": 0,
    "tuesday": 1,
    "utorok": 1,
    "ut": 1,
    "wednesday": 2,
    "streda": 2,
    "st": 2,
    "thursday": 3,
    "štvrtok": 3,
    "stvrtok": 3,
    "št": 3,
    "friday": 4,
    "piatok": 4,
    "pi": 4,
    "saturday": 5,
    "sobota": 5,
    "so": 5,
    "sunday": 6,
    "nedeľa": 6,
    "nedela": 6,
    "ne": 6,
}
OSM_DAYS = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
CLOSED_WORDS = ("zatvorené", "zatvorene", "closed")
OPEN_24_WORDS = (
    "otvorené 24 hodín",
    "otvorene 24 hodin",
    "open 24 hours",
    "nonstop",
    "24 hodín",
)


def name_key(name: str) -> str:
    return SPACE_RE.sub(" ", (name or "").strip().casefold())


def geohash8(lat: float, lng: float) -> str:
    return geohash2.encode(lat, lng, precision=8)


def iter_values(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, list):
        for child in value:
            yield from iter_values(child)
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_values(child)


def clean_time(hour: str, minute: str | None) -> str:
    return f"{int(hour):02d}:{minute or '00'}"


def parse_interval_text(text: str) -> str | None:
    folded = text.casefold()
    if any(word in folded for word in CLOSED_WORDS):
        return "off"
    if any(word in folded for word in OPEN_24_WORDS):
        return "00:00-24:00"
    intervals = [
        f"{clean_time(match.group(1), match.group(2))}-{clean_time(match.group(3), match.group(4))}"
        for match in TIME_RE.finditer(text)
    ]
    return ",".join(intervals) if intervals else None


def weekday_rows(value: Any) -> dict[int, str]:
    """Find localized [weekday, hours] rows anywhere in Google's raw hours array."""
    rows: dict[int, str] = {}
    for item in iter_values(value):
        if not isinstance(item, list) or len(item) < 2 or not isinstance(item[0], str):
            continue
        day = DAY_NAMES.get(item[0].strip().casefold().rstrip(":"))
        if day is None:
            continue
        texts = [part for part in iter_values(item[1:]) if isinstance(part, str)]
        parsed = parse_interval_text("; ".join(texts))
        if parsed:
            rows[day] = parsed
    return rows


def api_period_rows(value: Any) -> dict[int, str]:
    """Support Places-style period dictionaries if Google emits that variant."""
    intervals: dict[int, list[str]] = {}
    for item in iter_values(value):
        if not isinstance(item, dict) or "open" not in item:
            continue
        opening = item.get("open") or {}
        closing = item.get("close") or {}
        day = opening.get("day")
        open_time = opening.get("time")
        close_time = closing.get("time")
        if not isinstance(day, int) or not isinstance(open_time, str):
            continue
        # Google Places numbers Sunday as zero; OSM starts with Monday.
        osm_day = (day - 1) % 7
        if not close_time:
            intervals.setdefault(osm_day, []).append("00:00-24:00")
            continue
        start = f"{open_time[:2]}:{open_time[2:4]}"
        end = f"{close_time[:2]}:{close_time[2:4]}"
        intervals.setdefault(osm_day, []).append(f"{start}-{end}")
    return {day: ",".join(values) for day, values in intervals.items()}


def merge_days(rows: dict[int, str]) -> str | None:
    if not rows:
        return None
    if len(rows) == 7 and all(value == "00:00-24:00" for value in rows.values()):
        return "24/7"
    parts: list[str] = []
    day = 0
    while day < 7:
        value = rows.get(day)
        if value is None:
            day += 1
            continue
        end = day
        while end + 1 < 7 and rows.get(end + 1) == value:
            end += 1
        day_label = OSM_DAYS[day] if end == day else f"{OSM_DAYS[day]}-{OSM_DAYS[end]}"
        parts.append(f"{day_label} {value}")
        day = end + 1
    return "; ".join(parts) or None


def normalize_hours(value: Any) -> str | None:
    if value is None:
        return None
    rows = weekday_rows(value) or api_period_rows(value)
    return merge_days(rows)


def city_from_address(address: str) -> str:
    parts = [part.strip() for part in (address or "").split(",") if part.strip()]
    countries = {"slovensko", "slovakia", "slovenská republika", "slovak republic"}
    parts = [part for part in parts if part.casefold() not in countries]
    for part in reversed(parts):
        cleaned = POSTAL_RE.sub("", part).strip()
        if cleaned and cleaned != part:
            return cleaned
    return parts[-1] if len(parts) > 1 else ""


def review_count(record: dict[str, Any]) -> int:
    value = record.get("rating_count")
    return value if isinstance(value, int) else -1


def load_and_deduplicate(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    records: dict[tuple[str, str], dict[str, Any]] = {}
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                name = SPACE_RE.sub(" ", record["name"].strip())
                lat = float(record["lat"])
                lng = float(record["lng"])
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"Invalid raw line {line_number}: {exc}") from exc
            if not name or not (-90 <= lat <= 90 and -180 <= lng <= 180):
                continue
            record["name"] = name
            record["lat"] = lat
            record["lng"] = lng
            identity = (geohash8(lat, lng), name_key(name))
            existing = records.get(identity)
            if existing is None or review_count(record) > review_count(existing):
                records[identity] = record
    return records


def load_weekly_hours(raw_path: Path, hours_path: Path) -> dict[str, dict[int, str]]:
    """Merge day-one discovery hours with the latest usable daily captures."""
    weekly: dict[str, dict[int, str]] = {}
    with raw_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid raw line {line_number}: {exc}") from exc
            feature_id = record.get("feature_id")
            if not isinstance(feature_id, str) or not feature_id:
                continue
            parsed = weekday_rows(record.get("hours_periods")) or api_period_rows(
                record.get("hours_periods")
            )
            scraped_weekday = record.get("scraped_weekday")
            if (
                len(parsed) == 1
                and isinstance(scraped_weekday, int)
                and not isinstance(scraped_weekday, bool)
                and 0 <= scraped_weekday <= 6
            ):
                weekly.setdefault(feature_id.lower(), {})[scraped_weekday] = next(
                    iter(parsed.values())
                )
            elif parsed:
                # Backward-compatible with pre-addendum rows: their localized
                # weekday label is enough to recover the capture day.
                weekly.setdefault(feature_id.lower(), {}).update(parsed)

    if not hours_path.exists():
        return weekly
    with hours_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid hours line {line_number}: {exc}") from exc
            feature_id = item.get("feature_id")
            weekday = item.get("weekday")
            interval = item.get("hours_interval")
            if (
                not isinstance(feature_id, str)
                or not feature_id
                or not isinstance(weekday, int)
                or isinstance(weekday, bool)
                or not 0 <= weekday <= 6
            ):
                raise ValueError(
                    f"Invalid hours line {line_number}: invalid identity/day"
                )
            if interval is None:
                # Unknown is not the same as closed; retain any earlier usable
                # observation for this weekday instead of replacing it.
                continue
            if not isinstance(interval, str) or not interval.strip():
                raise ValueError(f"Invalid hours line {line_number}: invalid interval")
            weekly.setdefault(feature_id.lower(), {})[weekday] = interval.strip()
    return weekly


def load_venue_kinds(kinds_path: Path, verdicts_path: Path) -> dict[str, str]:
    """feature_id -> venue_kind, LLM verdict (pub/not_pub) overriding the category."""
    kinds: dict[str, str] = {}
    if kinds_path.exists():
        with kinds_path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    item = json.loads(line)
                    fid = item.get("feature_id")
                    if fid:
                        kinds[fid] = item.get("venue_kind") or "unknown"
    if verdicts_path.exists():
        with verdicts_path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    item = json.loads(line)
                    fid = item.get("feature_id")
                    if fid and item.get("verdict") in ("pub", "not_pub"):
                        kinds[fid] = item["verdict"]
    return kinds


def normalize_record(
    record: dict[str, Any],
    weekly_hours: dict[int, str] | None = None,
    venue_kind: str = "unknown",
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "name": record["name"],
        "lat": record["lat"],
        "lng": record["lng"],
        "cache_key": geohash8(record["lat"], record["lng"]),
        "city": record.get("city") or city_from_address(record.get("address") or ""),
        "country": "sk",
        "venue_kind": venue_kind,
    }
    hours = merge_days(weekly_hours or {})
    if hours:
        output["opening_hours_raw"] = hours
    google_place_id = record.get("google_place_id")
    if isinstance(google_place_id, str) and google_place_id.startswith("ChIJ"):
        output["google_place_id"] = google_place_id
    rating_value = record.get("rating_value")
    if isinstance(rating_value, (int, float)) and not isinstance(rating_value, bool):
        output["rating_value"] = float(rating_value)
    rating_count = record.get("rating_count")
    if isinstance(rating_count, int) and not isinstance(rating_count, bool):
        output["rating_count"] = rating_count
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=RAW_PATH)
    parser.add_argument("--hours-input", type=Path, default=HOURS_PATH)
    parser.add_argument("--output", type=Path, default=IMPORT_PATH)
    parser.add_argument("--kinds-input", type=Path, default=BASE / "sk_venue_kind.jsonl")
    parser.add_argument("--verdicts-input", type=Path, default=BASE / "sk_llm_verdicts.jsonl")
    parser.add_argument(
        "--keep-not-pub", action="store_true",
        help="Also emit places classified not_pub (default: drop them).",
    )
    args = parser.parse_args()
    records = load_and_deduplicate(args.input)
    weekly_hours = load_weekly_hours(args.input, args.hours_input)
    venue_kinds = load_venue_kinds(args.kinds_input, args.verdicts_input)

    written = 0
    dropped = 0
    with args.output.open("w", encoding="utf-8") as handle:
        for record in records.values():
            feature_id = record.get("feature_id")
            kind = venue_kinds.get(feature_id, "unknown") if isinstance(feature_id, str) else "unknown"
            if kind == "not_pub" and not args.keep_not_pub:
                dropped += 1
                continue
            handle.write(
                json.dumps(
                    normalize_record(
                        record,
                        weekly_hours.get(feature_id.lower(), {})
                        if isinstance(feature_id, str)
                        else {},
                        kind,
                    ),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "\n"
            )
            written += 1
    print(f"normalized {written} pub/maybe identities -> {args.output} (dropped {dropped} not_pub)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

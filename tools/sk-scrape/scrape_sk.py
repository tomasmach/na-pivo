# /// script
# requires-python = ">=3.14"
# dependencies = ["playwright==1.61.0"]
# ///
"""Resumable Google Maps scraper for pub-like venues in Slovakia.

Discover mode finds places through tiled searches; its safe default runs two
sample tiles and a country-wide run requires ``--full-country``. Hours mode
cheaply revisits already-discovered feature IDs to accumulate today's hours.
Google Maps is driven through a residential browser; the paid Places API is
never used.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import random
import re
import subprocess
import sys
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote
from zoneinfo import ZoneInfo

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Response,
    async_playwright,
)

BASE = Path(__file__).resolve().parent
RAW_PATH = BASE / "sk_places_raw.jsonl"
HOURS_PATH = BASE / "sk_hours_by_day.jsonl"
CHECKPOINT_PATH = BASE / "sk_scrape_checkpoint.jsonl"
SAMPLE_RECORD_PATH = BASE / "sample_intercept_record.json"
LOCAL_TIMEZONE = ZoneInfo("Europe/Bratislava")

KEYWORDS = (
    "krčma",
    "hostinec",
    "piváreň",
    "pivnica",
    "pub",
    "bar",
    "reštaurácia",
    "pivo",
)
SK_BOUNDS = (47.73, 49.62, 16.94, 22.55)
SK_POLYGON = (
    (16.94, 48.62),
    (16.98, 48.13),
    (17.25, 47.99),
    (18.30, 47.73),
    (18.72, 47.79),
    (19.60, 48.20),
    (20.50, 48.30),
    (21.60, 48.33),
    (22.15, 48.38),
    (22.55, 48.80),
    (22.55, 49.10),
    (22.00, 49.30),
    (21.00, 49.48),
    (20.10, 49.42),
    (19.45, 49.62),
    (18.85, 49.52),
    (18.16, 49.27),
    (17.55, 48.82),
)
FEATURE_ID_RE = re.compile(r"0x[0-9a-fA-F]+:0x[0-9a-fA-F]+")
GOOGLE_PLACE_ID_RE = re.compile(r"ChIJ[A-Za-z0-9_-]+")
TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?")
BOT_TEXT_RE = re.compile(
    r"unusual traffic|neobvykl[áa] prev[aá]dzka|captcha|automated queries|"
    r"nie ste robot|not a robot|verify you are human",
    re.IGNORECASE,
)
INTERCEPT_MARKERS = ("/search?", "/maps/rpc/", "listentities")
CLOSED_WORDS = ("zatvorené", "zatvorene", "closed")
OPEN_24_WORDS = (
    "otvorené 24 hodín",
    "otvorene 24 hodin",
    "open 24 hours",
    "nonstop",
    "24 hodín",
)
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
LOG = logging.getLogger("scrape_sk")


@dataclass(frozen=True)
class Tile:
    min_lat: float
    max_lat: float
    min_lng: float
    max_lng: float
    depth: int = 0
    label: str = ""

    @property
    def center(self) -> tuple[float, float]:
        return ((self.min_lat + self.max_lat) / 2, (self.min_lng + self.max_lng) / 2)

    def key(self, keyword: str) -> str:
        values = (self.min_lat, self.max_lat, self.min_lng, self.max_lng)
        bounds = ":".join(f"{value:.6f}" for value in values)
        return f"{keyword}:{bounds}:d{self.depth}"

    def split(self) -> tuple[Tile, Tile, Tile, Tile]:
        mid_lat, mid_lng = self.center
        children = (
            Tile(
                self.min_lat, mid_lat, self.min_lng, mid_lng, self.depth + 1, self.label
            ),
            Tile(
                self.min_lat, mid_lat, mid_lng, self.max_lng, self.depth + 1, self.label
            ),
            Tile(
                mid_lat, self.max_lat, self.min_lng, mid_lng, self.depth + 1, self.label
            ),
            Tile(
                mid_lat, self.max_lat, mid_lng, self.max_lng, self.depth + 1, self.label
            ),
        )
        return children


@dataclass
class SearchResult:
    records: dict[str, dict[str, Any]]
    raw_sample: list[Any] | None
    intercept_count: int
    response_count: int
    blocked: bool
    rate_limited: bool
    used_dom_fallback: bool
    elapsed_s: float


@dataclass
class HoursResult:
    hours_interval: str | None
    record_found: bool
    blocked: bool
    rate_limited: bool
    http_status: int | None
    elapsed_s: float


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def local_today() -> date:
    return datetime.now(LOCAL_TIMEZONE).date()


def point_in_polygon(lat: float, lng: float) -> bool:
    inside = False
    previous = SK_POLYGON[-1]
    for current in SK_POLYGON:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > lat) != (y2 > lat):
            boundary_lng = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lng < boundary_lng:
                inside = not inside
        previous = current
    return inside


def initial_country_tiles(size: float = 0.1) -> list[Tile]:
    min_lat, max_lat, min_lng, max_lng = SK_BOUNDS
    tiles: list[Tile] = []
    lat = min_lat
    while lat < max_lat - 1e-9:
        lng = min_lng
        while lng < max_lng - 1e-9:
            tile = Tile(lat, min(lat + size, max_lat), lng, min(lng + size, max_lng))
            center_lat, center_lng = tile.center
            if point_in_polygon(center_lat, center_lng):
                tiles.append(tile)
            lng += size
        lat += size
    return tiles


def sample_tiles() -> list[Tile]:
    return [
        Tile(48.127, 48.167, 17.087, 17.127, label="Bratislava center"),
        Tile(48.620, 48.720, 19.080, 19.180, label="rural central Slovakia"),
    ]


def zoom_for_tile(
    tile: Tile, viewport_width: int = 1280, viewport_height: int = 900
) -> int:
    """Return a Web Mercator zoom that approximately fits the tile."""
    lat_span = max(tile.max_lat - tile.min_lat, 1e-6)
    lng_span = max(tile.max_lng - tile.min_lng, 1e-6)
    center_lat, _ = tile.center
    effective_lng_span = max(
        lng_span, lat_span / max(math.cos(math.radians(center_lat)), 0.2)
    )
    zoom_x = math.log2(360 * viewport_width / (256 * effective_lng_span))
    zoom_y = math.log2(170 * viewport_height / (256 * lat_span))
    return max(8, min(18, round(min(zoom_x, zoom_y))))


def nested_get(value: Any, *path: int) -> Any:
    try:
        for index in path:
            value = value[index]
        return value
    except (IndexError, TypeError):
        return None


def iter_values(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, list):
        for child in value:
            yield from iter_values(child)
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_values(child)


def iter_lists(value: Any) -> Iterable[list[Any]]:
    if isinstance(value, list):
        yield value
        for child in value:
            yield from iter_lists(child)
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_lists(child)


def parse_json_documents(text: str) -> list[Any]:
    """Decode normal, XSSI-prefixed, and batchexecute nested JSON documents."""
    cleaned = text.lstrip()
    if cleaned.startswith(")]}'"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
    roots: list[Any] = []
    candidates = [cleaned]
    candidates.extend(line for line in cleaned.splitlines() if line[:1] in "[{")
    for candidate in candidates:
        try:
            root = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
        roots.append(root)
        for item in iter_values(root):
            if not isinstance(item, str):
                continue
            stripped = item.lstrip()
            if stripped[:1] not in "[{":
                continue
            try:
                roots.append(json.loads(stripped))
            except json.JSONDecodeError:
                pass
    return roots


def coordinates_from_record(record: list[Any]) -> tuple[float | None, float | None]:
    lat = nested_get(record, 9, 2)
    lng = nested_get(record, 9, 3)
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        if 47.0 <= lat <= 50.5 and 16.0 <= lng <= 23.5:
            return float(lat), float(lng)
    location = nested_get(record, 9)
    for candidate in iter_lists(location):
        for index in range(len(candidate) - 1):
            lat, lng = candidate[index : index + 2]
            if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                if 47.0 <= lat <= 50.5 and 16.0 <= lng <= 23.5:
                    return float(lat), float(lng)
    return None, None


def feature_id_from_record(record: list[Any]) -> str | None:
    preferred = nested_get(record, 10)
    search_space = [preferred, record]
    for value in search_space:
        for item in iter_values(value):
            if isinstance(item, str) and (match := FEATURE_ID_RE.search(item)):
                return match.group(0).lower()
    return None


def google_place_id_from_record(record: list[Any]) -> str | None:
    preferred = nested_get(record, 78)
    for value in (preferred, record):
        for item in iter_values(value):
            if isinstance(item, str) and (match := GOOGLE_PLACE_ID_RE.search(item)):
                return match.group(0)
    return None


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
    rows: dict[int, str] = {}
    for item in iter_values(value):
        if not isinstance(item, list) or len(item) < 2 or not isinstance(item[0], str):
            continue
        weekday = DAY_NAMES.get(item[0].strip().casefold().rstrip(":"))
        if weekday is None:
            continue
        texts = [part for part in iter_values(item[1:]) if isinstance(part, str)]
        parsed = parse_interval_text("; ".join(texts))
        if parsed:
            rows[weekday] = parsed
    return rows


def numeric_field(
    record: list[Any], path: tuple[int, ...], kind: type
) -> int | float | None:
    value = nested_get(record, *path)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return kind(value)


def first_numeric_field(
    record: list[Any], paths: tuple[tuple[int, ...], ...], kind: type
) -> int | float | None:
    for path in paths:
        value = numeric_field(record, path, kind)
        if value is not None:
            return value
    return None


def first_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        for child in value:
            found = first_text(child)
            if found:
                return found
    return None


def address_from_record(record: list[Any]) -> str:
    for index in (18, 2):
        value = nested_get(record, index)
        if isinstance(value, str) and value.strip() and not FEATURE_ID_RE.search(value):
            return value.strip()
    structured = nested_get(record, 183, 1)
    if structured:
        parts = [
            item.strip()
            for item in iter_values(structured)
            if isinstance(item, str) and item.strip()
        ]
        if parts:
            return ", ".join(dict.fromkeys(parts))
    return ""


def city_from_address(address: str) -> str:
    if not address:
        return ""
    parts = [part.strip() for part in address.split(",") if part.strip()]
    country_names = {"slovensko", "slovakia", "slovenská republika", "slovak republic"}
    parts = [part for part in parts if part.casefold() not in country_names]
    postal_re = re.compile(r"^(?:SK-)?\d{3}\s?\d{2}\s+")
    for part in reversed(parts):
        without_postal = postal_re.sub("", part).strip()
        if without_postal and without_postal != part:
            return without_postal
    return parts[-1] if len(parts) > 1 else ""


def categories_from_record(record: list[Any]) -> list[str]:
    value = nested_get(record, 13)
    categories: list[str] = []
    for item in iter_values(value):
        if isinstance(item, str) and item.strip() and len(item) < 100:
            categories.append(item.strip())
    return list(dict.fromkeys(categories))


def looks_like_place_record(record: list[Any]) -> bool:
    name = nested_get(record, 11)
    lat, lng = coordinates_from_record(record)
    return (
        len(record) > 13
        and isinstance(name, str)
        and bool(name.strip())
        and lat is not None
        and lng is not None
    )


def parse_place_record(record: list[Any], keyword: str) -> dict[str, Any] | None:
    try:
        feature_id = feature_id_from_record(record)
        name = nested_get(record, 11)
        lat, lng = coordinates_from_record(record)
        if not feature_id or not isinstance(name, str) or lat is None or lng is None:
            return None
        address = address_from_record(record)
        captured_at = datetime.now(LOCAL_TIMEZONE)
        return {
            "feature_id": feature_id,
            "google_place_id": google_place_id_from_record(record),
            "name": name.strip(),
            "lat": lat,
            "lng": lng,
            "address": address,
            "city": city_from_address(address),
            "rating_value": numeric_field(record, (4, 7), float),
            "rating_count": first_numeric_field(record, ((37, 1), (4, 8)), int),
            "categories": categories_from_record(record),
            "hours_periods": nested_get(record, 203) or nested_get(record, 34),
            "keyword": keyword,
            "scraped_weekday": captured_at.weekday(),
            "scraped_at": captured_at.isoformat(),
        }
    except (IndexError, TypeError, ValueError):
        return None


def records_from_response(
    text: str, keyword: str
) -> tuple[dict[str, dict[str, Any]], list[Any] | None]:
    records: dict[str, dict[str, Any]] = {}
    raw_sample = None
    seen_objects: set[int] = set()
    for root in parse_json_documents(text):
        for candidate in iter_lists(root):
            object_id = id(candidate)
            if object_id in seen_objects or not looks_like_place_record(candidate):
                continue
            seen_objects.add(object_id)
            parsed = parse_place_record(candidate, keyword)
            if parsed:
                records[parsed["feature_id"]] = parsed
                if raw_sample is None and parsed.get("rating_value") is not None:
                    raw_sample = candidate
    return records, raw_sample


def is_intercept_candidate(response: Response) -> bool:
    url = response.url
    if "/search?" in url and "tbm=map" not in url:
        return False
    return any(marker in url for marker in INTERCEPT_MARKERS)


async def accept_consent(page: Page) -> None:
    labels = re.compile(r"Prijať všetko|Súhlasím|Accept all|I agree", re.IGNORECASE)
    try:
        button = page.get_by_role("button", name=labels).first
        if await button.count() and await button.is_visible():
            await button.click(timeout=3_000)
            await page.wait_for_timeout(1_000)
    except Exception:
        return


async def page_is_blocked(page: Page) -> bool:
    try:
        text = (await page.locator("body").inner_text(timeout=3_000))[:20_000]
    except Exception:
        text = ""
    return bool(BOT_TEXT_RE.search(text)) or "/sorry/" in page.url


async def scroll_results(page: Page, max_scrolls: int) -> None:
    feed = page.locator('[role="feed"]').first
    if not await feed.count():
        return
    stable_rounds = 0
    previous_height = -1
    end_re = re.compile(
        r"koniec zoznamu|end of the list|všetky výsledky", re.IGNORECASE
    )
    for _ in range(max_scrolls):
        try:
            feed_text = (await feed.inner_text(timeout=3_000))[-2_000:]
            if end_re.search(feed_text):
                return
            height = await feed.evaluate("element => element.scrollHeight")
            await feed.evaluate("element => element.scrollTo(0, element.scrollHeight)")
            await page.wait_for_timeout(random.randint(1_000, 1_800))
            stable_rounds = stable_rounds + 1 if height == previous_height else 0
            previous_height = height
            if stable_rounds >= 3:
                return
        except Exception:
            return


async def dom_fallback(
    page: Page, keyword: str, limit: int = 8
) -> dict[str, dict[str, Any]]:
    """Slow fallback: open a few visible place cards and read their detail panels."""
    links = page.locator('a[href*="/maps/place/"]')
    hrefs: list[str] = []
    for index in range(min(await links.count(), limit * 3)):
        href = await links.nth(index).get_attribute("href")
        if href and href not in hrefs:
            hrefs.append(href)
        if len(hrefs) >= limit:
            break
    output: dict[str, dict[str, Any]] = {}
    for href in hrefs:
        match = FEATURE_ID_RE.search(href)
        coords_match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", href)
        if not match or not coords_match:
            continue
        detail = await page.context.new_page()
        try:
            await detail.goto(href, wait_until="domcontentloaded", timeout=30_000)
            await detail.wait_for_timeout(1_500)
            name = (await detail.locator("h1").first.inner_text(timeout=5_000)).strip()
            body = (await detail.locator("body").inner_text(timeout=5_000))[:30_000]
            rating_match = re.search(r"(\d[,.]\d)\s*\((\d[\d\s,.]*)\)", body)
            hours_lines = [
                line.strip()
                for line in body.splitlines()
                if re.search(
                    r"pondelok|utorok|streda|štvrtok|piatok|sobota|nedeľa",
                    line,
                    re.IGNORECASE,
                )
            ]
            lat, lng = map(float, coords_match.groups())
            captured_at = datetime.now(LOCAL_TIMEZONE)
            place_id_match = GOOGLE_PLACE_ID_RE.search(href)
            output[match.group(0).lower()] = {
                "feature_id": match.group(0).lower(),
                "google_place_id": place_id_match.group(0) if place_id_match else None,
                "name": name,
                "lat": lat,
                "lng": lng,
                "address": "",
                "city": "",
                "rating_value": float(rating_match.group(1).replace(",", "."))
                if rating_match
                else None,
                "rating_count": int(re.sub(r"\D", "", rating_match.group(2)))
                if rating_match
                else None,
                "categories": [],
                "hours_periods": hours_lines or None,
                "keyword": keyword,
                "scraped_weekday": captured_at.weekday(),
                "scraped_at": captured_at.isoformat(),
            }
        except Exception:
            pass
        finally:
            await detail.close()
    return output


async def search_tile(
    context: BrowserContext,
    tile: Tile,
    keyword: str,
    *,
    max_scrolls: int,
) -> SearchResult:
    started = time.monotonic()
    page = await context.new_page()
    records: dict[str, dict[str, Any]] = {}
    raw_sample: list[Any] | None = None
    capture_tasks: set[asyncio.Task[None]] = set()
    intercept_count = 0
    response_count = 0
    rate_limited = False

    async def capture(response: Response) -> None:
        nonlocal raw_sample, intercept_count, response_count, rate_limited
        response_count += 1
        if response.status == 429:
            rate_limited = True
        if not is_intercept_candidate(response):
            return
        intercept_count += 1
        try:
            body = await response.text()
        except Exception:
            return
        parsed, sample = records_from_response(body, keyword)
        records.update(parsed)
        if raw_sample is None and sample is not None:
            raw_sample = sample

    def schedule_capture(response: Response) -> None:
        task = asyncio.create_task(capture(response))
        capture_tasks.add(task)
        task.add_done_callback(capture_tasks.discard)

    page.on("response", schedule_capture)
    center_lat, center_lng = tile.center
    zoom = zoom_for_tile(tile)
    url = f"https://www.google.com/maps/search/{quote(keyword)}/@{center_lat:.6f},{center_lng:.6f},{zoom}z?hl=sk&gl=sk"
    used_dom_fallback = False
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        await accept_consent(page)
        await page.wait_for_timeout(random.randint(2_000, 3_500))
        blocked = await page_is_blocked(page)
        if not blocked:
            await scroll_results(page, max_scrolls)
            await page.wait_for_timeout(1_500)
        if capture_tasks:
            await asyncio.gather(*tuple(capture_tasks), return_exceptions=True)
        if not blocked and not records:
            used_dom_fallback = True
            records.update(await dom_fallback(page, keyword))
        return SearchResult(
            records=records,
            raw_sample=raw_sample,
            intercept_count=intercept_count,
            response_count=response_count,
            blocked=blocked,
            rate_limited=rate_limited,
            used_dom_fallback=used_dom_fallback,
            elapsed_s=time.monotonic() - started,
        )
    finally:
        await page.close()


def read_existing_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            try:
                record = json.loads(line)
                if record.get("feature_id"):
                    ids.add(record["feature_id"])
            except json.JSONDecodeError:
                LOG.warning("Ignoring malformed raw line %d", line_number)
    return ids


def read_feature_ids(path: Path) -> list[str]:
    feature_ids: list[str] = []
    seen: set[str] = set()
    if not path.exists():
        raise SystemExit(f"Raw discovery file does not exist: {path}")
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            try:
                feature_id = json.loads(line).get("feature_id")
            except json.JSONDecodeError:
                LOG.warning("Ignoring malformed raw line %d", line_number)
                continue
            if not isinstance(feature_id, str) or not FEATURE_ID_RE.fullmatch(
                feature_id
            ):
                LOG.warning(
                    "Ignoring raw line %d without a valid feature_id", line_number
                )
                continue
            feature_id = feature_id.lower()
            if feature_id not in seen:
                feature_ids.append(feature_id)
                seen.add(feature_id)
    return feature_ids


def load_pub_feature_ids(base_dir: Path) -> set[str] | None:
    """Lowercased feature ids classified pub/maybe/unknown (i.e. not not_pub).

    Merges the deterministic category labels (sk_venue_kind.jsonl) with the LLM
    verdicts (sk_llm_verdicts.jsonl), the latter winning. Returns None if the
    category file is absent, so hours mode falls back to visiting everything.
    """
    kinds_path = base_dir / "sk_venue_kind.jsonl"
    verdicts_path = base_dir / "sk_llm_verdicts.jsonl"
    if not kinds_path.exists():
        LOG.warning("--pubs-only set but %s missing; visiting all places", kinds_path.name)
        return None
    kind: dict[str, str] = {}
    with kinds_path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                item = json.loads(line)
                fid = item.get("feature_id")
                if isinstance(fid, str):
                    kind[fid.lower()] = item.get("venue_kind") or "unknown"
    if verdicts_path.exists():
        with verdicts_path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    item = json.loads(line)
                    fid = item.get("feature_id")
                    if isinstance(fid, str) and item.get("verdict") in ("pub", "not_pub"):
                        kind[fid.lower()] = item["verdict"]
    return {fid for fid, k in kind.items() if k != "not_pub"}


def read_completed_hours(path: Path, target_date: date) -> set[tuple[str, int, str]]:
    completed: set[tuple[str, int, str]] = set()
    if not path.exists():
        return completed
    date_text = target_date.isoformat()
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                LOG.warning("Ignoring malformed hours line %d", line_number)
                continue
            feature_id = item.get("feature_id")
            weekday = item.get("weekday")
            captured_date = item.get("date")
            if (
                isinstance(feature_id, str)
                and isinstance(weekday, int)
                and not isinstance(weekday, bool)
                and 0 <= weekday <= 6
                and captured_date == date_text
            ):
                completed.add((feature_id.lower(), weekday, captured_date))
    return completed


def read_checkpoints(path: Path) -> dict[str, dict[str, Any]]:
    checkpoints: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return checkpoints
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            try:
                item = json.loads(line)
                if item.get("status") == "ok" and item.get("task_key"):
                    checkpoints[item["task_key"]] = item
            except json.JSONDecodeError:
                LOG.warning("Ignoring malformed checkpoint line %d", line_number)
    return checkpoints


def write_jsonl(handle: Any, record: dict[str, Any]) -> None:
    handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    handle.flush()


def detail_record_from_state(state: Any, feature_id: str) -> list[Any] | None:
    roots = [state]
    for value in iter_values(state):
        if isinstance(value, str) and feature_id in value.casefold():
            roots.extend(parse_json_documents(value))
    candidates: list[list[Any]] = []
    for root in roots:
        candidates.extend(
            candidate
            for candidate in iter_lists(root)
            if len(candidate) > 203
            and isinstance(nested_get(candidate, 11), str)
            and feature_id_from_record(candidate) == feature_id
        )
    if not candidates:
        return None
    return max(candidates, key=len)


async def fetch_daily_hours(context: BrowserContext, feature_id: str) -> HoursResult:
    started = time.monotonic()
    page = await context.new_page()
    http_status: int | None = None
    saw_rate_limit = False

    def observe_status(response: Response) -> None:
        nonlocal saw_rate_limit
        if response.status == 429:
            saw_rate_limit = True

    page.on("response", observe_status)
    try:
        url = f"https://www.google.com/maps/place/?ftid={feature_id}&hl=sk&gl=sk"
        response = await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        http_status = response.status if response else None
        await accept_consent(page)
        await page.wait_for_timeout(650)
        blocked = await page_is_blocked(page)
        rate_limited = http_status == 429 or saw_rate_limit
        if blocked or rate_limited:
            return HoursResult(
                hours_interval=None,
                record_found=False,
                blocked=blocked,
                rate_limited=rate_limited,
                http_status=http_status,
                elapsed_s=time.monotonic() - started,
            )
        state = await page.evaluate("window.APP_INITIALIZATION_STATE")
        record = detail_record_from_state(state, feature_id)
        if record is None:
            return HoursResult(
                hours_interval=None,
                record_found=False,
                blocked=False,
                rate_limited=False,
                http_status=http_status,
                elapsed_s=time.monotonic() - started,
            )
        today = local_today()
        hours = nested_get(record, 203) or nested_get(record, 34)
        return HoursResult(
            hours_interval=weekday_rows(hours).get(today.weekday()),
            record_found=True,
            blocked=False,
            rate_limited=False,
            http_status=http_status,
            elapsed_s=time.monotonic() - started,
        )
    finally:
        await page.close()


async def run_discover(args: argparse.Namespace) -> int:
    keywords = tuple(part.strip() for part in args.keywords.split(",") if part.strip())
    if not keywords:
        raise SystemExit("At least one keyword is required")
    tiles = (
        initial_country_tiles(args.tile_size) if args.full_country else sample_tiles()
    )
    tasks: deque[tuple[Tile, str]] = deque(
        (tile, keyword) for tile in tiles for keyword in keywords
    )
    checkpoints = read_checkpoints(args.checkpoint)
    existing_ids = read_existing_ids(args.output)
    LOG.info(
        "Mode=%s root_tiles=%d keywords=%d queued=%d already_seen_places=%d",
        "full-country" if args.full_country else "sample",
        len(tiles),
        len(keywords),
        len(tasks),
        len(existing_ids),
    )

    async with async_playwright() as playwright:
        browser: Browser = await playwright.chromium.launch(headless=not args.headful)
        context = await browser.new_context(
            locale="sk-SK",
            timezone_id="Europe/Bratislava",
            viewport={"width": 1280, "height": 900},
            color_scheme="light",
        )
        completed_now = 0
        try:
            with (
                args.output.open("a", encoding="utf-8") as raw_out,
                args.checkpoint.open("a", encoding="utf-8") as checkpoint_out,
            ):
                while tasks:
                    tile, keyword = tasks.popleft()
                    task_key = tile.key(keyword)
                    saved = checkpoints.get(task_key)
                    if saved:
                        if saved.get("saturated") and tile.depth < args.max_depth:
                            tasks.extend(
                                (child, keyword)
                                for child in tile.split()
                                if point_in_polygon(*child.center)
                            )
                        continue
                    if args.limit_tasks and completed_now >= args.limit_tasks:
                        break
                    LOG.info(
                        "Searching %s keyword=%r center=%.4f,%.4f zoom=%d depth=%d",
                        tile.label or "tile",
                        keyword,
                        *tile.center,
                        zoom_for_tile(tile),
                        tile.depth,
                    )
                    result = await search_tile(
                        context, tile, keyword, max_scrolls=args.max_scrolls
                    )
                    if result.blocked or result.rate_limited:
                        status = "bot_blocked" if result.blocked else "rate_limited"
                        write_jsonl(
                            checkpoint_out,
                            {
                                "task_key": task_key,
                                "status": status,
                                "tile": asdict(tile),
                                "keyword": keyword,
                                "record_count": len(result.records),
                                "intercept_count": result.intercept_count,
                                "response_count": result.response_count,
                                "elapsed_s": round(result.elapsed_s, 2),
                                "finished_at": utc_now(),
                            },
                        )
                        LOG.warning(
                            "Google returned %s; backing off %.0fs and leaving task retryable",
                            status,
                            args.block_backoff,
                        )
                        await asyncio.sleep(args.block_backoff + random.uniform(0, 5))
                        continue

                    in_country = {
                        feature_id: record
                        for feature_id, record in result.records.items()
                        if point_in_polygon(record["lat"], record["lng"])
                    }
                    added = 0
                    for feature_id, record in in_country.items():
                        if feature_id in existing_ids:
                            continue
                        write_jsonl(raw_out, record)
                        existing_ids.add(feature_id)
                        added += 1
                    if (
                        result.raw_sample is not None
                        and not args.sample_record.exists()
                    ):
                        args.sample_record.write_text(
                            json.dumps(result.raw_sample, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                    saturated = len(result.records) >= args.saturation
                    write_jsonl(
                        checkpoint_out,
                        {
                            "task_key": task_key,
                            "status": "ok",
                            "tile": asdict(tile),
                            "keyword": keyword,
                            "record_count": len(result.records),
                            "in_country_count": len(in_country),
                            "new_count": added,
                            "saturated": saturated,
                            "intercept_count": result.intercept_count,
                            "response_count": result.response_count,
                            "dom_fallback": result.used_dom_fallback,
                            "elapsed_s": round(result.elapsed_s, 2),
                            "finished_at": utc_now(),
                        },
                    )
                    completed_now += 1
                    LOG.info(
                        "Completed records=%d new=%d intercepts=%d responses=%d elapsed=%.1fs fallback=%s",
                        len(result.records),
                        added,
                        result.intercept_count,
                        result.response_count,
                        result.elapsed_s,
                        result.used_dom_fallback,
                    )
                    if saturated and tile.depth < args.max_depth:
                        tasks.extend(
                            (child, keyword)
                            for child in tile.split()
                            if point_in_polygon(*child.center)
                        )
                    if tasks:
                        await asyncio.sleep(
                            random.uniform(args.delay_min, args.delay_max)
                        )
        finally:
            await context.close()
            await browser.close()
    LOG.info(
        "Finished this run: tasks=%d total_unique_places=%d",
        completed_now,
        len(existing_ids),
    )
    return 0


async def run_hours(args: argparse.Namespace) -> int:
    target_date = local_today()
    weekday = target_date.weekday()
    feature_ids = read_feature_ids(args.output)
    if args.pubs_only:
        allowed = load_pub_feature_ids(args.output.parent)
        if allowed is not None:
            before = len(feature_ids)
            feature_ids = [f for f in feature_ids if f in allowed]
            LOG.info(
                "pubs-only: kept %d/%d places classified pub/maybe",
                len(feature_ids), before,
            )
    completed = read_completed_hours(args.hours_output, target_date)
    pending_all = [
        feature_id
        for feature_id in feature_ids
        if (feature_id, weekday, target_date.isoformat()) not in completed
    ]
    pending = pending_all
    if args.limit_places:
        pending = pending[: args.limit_places]
    LOG.info(
        "Mode=hours date=%s weekday=%d discovered=%d already_completed=%d pending=%d",
        target_date,
        weekday,
        len(feature_ids),
        len(feature_ids) - len(pending_all),
        len(pending),
    )
    if not pending:
        LOG.info("Nothing to do; every discovered place is already recorded today")
        return 0

    async with async_playwright() as playwright:
        browser: Browser = await playwright.chromium.launch(headless=not args.headful)
        context = await browser.new_context(
            locale="sk-SK",
            timezone_id="Europe/Bratislava",
            viewport={"width": 1280, "height": 900},
            color_scheme="light",
        )
        appended = 0
        failed = 0
        try:
            with args.hours_output.open("a", encoding="utf-8") as hours_out:
                for index, feature_id in enumerate(pending, 1):
                    LOG.info(
                        "Fetching hours %d/%d feature_id=%s",
                        index,
                        len(pending),
                        feature_id,
                    )
                    try:
                        try:
                            result = await fetch_daily_hours(context, feature_id)
                        except Exception as exc:
                            failed += 1
                            LOG.warning(
                                "Hours fetch failed for %s: %s",
                                feature_id,
                                type(exc).__name__,
                            )
                            continue
                        if result.blocked or result.rate_limited:
                            failed += 1
                            status = "bot_blocked" if result.blocked else "rate_limited"
                            LOG.warning(
                                "Google returned %s for %s; backing off %.0fs and leaving it retryable",
                                status,
                                feature_id,
                                args.block_backoff,
                            )
                            await asyncio.sleep(
                                args.block_backoff + random.uniform(0, 5)
                            )
                            continue
                        if not result.record_found:
                            failed += 1
                            LOG.warning(
                                "No matching detail record for %s (HTTP %s); leaving it retryable",
                                feature_id,
                                result.http_status,
                            )
                            continue
                        write_jsonl(
                            hours_out,
                            {
                                "feature_id": feature_id,
                                "weekday": weekday,
                                "date": target_date.isoformat(),
                                "hours_interval": result.hours_interval,
                            },
                        )
                        appended += 1
                        LOG.info(
                            "Recorded interval=%r elapsed=%.2fs",
                            result.hours_interval,
                            result.elapsed_s,
                        )
                    finally:
                        if index < len(pending):
                            await asyncio.sleep(
                                random.uniform(args.delay_min, args.delay_max)
                            )
        finally:
            await context.close()
            await browser.close()
    LOG.info("Finished hours run: appended=%d failed=%d", appended, failed)
    return 0 if failed == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("discover", "hours"),
        default="discover",
        help="Discover places by tiled search or revisit known IDs for today's hours",
    )
    coverage = parser.add_mutually_exclusive_group()
    coverage.add_argument(
        "--sample", action="store_true", help="Run two sample tiles (default)"
    )
    coverage.add_argument(
        "--full-country",
        action="store_true",
        help="Explicitly enable the Slovakia sweep",
    )
    parser.add_argument(
        "--keywords", default="krčma", help="Comma-separated search terms"
    )
    parser.add_argument("--output", type=Path, default=RAW_PATH)
    parser.add_argument("--hours-output", type=Path, default=HOURS_PATH)
    parser.add_argument("--checkpoint", type=Path, default=CHECKPOINT_PATH)
    parser.add_argument("--sample-record", type=Path, default=SAMPLE_RECORD_PATH)
    parser.add_argument("--tile-size", type=float, default=0.1)
    parser.add_argument(
        "--saturation",
        type=int,
        default=20,
        help="Split at the anonymous result cap observed during verification",
    )
    parser.add_argument("--max-depth", type=int, default=5)
    parser.add_argument("--max-scrolls", type=int, default=35)
    parser.add_argument("--limit-tasks", type=int, default=0)
    parser.add_argument("--limit-places", type=int, default=0)
    parser.add_argument(
        "--pubs-only",
        action="store_true",
        help="Hours mode: only visit places classified pub/maybe "
        "(reads sk_venue_kind.jsonl + sk_llm_verdicts.jsonl), skipping not_pub.",
    )
    parser.add_argument("--delay-min", type=float, default=2.5)
    parser.add_argument("--delay-max", type=float, default=5.5)
    parser.add_argument("--block-backoff", type=float, default=30.0)
    parser.add_argument(
        "--headful", action="store_true", help="Show Chromium (requires a display)"
    )
    parser.add_argument(
        "--install-browser",
        action="store_true",
        help="Install Playwright Chromium and exit",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    if args.install_browser:
        return subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"], check=False
        ).returncode
    if args.delay_max < args.delay_min:
        parser.error("--delay-max must be greater than or equal to --delay-min")
    if args.mode == "hours" and args.full_country:
        parser.error("--full-country only applies to --mode discover")
    runner = run_discover if args.mode == "discover" else run_hours
    return asyncio.run(runner(args))


if __name__ == "__main__":
    raise SystemExit(main())

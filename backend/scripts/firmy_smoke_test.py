"""
firmy_smoke_test — measure Firmy.cz hours + rating coverage on a real sample.

Pulls a sample of real pubs from Mapy.cz /v1/suggest (the exact source the app
searches by), then runs the existing FirmyHoursSource against each WITHOUT a
proxy (i.e. straight from this machine's residential IP). Reports the three
numbers that decide whether a full bulk pre-fill is worth it:

    * match rate     — how many Mapy pubs Firmy.cz confidently matches
    * hours coverage — of matched pubs, how many carry opening hours
    * rating coverage — of matched pubs, how many carry a rating

Run:
    cd na-pivo-backend && uv run python scripts/firmy_smoke_test.py
    # optional: LAT, LNG, RADIUS_KM, SAMPLE, MIN_INTERVAL env overrides

It does NOT touch the Django DB — it imports the enrichment classes directly.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from pubs.enrichment.firmy import FirmyHoursSource, TransientFetchError  # noqa: E402
from pubs.enrichment.mapy import MapySuggestSource  # noqa: E402


def load_env(path: Path) -> dict[str, str]:
    """Minimal .env parser (KEY=VALUE lines, ignores comments/blanks/quotes)."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def find_mapy_key(env: dict[str, str]) -> str | None:
    for k, v in env.items():
        if "MAPY" in k.upper() and v:
            return v
    return None


def municipality(item: dict) -> str | None:
    """Best-effort city from a Mapy suggest item's regionalStructure."""
    for entry in item.get("regionalStructure") or []:
        if entry.get("type") == "regional.municipality" and entry.get("name"):
            return entry["name"]
    # fallback: any municipality-ish entry
    for entry in item.get("regionalStructure") or []:
        if entry.get("name"):
            return entry["name"]
    return None


def main() -> int:
    env = load_env(REPO / ".env")
    mapy_key = find_mapy_key(env) or os.environ.get("MAPY_API_KEY")
    if not mapy_key:
        print("ERROR: no Mapy API key found in .env or MAPY_API_KEY env.")
        return 1

    lat = float(os.environ.get("LAT", "50.0875"))   # Prague centre (Old Town)
    lng = float(os.environ.get("LNG", "14.4213"))
    radius_km = float(os.environ.get("RADIUS_KM", "3"))
    sample = int(os.environ.get("SAMPLE", "25"))
    min_interval = float(os.environ.get("MIN_INTERVAL", "3"))

    print(f"== Mapy suggest near ({lat},{lng}) r={radius_km}km ==")
    with MapySuggestSource(api_key=mapy_key) as mapy:
        result = mapy.search_near(lat, lng, radius_km)
    pubs = result.items[:sample]
    print(f"Got {len(result.items)} pubs, testing first {len(pubs)}.\n")

    # No proxy → uses this machine's (residential) IP directly.
    firmy = FirmyHoursSource(proxy_url=None, min_interval=min_interval)

    matched = hours_cov = rating_cov = 0
    rows: list[str] = []
    t0 = time.monotonic()

    for i, pub in enumerate(pubs, 1):
        name = pub["name"]
        pos = pub["position"]
        city = municipality(pub)
        plat, plng = pos["lat"], pos["lon"]
        try:
            raw = firmy.fetch(name, plat, plng, city)
        except TransientFetchError as exc:
            rows.append(f"{i:2}. ~RETRY  {name[:34]:34}  {exc}")
            continue
        except Exception as exc:  # noqa: BLE001
            rows.append(f"{i:2}. !ERROR  {name[:34]:34}  {exc}")
            continue

        if raw is None:
            rows.append(f"{i:2}. -NOHIT  {name[:34]:34}  (no confident match)")
            continue

        matched += 1
        has_hours = bool(raw.opening_hours_raw)
        has_rating = raw.rating_value is not None
        hours_cov += has_hours
        rating_cov += has_rating
        hrs = raw.opening_hours_raw or "—"
        rat = (
            f"{raw.rating_value}★ ({raw.rating_count})" if has_rating else "—"
        )
        rows.append(
            f"{i:2}. +MATCH  {name[:34]:34}  conf={raw.confidence:.2f}  "
            f"rating={rat}\n          hours={hrs[:70]}"
        )

    dt = time.monotonic() - t0
    print("\n".join(rows))
    n = len(pubs)
    print("\n== SUMMARY ==")
    print(f"sample            : {n} pubs ({dt:.0f}s, ~{dt/max(n,1):.1f}s/pub)")
    print(f"match rate        : {matched}/{n}  ({matched/max(n,1)*100:.0f}%)")
    if matched:
        print(f"hours coverage    : {hours_cov}/{matched}  ({hours_cov/matched*100:.0f}% of matched)")
        print(f"rating coverage   : {rating_cov}/{matched}  ({rating_cov/matched*100:.0f}% of matched)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

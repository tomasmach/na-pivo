# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx[socks]>=0.28"]
# ///
"""Match pub identities to Google Place IDs via Places API (New) searchText.

Usage:
  uv run match_places.py                 # full run, free IDs-only field mask
  uv run match_places.py --pilot 400     # pilot with paid Pro field mask
                                         # (id + displayName + location) for
                                         # match-quality measurement

Requires the SOCKS tunnel through the production server (the API key is
IP-restricted): ssh -D 1080 -N mach-projects

Resumable: results append to matches.jsonl / pilot_results.jsonl and already
processed identities are skipped on restart.
"""

import argparse
import asyncio
import json
import math
import random
from pathlib import Path

import httpx

BASE = Path(__file__).parent
API_URL = "https://places.googleapis.com/v1/places:searchText"
PROXY = "socks5://localhost:1080"
CONCURRENCY = 8
BIAS_RADIUS_M = 300.0
SOURCE_PRIORITY = {"user_added": 0, "directory": 1, "pubhours": 2, "searchcache": 3}


def identity(rec: dict) -> str:
    return f"{rec['cache_key']}::{rec['name_key']}"


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def search_one(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    rec: dict,
    *,
    api_key: str,
    field_mask: str,
) -> dict:
    # Hard locationRestriction (~250 m box): a same-named pub in another town
    # must never match. Unmatched pubs keep the coordinates fallback in-app.
    dlat = BIAS_RADIUS_M / 111_320.0
    dlng = BIAS_RADIUS_M / (111_320.0 * max(0.2, math.cos(math.radians(rec["lat"]))))
    body = {
        "textQuery": rec["name"],
        "languageCode": "cs",
        "regionCode": "CZ",
        "pageSize": 1,
        "locationRestriction": {
            "rectangle": {
                "low": {"latitude": rec["lat"] - dlat, "longitude": rec["lng"] - dlng},
                "high": {"latitude": rec["lat"] + dlat, "longitude": rec["lng"] + dlng},
            }
        },
    }
    headers = {"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": field_mask}
    async with sem:
        for attempt in range(6):
            try:
                resp = await client.post(API_URL, json=body, headers=headers)
            except httpx.HTTPError:
                await asyncio.sleep(2**attempt + random.random())
                continue
            if resp.status_code in (429, 500, 502, 503, 504):
                await asyncio.sleep(2**attempt + random.random())
                continue
            if resp.status_code != 200:
                return {**rec, "status": f"http_{resp.status_code}"}
            places = resp.json().get("places") or []
            if not places:
                return {**rec, "status": "no_match"}
            place = places[0]
            out = {**rec, "status": "matched", "google_place_id": place["id"]}
            display = (place.get("displayName") or {}).get("text")
            location = place.get("location")
            if display:
                out["matched_name"] = display
            if location:
                out["matched_lat"] = location.get("latitude")
                out["matched_lng"] = location.get("longitude")
                out["distance_m"] = round(
                    haversine_m(
                        rec["lat"], rec["lng"],
                        location["latitude"], location["longitude"],
                    )
                )
            return out
        return {**rec, "status": "gave_up"}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot", type=int, default=0)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    api_key = (BASE / ".apikey").read_text().strip()
    out_path = BASE / ("pilot_results.jsonl" if args.pilot else "matches.jsonl")
    field_mask = (
        "places.id,places.displayName,places.location" if args.pilot else "places.id"
    )

    done: set[str] = set()
    if out_path.exists():
        with out_path.open() as f:
            for line in f:
                if line.strip():
                    done.add(identity(json.loads(line)))

    universe: list[dict] = []
    with (BASE / "universe.jsonl").open() as f:
        for line in f:
            if line.strip():
                universe.append(json.loads(line))
    universe.sort(key=lambda r: min(SOURCE_PRIORITY[s] for s in r["sources"]))

    todo = [r for r in universe if identity(r) not in done]
    if args.pilot:
        # Spread the pilot across source types by striding the priority-sorted
        # list so quality numbers are not dominated by one source.
        stride = max(1, len(todo) // args.pilot)
        todo = todo[::stride][: args.pilot]
    elif args.limit:
        todo = todo[: args.limit]

    print(f"todo: {len(todo)} (already done: {len(done)})")
    sem = asyncio.Semaphore(CONCURRENCY)
    processed = 0
    async with httpx.AsyncClient(proxy=PROXY, timeout=20.0) as client:
        with out_path.open("a") as out:
            for batch_start in range(0, len(todo), 500):
                batch = todo[batch_start : batch_start + 500]
                results = await asyncio.gather(
                    *(
                        search_one(client, sem, rec, api_key=api_key, field_mask=field_mask)
                        for rec in batch
                    )
                )
                for res in results:
                    out.write(json.dumps(res, ensure_ascii=False) + "\n")
                out.flush()
                processed += len(batch)
                matched = sum(1 for r in results if r["status"] == "matched")
                print(
                    f"{processed}/{len(todo)} (batch matched {matched}/{len(batch)})",
                    flush=True,
                )


if __name__ == "__main__":
    asyncio.run(main())

# /// script
# requires-python = ">=3.14"
# dependencies = ["rapidfuzz>=3.0"]
# ///
"""Summarize pilot match quality: distance buckets x name similarity."""

import json
from collections import Counter
from pathlib import Path

from rapidfuzz import fuzz

BASE = Path(__file__).parent

rows = []
with (BASE / "pilot_results.jsonl").open() as f:
    for line in f:
        if line.strip():
            rows.append(json.loads(line))

statuses = Counter(r["status"] for r in rows)
print(f"total: {len(rows)}  statuses: {dict(statuses)}")

matched = [r for r in rows if r["status"] == "matched"]
buckets = Counter()
suspicious = []
for r in matched:
    dist = r.get("distance_m")
    sim = fuzz.token_set_ratio(r["name"].casefold(), (r.get("matched_name") or "").casefold())
    r["_sim"] = sim
    if dist is None:
        buckets["no_location"] += 1
    elif dist <= 100:
        buckets["<=100m"] += 1
    elif dist <= 250:
        buckets["100-250m"] += 1
    elif dist <= 1000:
        buckets["250m-1km"] += 1
    else:
        buckets[">1km"] += 1
    if (dist or 0) > 250 or sim < 55:
        suspicious.append(r)

print(f"distance buckets: {dict(buckets)}")
sims = sorted(r["_sim"] for r in matched)
if sims:
    print(
        "name similarity: "
        f"min={sims[0]} p10={sims[len(sims)//10]} median={sims[len(sims)//2]} "
        f"good(>=55): {sum(1 for s in sims if s >= 55)}/{len(sims)}"
    )

good = [r for r in matched if (r.get("distance_m") or 0) <= 250 and r["_sim"] >= 55]
print(f"auto-accept (<=250m & sim>=55): {len(good)}/{len(matched)} matched, {len(good)}/{len(rows)} of all")

print("\n-- suspicious sample (up to 25) --")
for r in suspicious[:25]:
    print(
        f"  {r['name']} ({r['city']}) -> {r.get('matched_name')} "
        f"[{r.get('distance_m')}m, sim {r['_sim']}] sources={r['sources']}"
    )

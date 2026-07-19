# SK Google Maps pub scraper — spec

## Goal
Scrape **all** pub-like venues in Slovakia directly from Google Maps (NOT the paid
Places API), from the local residential network, including **rating**, **review
count**, and **opening hours**. Produce a normalized JSONL that the existing Django
command `import_pub_directory` can ingest to build a local SK directory.

Why: opening the map in Slovakia is currently slow and burns paid Google API quota
because SK has no local directory-with-hours (no firmy.sk source like CZ has). We
want the data cached locally, same as CZ.

## Hard constraints
- Run everything under `/home/tomasmach/Code/na-pivo/.skscrape/` (gitignored).
- Python 3.14 via `uv run` (PEP 723 inline deps `# /// script`), matching the
  existing style of `../.pubmatch/match_places.py`.
- **Do NOT use the paid Places API.** Scrape maps.google.com directly.
- Residential network: this machine's own IP. No proxy, no SOCKS tunnel.
- **Resumable**: every long run must be restartable and skip already-done work
  (persist progress to disk, append-only JSONL + a done-set/checkpoint).
- Polite pacing: randomized delays, low concurrency (Google will 429/captcha if
  hammered). Handle 429/captcha by backing off, not crashing.
- Good logging WITHOUT sensitive data. No tokens/cookies in logs.

## Recommended technique: Playwright + response interception
Guessing Google's `pb` query encoding by hand is fragile (already tried: the
lightweight httpx feed returns only truncated `0x0:0x...` feature ids and no
names/hours). Instead:

1. Use Playwright (chromium, headless=False acceptable if needed to dodge bot
   detection; headless preferred if it works). `uv` can pull `playwright`; run
   `playwright install chromium` once.
2. Navigate to a maps search URL for a viewport + keyword, e.g.
   `https://www.google.com/maps/search/<keyword>/@<lat>,<lng>,14z?hl=sk&gl=sk`.
3. **Intercept the XHR responses** whose URL contains `/search?tbm=map` (or the
   `/maps/rpc/...`/`listentities` response the JS fires). Google's own JS builds
   the correct `pb`, and that response body is the RICH feed containing, per
   place: name, coordinates, formatted address, rating value, review count,
   category/type, and opening-hours periods. Parse that protobuf-ish JSON array.
4. Scroll the results feed (the left panel) until the "you've reached the end"
   marker appears, so all cards (and thus all intercepted pages) load.
5. Extract a stable dedup id per place (the full `0x...:0x...` feature id / place
   id present in the rich response — NOT the truncated feed one).

Confirm empirically where name/lat/lng/rating/reviewCount/hours live in the
intercepted array by dumping one full record to a file and inspecting it. Write a
parser against the confirmed indices with defensive `try/except` + None fallbacks
(Google reorders array slots; never hard-crash on a missing slot).

If Playwright interception proves unworkable, fall back to driving the DOM: scroll
feed, read each card's aria-label/rating, click each place, read the detail panel
(name, rating, reviews, hours). Slower but robust. Prefer interception.

## Coverage: tiling Slovakia
Google returns at most ~120 results per search viewport. Cover SK without gaps or
truncation:
- Bounding box of SK: lat 47.73–49.62, lng 16.94–22.55. Only keep points inside
  the SK polygon (below) — skip tiles whose center is outside.
- **Adaptive quadtree tiling**: start with a coarse grid (e.g. ~0.1° tiles). For
  each tile × keyword, if the result count hits the ~120 cap (saturated), split
  the tile into 4 and recurse until under the cap. Dense city centers
  (Bratislava, Košice) will subdivide deeply; rural tiles stay coarse.
- Keywords (Slovak, cast wide — the GPT filter cleans up later): `krčma`,
  `hostinec`, `piváreň`, `pivnica`, `pub`, `bar`, `reštaurácia`, `pivo`.
  Dedup across keywords by feature id.

SK_POLYGON (lng, lat) for point-in-polygon (ray cast):
```
[(16.94,48.62),(16.98,48.13),(17.25,47.99),(18.30,47.73),(18.72,47.79),
 (19.60,48.20),(20.50,48.30),(21.60,48.33),(22.15,48.38),(22.55,48.80),
 (22.55,49.10),(22.00,49.30),(21.00,49.48),(20.10,49.42),(19.45,49.62),
 (18.85,49.52),(18.16,49.27),(17.55,48.82)]
```

## Output 1: raw scrape (`sk_places_raw.jsonl`)
Append-only, one JSON object per unique place (dedup by feature id). Fields:
```json
{"feature_id":"0x...:0x...","name":"...","lat":48.1,"lng":17.1,
 "address":"...","city":"...","rating_value":4.3,"rating_count":128,
 "categories":["Krčma","Bar"],"hours_periods":<google raw hours>,
 "keyword":"krčma","scraped_at":"<iso>"}
```
Keep `hours_periods` in Google's raw form here; normalize in the next step.

## Output 2: normalized import JSONL (`sk_import.jsonl`)
This is what `import_pub_directory` reads. One line per place:
```json
{"name":"U Zlatého Bažanta","lat":48.1486,"lng":17.1077,"city":"Bratislava",
 "country":"sk","venue_kind":"pub","opening_hours_raw":"Mo-Fr 10:00-22:00; Sa 11:00-23:00",
 "rating_value":4.3,"rating_count":128}
```
Rules:
- `country` always `"sk"`.
- `cache_key` is NOT in the file — the importer derives it. But identity is
  `(geohash8(lat,lng), normalize_pub_name(name))`, so make sure lat/lng/name are
  clean. geohash8 = geohash precision 8. normalize_pub_name = casefold + collapse
  whitespace.
- `opening_hours_raw` = **OSM opening_hours grammar**, e.g.
  `Mo-Fr 10:00-22:00; Sa 11:00-23:00; Su off`. Convert Google's per-day periods
  to this. Merge consecutive identical days into ranges (Mo-Fr). Omit the field
  (don't emit key) if hours unknown. 24/7 → `24/7`.
- `rating_value` float, `rating_count` int, omit if unknown.
- `venue_kind`: leave as `"unknown"` for now — a later GPT classification step
  fills pub/maybe/not_pub. (Do NOT call any LLM in this scraper.)
- Deduplicate by `(geohash8, name_key)` — if two feature ids collapse to the same
  identity, keep the one with more reviews.

## Deliverables
1. `scrape_sk.py` — the scraper (tiling + interception + resumable), writes
   `sk_places_raw.jsonl`.
2. `normalize_sk.py` — reads raw, writes `sk_import.jsonl` (OSM hours conversion,
   identity dedup, city extraction).
3. Run the scraper against a FEW tiles first (e.g. Bratislava + one rural tile),
   verify the raw records actually contain names + rating + hours, print a sample,
   and report counts. Do NOT do the full country run unattended yet — report back
   with the sample and estimated total tiles/time so a human can green-light the
   full sweep.

## Reference (existing repo patterns, read them)
- `../.pubmatch/match_places.py` — async httpx, resumable append-JSONL, backoff.
- `../.pubmatch/build_universe.py` — geohash8 + name_key identity, dedup dict.
- `../backend/pubs/management/commands/import_pub_directory.py` — the importer;
  its expected line shape (name/lat/lng/city/country/venue_kind + hours/rating
  fields merged into PubHours).
- `../backend/pubs/identity.py` (normalize_pub_name), `../backend/pubs/enrichment/matcher.py` (geohash8).

Report: what technique worked, where the fields live in the intercepted JSON, the
sample records, and the estimated full-run cost/time.

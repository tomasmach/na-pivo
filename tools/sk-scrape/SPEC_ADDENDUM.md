# Addendum: 7-day weekly-hours accumulation + Raspberry Pi deployment

Decisions made by the product owner:
- Weekly opening hours will be built by **7-day accumulation** (anonymous, no
  Google account). Google only exposes TODAY's hours anonymously, so we capture
  each place across the week and merge.
- The full sweep runs on a **headless Raspberry Pi** (ssh host `tomas-pi`,
  aarch64 Debian 13, 3.7 GB RAM, 4 cores, node 22, python 3.13, no uv yet).

## Key efficiency requirement (build this)
Do NOT re-run the full tiled discovery 7 times. Split the scraper into two modes:

1. `--mode discover` (the existing full tiled sweep): finds all places, writes
   `sk_places_raw.jsonl` with name, feature_id, coords, rating, review count,
   Google place id (ChIJ), address/city, categories, AND today's hours block.
   Tag every record with the weekday it was captured: add
   `"scraped_weekday": 0..6` (Mon=0) and `"scraped_at"` ISO.

2. `--mode hours` (NEW, cheap daily pass): read the set of unique feature_ids
   already in `sk_places_raw.jsonl`, and for each, do ONLY the fast per-place
   detail fetch (direct `?ftid=0x...:0x...` navigation, ~1.4 s each as measured)
   to grab today's hours interval. Append weekday-tagged hour records to a
   separate append-only file `sk_hours_by_day.jsonl`:
   `{"feature_id":..., "weekday":0..6, "date":"YYYY-MM-DD", "hours_interval":"11:00-23:00" | "off" | null}`.
   Resumable: skip (feature_id, weekday) pairs already recorded today. Same
   pacing/backoff/captcha handling as discover.

Intended operation on the Pi: run `discover` once (day 1, also yields day-1
hours), then run `hours` once per remaining weekday. After 7 distinct weekdays
are collected, `normalize_sk.py` builds the full week.

## normalize_sk.py changes
- Merge weekly hours from BOTH sources keyed by feature_id:
  - day-1 hours embedded in `sk_places_raw.jsonl` (tag its weekday), plus
  - all rows in `sk_hours_by_day.jsonl`.
  Build a `{weekday -> interval}` table per feature_id, then produce the OSM
  string with the existing merge_days() logic (consecutive-day ranges, `off`,
  `24/7`). If a weekday was never captured, omit it (partial week is fine;
  better than a wrong full week). If NO weekday captured, omit the hours field.
- Keep emitting `cache_key` (geohash8) — the importer requires it. Keep rating,
  review count, city, country="sk", venue_kind="unknown".
- Preserve the Google place id (ChIJ) into the output as `google_place_id` too
  (additive) so we can later feed the existing PubGooglePlace import — but do NOT
  break the import_pub_directory contract; extra keys are ignored by it.

## Pi bootstrap + run scripts (create these, plain POSIX sh)
- `pi_bootstrap.sh`: idempotent setup runnable ON the Pi. Installs uv (official
  installer), runs `uv run --with playwright playwright install-deps chromium` or
  the apt equivalent for Debian 13 aarch64, and `playwright install chromium`.
  Must succeed headless on aarch64. Print versions at the end.
- `run_discover.sh` and `run_hours.sh`: thin wrappers that `cd` to the deploy dir
  and run the scraper in the right mode with `uv run`, logging to timestamped
  files, safe to invoke repeatedly (resumable). Do not hardcode my home path;
  use the script's own dir.
- A short `DEPLOY.md`: exact commands to rsync this dir to `tomas-pi`, run
  bootstrap, do a 2-tile smoke test on the Pi, then the intended weekly cron
  (discover once, hours daily). Keep it copy-pasteable.

## Verify locally before Pi
- Add `--mode hours` and run it against the existing ~40 feature_ids in
  `sk_places_raw.jsonl` to confirm it appends valid `sk_hours_by_day.jsonl` rows
  and is resumable (second run adds nothing for the same weekday).
- Run `normalize_sk.py` and confirm rows still valid (cache_key present, hours
  merged from available weekdays, no crashes). Print 5 samples.
- Do NOT run the full country discover here. That happens on the Pi.

Append a `## 7-day accumulation build` section to REPORT.md: what you changed,
the new file formats, local verification output, and the exact Pi deploy steps.

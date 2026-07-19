# SK Google Maps pub scraper

Builds a local directory of Slovak pubs (name, coordinates, rating, review
count, Google place id, and opening hours) by driving Google Maps from your own
residential network — no paid Places API. Output feeds the existing Django
`import_pub_directory` command.

Runs on macOS or Linux. Designed to run on a laptop/desktop in `tmux`, be
stopped anytime, and resumed by re-running the same command.

## One-time setup

```sh
# uv (if you don't have it)
curl -LsSf https://astral.sh/uv/install.sh | sh
cd tools/sk-scrape
chmod +x run_local.sh
```

The first run downloads the Chromium build Playwright needs automatically.

## Run it in tmux

```sh
tmux new -s skscrape          # or: tmux attach -t skscrape
cd tools/sk-scrape

# 1) Full country discovery — run ONCE. Long (roughly 2-4 days of browser time).
./run_local.sh discover

# 2) Daily hours pass — run ONCE PER WEEKDAY for a week after discovery has data.
#    Anonymous Google Maps only shows *today's* hours, so we accumulate a full
#    week by capturing each weekday. Cheap (~1.4s per place).
./run_local.sh hours
```

Detach from tmux with `Ctrl-b d`; the run keeps going. Reattach with
`tmux attach -t skscrape`.

**Stopping and resuming is safe.** `Ctrl+C` (or closing the laptop / killing
tmux) just stops it. Re-run the same command and it continues:
- discover appends to `sk_places_raw.jsonl` and skips tiles already in
  `sk_scrape_checkpoint.jsonl`;
- hours appends to `sk_hours_by_day.jsonl` and skips places already captured
  for today.

The machine is kept awake automatically while a run is active (`caffeinate` on
macOS, `systemd-inhibit` on Linux).

## After a full week of hours

```sh
uv run normalize_sk.py           # merges everything into sk_import.jsonl
head -5 sk_import.jsonl
```

`sk_import.jsonl` is ready for `import_pub_directory` (see the repo's backend
command). Remaining pipeline after that: GPT classification of `venue_kind`
(pub / maybe / not_pub), then a `--dry-run` import, then the real import.

## Files

| File | Tracked? | What |
| --- | --- | --- |
| `scrape_sk.py` | yes | scraper: `--mode discover` and `--mode hours` |
| `normalize_sk.py` | yes | merges raw + weekday hours into `sk_import.jsonl` |
| `run_local.sh` | yes | laptop runner (keep-awake, resumable) |
| `REPORT.md` | yes | field positions, findings, estimates |
| `sk_places_raw.jsonl` | no (gitignored) | discovered places |
| `sk_hours_by_day.jsonl` | no | per-weekday hours captures |
| `sk_scrape_checkpoint.jsonl` | no | discovery resume state |
| `sk_import.jsonl` | no | normalized import file |
| `logs/` | no | run logs |

Working data stays local and out of git on purpose (personal-ish place data,
large, regenerable).

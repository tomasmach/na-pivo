#!/usr/bin/env bash
#
# Bulk-fill opening hours + ratings for the WHOLE Czech Republic.
#
# Scrapes firmy.cz from the HOME IP (no proxy = $0). Writes into bulk.sqlite3
# (separate from dev db.sqlite3). The Mapy catalogue is already built and cached
# at scripts/pub_catalogue_cz.json, so this skips the sweep and goes straight to
# filling. Prague pubs already filled in a prior run are skipped (resume).
#
# Runs the command DIRECTLY on the terminal (a TTY), which is what makes it:
#   * draw the live progress bar:  [####] done/total (%)  ✓matched ✗failed  ETA
#   * silence the firmy.cz INFO/DEBUG noise (410s for German border pubs, etc.)
# Do NOT pipe this through tee/cat — that hides the TTY, kills the bar and lets
# the log spam back in.
#
# RUN ONLY FROM A HOME / RESIDENTIAL IP — never on the Hetzner server (a
# datacenter IP hits the firmy.cz consent wall). Keep the laptop awake.
#
# Fire-and-forget: launch it inside tmux, detach, and you can `git checkout`
# any other branch and keep working — the running process already loaded its
# code into memory, so switching branches does not disturb it. (To RESUME later
# after an interruption, check this branch back out and run this script again;
# finished pubs are skipped.)
#
#   tmux new -s bulk        # or: tmux attach -t bulk
#   ./scripts/run_bulk_cz.sh
#   # Ctrl-b then d         # detach — it keeps running

set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

exec env DATABASE_URL="sqlite:///$(pwd)/bulk.sqlite3" \
  uv run python manage.py bulk_fill_hours \
    --bbox 12.0,48.5,18.9,51.1 \
    --catalogue scripts/pub_catalogue_cz.json \
    --remaining-out scripts/pub_remaining_cz.json \
    --throttle 1.5 \
    --mapy-cap 1000000

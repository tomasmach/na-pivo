#!/bin/sh
# Run the Slovakia Google Maps scraper on a normal laptop/desktop (macOS or
# Linux) from your own residential network. Safe to Ctrl+C and re-run anytime:
# discover is append-only + checkpointed, hours is deduped per (place, weekday,
# date), so a restart continues where it stopped and never double-counts.
#
#   ./run_local.sh discover   # full-country sweep (run once; long)
#   ./run_local.sh hours      # cheap daily pass (run once per weekday)
#
# It keeps the machine awake for the duration (caffeinate on macOS,
# systemd-inhibit on Linux) and pins Google-facing pacing to polite defaults.
set -eu

MODE="${1:-discover}"
if [ "$MODE" != "discover" ] && [ "$MODE" != "hours" ]; then
    echo "usage: $0 [discover|hours]" >&2
    exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"
mkdir -p logs

# Locate uv (installs it if missing).
UV_BIN=$(command -v uv 2>/dev/null || true)
if [ -z "$UV_BIN" ] && [ -x "${HOME}/.local/bin/uv" ]; then
    UV_BIN="${HOME}/.local/bin/uv"
fi
if [ -z "$UV_BIN" ]; then
    echo "uv not found. Install it once with:" >&2
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
fi

# Ensure the Chromium build Playwright needs exists (idempotent, quick if cached).
"$UV_BIN" run scrape_sk.py --install-browser >/dev/null 2>&1 || \
    "$UV_BIN" run scrape_sk.py --install-browser

# Keep the machine awake while the scraper runs.
KEEP_AWAKE=""
if command -v caffeinate >/dev/null 2>&1; then
    KEEP_AWAKE="caffeinate -i -s"          # macOS: no idle/system sleep
elif command -v systemd-inhibit >/dev/null 2>&1; then
    KEEP_AWAKE="systemd-inhibit --what=idle:sleep --why=sk-scrape --mode=block"
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_PATH="logs/${MODE}-${TIMESTAMP}.log"
KEYWORDS='krčma,hostinec,piváreň,pivnica,pub,bar,reštaurácia,pivo'

if [ "$MODE" = "discover" ]; then
    set -- --mode discover --full-country --keywords "$KEYWORDS"
else
    set -- --mode hours
fi

echo "Running '$MODE'. Log: ${SCRIPT_DIR}/${LOG_PATH}"
echo "Safe to Ctrl+C; re-run the same command to resume."
# shellcheck disable=SC2086
$KEEP_AWAKE "$UV_BIN" run scrape_sk.py "$@" 2>&1 | tee "$LOG_PATH"

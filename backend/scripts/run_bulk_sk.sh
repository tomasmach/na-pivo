#!/usr/bin/env bash
#
# Build the Mapy pub catalogue for the WHOLE of Slovakia.
#
# Sweeps Mapy.cz only; it does not scrape firmy.cz or write PubHours rows.
# The Mapy API is key-based, and this sweep spends Mapy credits bounded by
# --mapy-cap. The catalogue is cached at scripts/pub_catalogue_sk.json, so
# rerunning without deleting it reuses the existing file.
#
# Runs the command DIRECTLY on the terminal. The catalogue is written into the
# scripts directory, while DATABASE_URL keeps any Django database access
# isolated in bulk.sqlite3 (separate from dev db.sqlite3).
#
#   ./scripts/run_bulk_sk.sh

set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

exec env DATABASE_URL="sqlite:///$(pwd)/bulk.sqlite3" \
  uv run python manage.py bulk_fill_hours \
    --bbox 16.83,47.72,22.58,49.62 \
    --catalogue-only \
    --catalogue scripts/pub_catalogue_sk.json \
    --remaining-out scripts/pub_remaining_sk.json \
    --mapy-cap 1000000

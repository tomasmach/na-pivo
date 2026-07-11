#!/usr/bin/env bash
#
# Prune no-match 'unknown' rows from bulk.sqlite3 so a resume re-tries them
# with the fixed multi-candidate firmy matcher.
#
# Keeps:
#   * status='ok' rows                       (have hours — nothing to gain)
#   * 'unknown' rows WITH source_ref         (matched on firmy, page just has no
#                                             hours; they carry ratings we keep)
# Deletes:
#   * 'unknown' rows with source_ref IS NULL (search no-match — exactly the rows
#                                             the first-link-only bug produced;
#                                             foreign ones get skipped by
#                                             --cz-only without HTTP anyway)
#
# STOP the running bulk_fill_hours first — it holds the sqlite file and its
# in-memory pending list would go stale.
#
set -euo pipefail
cd "$(dirname "$0")/.."

DB=bulk.sqlite3
BACKUP="bulk.backup-$(date +%Y%m%d-%H%M%S).sqlite3"

if pgrep -f bulk_fill_hours >/dev/null; then
  echo "ERROR: bulk_fill_hours is still running — stop it first (tmux attach -t bulk, Ctrl-C)." >&2
  exit 1
fi

cp "$DB" "$BACKUP"
echo "backup: $BACKUP"

sqlite3 "$DB" <<'SQL'
SELECT 'before: total=' || count(*) ||
       ' ok=' || sum(status='ok') ||
       ' unknown_matched=' || sum(status='unknown' AND source_ref IS NOT NULL) ||
       ' unknown_nomatch=' || sum(status='unknown' AND source_ref IS NULL)
FROM pubs_pubhours;

DELETE FROM pubs_pubhours WHERE status='unknown' AND source_ref IS NULL;

SELECT 'after:  total=' || count(*) FROM pubs_pubhours;
VACUUM;
SQL
echo "done — resume with ./scripts/run_bulk_cz.sh"

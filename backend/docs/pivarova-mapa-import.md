# One-time Pivařova mapa seed

This is a one-time local snapshot and database seed, not a scheduled scraper.
Third-party prices are stored in `PubExternalBeerMenu`; the seed never writes
`PubCommunityData`, contribution logs, or mapper XP. An existing user beer menu
always wins, including a menu that the user explicitly cleared.

## 1. Get permission

Obtain permission from the Pivařova mapa operator before crawling or reusing
the database. The exporter requires an explicit confirmation flag so a full
crawl cannot start accidentally.

## 2. Export the local snapshot

Start with the default 20-business sample:

```bash
uv run python manage.py export_pivarova_mapa pubs/data/pivarova_mapa_seed.jsonl \
  --confirm-source-permission
```

After reviewing the sample, resume and export the complete public map at one
detail request per second:

```bash
uv run python manage.py export_pivarova_mapa pubs/data/pivarova_mapa_seed.jsonl \
  --confirm-source-permission --resume --all
```

The JSONL is flushed after every business, so `--resume` can continue after a
network failure without repeating completed details. Hidden pins are skipped.

## 3. Review matching without writes

```bash
uv run python manage.py import_pivarova_mapa pubs/data/pivarova_mapa_seed.jsonl
```

The default is a transactionally rolled-back dry run. Review the `unmatched`
and `ambiguous` counts before applying. Matching uses both name and nearby
coordinates against the existing active Czech `PubDirectory`. Unmatched source
pubs are added to the directory as Czech pubs; ambiguous rows are skipped
rather than attached to the wrong place. Matched source businesses are promoted
to `venue_kind=pub` when an older classifier marked them otherwise. Use
`--skip-new-pubs` only when the snapshot must not expand the directory.

## 4. Apply

```bash
uv run python manage.py import_pivarova_mapa pubs/data/pivarova_mapa_seed.jsonl --apply
```

The import is idempotent. It skips prices for every pub where a user already
submitted or explicitly cleared the beer menu. Re-running it still cannot
replace or delete a user's menu. Disable a questionable snapshot through the
Django admin by setting `active` to false.

Matched pubs keep the display name already used by Na pivo. New pub names are
Unicode/whitespace-normalized and get the standard `name_key`. Beer names are
canonicalized through the existing beer catalogue on import; unknown names are
cleaned but never guessed. Exact duplicate price rows are collapsed.

Keep the completed JSONL as the audit/recovery snapshot. Do not schedule the
export command or use it as a runtime dependency.

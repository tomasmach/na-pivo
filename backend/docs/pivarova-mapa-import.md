# Pivařova mapa beer-price import

The integration keeps third-party prices in `PubExternalBeerMenu`. It never
writes `PubCommunityData`, contribution logs, or mapper XP. At read time an
existing user beer menu always wins; the external snapshot is returned only
when the pub has no user-confirmed menu.

## 1. Get permission

Obtain permission from the Pivařova mapa operator before crawling or reusing
the database. The exporter requires an explicit confirmation flag so a full
crawl cannot start accidentally.

## 2. Export to staging JSONL

Start with the default 20-business sample:

```bash
uv run python manage.py export_pivarova_mapa /tmp/pivarova-mapa.jsonl \
  --confirm-source-permission
```

After reviewing the sample, resume and export the complete public map at one
detail request per second:

```bash
uv run python manage.py export_pivarova_mapa /tmp/pivarova-mapa.jsonl \
  --confirm-source-permission --resume --all
```

The JSONL is flushed after every business, so `--resume` can continue after a
network failure without repeating completed details. Hidden pins are skipped.

## 3. Review matching without writes

```bash
uv run python manage.py import_pivarova_mapa /tmp/pivarova-mapa.jsonl
```

The default is a transactionally rolled-back dry run. Review the `unmatched`
and `ambiguous` counts before applying. Matching uses both name and nearby
coordinates against the existing active Czech `PubDirectory`; uncertain rows
are skipped rather than attached to the wrong pub.

## 4. Apply

```bash
uv run python manage.py import_pivarova_mapa /tmp/pivarova-mapa.jsonl --apply
```

The import is idempotent. Re-running it updates source snapshots but cannot
replace or delete a user's beer menu. Disable a questionable snapshot through
the Django admin by setting `active` to false.

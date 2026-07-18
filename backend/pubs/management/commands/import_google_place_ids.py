"""Import offline-matched Google Place IDs for pub identities."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from pubs.identity import normalize_pub_name
from pubs.models import PubGooglePlace

BATCH_SIZE = 1_000


def _load_lines(path: Path) -> list[dict]:
    rows: list[dict] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                if not raw_line.strip():
                    continue
                try:
                    row = json.loads(raw_line)
                    cache_key = str(row["cache_key"]).strip()
                    name_key = normalize_pub_name(
                        str(row.get("name") or row.get("name_key") or "")
                    )
                    place_id = str(row["google_place_id"]).strip()
                    if not cache_key or not name_key or not place_id:
                        continue
                    rows.append(
                        {
                            "cache_key": cache_key,
                            "name_key": name_key,
                            "google_place_id": place_id,
                        }
                    )
                except (json.JSONDecodeError, KeyError, TypeError) as exc:
                    raise CommandError(f"Invalid match line {line_number}: {exc}") from exc
    except OSError as exc:
        raise CommandError(f"Cannot read matches: {exc}") from exc
    return rows


class Command(BaseCommand):
    help = "Import Google Place ID matches (JSONL) produced by an offline Places run."

    def add_arguments(self, parser) -> None:
        parser.add_argument("matches_file", type=Path)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options) -> None:
        rows = _load_lines(options["matches_file"])
        dry_run = options["dry_run"]
        counts: Counter = Counter()
        now = timezone.now()

        existing = {
            (item.cache_key, item.name_key): item
            for item in PubGooglePlace.objects.all().iterator()
        }
        creates: list[PubGooglePlace] = []
        updates: list[PubGooglePlace] = []
        processed: set[tuple[str, str]] = set()

        for row in rows:
            identity = (row["cache_key"], row["name_key"])
            if identity in processed:
                counts["duplicate"] += 1
                continue
            processed.add(identity)
            item = existing.get(identity)
            if item is None:
                creates.append(
                    PubGooglePlace(
                        cache_key=identity[0],
                        name_key=identity[1],
                        google_place_id=row["google_place_id"],
                        matched_at=now,
                    )
                )
                counts["created"] += 1
            elif item.google_place_id == row["google_place_id"]:
                counts["unchanged"] += 1
            else:
                item.google_place_id = row["google_place_id"]
                item.matched_at = now
                item.updated_at = now
                updates.append(item)
                counts["updated"] += 1

        if not dry_run:
            PubGooglePlace.objects.bulk_create(creates, batch_size=BATCH_SIZE)
            PubGooglePlace.objects.bulk_update(
                updates,
                ["google_place_id", "matched_at", "updated_at"],
                batch_size=BATCH_SIZE,
            )

        prefix = "DRY RUN - " if dry_run else ""
        self.stdout.write(
            f"{prefix}PubGooglePlace: created={counts['created']} "
            f"updated={counts['updated']} unchanged={counts['unchanged']} "
            f"duplicate={counts['duplicate']}"
        )

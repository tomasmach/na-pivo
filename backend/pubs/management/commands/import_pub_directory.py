"""Import a reviewed pub directory while protecting all existing user data."""

from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime, time
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from pubs.enrichment.matcher import names_match
from pubs.identity import normalize_pub_name
from pubs.models import PubDirectory, PubHours

BATCH_SIZE = 1_000
DIRECTORY_FIELDS = (
    "name",
    "lat",
    "lng",
    "city",
    "country",
    "venue_kind",
    "discovery_kind",
    "has_beer_signal",
    "source",
    "refreshed_at",
)
HOURS_FILL_FIELDS = (
    "opening_hours_raw", "status", "source_ref", "confidence", "rating_value",
    "rating_count", "rating_label", "venue_kind", "fetched_at",
)


class DryRunRollbackError(Exception):
    """Internal signal used to roll back a completed dry run."""


def _parse_refreshed_at(value: str) -> datetime:
    parsed = parse_datetime(value)
    if parsed is None:
        parsed_date = parse_date(value)
        if parsed_date is None:
            raise CommandError("--refreshed-at must be an ISO date or datetime")
        parsed = datetime.combine(parsed_date, time.min, tzinfo=UTC)
    elif timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, UTC)
    return parsed


def _load_lines(path: Path) -> list[dict]:
    rows: list[dict] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                if not raw_line.strip():
                    continue
                try:
                    row = json.loads(raw_line)
                    row["name_key"] = normalize_pub_name(row["name"])
                    discovery_kind = row.get("discovery_kind") or PubDirectory.DiscoveryKind.PUB
                    if discovery_kind not in PubDirectory.DiscoveryKind.values:
                        raise ValueError(f"unsupported discovery_kind {discovery_kind!r}")
                    row["discovery_kind"] = discovery_kind
                    row["has_beer_signal"] = bool(row.get("has_beer_signal", False))
                    rows.append(row)
                except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                    raise CommandError(f"Invalid export line {line_number}: {exc}") from exc
    except OSError as exc:
        raise CommandError(f"Cannot read export: {exc}") from exc
    return rows


class Command(BaseCommand):
    help = "Import a reviewed PubDirectory export and safely merge Firmy enrichment."

    def add_arguments(self, parser) -> None:
        parser.add_argument("export_file", type=Path)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--refreshed-at", required=True)

    def handle(self, *args, **options) -> None:
        rows = _load_lines(options["export_file"])
        refreshed_at = _parse_refreshed_at(options["refreshed_at"])
        dry_run = options["dry_run"]
        directory_counts: Counter = Counter()
        hours_counts: Counter = Counter()

        try:
            with transaction.atomic():
                self._merge_directory(rows, refreshed_at, directory_counts)
                self._merge_hours(rows, refreshed_at, hours_counts)
                if dry_run:
                    raise DryRunRollbackError
        except DryRunRollbackError:
            pass

        prefix = "DRY RUN - " if dry_run else ""
        self.stdout.write(
            f"{prefix}PubDirectory: created={directory_counts['created']} "
            f"updated={directory_counts['updated']} unchanged={directory_counts['unchanged']}"
        )
        self.stdout.write(
            f"{prefix}PubHours: inserted={hours_counts['inserted']} "
            f"filled={hours_counts['filled']} protected={hours_counts['protected']} "
            f"name_conflict={hours_counts['name_conflict']} skipped={hours_counts['skipped']}"
        )

    def _merge_directory(self, rows: list[dict], refreshed_at: datetime, counts: Counter) -> None:
        identities = {(row["cache_key"], row["name_key"]) for row in rows}
        keys = {identity[0] for identity in identities}
        existing = {
            (item.cache_key, item.name_key): item
            for item in PubDirectory.objects.filter(cache_key__in=keys)
        }
        creates: list[PubDirectory] = []
        updates: list[PubDirectory] = []
        processed: set[tuple[str, str]] = set()
        now = timezone.now()

        for row in rows:
            identity = (row["cache_key"], row["name_key"])
            if identity in processed:
                counts["unchanged"] += 1
                continue
            processed.add(identity)
            values = {
                "name": row["name"], "lat": row["lat"], "lng": row["lng"],
                "city": row.get("city") or "", "country": row["country"],
                "venue_kind": row["venue_kind"], "source": "bulk_scrape",
                "discovery_kind": row["discovery_kind"],
                "has_beer_signal": row["has_beer_signal"],
                "refreshed_at": refreshed_at,
            }
            item = existing.get(identity)
            if item is None:
                creates.append(PubDirectory(cache_key=identity[0], name_key=identity[1], **values))
                counts["created"] += 1
            elif all(getattr(item, field) == value for field, value in values.items()):
                counts["unchanged"] += 1
            else:
                for field, value in values.items():
                    setattr(item, field, value)
                item.updated_at = now
                updates.append(item)
                counts["updated"] += 1

        PubDirectory.objects.bulk_create(creates, batch_size=BATCH_SIZE)
        PubDirectory.objects.bulk_update(
            updates, [*DIRECTORY_FIELDS, "updated_at"], batch_size=BATCH_SIZE
        )

    def _merge_hours(self, rows: list[dict], refreshed_at: datetime, counts: Counter) -> None:
        candidates = [row for row in rows if row.get("opening_hours_raw") or self._has_rating(row)]
        keys = {row["cache_key"] for row in candidates}
        existing = {item.cache_key: item for item in PubHours.objects.filter(cache_key__in=keys)}
        creates: list[PubHours] = []
        updates: list[PubHours] = []
        processed: set[str] = set()
        now = timezone.now()

        for row in candidates:
            key = row["cache_key"]
            if key in processed:
                counts["skipped"] += 1
                continue
            processed.add(key)
            item = existing.get(key)
            values = self._hours_values(row, refreshed_at)
            if item is None:
                creates.append(PubHours(
                    cache_key=key, name=row["name"], lat=row["lat"], lng=row["lng"],
                    city=row.get("city") or "", source="firmy", **values,
                ))
                counts["inserted"] += 1
            elif item.opening_hours_raw:
                counts["protected"] += 1
            elif item.status not in (PubHours.Status.UNKNOWN, PubHours.Status.ERROR):
                counts["skipped"] += 1
            elif not names_match(item.name, row["name"]):
                counts["name_conflict"] += 1
            elif all(getattr(item, field) == value for field, value in values.items()):
                counts["skipped"] += 1
            else:
                for field, value in values.items():
                    setattr(item, field, value)
                item.updated_at = now
                updates.append(item)
                counts["filled"] += 1

        PubHours.objects.bulk_create(creates, batch_size=BATCH_SIZE)
        PubHours.objects.bulk_update(
            updates, [*HOURS_FILL_FIELDS, "updated_at"], batch_size=BATCH_SIZE
        )

    @staticmethod
    def _has_rating(row: dict) -> bool:
        return any(row.get(field) is not None for field in ("rating_value", "rating_count", "rating_label"))

    @staticmethod
    def _hours_values(row: dict, refreshed_at: datetime) -> dict:
        hours = row.get("opening_hours_raw")
        return {
            "opening_hours_raw": hours,
            "status": PubHours.Status.OK if hours else PubHours.Status.UNKNOWN,
            "source_ref": row.get("source_ref"),
            "confidence": row.get("confidence"),
            "rating_value": row.get("rating_value"),
            "rating_count": row.get("rating_count"),
            "rating_label": row.get("rating_label"),
            "venue_kind": row.get("venue_kind") or PubHours.VenueKind.UNKNOWN,
            "fetched_at": refreshed_at,
        }

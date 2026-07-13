"""Match a reviewed Pivařova mapa export and upsert external menu fallbacks."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from pubs.enrichment.matcher import verify_match
from pubs.models import PubDirectory, PubExternalBeerMenu

MATCH_LAT_DELTA = 0.002
MATCH_LNG_DELTA = 0.003
DEFAULT_MIN_CONFIDENCE = 0.65


class DryRunRollbackError(Exception):
    pass


def _load_rows(path: Path) -> list[dict]:
    rows: list[dict] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                required = ("source_id", "source_slug", "source_url", "name", "lat", "lng", "beers")
                missing = [field for field in required if field not in row]
                if missing:
                    raise ValueError(f"line {line_number} missing {', '.join(missing)}")
                if not isinstance(row["beers"], list):
                    raise ValueError(f"line {line_number} beers must be a list")
                rows.append(row)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise CommandError(f"Cannot read export: {exc}") from exc
    return rows


def _latest_verified_at(beers: list[dict]) -> datetime | None:
    timestamps: list[datetime] = []
    for beer in beers:
        parsed = parse_datetime(str(beer.get("verified_at") or ""))
        if parsed is not None:
            timestamps.append(parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed))
    return max(timestamps, default=None)


def _public_beers(beers: list[dict]) -> list[dict]:
    result: list[dict] = []
    for beer in beers:
        name = str(beer.get("name") or "").strip()
        price = beer.get("price_czk")
        volume = beer.get("volume_ml")
        if not name or isinstance(price, bool) or not isinstance(price, int | float):
            continue
        if isinstance(volume, bool) or not isinstance(volume, int) or volume <= 0:
            continue
        result.append({"name": name, "price_czk": price, "volume_ml": volume})
    return result


def _match_directory(row: dict, min_confidence: float) -> tuple[PubDirectory | None, bool]:
    lat = float(row["lat"])
    lng = float(row["lng"])
    candidates = PubDirectory.objects.filter(
        active=True,
        country="cz",
        lat__range=(lat - MATCH_LAT_DELTA, lat + MATCH_LAT_DELTA),
        lng__range=(lng - MATCH_LNG_DELTA, lng + MATCH_LNG_DELTA),
    )
    scored = sorted(
        (
            (verify_match(row["name"], lat, lng, item.name, item.lat, item.lng), item)
            for item in candidates
        ),
        key=lambda pair: pair[0],
        reverse=True,
    )
    if not scored or scored[0][0] < min_confidence:
        return None, False
    if len(scored) > 1 and scored[1][0] >= min_confidence and scored[0][0] - scored[1][0] < 0.03:
        return None, True
    return scored[0][1], False


class Command(BaseCommand):
    help = "Import reviewed Pivařova mapa prices as non-community fallback menus."

    def add_arguments(self, parser) -> None:
        parser.add_argument("export_file", type=Path)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)

    def handle(self, *args, **options) -> None:
        if not 0.5 <= options["min_confidence"] <= 1:
            raise CommandError("--min-confidence must be between 0.5 and 1")
        rows = _load_rows(options["export_file"])
        counts: Counter = Counter()
        try:
            with transaction.atomic():
                for row in rows:
                    beers = _public_beers(row["beers"])
                    if not beers:
                        counts["empty"] += 1
                        continue
                    directory, ambiguous = _match_directory(row, options["min_confidence"])
                    if directory is None:
                        counts["ambiguous" if ambiguous else "unmatched"] += 1
                        continue
                    values = {
                        "cache_key": directory.cache_key,
                        "name": directory.name,
                        "lat": directory.lat,
                        "lng": directory.lng,
                        "city": directory.city,
                        "source_url": row["source_url"],
                        "beers": beers,
                        "verified_at": _latest_verified_at(row["beers"]),
                        "fetched_at": timezone.now(),
                        "active": True,
                    }
                    existing = PubExternalBeerMenu.objects.filter(
                        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
                        source_id=str(row["source_id"]),
                    ).first()
                    if existing is None:
                        PubExternalBeerMenu.objects.create(
                            source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
                            source_id=str(row["source_id"]),
                            **values,
                        )
                        counts["created"] += 1
                    else:
                        comparable = {key: value for key, value in values.items() if key != "fetched_at"}
                        if all(getattr(existing, key) == value for key, value in comparable.items()):
                            counts["unchanged"] += 1
                            continue
                        for key, value in values.items():
                            setattr(existing, key, value)
                        existing.save(update_fields=[*values, "updated_at"])
                        counts["updated"] += 1
                if not options["apply"]:
                    raise DryRunRollbackError
        except DryRunRollbackError:
            pass

        prefix = "DRY RUN - " if not options["apply"] else ""
        self.stdout.write(
            f"{prefix}External menus: created={counts['created']} updated={counts['updated']} "
            f"unchanged={counts['unchanged']} unmatched={counts['unmatched']} "
            f"ambiguous={counts['ambiguous']} empty={counts['empty']}"
        )

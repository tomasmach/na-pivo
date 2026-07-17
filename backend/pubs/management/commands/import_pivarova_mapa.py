"""Seed the pub directory and beer menus from a reviewed local snapshot."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from pubs.beer_catalog import BeerCatalogMatchCache, normalize_beer_payload
from pubs.enrichment.matcher import geohash8, name_similarity, verify_match
from pubs.identity import normalize_pub_name
from pubs.models import PubDirectory, PubExternalBeerMenu, PubHours, PubPriceIndex
from pubs.price_index import has_user_beer_menu, upsert_pub_price_index

MATCH_LAT_DELTA = 0.002
MATCH_LNG_DELTA = 0.003
DEFAULT_MIN_CONFIDENCE = 0.65
GENERIC_NAME_TOKENS = {
    "bar",
    "beer",
    "bistro",
    "cafe",
    "café",
    "hotel",
    "hostinec",
    "hospoda",
    "hospudka",
    "hospůdka",
    "kavarna",
    "kavárna",
    "penzion",
    "pizza",
    "pizzeria",
    "pivnice",
    "pub",
    "restaurace",
    "restaurant",
    "restauracia",
    "the",
}


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


def _clean_display_name(value: object) -> str:
    return " ".join(unicodedata.normalize("NFC", str(value or "")).split())


def _public_beers(
    beers: list[dict], *, match_cache: BeerCatalogMatchCache
) -> list[dict]:
    result: list[dict] = []
    seen: set[tuple[str, int | float, int]] = set()
    for beer in beers:
        name = _clean_display_name(beer.get("name"))
        price = beer.get("price_czk")
        volume = beer.get("volume_ml")
        if not name or isinstance(price, bool) or not isinstance(price, int | float):
            continue
        if isinstance(volume, bool) or not isinstance(volume, int) or volume <= 0:
            continue
        normalized = normalize_beer_payload(
            {"name": name, "price_czk": price, "volume_ml": volume},
            match_cache=match_cache,
        )
        identity = (normalized["name"].casefold(), price, volume)
        if identity in seen:
            continue
        seen.add(identity)
        result.append(normalized)
    return result


def _distinctive_name_tokens(value: object) -> set[str]:
    tokens = set(re.findall(r"\w+", str(value or "").casefold()))
    return {
        token
        for token in tokens
        if len(token) > 1 and token not in GENERIC_NAME_TOKENS
    }


def _names_plausibly_same(source_name: object, candidate_name: object) -> bool:
    source_tokens = _distinctive_name_tokens(source_name)
    candidate_tokens = _distinctive_name_tokens(candidate_name)
    return bool(source_tokens & candidate_tokens) or name_similarity(
        str(source_name or ""), str(candidate_name or "")
    ) >= 0.8


def _distance_m(lat: float, lng: float, candidate: PubDirectory) -> float:
    lat_scale = 111_320.0
    lng_scale = lat_scale * math.cos(math.radians(lat))
    return math.hypot((candidate.lat - lat) * lat_scale, (candidate.lng - lng) * lng_scale)


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
            if _names_plausibly_same(row["name"], item.name)
        ),
        key=lambda pair: pair[0],
        reverse=True,
    )
    if not scored or scored[0][0] < min_confidence:
        return None, False
    if len(scored) > 1 and scored[1][0] >= min_confidence and scored[0][0] - scored[1][0] < 0.03:
        nearest = sorted(
            ((_distance_m(lat, lng, item), item) for _score, item in scored),
            key=lambda pair: pair[0],
        )
        if nearest[0][0] <= 60 and nearest[1][0] - nearest[0][0] >= 20:
            return nearest[0][1], False
        return None, True
    return scored[0][1], False


def _create_directory(row: dict) -> tuple[PubDirectory, bool]:
    lat = float(row["lat"])
    lng = float(row["lng"])
    name = _clean_display_name(row["name"])
    cache_key = geohash8(lat, lng)
    name_key = normalize_pub_name(name)
    directory, created = PubDirectory.objects.update_or_create(
        cache_key=cache_key,
        name_key=name_key,
        defaults={
            "name": name,
            "lat": lat,
            "lng": lng,
            "city": _clean_display_name(row.get("city")),
            "country": "cz",
            "venue_kind": PubHours.VenueKind.PUB,
            "source": "pivarova_mapa",
            "active": True,
            "refreshed_at": timezone.now(),
        },
    )
    return directory, created


def _has_user_beer_menu(directory: PubDirectory) -> bool:
    """Return whether an app user has already supplied or cleared this menu."""
    return has_user_beer_menu(cache_key=directory.cache_key, name=directory.name)


def _promote_directory_pub(directory: PubDirectory) -> bool:
    if directory.venue_kind == PubHours.VenueKind.PUB:
        return False
    directory.venue_kind = PubHours.VenueKind.PUB
    directory.save(update_fields=["venue_kind", "updated_at"])
    return True


class Command(BaseCommand):
    help = "Seed pubs and non-community beer menu fallbacks from a local Pivařova mapa snapshot."

    def add_arguments(self, parser) -> None:
        parser.add_argument("export_file", type=Path)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)
        parser.add_argument(
            "--skip-new-pubs",
            action="store_true",
            help="Only attach menus to pubs already present in PubDirectory.",
        )

    def handle(self, *args, **options) -> None:
        if not 0.5 <= options["min_confidence"] <= 1:
            raise CommandError("--min-confidence must be between 0.5 and 1")
        rows = _load_rows(options["export_file"])
        counts: Counter = Counter()
        beer_match_cache = BeerCatalogMatchCache()
        try:
            with transaction.atomic():
                for row in rows:
                    directory, ambiguous = _match_directory(row, options["min_confidence"])
                    if directory is None:
                        if ambiguous:
                            counts["ambiguous"] += 1
                            self.stderr.write(
                                self.style.WARNING(
                                    f"Skipped ambiguous pub: {row['name']} ({row['source_url']})"
                                )
                            )
                            continue
                        if options["skip_new_pubs"]:
                            counts["unmatched"] += 1
                            self.stderr.write(
                                self.style.WARNING(
                                    f"Skipped unmatched pub: {row['name']} ({row['source_url']})"
                                )
                            )
                            continue
                        directory, created = _create_directory(row)
                        counts["pub_created" if created else "pub_reactivated"] += 1
                    else:
                        counts["pub_matched"] += 1
                    if _promote_directory_pub(directory):
                        counts["pub_promoted"] += 1

                    beers = _public_beers(row["beers"], match_cache=beer_match_cache)
                    if not beers:
                        counts["empty"] += 1
                        continue
                    if _has_user_beer_menu(directory):
                        counts["user_menu"] += 1
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
                        external_menu = PubExternalBeerMenu.objects.create(
                            source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
                            source_id=str(row["source_id"]),
                            **values,
                        )
                        counts["created"] += 1
                    else:
                        comparable = {key: value for key, value in values.items() if key != "fetched_at"}
                        if all(getattr(existing, key) == value for key, value in comparable.items()):
                            counts["unchanged"] += 1
                            external_menu = existing
                        else:
                            for key, value in values.items():
                                setattr(existing, key, value)
                            existing.save(update_fields=[*values, "updated_at"])
                            counts["updated"] += 1
                            external_menu = existing
                    upsert_pub_price_index(
                        cache_key=external_menu.cache_key,
                        name=external_menu.name,
                        lat=external_menu.lat,
                        lng=external_menu.lng,
                        city=external_menu.city,
                        beers=external_menu.beers,
                        observed_at=external_menu.verified_at or external_menu.fetched_at,
                        source=PubPriceIndex.Source.EXTERNAL,
                    )
                if not options["apply"]:
                    raise DryRunRollbackError
        except DryRunRollbackError:
            pass

        prefix = "DRY RUN - " if not options["apply"] else ""
        self.stdout.write(
            f"{prefix}Pubs: matched={counts['pub_matched']} created={counts['pub_created']} "
            f"reactivated={counts['pub_reactivated']} promoted={counts['pub_promoted']} "
            f"unmatched={counts['unmatched']} "
            f"ambiguous={counts['ambiguous']}; External menus: "
            f"created={counts['created']} updated={counts['updated']} "
            f"unchanged={counts['unchanged']} empty={counts['empty']} "
            f"skipped_user_menu={counts['user_menu']}"
        )

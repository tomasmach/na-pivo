"""Run repeatable, network-free pub directory coverage smoke checks."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

from django.core.management.base import BaseCommand, CommandError
from django.db.models import F, FloatField, Value
from django.db.models.expressions import ExpressionWrapper

from pubs.enrichment.coverage import coverage_country
from pubs.models import PubDirectory, PubHours, UserAddedPub


@dataclass(frozen=True)
class CoverageSample:
    name: str
    lat: float
    lng: float
    radius_km: float
    minimum: int


DEFAULT_SAMPLES = (
    CoverageSample("Brno", 49.1951, 16.6068, 5, 30),
    CoverageSample("Bratislava", 48.1486, 17.1077, 5, 20),
    CoverageSample("Košice", 48.7164, 21.2611, 5, 15),
    # Outside the licensed/imported CZ/SK directory, discovery remains
    # community-only. Keeping the sample makes that product boundary visible.
    CoverageSample("Tenerife", 28.2916, -16.6291, 10, 0),
)


def _parse_sample(raw: str) -> CoverageSample:
    try:
        name, lat, lng, radius, minimum = [part.strip() for part in raw.split(",")]
        sample = CoverageSample(name, float(lat), float(lng), float(radius), int(minimum))
    except (TypeError, ValueError) as exc:
        raise CommandError(
            "--sample must be NAME,LAT,LNG,RADIUS_KM,MINIMUM"
        ) from exc
    if not sample.name or sample.radius_km <= 0 or sample.minimum < 0:
        raise CommandError("--sample contains invalid values")
    return sample


def _nearby_count(queryset, sample: CoverageSample) -> int:
    lat_delta = sample.radius_km / 111.0
    lng_scale = max(math.cos(math.radians(sample.lat)), 0.01)
    lng_delta = sample.radius_km / (111.0 * lng_scale)
    lat_distance = F("lat") - Value(sample.lat)
    lng_distance = (F("lng") - Value(sample.lng)) * Value(lng_scale)
    max_planar = (sample.radius_km / 111.0) ** 2
    return (
        queryset.filter(
            lat__gte=sample.lat - lat_delta,
            lat__lte=sample.lat + lat_delta,
            lng__gte=sample.lng - lng_delta,
            lng__lte=sample.lng + lng_delta,
        )
        .annotate(
            distance_score=ExpressionWrapper(
                lat_distance * lat_distance + lng_distance * lng_distance,
                output_field=FloatField(),
            )
        )
        .filter(distance_score__lte=max_planar)
        .count()
    )


class Command(BaseCommand):
    help = "Check minimum pub coverage for named locations without calling external providers."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--sample",
            action="append",
            default=[],
            help="NAME,LAT,LNG,RADIUS_KM,MINIMUM; repeat for multiple locations.",
        )
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit non-zero when a supported directory sample is below its minimum.",
        )

    def handle(self, *args, **options) -> None:
        samples = tuple(_parse_sample(raw) for raw in options["sample"]) or DEFAULT_SAMPLES
        rows = []
        failed = []
        for sample in samples:
            country = coverage_country(sample.lat, sample.lng)
            directory_count = (
                _nearby_count(
                    PubDirectory.objects.filter(active=True).exclude(
                        venue_kind=PubHours.VenueKind.NOT_PUB
                    ),
                    sample,
                )
                if country
                else 0
            )
            community_count = _nearby_count(
                UserAddedPub.objects.filter(active=True), sample
            )
            passed = country is None or directory_count >= sample.minimum
            if not passed:
                failed.append(sample.name)
            rows.append(
                {
                    "name": sample.name,
                    "country": country,
                    "mode": "directory_and_community" if country else "community_only",
                    "radius_km": sample.radius_km,
                    "minimum_directory_pubs": sample.minimum,
                    "directory_pubs": directory_count,
                    "community_pubs": community_count,
                    "passed": passed,
                }
            )

        self.stdout.write(
            json.dumps(
                {"samples": rows, "failed_supported_samples": failed},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        if options["strict"] and failed:
            raise CommandError(f"Coverage below minimum: {', '.join(failed)}")

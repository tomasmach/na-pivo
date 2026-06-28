from __future__ import annotations

import json
import math

from django.core.management.base import BaseCommand
from django.db import transaction

from pubs.models import UserAddedPub
from pubs.user_added_pub_geocoding import resolve_user_added_pub_location

_EARTH_RADIUS_M = 6_371_000.0


def _haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    phi1 = math.radians(a_lat)
    phi2 = math.radians(b_lat)
    d_phi = math.radians(b_lat - a_lat)
    d_lam = math.radians(b_lng - a_lng)
    h = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(h))


class Command(BaseCommand):
    help = (
        "Re-geocode user-added pubs that have an address and move rows whose "
        "stored coordinates are far from the precise address. Defaults to dry-run."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Write changes. Without this flag the command only reports the plan.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Maximum rows to scan. 0 = no limit.",
        )
        parser.add_argument(
            "--min-distance-m",
            type=float,
            default=100.0,
            help="Only update rows whose resolved address is at least this far away.",
        )
        parser.add_argument(
            "--include-inactive",
            action="store_true",
            help="Also scan inactive user-added pubs.",
        )

    def handle(self, *args, **options) -> None:
        apply = bool(options["apply"])
        limit = int(options["limit"] or 0)
        min_distance_m = float(options["min_distance_m"])
        include_inactive = bool(options["include_inactive"])

        queryset = UserAddedPub.objects.exclude(address="").order_by("-updated_at")
        if not include_inactive:
            queryset = queryset.filter(active=True)
        if limit > 0:
            queryset = queryset[:limit]

        scanned = 0
        unresolved = 0
        unchanged = 0
        candidates = []

        with transaction.atomic():
            for pub in queryset:
                scanned += 1
                resolved = resolve_user_added_pub_location(
                    name=pub.name,
                    address=pub.address,
                    city=pub.city,
                    lat=pub.lat,
                    lng=pub.lng,
                )
                if resolved is None:
                    unresolved += 1
                    continue

                distance_m = _haversine_m(pub.lat, pub.lng, resolved.lat, resolved.lng)
                if distance_m < min_distance_m:
                    unchanged += 1
                    continue

                record = {
                    "id": pub.pk,
                    "name": pub.name,
                    "old_cache_key": pub.cache_key,
                    "new_cache_key": resolved.cache_key,
                    "old_lat": pub.lat,
                    "old_lng": pub.lng,
                    "new_lat": resolved.lat,
                    "new_lng": resolved.lng,
                    "distance_m": round(distance_m, 1),
                    "city": pub.city or resolved.city,
                    "address": pub.address or resolved.address,
                    "result_type": resolved.result_type,
                }
                candidates.append(record)

                if apply:
                    pub.cache_key = resolved.cache_key
                    pub.lat = resolved.lat
                    pub.lng = resolved.lng
                    pub.city = pub.city or resolved.city
                    pub.address = pub.address or resolved.address
                    pub.save(
                        update_fields=[
                            "cache_key",
                            "lat",
                            "lng",
                            "city",
                            "address",
                            "updated_at",
                        ]
                    )

            if not apply:
                transaction.set_rollback(True)

        self.stdout.write(
            json.dumps(
                {
                    "dry_run": not apply,
                    "scanned": scanned,
                    "unresolved": unresolved,
                    "unchanged": unchanged,
                    "updates": len(candidates),
                    "records": candidates,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
        )

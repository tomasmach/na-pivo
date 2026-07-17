"""Refresh cached Google coordinates for community-added pubs."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.enrichment import (
    GoogleGeocodingSource,
    GoogleGeocodingUnavailableError,
    geohash8,
)
from pubs.external_api_budget import reserve_external_api_request
from pubs.models import UserAddedPub

logger = logging.getLogger(__name__)

_REFRESH_AFTER_DAYS = 25


class Command(BaseCommand):
    """Refresh Google-derived coordinates before their cache deadline."""

    help = (
        "Refresh active Google-geocoded user-added pubs whose coordinates are "
        "older than 25 days."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--limit",
            type=int,
            default=25,
            help="Maximum rows to refresh in this run. Defaults to 25.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only print rows that would be refreshed.",
        )

    def handle(self, *args, **options) -> None:
        limit = max(0, int(options["limit"]))
        dry_run = bool(options["dry_run"])
        cutoff = timezone.now() - timedelta(days=_REFRESH_AFTER_DAYS)
        queryset = UserAddedPub.objects.filter(
            active=True,
            location_source=UserAddedPub.LocationSource.GOOGLE_GEOCODE,
            location_synced_at__lt=cutoff,
        ).order_by("location_synced_at")[:limit]

        pubs = list(queryset)
        if dry_run:
            for pub in pubs:
                self.stdout.write(
                    f"[dry-run] would refresh pub id={pub.pk} cache_key={pub.cache_key}"
                )
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] Would refresh {len(pubs)} Google pub location(s)."
                )
            )
            return

        if not pubs:
            self.stdout.write(self.style.SUCCESS("No stale Google pub locations found."))
            return

        api_key = getattr(settings, "GOOGLE_MAPS_SERVER_API_KEY", "") or ""
        if not api_key:
            logger.warning("Google pub location refresh stopped: geocoding is not configured.")
            self.stdout.write(
                self.style.WARNING("Stopped: Google Geocoding is not configured.")
            )
            return

        timeout = int(getattr(settings, "GOOGLE_MAPS_TIMEOUT", 8))
        daily_cap = int(getattr(settings, "GOOGLE_MAPS_DAILY_CAP", 250))
        refreshed = 0
        failed = 0

        with GoogleGeocodingSource(
            api_key=api_key,
            timeout=timeout,
            reserve_request=lambda: reserve_external_api_request(
                provider="google_maps",
                operation="billable",
                cap=daily_cap,
            ),
        ) as source:
            for pub in pubs:
                try:
                    if pub.google_place_id:
                        candidate = source.geocode_place_id(pub.google_place_id)
                    else:
                        candidate = source.geocode_address(
                            address=pub.address,
                            city=pub.city,
                        )
                except GoogleGeocodingUnavailableError as exc:
                    logger.warning(
                        "Google pub location refresh stopped for pub id=%s cache_key=%s: %s",
                        pub.pk,
                        pub.cache_key,
                        type(exc).__name__,
                    )
                    self.stdout.write(
                        self.style.WARNING(
                            f"Stopped after {refreshed} refresh(es): Google Geocoding unavailable."
                        )
                    )
                    return

                if candidate is None:
                    failed += 1
                    logger.warning(
                        "Google pub location lookup failed for pub id=%s cache_key=%s.",
                        pub.pk,
                        pub.cache_key,
                    )
                    continue

                pub.lat = candidate.lat
                pub.lng = candidate.lng
                pub.cache_key = geohash8(candidate.lat, candidate.lng)
                if candidate.place_id:
                    pub.google_place_id = candidate.place_id
                pub.location_synced_at = timezone.now()
                pub.save(
                    update_fields=[
                        "lat",
                        "lng",
                        "cache_key",
                        "google_place_id",
                        "location_synced_at",
                        "updated_at",
                    ]
                )
                refreshed += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Refreshed {refreshed} Google pub location(s); "
                f"{failed} lookup(s) left for retry."
            )
        )

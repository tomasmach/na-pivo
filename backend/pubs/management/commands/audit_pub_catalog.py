"""Emit a bounded, machine-readable pub catalog quality report."""

from __future__ import annotations

import json
from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from pubs.enrichment.coverage import coverage_country
from pubs.models import PubDirectory, PubHours, PubReport, UserAddedPub


class Command(BaseCommand):
    help = "Audit pub catalog quality and print a JSON snapshot for trend monitoring."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--stale-days", type=int, default=90)

    def handle(self, *args, **options) -> None:
        limit = max(1, min(int(options["limit"]), 500))
        stale_days = max(1, int(options["stale_days"]))
        now = timezone.now()
        active_directory = PubDirectory.objects.filter(active=True)

        venue_counts = {
            row["venue_kind"]: row["count"]
            for row in active_directory.values("venue_kind")
            .annotate(count=Count("id"))
            .order_by("venue_kind")
        }
        source_counts = {
            row["source"]: row["count"]
            for row in active_directory.values("source")
            .annotate(count=Count("id"))
            .order_by("source")
        }
        report_counts = {
            row["reason"]: row["count"]
            for row in PubReport.objects.filter(active=True)
            .values("reason")
            .annotate(count=Count("id"))
            .order_by("reason")
        }

        suspicious_locations = []
        for row in active_directory.only("id", "name", "lat", "lng", "city", "country").iterator(
            chunk_size=2_000
        ):
            detected_country = coverage_country(row.lat, row.lng)
            if detected_country == row.country.lower():
                continue
            suspicious_locations.append(
                {
                    "kind": "directory_country_mismatch",
                    "id": row.pk,
                    "name": row.name,
                    "city": row.city,
                    "stored_country": row.country.lower(),
                    "detected_country": detected_country,
                }
            )
            if len(suspicious_locations) >= limit:
                break

        remaining = max(0, limit - len(suspicious_locations))
        if remaining:
            for row in UserAddedPub.objects.filter(active=True).only(
                "id", "name", "lat", "lng", "city", "location_source"
            ).iterator(chunk_size=2_000):
                if coverage_country(row.lat, row.lng) is not None:
                    continue
                suspicious_locations.append(
                    {
                        "kind": "community_outside_supported_coverage",
                        "id": row.pk,
                        "name": row.name,
                        "city": row.city,
                        "location_source": row.location_source,
                    }
                )
                if len(suspicious_locations) >= limit:
                    break

        stale_before = now - timedelta(days=stale_days)
        stale_rows = list(
            active_directory.filter(refreshed_at__lt=stale_before)
            .order_by("refreshed_at", "id")
            .values("id", "name", "city", "country", "venue_kind", "refreshed_at")[:limit]
        )
        unresolved_reports = list(
            PubReport.objects.filter(active=True)
            .order_by("-updated_at", "id")
            .values("id", "name", "city", "reason", "cache_key", "updated_at")[:limit]
        )

        active_total = active_directory.count()
        confirmed_total = venue_counts.get(PubHours.VenueKind.PUB, 0)
        maybe_total = venue_counts.get(PubHours.VenueKind.MAYBE, 0)
        usable_share = (
            round((confirmed_total + maybe_total) / active_total, 4) if active_total else 1.0
        )
        priority_counts = Counter()
        priority_counts["active_reports"] = sum(report_counts.values())
        priority_counts["stale_rows"] = active_directory.filter(
            refreshed_at__lt=stale_before
        ).count()
        priority_counts["suspicious_locations"] = len(suspicious_locations)

        snapshot = {
            "captured_at": now.isoformat(),
            "parameters": {"limit": limit, "stale_days": stale_days},
            "metrics": {
                "active_directory_total": active_total,
                "active_user_added_total": UserAddedPub.objects.filter(active=True).count(),
                "usable_venue_share": usable_share,
                "venue_kind_counts": venue_counts,
                "source_counts": source_counts,
                "active_report_counts": report_counts,
                "review_queue_counts": dict(priority_counts),
            },
            "review_queue": {
                "active_reports": unresolved_reports,
                "stale_directory_rows": stale_rows,
                "suspicious_locations": suspicious_locations,
            },
        }
        self.stdout.write(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, default=str))

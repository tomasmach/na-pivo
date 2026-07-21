from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.models import PubDirectory, PubHours, PubReport, UserAddedPub


@pytest.mark.django_db
def test_audit_pub_catalog_emits_metrics_and_prioritized_review_rows(capsys):
    fresh = PubDirectory.objects.create(
        name="Čerstvá hospoda",
        lat=49.1951,
        lng=16.6068,
        city="Brno",
        country="cz",
        venue_kind=PubHours.VenueKind.PUB,
        source="test",
        refreshed_at=timezone.now(),
    )
    stale = PubDirectory.objects.create(
        name="Stará restaurace",
        lat=50.0755,
        lng=14.4378,
        city="Praha",
        country="cz",
        venue_kind=PubHours.VenueKind.MAYBE,
        source="test",
        refreshed_at=timezone.now() - timedelta(days=120),
    )
    PubReport.objects.create(
        cache_key=fresh.cache_key,
        name=fresh.name,
        lat=fresh.lat,
        lng=fresh.lng,
        city=fresh.city,
        reason=PubReport.Reason.NOT_PUB,
    )
    UserAddedPub.objects.create(
        client_id="c51d80bc-e226-432c-b6bc-356bf77a5547",
        name="Hospoda mimo pokrytí",
        cache_key="28rzzzzz",
        lat=28.2916,
        lng=-16.6291,
        city="Tenerife",
    )

    call_command("audit_pub_catalog", "--stale-days", "90")

    body = json.loads(capsys.readouterr().out)
    assert body["metrics"]["active_directory_total"] == 2
    assert body["metrics"]["usable_venue_share"] == 1.0
    assert body["metrics"]["active_report_counts"] == {"not_pub": 1}
    assert body["metrics"]["review_queue_counts"] == {
        "active_reports": 1,
        "stale_rows": 1,
        "suspicious_locations": 1,
    }
    assert body["review_queue"]["active_reports"][0]["name"] == fresh.name
    assert body["review_queue"]["stale_directory_rows"][0]["name"] == stale.name
    assert body["review_queue"]["suspicious_locations"][0]["name"] == "Hospoda mimo pokrytí"

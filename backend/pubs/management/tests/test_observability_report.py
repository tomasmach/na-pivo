from __future__ import annotations

import json
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.models import Account, AccountUsageStats, ClientEvent, FeedbackReport


@pytest.mark.django_db
def test_observability_report_json_output():
    account = Account.objects.create(
        device_id="3f8b1c2e-4d5a-6789-0abc-def012345678",
        token_hash="x" * 64,
    )
    AccountUsageStats.objects.create(
        account=account,
        app_open_count=3,
        walked_distance_m=1250,
        last_app_version="v1.2.0 (42)",
        last_platform="ios",
    )
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.APP_OPEN,
        app_version="v1.2.0 (42)",
        platform="ios",
    )
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.WALKING_DISTANCE,
        context={"distance_m": 250},
    )
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.API_FAILURE,
        severity=ClientEvent.Severity.WARNING,
        context={"operation": "pub_hours", "status": 503},
    )
    FeedbackReport.objects.create(
        account=account,
        client_id="9a7b6c5d-4e3f-4a1b-8c9d-8e7f6a5b4c3d",
        category=FeedbackReport.Category.IDEA,
        message="Prosím odpovězte na user@example.com a přidejte žebříček.",
        app_version="v1.2.0 (42)",
        platform="ios",
    )

    out = StringIO()
    call_command("observability_report", "--days", "7", "--format", "json", stdout=out)

    report = json.loads(out.getvalue())
    assert report["usage"]["app_opens"] == 1
    assert report["usage"]["unique_opening_accounts"] == 1
    assert report["usage"]["walked_distance_m"] == 250
    assert report["all_time"]["app_opens"] == 3
    assert report["top_walkers_all_time"][0]["walked_distance_km"] == 1.25
    assert report["client_health"]["api_failures"] == 1
    assert report["client_health"]["api_failures_by_operation"] == [
        {"operation": "pub_hours", "status": "503", "count": 1}
    ]
    assert report["feedback"]["recent"][0]["message"] == (
        "Prosím odpovězte na [redacted-email] a přidejte žebříček."
    )

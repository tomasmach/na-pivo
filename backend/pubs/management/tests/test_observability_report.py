from __future__ import annotations

import json
import uuid
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.models import Account, AccountUsageStats, ClientEvent, DrinkLog, FeedbackReport


@pytest.mark.django_db
def test_observability_report_json_output(settings):
    settings.DRINK_DAILY_FLAG_CAP = 2
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
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.COUNTER_TAB_OPENED)
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.COUNTER_SESSION_STARTED)
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.DRINK_ADDED)
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.DRINK_REMOVED,
        context={"delivery_state": "queued"},
    )
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.DRINK_SYNCED)
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.DRINK_SYNC_FAILED,
        severity=ClientEvent.Severity.WARNING,
        context={"operation": "submit_drink", "status": 429, "sync_result": "retry"},
    )
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.BEER_FORM_OPENED)
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.BEER_PRICE_ADDED)
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.COUNTER_RETURNED_SAME_DAY)
    ClientEvent.objects.create(account=account, event=ClientEvent.Event.COUNTER_RETURNED_LATER)
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.SCREEN_VIEWED,
        context={"screen": "compass"},
    )
    ClientEvent.objects.create(
        account=account,
        event=ClientEvent.Event.SCREEN_VIEWED,
        context={"screen": "beer", "previous_screen": "compass"},
    )
    FeedbackReport.objects.create(
        account=account,
        client_id="9a7b6c5d-4e3f-4a1b-8c9d-8e7f6a5b4c3d",
        category=FeedbackReport.Category.IDEA,
        message="Prosím odpovězte na user@example.com a přidejte žebříček.",
        app_version="v1.2.0 (42)",
        platform="ios",
    )
    for index in range(2):
        DrinkLog.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            cache_key="u2fkbn1z",
            name="U Zlatého tygra",
            lat=50.0876,
            lng=14.4214,
            beer_name="Pilsner Urquell",
            price_czk=65,
            drank_at=timezone.now(),
            is_suspect=index == 1,
            suspect_reason="burst" if index == 1 else "",
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
    assert report["counter"] == {
        "events": 10,
        "tab_opens": 1,
        "unique_counter_accounts": 1,
        "sessions_started": 1,
        "drinks_added": 1,
        "drinks_removed": 1,
        "drinks_synced": 1,
        "drink_sync_failures": 1,
        "beer_forms_opened": 1,
        "beer_prices_added": 1,
        "returns_same_day": 1,
        "returns_later": 1,
        "drink_sync_failures_by_operation": [
            {
                "operation": "submit_drink",
                "status": "429",
                "sync_result": "retry",
                "count": 1,
            }
        ],
    }
    assert report["product"] == {
        "screen_views": 2,
        "unique_viewing_accounts": 1,
        "screens": [
            {"screen": "beer", "views": 1, "unique_accounts": 1},
            {"screen": "compass", "views": 1, "unique_accounts": 1},
        ],
    }
    assert report["client_health"]["api_failures_by_operation"] == [
        {"operation": "pub_hours", "status": "503", "count": 1}
    ]
    assert report["abuse"] == {
        "drinks_created": 2,
        "flagged": 1,
        "flagged_by_reason": [{"suspect_reason": "burst", "count": 1}],
        "top_accounts_by_daily_drinks": [
            {"account_id": account.id, "nickname": "", "count": 2}
        ],
    }
    assert report["feedback"]["recent"][0]["message"] == (
        "Prosím odpovězte na [redacted-email] a přidejte žebříček."
    )

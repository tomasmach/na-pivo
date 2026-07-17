from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, AccountUsageStats, ClientEvent

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.mark.django_db
def test_client_event_can_be_recorded_without_account(client):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": "app_open",
            "severity": "info",
            "app_version": "v1.2.0 (42)",
            "platform": "ios",
            "os_version": "18.1",
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.account is None
    assert event.event == ClientEvent.Event.APP_OPEN
    assert AccountUsageStats.objects.count() == 0


@pytest.mark.django_db
def test_authenticated_client_events_update_usage_stats(client):
    token = _register(client)
    account = Account.objects.get(device_id=_DEVICE_ID)

    opened = client.post(
        "/v1/client-events",
        data={
            "event": "app_open",
            "severity": "info",
            "app_version": "v1.2.0 (42)",
            "platform": "ios",
            "os_version": "18.1",
        },
        format="json",
        **_auth(token),
    )
    distance = client.post(
        "/v1/client-events",
        data={
            "event": "walking_distance",
            "severity": "info",
            "context": {"distance_m": 375},
            "app_version": "v1.2.0 (42)",
            "platform": "ios",
        },
        format="json",
        **_auth(token),
    )
    failed_api = client.post(
        "/v1/client-events",
        data={
            "event": "api_failure",
            "severity": "warning",
            "context": {"operation": "pub_hours", "status": 503},
            "platform": "ios",
        },
        format="json",
        **_auth(token),
    )

    assert opened.status_code == status.HTTP_202_ACCEPTED
    assert distance.status_code == status.HTTP_202_ACCEPTED
    assert failed_api.status_code == status.HTTP_202_ACCEPTED

    stats_row = AccountUsageStats.objects.get(account=account)
    assert stats_row.app_open_count == 1
    assert stats_row.walked_distance_m == 375
    assert stats_row.api_failure_count == 1
    assert stats_row.client_warning_count == 1
    assert stats_row.last_app_version == "v1.2.0 (42)"
    assert stats_row.last_platform == "ios"


@pytest.mark.django_db
def test_client_event_payload_is_sanitized(client):
    token = _register(client)
    raw_uuid = "11111111-2222-4333-8444-555555555555"
    resp = client.post(
        "/v1/client-events",
        data={
            "event": "console_error",
            "severity": "error",
            "message": f"Bearer super-secret-token user@example.com {raw_uuid}",
            "context": {
                "endpoint": "/v1/pub-hours?lat=50.1&lng=14.4",
                "distance_m": 999_999,
                "authorization": "Bearer should-not-store",
                "lat": 50.1,
                "error_message": "Failed for user@example.com",
            },
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert "super-secret-token" not in event.message
    assert "user@example.com" not in event.message
    assert raw_uuid not in event.message
    assert event.message == "Bearer [redacted] [redacted-email] [redacted-uuid]"
    assert event.context == {
        "endpoint": "/v1/pub-hours",
        "distance_m": 50_000,
        "error_message": "Failed for [redacted-email]",
    }

    stats_row = AccountUsageStats.objects.get()
    assert stats_row.client_error_count == 1
    assert stats_row.walked_distance_m == 0


@pytest.mark.django_db
def test_counter_product_events_are_accepted_and_sanitized(client):
    token = _register(client)

    resp = client.post(
        "/v1/client-events",
        data={
            "event": "drink_sync_failed",
            "severity": "warning",
            "context": {
                "operation": "submit_drink",
                "status": 429,
                "sync_result": "retry",
                "retryable": True,
                "mode": "add",
                "delivery_state": "queued",
                "return_days": 2.4,
                "had_active_session": False,
                "pub_name": "U Zlatého tygra",
                "beer_name": "Plzeň",
                "lat": 50.0876,
                "lng": 14.4214,
            },
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.event == ClientEvent.Event.DRINK_SYNC_FAILED
    assert event.context == {
        "operation": "submit_drink",
        "status": 429,
        "sync_result": "retry",
        "retryable": True,
        "mode": "add",
        "delivery_state": "queued",
        "return_days": 2,
        "had_active_session": False,
    }

    stats_row = AccountUsageStats.objects.get()
    assert stats_row.client_warning_count == 1


@pytest.mark.django_db
@pytest.mark.parametrize("event_name", ["counter_session_closed", "counter_session_resumed"])
def test_counter_session_lifecycle_events_are_accepted(client, event_name):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": event_name,
            "severity": "info",
            "context": {
                "reason": "manual",
                "pub_name": "U Zlatého tygra",
                "lat": 50.0876,
                "lng": 14.4214,
            },
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.event == event_name
    assert event.context == {"reason": "manual"}


@pytest.mark.django_db
def test_beer_form_scan_opened_event_is_accepted(client):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": "beer_form_scan_opened",
            "severity": "info",
            "context": {"source": "counter_add_beer_form"},
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.event == ClientEvent.Event.BEER_FORM_SCAN_OPENED
    assert event.context == {"source": "counter_add_beer_form"}


@pytest.mark.django_db
def test_leaderboards_opened_event_is_accepted(client):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": "leaderboards_opened",
            "severity": "info",
            "context": {"category": "beers", "period": "week"},
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.event == ClientEvent.Event.LEADERBOARDS_OPENED
    assert event.context == {}


@pytest.mark.django_db
def test_onboarding_event_is_accepted_with_slide_context(client):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": "onboarding_started",
            "severity": "info",
            "context": {"slide": 2},
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.event == ClientEvent.Event.ONBOARDING_STARTED
    assert event.context == {"slide": 2}


@pytest.mark.django_db
def test_onboarding_auth_opened_event_is_accepted_with_slide_context(client):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": "onboarding_auth_opened",
            "severity": "info",
            "context": {"slide": 2},
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    event = ClientEvent.objects.get()
    assert event.event == ClientEvent.Event.ONBOARDING_AUTH_OPENED
    assert event.context == {"slide": 2}


@pytest.mark.django_db
@pytest.mark.parametrize(
    "event_name",
    ["rating_synced", "rating_sync_failed", "visit_synced", "visit_sync_failed"],
)
def test_rating_and_visit_sync_events_are_accepted(client, event_name):
    resp = client.post(
        "/v1/client-events",
        data={
            "event": event_name,
            "severity": "warning" if event_name.endswith("_failed") else "info",
            "context": {"operation": "sync", "sync_result": "retry"},
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED
    assert ClientEvent.objects.get().event == event_name


@pytest.mark.django_db
def test_client_event_rejects_unknown_event(client):
    resp = client.post(
        "/v1/client-events",
        data={"event": "raw_payload_dump", "severity": "info"},
        format="json",
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert ClientEvent.objects.count() == 0


@pytest.mark.django_db
def test_request_logging_middleware_sets_request_id_header(client):
    resp = client.get("/v1/health", HTTP_X_REQUEST_ID="test-request-123")

    assert resp.status_code == status.HTTP_200_OK
    assert resp["X-Request-ID"] == "test-request-123"

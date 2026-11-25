from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from pubs.models import Account, ClientEvent

_TOKEN = "ops-test-token"
# Prague midnight of 2026-11-05 (CET, UTC+1) is 2026-11-04 23:00 UTC.
_NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
_BEFORE_MIDNIGHT = datetime(2026, 11, 4, 22, 59, 59, tzinfo=UTC)
_AFTER_MIDNIGHT = datetime(2026, 11, 4, 23, 0, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _ops_token(settings):
    settings.OPS_LIVE_TOKEN = _TOKEN


def _get(token: str | None = _TOKEN):
    client = APIClient()
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token is not None else {}
    with patch("pubs.api.ops_views.timezone.now", return_value=_NOW):
        return client.get("/v1/ops/live", **headers)


def _account(created_at: datetime) -> Account:
    account = Account.objects.create(device_id=str(uuid.uuid4()), nickname=f"n{uuid.uuid4().hex[:8]}")
    Account.objects.filter(pk=account.pk).update(created_at=created_at)
    return account


def _event(account: Account | None, event: str, created_at: datetime) -> None:
    row = ClientEvent.objects.create(account=account, event=event)
    ClientEvent.objects.filter(pk=row.pk).update(created_at=created_at)


@pytest.mark.django_db
@pytest.mark.parametrize("token", [None, "wrong", ""])
def test_rejects_missing_or_wrong_token(token):
    _account(_AFTER_MIDNIGHT)
    response = _get(token)
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


@pytest.mark.django_db
def test_unconfigured_token_hides_endpoint(settings):
    settings.OPS_LIVE_TOKEN = ""
    assert _get("").status_code == 404
    assert _get("anything").status_code == 404


@pytest.mark.django_db
def test_rejects_account_session_token():
    client = APIClient()
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert _get(resp.json()["token"]).status_code == 401


@pytest.mark.django_db
def test_counts_today_from_prague_midnight_without_personal_data():
    yesterday = _account(_BEFORE_MIDNIGHT)
    today = _account(_AFTER_MIDNIGHT)
    resumed = _account(_BEFORE_MIDNIGHT)
    _event(yesterday, "app_open", _BEFORE_MIDNIGHT)
    _event(today, "app_open", _AFTER_MIDNIGHT)
    _event(today, "app_open", _NOW)
    _event(resumed, "app_foreground", _NOW)
    _event(yesterday, "screen_viewed", _NOW)
    _event(None, "app_open", _NOW)

    response = _get()

    assert response.status_code == 200
    assert response.json() == {
        "registrations_today": 1,
        "active_today": 2,
        "registrations_total": 3,
        "last_registration_at": "2026-11-04T23:00:00+00:00",
    }


@pytest.mark.django_db
def test_empty_database():
    assert _get().json() == {
        "registrations_today": 0,
        "active_today": 0,
        "registrations_total": 0,
        "last_registration_at": None,
    }

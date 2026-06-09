"""
Tests for the anonymous device-bound account endpoints (AccountView + AccountMeView).

All tests use pytest-django with APIClient.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.models import Account

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # AccountView is per-IP throttled (scope "account") and DRF stores the
    # request history in the default cache. Clear it around every test so the
    # shared 127.0.0.1 counter never bleeds across tests as this file grows.
    cache.clear()
    yield
    cache.clear()


# ---------------------------------------------------------------------------
# POST /v1/account — registration
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_register_creates_account(client):
    resp = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["id"]
    assert body["device_id"] == _DEVICE_ID
    assert body["token"]
    assert body["created"] is True
    assert body["created_at"]

    assert Account.objects.count() == 1


@pytest.mark.django_db
def test_register_is_idempotent(client):
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert second.status_code == status.HTTP_200_OK

    first_body = first.json()
    second_body = second.json()
    assert second_body["created"] is False
    # Idempotent on the ACCOUNT (same row), not on the token: re-registration
    # returns the same id but rotates the token (the old raw value is unrecoverable
    # from its stored hash). See test_reregistration_rotates_token.
    assert second_body["id"] == first_body["id"]

    assert Account.objects.count() == 1


@pytest.mark.django_db
def test_reregistration_rotates_token(client):
    """Re-POSTing a known device_id issues a new token and invalidates the old one."""
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    second = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")

    first_token = first.json()["token"]
    second_token = second.json()["token"]
    assert first_token != second_token

    # The old token no longer authenticates; the new one does.
    old = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {first_token}")
    assert old.status_code == status.HTTP_401_UNAUTHORIZED
    new = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {second_token}")
    assert new.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_token_is_stored_hashed(client):
    """The DB stores only the SHA-256 of the token, never the raw bearer secret."""
    resp = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    raw_token = resp.json()["token"]

    account = Account.objects.get(device_id=_DEVICE_ID)
    expected = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    assert account.token_hash == expected
    assert account.token_hash != raw_token


@pytest.mark.django_db
def test_register_missing_device_id_returns_400(client):
    resp = client.post("/v1/account", data={}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_register_blank_device_id_returns_400(client):
    resp_empty = client.post("/v1/account", data={"device_id": ""}, format="json")
    assert resp_empty.status_code == status.HTTP_400_BAD_REQUEST

    resp_whitespace = client.post("/v1/account", data={"device_id": "   "}, format="json")
    assert resp_whitespace.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_tokens_are_unique_per_device(client):
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    second = client.post("/v1/account", data={"device_id": _OTHER_DEVICE_ID}, format="json")

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_201_CREATED

    first_body = first.json()
    second_body = second.json()
    assert first_body["token"] != second_body["token"]
    assert first_body["id"] != second_body["id"]


# ---------------------------------------------------------------------------
# GET /v1/account/me — token-authenticated lookup
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_me_returns_account_for_valid_token(client):
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    register_body = register.json()
    token = register_body["token"]

    resp = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {token}")

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["id"] == register_body["id"]
    assert body["device_id"] == _DEVICE_ID
    assert "token" not in body


@pytest.mark.django_db
def test_me_with_invalid_token_returns_401(client):
    resp = client.get("/v1/account/me", HTTP_AUTHORIZATION="Bearer not-a-real-token")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_me_without_token_returns_401(client):
    resp = client.get("/v1/account/me")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# device_id validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_register_invalid_device_id_returns_400(client):
    """A non-UUID device_id is rejected (narrows the account-creation key space)."""
    resp = client.post("/v1/account", data={"device_id": "not-a-uuid"}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert Account.objects.count() == 0


@pytest.mark.django_db
def test_register_canonicalizes_device_id(client):
    """Non-canonical spellings of one UUID resolve to a SINGLE account.

    Regression guard for the idempotency bug where validate_device_id returned
    the raw input instead of str(uuid.UUID(...)): an uppercase (or braced / urn:
    / dash-less) device_id was stored verbatim, so re-POSTing the canonical form
    of the same id missed the UNIQUE row and created a duplicate account.
    """
    uppercase = _DEVICE_ID.upper()

    first = client.post("/v1/account", data={"device_id": uppercase}, format="json")
    assert first.status_code == status.HTTP_201_CREATED
    # Stored/echoed in canonical lowercase form, NOT the uppercase input.
    assert first.json()["device_id"] == _DEVICE_ID

    # Re-POST the canonical form: same logical id → recovered, not duplicated.
    second = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert second.status_code == status.HTTP_200_OK
    assert second.json()["id"] == first.json()["id"]
    assert Account.objects.count() == 1


# ---------------------------------------------------------------------------
# last_seen_at is touched on re-registration
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_register_advances_last_seen_at(client):
    """Re-POSTing a known device_id advances last_seen_at but preserves created_at/id/token."""
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert register.status_code == status.HTTP_201_CREATED

    account = Account.objects.get(device_id=_DEVICE_ID)
    created_before = account.created_at
    # Force last_seen_at into the past via .update() (bypasses auto_now) so the
    # re-POST's touch is observable regardless of clock granularity.
    past = created_before - timedelta(days=1)
    Account.objects.filter(pk=account.pk).update(last_seen_at=past)

    second = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert second.status_code == status.HTTP_200_OK

    account.refresh_from_db()
    assert account.last_seen_at > past  # touch advanced it
    assert account.created_at == created_before  # created_at untouched


# ---------------------------------------------------------------------------
# Rate limiting (scope "account")
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_account_register_is_throttled(client, monkeypatch):
    """A burst of registrations beyond the per-IP rate is rejected with 429.

    The rate is monkeypatched rather than set via @override_settings because DRF
    binds SimpleRateThrottle.THROTTLE_RATES at import time, so override_settings
    does NOT affect it (a well-known DRF testing gotcha).
    """
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"account": "3/min"})

    for i in range(3):
        resp = client.post(
            "/v1/account",
            data={"device_id": f"00000000-0000-4000-8000-00000000000{i}"},
            format="json",
        )
        assert resp.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)

    throttled = client.post(
        "/v1/account",
        data={"device_id": "00000000-0000-4000-8000-000000000009"},
        format="json",
    )
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS

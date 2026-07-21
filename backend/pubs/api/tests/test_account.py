"""
Tests for the anonymous device-bound account endpoints (AccountView + AccountMeView).

All tests use pytest-django with APIClient.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

import pubs.accounts as accounts
from pubs.api.serializers import AccountMeSerializer
from pubs.models import (
    Account,
    AuthIdentity,
    AuthToken,
    DrinkLog,
    EmailCredential,
    Friendship,
    PubVisit,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11111111-2222-3333-4444-555555555555"
_PRAGUE = ZoneInfo("Europe/Prague")


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
    assert body["hide_pub_names"] is False
    assert body["created"] is True
    assert body["created_at"]

    assert Account.objects.count() == 1


@pytest.mark.django_db
def test_register_rolls_back_new_account_when_token_issue_fails(client, monkeypatch):
    def fail_issue_token(*_args, **_kwargs):
        raise RuntimeError("forced token issue failure")

    monkeypatch.setattr(accounts, "issue_token", fail_issue_token)
    resp = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")

    assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert not Account.objects.filter(device_id=_DEVICE_ID).exists()


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _drink(account: Account, *, index: int, drank_at=None) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=f"drink-{index % 30}",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        city="Praha",
        external_id="mapy:test",
        beer_name=f"Pivo {index}",
        beer_product_key=f"product-{index % 10}",
        price_czk=65,
        drank_at=drank_at or timezone.now(),
    )


def _visit(account: Account, *, cache_key: str, started_at=None) -> PubVisit:
    return PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        city="Praha",
        external_id="mapy:test",
        started_at=started_at or timezone.now(),
        client_updated_at=started_at or timezone.now(),
    )


@pytest.mark.django_db
def test_register_is_idempotent(client):
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {first.json()['token']}",
    )
    assert second.status_code == status.HTTP_200_OK

    first_body = first.json()
    second_body = second.json()
    assert second_body["created"] is False
    # Idempotent on the ACCOUNT (same row), not on the token: authenticated
    # re-registration returns the same id but rotates the token.
    assert second_body["id"] == first_body["id"]

    assert Account.objects.count() == 1


@pytest.mark.django_db
def test_authenticated_reregistration_keeps_old_token_for_lost_response_retry(client):
    """A lost rotation response can be retried with the previously valid token."""
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    first_token = first.json()["token"]
    second = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {first_token}",
    )
    second_token = second.json()["token"]
    assert first_token != second_token

    # Both tokens authenticate until a later successful rotation prunes stale
    # device tokens. This lets a client retry when it never received the response.
    old = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {first_token}")
    assert old.status_code == status.HTTP_200_OK
    new = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {second_token}")
    assert new.status_code == status.HTTP_200_OK

    retry = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {first_token}",
    )
    assert retry.status_code == status.HTTP_200_OK
    assert retry.json()["token"] not in {first_token, second_token}


@pytest.mark.django_db
def test_reregistration_without_bearer_does_not_rotate_token(client):
    """A known device_id with any token cannot recover without a bearer."""
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert first.status_code == status.HTTP_201_CREATED
    token = first.json()["token"]
    original_hash = AuthToken.objects.get(account__device_id=_DEVICE_ID).token_hash

    second = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")

    assert second.status_code == status.HTTP_401_UNAUTHORIZED
    assert "token" not in second.json()
    assert AuthToken.objects.get(account__device_id=_DEVICE_ID).token_hash == original_hash
    resp = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert resp.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_existing_zero_token_account_recovers_without_bearer(client, monkeypatch):
    account = Account.objects.create(device_id=_DEVICE_ID)
    logged: dict = {}

    def capture_recovery(_message, *, extra):
        logged.update(extra)

    monkeypatch.setattr("pubs.api.views.auth_logger.warning", capture_recovery)
    resp = client.post(
        "/v1/account", data={"device_id": _DEVICE_ID}, format="json"
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["id"] == str(account.public_id)
    assert resp.json()["created"] is False
    assert resp.json()["token"]
    token = AuthToken.objects.get(account=account)
    assert token.kind == AuthToken.Kind.DEVICE
    assert logged["event"] == "account_bootstrap_recovered"
    assert logged["observability"]["reason"] == "zero_tokens"


@pytest.mark.django_db
def test_reregistration_with_invalid_bearer_does_not_rotate_token(client):
    """A stale or unknown Bearer token cannot recover a known device account."""
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert first.status_code == status.HTTP_201_CREATED
    token = first.json()["token"]
    original_hash = AuthToken.objects.get(account__device_id=_DEVICE_ID).token_hash

    resp = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION="Bearer not-a-real-token",
    )

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert resp.json() == {"detail": "Invalid account token."}
    assert "token" not in resp.json()
    assert AuthToken.objects.get(account__device_id=_DEVICE_ID).token_hash == original_hash
    me = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert me.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_new_device_with_invalid_bearer_still_bootstraps(client):
    """A garbage optional bearer cannot block first-time device bootstrap."""
    resp = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION="Bearer not-a-real-token",
    )

    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["created"] is True
    assert resp.json()["token"]


@pytest.mark.django_db
def test_reregistration_with_other_account_token_does_not_rotate_token(client):
    first = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    other = client.post("/v1/account", data={"device_id": _OTHER_DEVICE_ID}, format="json")
    assert first.status_code == status.HTTP_201_CREATED
    assert other.status_code == status.HTTP_201_CREATED

    token = first.json()["token"]
    original_hash = AuthToken.objects.get(account__device_id=_DEVICE_ID).token_hash

    resp = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {other.json()['token']}",
    )

    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert "token" not in resp.json()
    assert AuthToken.objects.get(account__device_id=_DEVICE_ID).token_hash == original_hash
    me = client.get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert me.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_token_is_stored_hashed(client):
    """The DB stores only the SHA-256 of the token, never the raw bearer secret.

    Tokens now live in AuthToken (kind="device" for the bootstrap path); the
    legacy Account.token_hash column is unused (NULL) for new accounts.
    """
    resp = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    raw_token = resp.json()["token"]

    account = Account.objects.get(device_id=_DEVICE_ID)
    expected = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    auth_token = AuthToken.objects.get(account=account)
    assert auth_token.token_hash == expected
    assert auth_token.token_hash != raw_token
    assert auth_token.kind == AuthToken.Kind.DEVICE
    # The raw secret is never persisted anywhere, including the legacy column.
    assert account.token_hash is None


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
    assert body["hide_pub_names"] is False
    assert "token" not in body


@pytest.mark.django_db
def test_new_account_achievement_badges_default_false(client):
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    token = register.json()["token"]

    resp = client.get("/v1/account/me", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    achievements = resp.json()["achievements"]
    for key in (
        "first_beer",
        "century",
        "pilgrim",
        "stamgast",
        "night_owl",
        "taster",
        "party_animal",
    ):
        assert achievements[key] is False


@pytest.mark.django_db
def test_new_account_achievement_badges_unlock_from_existing_data(client):
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    token = register.json()["token"]
    account = Account.objects.get(device_id=_DEVICE_ID)
    night_beer_at = datetime(2026, 7, 7, 1, 30, tzinfo=_PRAGUE)
    _drink(account, index=0, drank_at=night_beer_at)
    for index in range(1, 100):
        _drink(account, index=index)
    for _ in range(10):
        _visit(account, cache_key="home")
    for index in range(24):
        _visit(account, cache_key=f"pub-{index}")
    for index in range(5):
        friend = Account.objects.create(device_id=f"friend-{index}", nickname=f"f{index}")
        Friendship.objects.create(
            requester=account,
            recipient=friend,
            status=Friendship.Status.ACCEPTED,
            responded_at=timezone.now(),
        )

    resp = client.get("/v1/account/me", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    achievements = resp.json()["achievements"]
    for key in (
        "first_beer",
        "century",
        "pilgrim",
        "stamgast",
        "night_owl",
        "taster",
        "party_animal",
    ):
        assert achievements[key] is True


@pytest.mark.django_db
def test_account_me_serializer_reuses_auth_snapshot(django_assert_num_queries):
    account = Account.objects.create(device_id="auth-snapshot-device")
    EmailCredential.objects.create(
        account=account,
        email="snapshot@example.com",
        password="x",
        email_verified=True,
    )
    AuthIdentity.objects.create(
        account=account,
        provider=AuthIdentity.Provider.GOOGLE,
        subject="google-sub",
        email="google@example.com",
    )
    AuthIdentity.objects.create(
        account=account,
        provider=AuthIdentity.Provider.APPLE,
        subject="apple-sub",
        email="apple@example.com",
    )

    serializer = AccountMeSerializer()
    fresh_account = Account.objects.get(pk=account.pk)

    with django_assert_num_queries(2):
        assert serializer.get_email(fresh_account) == "snapshot@example.com"
        assert serializer.get_email_verified(fresh_account) is True
        assert serializer.get_is_anonymous(fresh_account) is False
        assert serializer.get_providers(fresh_account) == ["email", "google", "apple"]


@pytest.mark.django_db
def test_me_with_invalid_token_returns_401(client):
    resp = client.get("/v1/account/me", HTTP_AUTHORIZATION="Bearer not-a-real-token")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_me_without_token_returns_401(client):
    resp = client.get("/v1/account/me")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_patch_me_updates_hide_pub_names_preference(client):
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    token = register.json()["token"]

    resp = client.patch(
        "/v1/account/me",
        data={"hide_pub_names": True},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["hide_pub_names"] is True

    account = Account.objects.get(device_id=_DEVICE_ID)
    assert account.hide_pub_names is True


@pytest.mark.django_db
def test_patch_me_rejects_invalid_hide_pub_names(client):
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    token = register.json()["token"]

    resp = client.patch(
        "/v1/account/me",
        data={"hide_pub_names": "not-a-bool"},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST


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

    # Re-POST the canonical form with the current token: same logical id →
    # recovered, not duplicated.
    second = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {first.json()['token']}",
    )
    assert second.status_code == status.HTTP_200_OK
    assert second.json()["id"] == first.json()["id"]
    assert Account.objects.count() == 1


# ---------------------------------------------------------------------------
# last_seen_at is touched on re-registration
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_register_advances_last_seen_at(client):
    """Authenticated re-POST advances last_seen_at but preserves created_at/id."""
    register = client.post("/v1/account", data={"device_id": _DEVICE_ID}, format="json")
    assert register.status_code == status.HTTP_201_CREATED
    token = register.json()["token"]

    account = Account.objects.get(device_id=_DEVICE_ID)
    created_before = account.created_at
    # Force last_seen_at into the past via .update() (bypasses auto_now) so the
    # re-POST's touch is observable regardless of clock granularity.
    past = created_before - timedelta(days=1)
    Account.objects.filter(pk=account.pk).update(last_seen_at=past)

    second = client.post(
        "/v1/account",
        data={"device_id": _DEVICE_ID},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
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

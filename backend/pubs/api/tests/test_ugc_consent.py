"""Contract tests for versioned UGC consent (RED — endpoint not implemented yet).

Covers the /v1/account/me ``ugc_consent`` block (additive field on the existing
``me`` payload), the PUT /v1/account/me/ugc-consent acceptance flow (including
stale-policy rejection and idempotent re-acceptance) and the presence of the
acceptance proof in /v1/account/export.

The current policy version is ``2026-08-22``. Human-facing response details are
intentionally not asserted.
"""

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

CURRENT_POLICY_VERSION = "2026-08-22"
STALE_POLICY_VERSION = "2026-01-01"

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # Account endpoints are scope-throttled on a per-IP/per-account counter in
    # the default (LocMem) cache; clear it around every test so counters never
    # bleed across tests.
    cache.clear()
    yield
    cache.clear()


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _register_anonymous(client) -> tuple[str, str]:
    """Create an anonymous device account; return (raw bearer token, public id)."""
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], body["id"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_fresh_account_me_contains_additive_ugc_consent_block(client):
    token, _ = _register_anonymous(client)

    resp = client.get("/v1/account/me", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    me = resp.json()
    assert me["ugc_consent"] == {
        "policy_version": CURRENT_POLICY_VERSION,
        "accepted": False,
        "accepted_version": "",
        "accepted_at": None,
    }


def test_accept_current_policy_is_idempotent_and_persists_proof(client):
    from pubs.models import Account

    token, account_public_id = _register_anonymous(client)

    first = client.put(
        "/v1/account/me/ugc-consent",
        data={"version": CURRENT_POLICY_VERSION},
        format="json",
        **_auth(token),
    )

    assert first.status_code == status.HTTP_200_OK, first.content
    consent = first.json()["ugc_consent"]
    assert consent["accepted"] is True
    assert consent["policy_version"] == CURRENT_POLICY_VERSION
    assert consent["accepted_version"] == CURRENT_POLICY_VERSION
    assert consent["accepted_at"] is not None

    account = Account.objects.get(public_id=account_public_id)
    assert account.ugc_terms_version == CURRENT_POLICY_VERSION
    assert account.ugc_terms_accepted_at is not None

    repeat = client.put(
        "/v1/account/me/ugc-consent",
        data={"version": CURRENT_POLICY_VERSION},
        format="json",
        **_auth(token),
    )
    assert repeat.status_code == status.HTTP_200_OK, repeat.content
    repeated_consent = repeat.json()["ugc_consent"]
    assert repeated_consent["accepted_at"] == consent["accepted_at"]

    account.refresh_from_db()
    assert account.ugc_terms_accepted_at is not None


def test_stale_policy_version_rejected_without_storing_proof(client):
    token, _ = _register_anonymous(client)

    resp = client.put(
        "/v1/account/me/ugc-consent",
        data={"version": STALE_POLICY_VERSION},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "ugc_policy_update_required"

    me = client.get("/v1/account/me", **_auth(token)).json()
    assert me["ugc_consent"]["accepted"] is False
    assert me["ugc_consent"]["accepted_version"] == ""
    assert me["ugc_consent"]["accepted_at"] is None


def test_accepted_proof_appears_in_account_export(client):
    token, _ = _register_anonymous(client)

    accepted = client.put(
        "/v1/account/me/ugc-consent",
        data={"version": CURRENT_POLICY_VERSION},
        format="json",
        **_auth(token),
    )
    assert accepted.status_code == status.HTTP_200_OK, accepted.content
    accepted_at = accepted.json()["ugc_consent"]["accepted_at"]

    export_resp = client.get("/v1/account/export", **_auth(token))

    assert export_resp.status_code == status.HTTP_200_OK
    account_export = export_resp.json()["account"]
    assert account_export["ugc_terms_version"] == CURRENT_POLICY_VERSION
    assert account_export["ugc_terms_accepted_at"] == accepted_at

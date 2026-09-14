"""
RED tests for quorum trust on the auth surface (Phase A).

Contract under test, end-to-end through /v1 endpoints:

- Claiming with an UNVERIFIED email and PLAIN LOGIN never set trust.
- A successful email verification sets ``quorum_trusted_at`` exactly once,
  atomically (the frozen "now" of the request).
- A successful password-reset proof sets it the same way; a failed reset
  never does.
- Cryptographically verified Google/Apple resolution or link onto an anonymous
  account sets it once — the verified provider SUBJECT is the proof, so this
  holds even when the claims carry no email or an unverified one; any
  provider/signature/audience/issuer/expiry failure answers exactly
  401 ``oauth_failed`` and never sets it, and a mid-transaction crash must roll
  the stamp back so nothing persists.
- An anonymous-source merge never transfers trust; a SUSPICIOUS unclaimed
  source that already carries trust aborts the whole merge.
- auth/me and the public friend profile never expose the timestamp; GET
  /v1/account/export includes it additively.

OAuth is mocked at the ``pubs.oauth`` boundary and transactional emails at
``pubs.emailer``, same as test_auth.py. Time is frozen by monkeypatching
``django.utils.timezone.now`` — no new dependency. Old response assertions are
kept intact: export must still carry every pre-existing account key.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.test import APIClient

import pubs.accounts as accounts
import pubs.emailer as emailer
import pubs.oauth as oauth
from pubs.models import Account, AuthIdentity, DrinkLog
from pubs.tests.test_community_trust import community_trust

# ---------------------------------------------------------------------------
# Fixtures + helpers (mirroring test_auth.py conventions)
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def fake_oauth(monkeypatch):
    """Happy-path OAuth verifiers parsing "<provider>:<sub>:<email>" tokens."""

    def fake_google(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    def fake_apple(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    monkeypatch.setattr(oauth, "verify_google_id_token", fake_google)
    monkeypatch.setattr(oauth, "verify_apple_identity_token", fake_apple)
    monkeypatch.setattr(oauth, "exchange_apple_auth_code", lambda code: {"refresh_token": "rt_test"})
    monkeypatch.setattr(oauth, "revoke_apple_token", lambda token, token_type_hint="": None)


@pytest.fixture
def sent_emails(monkeypatch):
    sent: list[dict] = []

    def make_recorder(tag: str):
        def recorder(to, **kwargs):
            sent.append({"tag": tag, "to": to, **kwargs})
            return True

        return recorder

    monkeypatch.setattr(emailer, "send_verification_email", make_recorder("verify"))
    monkeypatch.setattr(emailer, "send_password_reset_email", make_recorder("reset"))
    return sent


def _freeze_now(monkeypatch, moment=None):
    moment = moment or dj_timezone.now()
    monkeypatch.setattr(dj_timezone, "now", lambda: moment)
    return moment


def _bootstrap_anon(client) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], Account.objects.get(public_id=body["id"])


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _register_account(client, email: str, password: str = "Tr0ub4dor&3") -> tuple[str, Account]:
    resp = client.post(
        "/v1/auth/register",
        data={"email": email, "password": password},
        format="json",
    )
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], Account.objects.get(public_id=body["id"])


def _verify_code(sent_emails, tag: str) -> str:
    for record in reversed(sent_emails):
        if record["tag"] == tag:
            return record["code"]
    raise AssertionError(f"no {tag} email captured in {sent_emails!r}")


def _assert_key_absent(payload, key: str) -> None:
    """Recursively assert no object anywhere in the payload exposes ``key``."""

    def walk(node):
        if isinstance(node, dict):
            assert key not in node, f"{key} leaked into response payload"
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)


# ---------------------------------------------------------------------------
# No proof → no trust
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_unverified_registration_and_plain_login_never_set_trust(client):
    _token, account = _register_account(client, "untrusted-plain@x.cz")
    assert account.quorum_trusted_at is None

    # Plain login with the correct password proves nothing beyond the claim.
    login = client.post(
        "/v1/auth/login",
        data={"email": "untrusted-plain@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK, login.content
    account.refresh_from_db()
    assert account.quorum_trusted_at is None


# ---------------------------------------------------------------------------
# Email verification proof
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_successful_email_verification_sets_trust_exactly_once(
    client, sent_emails, monkeypatch
):
    frozen_now = _freeze_now(monkeypatch)
    token, account = _register_account(client, "verify-trust@x.cz")

    requested = client.post("/v1/auth/request-email-verify", format="json", **_auth(token))
    assert requested.status_code == status.HTTP_202_ACCEPTED, requested.content

    code = _verify_code(sent_emails, "verify")
    verified = client.post("/v1/auth/verify-email", data={"token": code}, format="json")
    assert verified.status_code == status.HTTP_200_OK, verified.content

    account.refresh_from_db()
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_replayed_email_verification_cannot_advance_trust(
    client, sent_emails, monkeypatch
):
    first_now = _freeze_now(monkeypatch)
    token, account = _register_account(client, "verify-once@x.cz")
    client.post("/v1/auth/request-email-verify", format="json", **_auth(token))
    code = _verify_code(sent_emails, "verify")

    first = client.post("/v1/auth/verify-email", data={"token": code}, format="json")
    assert first.status_code == status.HTTP_200_OK, first.content

    # The one-time token is burned; even an attempt six hours later may not
    # move the original stamp.
    _freeze_now(monkeypatch, first_now + timedelta(hours=6))
    replay = client.post("/v1/auth/verify-email", data={"token": code}, format="json")
    assert replay.status_code >= status.HTTP_400_BAD_REQUEST, replay.content

    account.refresh_from_db()
    assert account.quorum_trusted_at == first_now


# ---------------------------------------------------------------------------
# Password reset proof
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_successful_password_reset_sets_trust(client, sent_emails, monkeypatch):
    frozen_now = _freeze_now(monkeypatch)
    _token, account = _register_account(client, "reset-trust@x.cz")

    requested = client.post(
        "/v1/auth/request-password-reset",
        data={"email": "reset-trust@x.cz"},
        format="json",
    )
    assert requested.status_code == status.HTTP_202_ACCEPTED, requested.content

    code = _verify_code(sent_emails, "reset")
    reset = client.post(
        "/v1/auth/reset-password",
        data={"token": code, "password": "N3w-P4ssw0rd!"},
        format="json",
    )
    assert reset.status_code == status.HTTP_200_OK, reset.content

    account.refresh_from_db()
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_failed_password_reset_never_sets_trust(client, sent_emails, monkeypatch):
    _freeze_now(monkeypatch)
    _token, account = _register_account(client, "reset-fail@x.cz")
    client.post(
        "/v1/auth/request-password-reset",
        data={"email": "reset-fail@x.cz"},
        format="json",
    )
    code = _verify_code(sent_emails, "reset")

    rejected = client.post(
        "/v1/auth/reset-password",
        data={"token": code, "password": "short"},
        format="json",
    )
    assert rejected.status_code >= status.HTTP_400_BAD_REQUEST, rejected.content

    account.refresh_from_db()
    assert account.quorum_trusted_at is None


# ---------------------------------------------------------------------------
# Social resolution / link proofs
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_verified_google_resolution_sets_trust_once(client, fake_oauth, monkeypatch):
    frozen_now = _freeze_now(monkeypatch)

    resp = client.post(
        "/v1/auth/google",
        data={"id_token": f"google:{uuid.uuid4()}:google-resolve@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    account = Account.objects.get(public_id=resp.json()["id"])
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_verified_apple_link_on_anonymous_account_sets_trust_once(
    client, fake_oauth, monkeypatch
):
    frozen_now = _freeze_now(monkeypatch)
    anon_token, anon = _bootstrap_anon(client)

    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": f"apple:{uuid.uuid4()}:apple-link@x.cz",
            "authorization_code": "code-1",
        },
        format="json",
        **_auth(anon_token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    anon.refresh_from_db()
    assert str(anon.public_id) == resp.json()["id"], "link must claim the same account"
    assert anon.quorum_trusted_at == frozen_now


@pytest.mark.django_db
@pytest.mark.parametrize("failure", ["signature", "expired", "audience", "issuer", "provider"])
def test_social_verification_failures_never_set_trust(
    client, fake_oauth, monkeypatch, failure
):
    _freeze_now(monkeypatch)

    # At the pubs.oauth boundary every real token-verification failure
    # (signature/expiry/audience/issuer) surfaces as OAuthError — that is the
    # production contract verify_provider_token maps to 401 oauth_failed.
    # Anything else is an unexpected crash and becomes a bare 500.
    exc = (
        ValueError("unexpected provider payload")
        if failure == "provider"
        else oauth.OAuthError(f"token rejected: {failure}")
    )

    def rejecting(token):
        raise exc

    monkeypatch.setattr(oauth, "verify_google_id_token", rejecting)
    monkeypatch.setattr(oauth, "verify_apple_identity_token", rejecting)

    # Real token-verification failures map to exactly 401 oauth_failed.
    expected_status = (
        status.HTTP_500_INTERNAL_SERVER_ERROR
        if failure == "provider"
        else status.HTTP_401_UNAUTHORIZED
    )

    for path, field in (("/v1/auth/google", "id_token"), ("/v1/auth/apple", "identity_token")):
        body = {field: f"{path.rsplit('/', 1)[-1]}:{uuid.uuid4()}:{failure}@x.cz"}
        if path.endswith("apple"):
            body["authorization_code"] = "code-fail"
        resp = client.post(path, data=body, format="json")
        assert resp.status_code == expected_status, resp.content
        if failure != "provider":
            assert resp.json()["code"] == "oauth_failed", resp.content

    assert list(Account.objects.exclude(quorum_trusted_at=None)) == []


@pytest.mark.django_db
def test_social_login_with_unverified_email_claim_still_stamps_trust_once(
    client, fake_oauth, monkeypatch
):
    frozen_now = _freeze_now(monkeypatch)
    monkeypatch.setattr(
        oauth,
        "verify_google_id_token",
        lambda token: {"sub": "unv-sub", "email": "unv@x.cz", "email_verified": False},
    )

    first = client.post(
        "/v1/auth/google",
        data={"id_token": "google:unv-sub:unv@x.cz"},
        format="json",
    )
    assert first.status_code == status.HTTP_200_OK, first.content
    account = Account.objects.get(public_id=first.json()["id"])
    assert account.quorum_trusted_at == frozen_now

    # A later sign-in of the same verified subject never advances the stamp.
    _freeze_now(monkeypatch, frozen_now + timedelta(hours=6))
    second = client.post(
        "/v1/auth/google",
        data={"id_token": "google:unv-sub:unv@x.cz"},
        format="json",
    )
    assert second.status_code == status.HTTP_200_OK, second.content
    account.refresh_from_db()
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_verified_google_resolution_without_any_email_stamps_trust_once(
    client, fake_oauth, monkeypatch
):
    """The subject proof alone is enough: claims carry no email field value."""
    frozen_now = _freeze_now(monkeypatch)
    monkeypatch.setattr(
        oauth,
        "verify_google_id_token",
        lambda token: {"sub": "no-email-sub", "email": "", "email_verified": True},
    )

    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:no-email-sub:"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    account = Account.objects.get(public_id=resp.json()["id"])
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_verified_apple_resolution_with_false_email_flag_stamps_trust_once(
    client, fake_oauth, monkeypatch
):
    frozen_now = _freeze_now(monkeypatch)
    monkeypatch.setattr(
        oauth,
        "verify_apple_identity_token",
        lambda token: {"sub": "apple-false-sub", "email": "relay@x.cz", "email_verified": "false"},
    )

    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:apple-false-sub:relay@x.cz",
            "authorization_code": "code-no-email",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    account = Account.objects.get(public_id=resp.json()["id"])
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_idempotent_relink_of_same_verified_subject_stamps_trust_once(
    client, fake_oauth, monkeypatch
):
    frozen_now = _freeze_now(monkeypatch)
    anon_token, anon = _bootstrap_anon(client)
    payload = {
        "identity_token": f"apple:{uuid.uuid4()}:relink@x.cz",
        "authorization_code": "code-relink-1",
    }

    first = client.post("/v1/auth/apple", data=payload, format="json", **_auth(anon_token))
    assert first.status_code == status.HTTP_200_OK, first.content
    anon.refresh_from_db()
    assert anon.quorum_trusted_at == frozen_now

    _freeze_now(monkeypatch, frozen_now + timedelta(hours=6))
    second = client.post(
        "/v1/auth/apple",
        data={**payload, "authorization_code": "code-relink-2"},
        format="json",
        **_auth(anon_token),
    )
    assert second.status_code == status.HTTP_200_OK, second.content
    anon.refresh_from_db()
    assert anon.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_idempotent_google_relink_via_link_endpoint_stamps_trust_once(
    client, fake_oauth, monkeypatch
):
    frozen_now = _freeze_now(monkeypatch)
    token, account = _register_account(client, "relink-google@x.cz")

    payload = {"provider": "google", "id_token": "google:relink-sub:relink@x.cz"}
    first = client.post("/v1/auth/link", data=payload, format="json", **_auth(token))
    assert first.status_code == status.HTTP_200_OK, first.content
    account.refresh_from_db()
    assert account.quorum_trusted_at == frozen_now

    # Relinking the same already-linked verified subject is an idempotent
    # success — and still never advances the original stamp.
    _freeze_now(monkeypatch, frozen_now + timedelta(hours=6))
    second = client.post("/v1/auth/link", data=payload, format="json", **_auth(token))
    assert second.status_code == status.HTTP_200_OK, second.content
    account.refresh_from_db()
    assert account.quorum_trusted_at == frozen_now


@pytest.mark.django_db
def test_mid_transaction_failure_after_proof_rolls_trust_back(
    client, fake_oauth, monkeypatch
):
    """A crash AFTER the verified proof but before commit leaves no stamp."""
    _freeze_now(monkeypatch)

    def boom(*args, **kwargs):
        raise RuntimeError("simulated crash after proof")

    monkeypatch.setattr(accounts, "issue_token", boom)

    # The auth surface's error boundary converts the unexpected crash into a
    # bare 500 (it never leaks exceptions); the point is that nothing persisted.
    crashed = client.post(
        "/v1/auth/google",
        data={"id_token": f"google:{uuid.uuid4()}:rollback@x.cz"},
        format="json",
    )
    assert crashed.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR, crashed.content

    rolled_back = Account.objects.filter(identities__email="rollback@x.cz").first()
    assert rolled_back is None, "identity persisted despite the mid-transaction crash"
    assert list(Account.objects.exclude(quorum_trusted_at=None)) == []


# ---------------------------------------------------------------------------
# Merges
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_merge_with_suspicious_trusted_anon_source_aborts_whole_merge(
    client, fake_oauth, monkeypatch
):
    _freeze_now(monkeypatch)
    source_token, source = _bootstrap_anon(client)
    _target_token, target = _register_account(client, "merge-abort-target@x.cz")

    DrinkLog.objects.create(
        account=source,
        client_id=uuid.uuid4(),
        beer_name="Pilsner",
        drank_at=dj_timezone.now(),
    )
    community_trust.mark_quorum_trusted(source.pk, proven_at=dj_timezone.now())

    resp = client.post(
        "/v1/auth/login",
        data={
            "email": "merge-abort-target@x.cz",
            "password": "Tr0ub4dor&3",
            "merge_operation_id": str(uuid.uuid4()),
        },
        format="json",
        **_auth(source_token),
    )

    # An unclaimed source carrying trust is suspicious: refuse everything.
    assert resp.status_code >= status.HTTP_400_BAD_REQUEST, resp.content
    source.refresh_from_db()
    target.refresh_from_db()
    assert source.drinks.count() == 1, "source data must not be moved"
    assert target.drinks.count() == 0, "nothing from the suspicious source may transfer"


@pytest.mark.django_db
def test_normal_merge_never_transfers_or_clears_target_trust(
    client, fake_oauth, sent_emails, monkeypatch
):
    first_now = _freeze_now(monkeypatch)
    source_token, source = _bootstrap_anon(client)
    target_token, target = _register_account(client, "merge-keep-target@x.cz")

    # Target earns its own trust via email verification.
    client.post("/v1/auth/request-email-verify", format="json", **_auth(target_token))
    code = _verify_code(sent_emails, "verify")
    client.post("/v1/auth/verify-email", data={"token": code}, format="json")
    target.refresh_from_db()
    assert target.quorum_trusted_at == first_now

    DrinkLog.objects.create(
        account=source,
        client_id=uuid.uuid4(),
        beer_name="Kozel",
        drank_at=dj_timezone.now(),
    )

    # A verified asserted email matching an identity on the target makes the
    # Google login resolve onto the target, so this is a genuine anonymous-source
    # merge (a new social identity otherwise just claims the anon account itself).
    AuthIdentity.objects.create(
        account=target,
        provider=AuthIdentity.Provider.APPLE,
        subject="merge-normal-apple",
        email="merge-normal@x.cz",
    )

    merged = client.post(
        "/v1/auth/google",
        data={
            "id_token": f"google:{uuid.uuid4()}:merge-normal@x.cz",
            "merge_operation_id": str(uuid.uuid4()),
        },
        format="json",
        **_auth(source_token),
    )
    assert merged.status_code == status.HTTP_200_OK, merged.content

    target.refresh_from_db()
    assert target.drinks.count() == 1, "sanity: the untrusted merge did move data"
    assert target.quorum_trusted_at == first_now, "trust survives the merge untouched"
    # The anonymous source was folded away by the merge; no trust appeared
    # anywhere else (nothing transferred, nothing new stamped).
    assert not Account.objects.filter(pk=source.pk).exists()
    assert list(Account.objects.exclude(quorum_trusted_at=None)) == [target]


# ---------------------------------------------------------------------------
# Exposure
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_me_and_public_profile_do_not_expose_quorum_trusted_at(
    client, sent_emails, monkeypatch
):
    _freeze_now(monkeypatch)
    viewer_token, _viewer = _bootstrap_anon(client)
    me_token, me_account = _register_account(client, "exposure-me@x.cz")

    client.post("/v1/auth/request-email-verify", format="json", **_auth(me_token))
    me_code = _verify_code(sent_emails, "verify")
    client.post("/v1/auth/verify-email", data={"token": me_code}, format="json")
    me_account.refresh_from_db()
    assert me_account.quorum_trusted_at is not None

    Account.objects.filter(pk=me_account.pk).update(is_public=True)

    me = client.get("/v1/account/me", **_auth(me_token))
    assert me.status_code == status.HTTP_200_OK, me.content
    _assert_key_absent(me.json(), "quorum_trusted_at")

    profile = client.get(f"/v1/friends/{me_account.public_id}", **_auth(viewer_token))
    assert profile.status_code == status.HTTP_200_OK, profile.content
    _assert_key_absent(profile.json(), "quorum_trusted_at")


@pytest.mark.django_db
def test_export_includes_quorum_trusted_at_additively(
    client, sent_emails, monkeypatch
):
    _freeze_now(monkeypatch)
    token, account = _register_account(client, "export-trust@x.cz")
    client.post("/v1/auth/request-email-verify", format="json", **_auth(token))
    code = _verify_code(sent_emails, "verify")
    client.post("/v1/auth/verify-email", data={"token": code}, format="json")
    account.refresh_from_db()

    exported = client.get("/v1/account/export", **_auth(token))
    assert exported.status_code == status.HTTP_200_OK, exported.content
    body = exported.json()

    # Additive: the new key sits next to every pre-existing account key...
    for legacy_key in ("id", "device_id", "nickname", "is_public", "email",
                       "email_verified", "providers", "status", "created_at"):
        assert legacy_key in body["account"]
    # ...and carries exactly the stamped value.
    assert body["account"]["quorum_trusted_at"] == account.quorum_trusted_at.isoformat()

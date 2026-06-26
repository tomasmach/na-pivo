"""
Tests for the user-accounts auth layer (pubs.api.auth_views + pubs.accounts).

These exercise the credential / social / linking / reset / verification / deletion
flows end-to-end through the DRF endpoints under /v1/auth and DELETE /v1/account/me.

OAuth is mocked at the ``pubs.oauth`` module boundary (the service layer calls
``oauth.verify_google_id_token`` etc. by attribute lookup at call time, so patching
the module attribute is sufficient — no real network). Test ID tokens encode the
asserted identity as a string ``"google:SUB:email"`` / ``"apple:SUB:email"`` so a
test can drive any (sub, email) it wants. Transactional emails are mocked at the
``pubs.emailer`` boundary to capture the raw one-time-token codes and to assert
sends happen.

The auth endpoints are scope-throttled (``auth`` 20/min, ``auth_email`` 5/min) on a
shared per-IP counter stored in the Django cache, so an autouse fixture clears the
cache around every test (same pattern as test_account.py). Individual tests keep
``auth_email`` calls under 5.
"""

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIClient

import pubs.emailer as emailer
import pubs.oauth as oauth
from pubs.models import (
    Account,
    AuthIdentity,
    AuthToken,
    DrinkLog,
    EmailCredential,
    OneTimeToken,
    PushDevice,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # The auth endpoints are ScopedRateThrottle'd ("auth" 20/min, "auth_email"
    # 5/min) on a shared per-IP (127.0.0.1) counter stored in the default cache.
    # Clear it around every test so the counter never bleeds across tests.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def tmp_media(tmp_path, settings):
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


@pytest.fixture
def fake_oauth(monkeypatch):
    """Patch the OAuth provider verifiers + Apple code-exchange / revoke.

    The verifiers parse a test token of the form ``"<provider>:<sub>:<email>"``.
    ``exchange_apple_auth_code`` is stubbed to a fixed refresh token. Apple revoke
    records every revoked token so tests can assert revocation happened on
    unlink / deletion.
    """
    revoked: list[str] = []

    def fake_google(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    def fake_apple(token: str) -> dict:
        _, sub, email = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True}

    def fake_exchange(code: str) -> dict:
        return {"refresh_token": "rt_test"}

    def fake_revoke(token: str, token_type_hint: str = "refresh_token") -> None:
        revoked.append(token)

    monkeypatch.setattr(oauth, "verify_google_id_token", fake_google)
    monkeypatch.setattr(oauth, "verify_apple_identity_token", fake_apple)
    monkeypatch.setattr(oauth, "exchange_apple_auth_code", fake_exchange)
    monkeypatch.setattr(oauth, "revoke_apple_token", fake_revoke)
    return {"revoked": revoked}


@pytest.fixture
def sent_emails(monkeypatch):
    """Capture transactional emails (which are otherwise a dev no-op).

    Records one dict per send with the function tag + kwargs so tests can pull
    the raw one-time-token ``code`` out of verification / reset emails.
    """
    sent: list[dict] = []

    def make_recorder(tag: str):
        def recorder(to, **kwargs):
            sent.append({"tag": tag, "to": to, **kwargs})
            return True

        return recorder

    monkeypatch.setattr(emailer, "send_verification_email", make_recorder("verify"))
    monkeypatch.setattr(emailer, "send_password_reset_email", make_recorder("reset"))
    monkeypatch.setattr(
        emailer, "send_account_deletion_scheduled_email", make_recorder("deletion_scheduled")
    )
    monkeypatch.setattr(emailer, "send_account_deleted_email", make_recorder("deleted"))
    return sent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _bootstrap_anon(client) -> tuple[str, str]:
    """Create an anonymous device account; return (raw_token, account_public_id)."""
    resp = client.post(
        "/v1/account", data={"device_id": str(uuid.uuid4())}, format="json"
    )
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], body["id"]


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _register(client, email: str, password: str = "Tr0ub4dor&3", *, token: str | None = None):
    """POST /v1/auth/register, optionally claiming the anon account behind ``token``."""
    extra = _auth(token) if token else {}
    return client.post(
        "/v1/auth/register",
        data={"email": email, "password": password},
        format="json",
        **extra,
    )


def _register_and_token(client, email: str, password: str = "Tr0ub4dor&3") -> tuple[APIClient, str]:
    """Register a fresh email account; return (client, working session token)."""
    resp = _register(client, email, password)
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    return client, resp.json()["token"]


def _verify_code(sent_emails, tag: str) -> str:
    """Pull the raw one-time token out of the most recent captured email."""
    for record in reversed(sent_emails):
        if record["tag"] == tag:
            return record["code"]
    raise AssertionError(f"no {tag} email captured in {sent_emails!r}")


# ===========================================================================
# 1. Register (email + password) — claims the anon account
# ===========================================================================


@pytest.mark.django_db
def test_register_claims_anonymous_account_and_preserves_data(client, sent_emails):
    token, anon_id = _bootstrap_anon(client)
    # Seed data on the anonymous account so we can prove it survives the claim.
    account = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )

    resp = _register(client, "claim@x.cz", token=token)

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    assert body["created"] is True
    assert body["token"]
    # Same logical account: the credential attached to the existing row.
    assert body["id"] == anon_id
    assert Account.objects.count() == 1
    # The drink still belongs to the (now claimed) account.
    drink.refresh_from_db()
    assert drink.account_id == account.id


@pytest.mark.django_db
def test_register_returns_working_token_with_email_provider(client, sent_emails):
    token, _ = _bootstrap_anon(client)
    resp = _register(client, "me@x.cz", token=token)
    session = resp.json()["token"]

    me = client.get("/v1/account/me", **_auth(session))
    assert me.status_code == status.HTTP_200_OK
    body = me.json()
    assert body["is_anonymous"] is False
    assert body["providers"] == ["email"]
    assert body["email"] == "me@x.cz"


@pytest.mark.django_db
def test_register_without_bearer_creates_fresh_account(client, sent_emails):
    resp = _register(client, "nobearer@x.cz")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    assert resp.json()["created"] is True
    assert EmailCredential.objects.filter(email="nobearer@x.cz").exists()


@pytest.mark.django_db
def test_register_ignores_invalid_optional_bearer(client, sent_emails):
    resp = _register(client, "stale-bearer@x.cz", token="stale-token")

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    assert body["created"] is True
    assert body["token"]
    assert EmailCredential.objects.filter(email="stale-bearer@x.cz").exists()


@pytest.mark.django_db
def test_register_duplicate_email_returns_409_email_taken(client, sent_emails):
    _register(client, "dup@x.cz")
    resp = _register(APIClient(), "dup@x.cz")
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "email_taken"


@pytest.mark.django_db
def test_register_weak_password_returns_400(client):
    # "123" is too short, all-numeric, and a common password.
    resp = client.post(
        "/v1/auth/register",
        data={"email": "weak@x.cz", "password": "123"},
        format="json",
    )
    # The serializer enforces min_length=8 (400) before the service-layer
    # weak_password check; either way it is a 400 rejection.
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert not EmailCredential.objects.filter(email="weak@x.cz").exists()


@pytest.mark.django_db
def test_register_weak_password_passes_serializer_but_fails_validator(client, sent_emails):
    # 8+ chars (clears the serializer) but all-numeric + common → weak_password.
    resp = client.post(
        "/v1/auth/register",
        data={"email": "weak2@x.cz", "password": "12345678"},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "weak_password"


@pytest.mark.django_db
def test_register_when_account_already_has_password_returns_409(client, sent_emails):
    _, token = _register_and_token(client, "first@x.cz")
    # Re-register on the SAME (now claimed) account.
    resp = _register(client, "second@x.cz", token=token)
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "already_has_password"


# ===========================================================================
# 2. Login (email + password)
# ===========================================================================


@pytest.mark.django_db
def test_login_correct_credentials_returns_working_token(client, sent_emails):
    _register(client, "login@x.cz", "Tr0ub4dor&3")

    resp = client.post(
        "/v1/auth/login",
        data={"email": "login@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    session = resp.json()["token"]
    me = client.get("/v1/account/me", **_auth(session))
    assert me.status_code == status.HTTP_200_OK
    assert me.json()["providers"] == ["email"]


@pytest.mark.django_db
def test_login_with_anonymous_bearer_merges_progress_into_existing_account(
    client, sent_emails
):
    _register(client, "merge-login@x.cz", "Tr0ub4dor&3")
    target = EmailCredential.objects.get(email="merge-login@x.cz").account

    anon_token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )
    push_device = PushDevice.objects.create(
        account=anon,
        push_token="ExponentPushToken[mergeLogin]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )

    resp = client.post(
        "/v1/auth/login",
        data={"email": "merge-login@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        **_auth(anon_token),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["id"] == str(target.public_id)
    assert Account.objects.count() == 1
    drink.refresh_from_db()
    assert drink.account_id == target.id
    push_device.refresh_from_db()
    assert push_device.account_id == target.id


@pytest.mark.django_db
def test_login_ignores_invalid_optional_bearer(client, sent_emails):
    _register(client, "invalid-hint@x.cz", "Tr0ub4dor&3")

    resp = client.post(
        "/v1/auth/login",
        data={"email": "invalid-hint@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
        HTTP_AUTHORIZATION="Bearer not-a-real-token",
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["providers"] == ["email"]


@pytest.mark.django_db
def test_login_wrong_password_returns_401_invalid_credentials(client, sent_emails):
    _register(client, "login2@x.cz", "Tr0ub4dor&3")
    resp = client.post(
        "/v1/auth/login",
        data={"email": "login2@x.cz", "password": "WrongPassword!9"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert resp.json()["code"] == "invalid_credentials"


@pytest.mark.django_db
def test_login_unknown_email_returns_401_same_code_no_enumeration(client):
    resp = client.post(
        "/v1/auth/login",
        data={"email": "ghost@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    # Same generic code as a wrong password → no account enumeration.
    assert resp.json()["code"] == "invalid_credentials"


@pytest.mark.django_db
def test_login_reactivates_pending_deletion_account(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "reactivate@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="reactivate@x.cz").account

    # Schedule deletion.
    deleted = client.delete("/v1/account/me", **_auth(token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION

    # Logging back in within the grace window reactivates the account.
    resp = client.post(
        "/v1/auth/login",
        data={"email": "reactivate@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE
    assert account.deleted_at is None


# ===========================================================================
# 3. Google sign-in
# ===========================================================================


@pytest.mark.django_db
def test_google_new_identity_no_bearer_creates_account(client, fake_oauth):
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-SUB-1:g1@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["created"] is True
    assert body["providers"] == ["google"]
    assert body["token"]
    me = client.get("/v1/account/me", **_auth(body["token"]))
    assert me.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_google_new_identity_with_anon_bearer_claims_it(client, fake_oauth):
    token, anon_id = _bootstrap_anon(client)
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-SUB-2:g2@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["created"] is False  # claimed, not created
    assert body["id"] == anon_id
    assert Account.objects.count() == 1


@pytest.mark.django_db
def test_google_signin_ignores_invalid_optional_bearer(client, fake_oauth):
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-STALE:stale@x.cz"},
        format="json",
        **_auth("stale-token"),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["created"] is True
    assert body["providers"] == ["google"]
    assert body["token"]


@pytest.mark.django_db
def test_google_returning_sub_signs_into_same_account(client, fake_oauth):
    first = client.post(
        "/v1/auth/google", data={"id_token": "google:G-SUB-3:g3@x.cz"}, format="json"
    )
    first_id = first.json()["id"]

    second = client.post(
        "/v1/auth/google", data={"id_token": "google:G-SUB-3:g3@x.cz"}, format="json"
    )
    assert second.status_code == status.HTTP_200_OK
    body = second.json()
    assert body["created"] is False
    assert body["id"] == first_id
    assert Account.objects.count() == 1
    assert AuthIdentity.objects.filter(provider="google", subject="G-SUB-3").count() == 1


@pytest.mark.django_db
def test_apple_signin_merges_into_existing_google_account_by_verified_email(client, fake_oauth):
    google = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-MERGE:same@x.cz"},
        format="json",
    )
    google_id = google.json()["id"]

    token, anon_id = _bootstrap_anon(client)
    anon = Account.objects.get(public_id=anon_id)
    drink = DrinkLog.objects.create(
        account=anon,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="U Vystřelenýho oka",
        lat=50.08,
        lng=14.45,
        beer_name="Plzeň",
        price_czk=55,
        drank_at="2026-06-01T18:00:00Z",
    )

    apple = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-MERGE:same@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
        **_auth(token),
    )

    assert apple.status_code == status.HTTP_200_OK, apple.content
    body = apple.json()
    assert body["id"] == google_id
    assert body["created"] is False
    assert sorted(body["providers"]) == ["apple", "google"]
    assert Account.objects.count() == 1
    assert AuthIdentity.objects.filter(provider="google", subject="G-MERGE").exists()
    assert AuthIdentity.objects.filter(provider="apple", subject="A-MERGE").exists()
    drink.refresh_from_db()
    assert str(drink.account.public_id) == google_id


# ===========================================================================
# 4. Apple sign-in
# ===========================================================================


@pytest.mark.django_db
def test_apple_new_identity_no_bearer_creates_account(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-SUB-1:a1@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["created"] is True
    assert body["providers"] == ["apple"]


@pytest.mark.django_db
def test_apple_new_identity_requires_refresh_token_capture(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={"identity_token": "apple:A-NO-REFRESH:no-refresh@x.cz"},
        format="json",
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "apple_refresh_required"
    assert not AuthIdentity.objects.filter(provider="apple", subject="A-NO-REFRESH").exists()


@pytest.mark.django_db
def test_apple_stores_refresh_token_from_authorization_code(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-SUB-2:a2@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    identity = AuthIdentity.objects.get(provider="apple", subject="A-SUB-2")
    assert identity.apple_refresh_token == "rt_test"


@pytest.mark.django_db
def test_apple_full_name_stored_as_display_name_on_first_signin(client, fake_oauth):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-SUB-3:a3@x.cz",
            "authorization_code": "apple-auth-code",
            "full_name": "Tomáš Macháček",
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["display_name"] == "Tomáš Macháček"
    account = AuthIdentity.objects.get(provider="apple", subject="A-SUB-3").account
    assert account.display_name == "Tomáš Macháček"


@pytest.mark.django_db
def test_google_signin_merges_into_existing_apple_account_by_verified_email(client, fake_oauth):
    apple = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-MERGE-FIRST:both@x.cz",
            "authorization_code": "apple-auth-code",
        },
        format="json",
    )
    apple_id = apple.json()["id"]

    google = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-MERGE-SECOND:both@x.cz"},
        format="json",
    )

    assert google.status_code == status.HTTP_200_OK, google.content
    body = google.json()
    assert body["id"] == apple_id
    assert body["created"] is False
    assert sorted(body["providers"]) == ["apple", "google"]
    assert Account.objects.count() == 1


# ===========================================================================
# 5. Email-collision guard (anti account-takeover)
# ===========================================================================


@pytest.mark.django_db
def test_social_signin_rejects_email_belonging_to_password_account(client, fake_oauth, sent_emails):
    # Password account owns a@x.cz.
    _register(client, "a@x.cz", "Tr0ub4dor&3")

    # A NEW google sub asserting the same email, no bearer → must be rejected,
    # never merged onto the password account.
    resp = client.post(
        "/v1/auth/google",
        data={"id_token": "google:G-COLLIDE:a@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "email_exists"
    # No identity was created and no extra account was made.
    assert not AuthIdentity.objects.filter(subject="G-COLLIDE").exists()
    assert Account.objects.count() == 1


# ===========================================================================
# 6. Linking a provider to the authenticated account
# ===========================================================================


@pytest.mark.django_db
def test_link_google_to_email_account(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "link@x.cz", "Tr0ub4dor&3")

    resp = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-LINK:link@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert sorted(resp.json()["providers"]) == ["email", "google"]


@pytest.mark.django_db
def test_link_google_already_linked_elsewhere_returns_409(client, fake_oauth, sent_emails):
    # Account B already owns google sub G-OTHER.
    client.post("/v1/auth/google", data={"id_token": "google:G-OTHER:b@x.cz"}, format="json")

    # Account A (email) tries to link the SAME sub.
    _, token = _register_and_token(client, "a2@x.cz", "Tr0ub4dor&3")
    resp = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-OTHER:b@x.cz"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_409_CONFLICT
    assert resp.json()["code"] == "provider_linked_elsewhere"


@pytest.mark.django_db
def test_link_google_when_already_have_google_returns_409(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "a3@x.cz", "Tr0ub4dor&3")
    # First link succeeds.
    first = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-FIRST:a3@x.cz"},
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_200_OK

    # Second link with a DIFFERENT google sub on the same account → rejected.
    second = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-SECOND:a3@x.cz"},
        format="json",
        **_auth(token),
    )
    assert second.status_code == status.HTTP_409_CONFLICT
    assert second.json()["code"] == "provider_already_linked"


@pytest.mark.django_db
def test_link_requires_authentication(client, fake_oauth):
    resp = client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-NOAUTH:x@x.cz"},
        format="json",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ===========================================================================
# 7. Unlinking
# ===========================================================================


@pytest.mark.django_db
def test_unlink_google_from_email_plus_google_account(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "u@x.cz", "Tr0ub4dor&3")
    client.post(
        "/v1/auth/link",
        data={"provider": "google", "id_token": "google:G-UNLINK:u@x.cz"},
        format="json",
        **_auth(token),
    )

    resp = client.post(
        "/v1/auth/unlink", data={"provider": "google"}, format="json", **_auth(token)
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["providers"] == ["email"]


@pytest.mark.django_db
def test_unlink_last_method_returns_400_last_credential(client, fake_oauth):
    # Google-only account: google is the only sign-in method.
    resp = client.post(
        "/v1/auth/google", data={"id_token": "google:G-ONLY:o@x.cz"}, format="json"
    )
    token = resp.json()["token"]

    unlink = client.post(
        "/v1/auth/unlink", data={"provider": "google"}, format="json", **_auth(token)
    )
    assert unlink.status_code == status.HTTP_400_BAD_REQUEST
    assert unlink.json()["code"] == "last_credential"


@pytest.mark.django_db
def test_unlink_apple_revokes_apple_token(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "ua@x.cz", "Tr0ub4dor&3")
    # Link apple WITH an authorization_code so a refresh token gets stored.
    client.post(
        "/v1/auth/link",
        data={
            "provider": "apple",
            "identity_token": "apple:A-UNLINK:ua@x.cz",
            "authorization_code": "code",
        },
        format="json",
        **_auth(token),
    )
    identity = AuthIdentity.objects.get(provider="apple", subject="A-UNLINK")
    assert identity.apple_refresh_token == "rt_test"

    unlink = client.post(
        "/v1/auth/unlink", data={"provider": "apple"}, format="json", **_auth(token)
    )
    assert unlink.status_code == status.HTTP_200_OK
    assert "rt_test" in fake_oauth["revoked"]
    assert not AuthIdentity.objects.filter(subject="A-UNLINK").exists()


@pytest.mark.django_db
def test_unlink_apple_keeps_identity_when_revocation_fails(
    client, fake_oauth, sent_emails, monkeypatch
):
    _, token = _register_and_token(client, "ua-fail@x.cz", "Tr0ub4dor&3")
    client.post(
        "/v1/auth/link",
        data={
            "provider": "apple",
            "identity_token": "apple:A-UNLINK-FAIL:ua-fail@x.cz",
            "authorization_code": "code",
        },
        format="json",
        **_auth(token),
    )

    def fail_revoke(token: str, token_type_hint: str = "refresh_token") -> None:
        raise oauth.OAuthError("apple down")

    monkeypatch.setattr(oauth, "revoke_apple_token", fail_revoke)

    unlink = client.post(
        "/v1/auth/unlink", data={"provider": "apple"}, format="json", **_auth(token)
    )

    assert unlink.status_code == status.HTTP_502_BAD_GATEWAY
    assert unlink.json()["code"] == "apple_revoke_failed"
    identity = AuthIdentity.objects.get(subject="A-UNLINK-FAIL")
    assert identity.apple_refresh_token == "rt_test"


# ===========================================================================
# 8. set-password (escape hatch for social-only accounts)
# ===========================================================================


@pytest.mark.django_db
def test_set_password_on_google_account_enables_email_login(client, fake_oauth, sent_emails):
    resp = client.post(
        "/v1/auth/google", data={"id_token": "google:G-SETPW:sp@x.cz"}, format="json"
    )
    token = resp.json()["token"]

    setpw = client.post(
        "/v1/auth/set-password",
        data={"password": "Tr0ub4dor&3", "email": "sp@x.cz"},
        format="json",
        **_auth(token),
    )
    assert setpw.status_code == status.HTTP_200_OK
    assert sorted(setpw.json()["providers"]) == ["email", "google"]

    # Now email+password login works.
    login = client.post(
        "/v1/auth/login",
        data={"email": "sp@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    assert login.status_code == status.HTTP_200_OK


# ===========================================================================
# 9. Logout (single token / all)
# ===========================================================================


@pytest.mark.django_db
def test_logout_revokes_current_token(client, sent_emails):
    _, token = _register_and_token(client, "logout@x.cz", "Tr0ub4dor&3")
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_200_OK

    resp = client.post("/v1/auth/logout", data={}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["ok"] is True

    # Old token no longer authenticates.
    assert client.get("/v1/account/me", **_auth(token)).status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_logout_all_revokes_every_token(client, sent_emails):
    _, token1 = _register_and_token(client, "all@x.cz", "Tr0ub4dor&3")
    # Second device: a fresh login issues another token for the same account.
    login = client.post(
        "/v1/auth/login",
        data={"email": "all@x.cz", "password": "Tr0ub4dor&3"},
        format="json",
    )
    token2 = login.json()["token"]
    assert token1 != token2

    resp = client.post("/v1/auth/logout", data={"all": True}, format="json", **_auth(token1))
    assert resp.status_code == status.HTTP_200_OK

    # Both devices' tokens stop working.
    assert client.get("/v1/account/me", **_auth(token1)).status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get("/v1/account/me", **_auth(token2)).status_code == status.HTTP_401_UNAUTHORIZED


# ===========================================================================
# 10. Password reset (request + consume)
# ===========================================================================


@pytest.mark.django_db
def test_request_password_reset_known_email_sends_email_and_creates_token(client, sent_emails):
    _register(client, "reset@x.cz", "Tr0ub4dor&3")
    # Clear the verification email captured during register so we isolate reset.
    sent_emails.clear()

    resp = client.post(
        "/v1/auth/request-password-reset", data={"email": "reset@x.cz"}, format="json"
    )
    assert resp.status_code == status.HTTP_202_ACCEPTED
    assert any(r["tag"] == "reset" for r in sent_emails)
    assert OneTimeToken.objects.filter(
        purpose=OneTimeToken.Purpose.RESET_PASSWORD
    ).count() == 1


@pytest.mark.django_db
def test_request_password_reset_unknown_email_still_202_no_token(client):
    resp = client.post(
        "/v1/auth/request-password-reset", data={"email": "nobody@x.cz"}, format="json"
    )
    assert resp.status_code == status.HTTP_202_ACCEPTED  # no enumeration
    assert OneTimeToken.objects.filter(
        purpose=OneTimeToken.Purpose.RESET_PASSWORD
    ).count() == 0


@pytest.mark.django_db
def test_reset_password_consumes_token_sets_new_and_revokes_old_sessions(client, sent_emails):
    _, old_token = _register_and_token(client, "rp@x.cz", "Tr0ub4dor&3")
    sent_emails.clear()
    client.post("/v1/auth/request-password-reset", data={"email": "rp@x.cz"}, format="json")
    raw = _verify_code(sent_emails, "reset")

    resp = client.post(
        "/v1/auth/reset-password",
        data={"token": raw, "password": "NewP@ssw0rd!"},
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["token"]  # fresh session issued

    # The previously-issued session token was revoked by the reset.
    assert client.get("/v1/account/me", **_auth(old_token)).status_code == status.HTTP_401_UNAUTHORIZED

    # New password works; old one does not.
    good = client.post(
        "/v1/auth/login", data={"email": "rp@x.cz", "password": "NewP@ssw0rd!"}, format="json"
    )
    assert good.status_code == status.HTTP_200_OK
    bad = client.post(
        "/v1/auth/login", data={"email": "rp@x.cz", "password": "Tr0ub4dor&3"}, format="json"
    )
    assert bad.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_reset_password_with_bogus_token_returns_400(client):
    resp = client.post(
        "/v1/auth/reset-password",
        data={"token": "not-a-real-token", "password": "NewP@ssw0rd!"},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "token_invalid"


# ===========================================================================
# 11. Email verification (request + consume)
# ===========================================================================


@pytest.mark.django_db
def test_email_unverified_after_register_then_verifies(client, sent_emails):
    _, token = _register_and_token(client, "verify@x.cz", "Tr0ub4dor&3")
    me = client.get("/v1/account/me", **_auth(token))
    assert me.json()["email_verified"] is False

    # Register already sent one verification email; capture its code.
    raw = _verify_code(sent_emails, "verify")
    resp = client.post("/v1/auth/verify-email", data={"token": raw}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["ok"] is True

    me2 = client.get("/v1/account/me", **_auth(token))
    assert me2.json()["email_verified"] is True


@pytest.mark.django_db
def test_request_email_verify_resends(client, sent_emails):
    _, token = _register_and_token(client, "rev@x.cz", "Tr0ub4dor&3")
    before = sum(1 for r in sent_emails if r["tag"] == "verify")

    resp = client.post("/v1/auth/request-email-verify", data={}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_202_ACCEPTED
    after = sum(1 for r in sent_emails if r["tag"] == "verify")
    assert after == before + 1


@pytest.mark.django_db
def test_verify_email_with_bogus_token_returns_400(client):
    resp = client.post("/v1/auth/verify-email", data={"token": "bogus"}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "token_invalid"


@pytest.mark.django_db
def test_verify_email_token_cannot_be_replayed(client, sent_emails):
    _, token = _register_and_token(client, "replay@x.cz", "Tr0ub4dor&3")
    raw = _verify_code(sent_emails, "verify")

    first = client.post("/v1/auth/verify-email", data={"token": raw}, format="json")
    second = client.post("/v1/auth/verify-email", data={"token": raw}, format="json")

    assert first.status_code == status.HTTP_200_OK, first.content
    assert second.status_code == status.HTTP_400_BAD_REQUEST, second.content
    assert second.json()["code"] == "token_invalid"
    account = EmailCredential.objects.get(email="replay@x.cz").account
    assert account.email_is_verified is True
    assert OneTimeToken.objects.get(account=account).used_at is not None
    assert client.get("/v1/account/me", **_auth(token)).json()["email_verified"] is True


# ===========================================================================
# 12. Account deletion (soft-delete + purge)
# ===========================================================================


@pytest.mark.django_db
def test_delete_account_soft_deletes_and_revokes_token(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "del@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="del@x.cz").account
    # CASCADE-bound personal data that must survive until the purge.
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbnhz",
        name="Pub",
        lat=50.0,
        lng=14.0,
        beer_name="Plzeň",
        price_czk=50,
        drank_at="2026-06-01T18:00:00Z",
    )
    push_device = PushDevice.objects.create(
        account=account,
        push_token="ExponentPushToken[deleteAccount]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
    )

    resp = client.delete("/v1/account/me", **_auth(token))
    assert resp.status_code == status.HTTP_204_NO_CONTENT

    account.refresh_from_db()
    push_device.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert account.deleted_at is not None
    assert push_device.enabled is False
    assert push_device.permission_status == PushDevice.PermissionStatus.DENIED

    # Token no longer authenticates. NOTE: schedule_deletion REVOKES (deletes)
    # all AuthToken rows before flipping status, so the presented token is gone
    # from the table → AccountTokenAuthentication answers "Invalid account token."
    # (it never reaches the "Account is no longer active." branch, which only
    # fires when a live token still points at a non-active account). Either way
    # the security guarantee — 401, no access — holds.
    me = client.get("/v1/account/me", **_auth(token))
    assert me.status_code == status.HTTP_401_UNAUTHORIZED
    assert me.json()["detail"] == "Invalid account token."

    # Tokens were revoked on schedule_deletion.
    assert AuthToken.objects.filter(account=account).count() == 0
    # CASCADE data still exists until purge.
    assert DrinkLog.objects.filter(pk=drink.pk).exists()


@pytest.mark.django_db
def test_live_token_on_non_active_account_is_rejected(client, sent_emails):
    """Directly exercise the AccountTokenAuthentication non-active guard.

    A token that outlives a status flip to PENDING_DELETION (i.e. without the
    token being revoked first) must still be refused with the dedicated message.
    """
    _, token = _register_and_token(client, "guard@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="guard@x.cz").account
    # Flip status WITHOUT revoking the token (bypass schedule_deletion).
    Account.objects.filter(pk=account.pk).update(status=Account.Status.PENDING_DELETION)

    me = client.get("/v1/account/me", **_auth(token))
    assert me.status_code == status.HTTP_401_UNAUTHORIZED
    assert me.json()["detail"] == "Account is no longer active."


@pytest.mark.django_db
def test_delete_account_with_apple_identity_revokes_apple_token(client, fake_oauth, sent_emails):
    # Apple-only account with a stored refresh token.
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-DEL:ad@x.cz",
            "authorization_code": "code",
        },
        format="json",
    )
    token = resp.json()["token"]
    assert AuthIdentity.objects.get(subject="A-DEL").apple_refresh_token == "rt_test"

    deleted = client.delete("/v1/account/me", **_auth(token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert "rt_test" in fake_oauth["revoked"]


@pytest.mark.django_db
def test_purge_command_hard_deletes_after_grace(client, fake_oauth, sent_emails):
    _, token = _register_and_token(client, "purge@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="purge@x.cz").account
    account_pk = account.pk

    client.delete("/v1/account/me", **_auth(token))
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION

    # --grace-days 0 makes every pending account immediately eligible.
    call_command("purge_deleted_accounts", "--grace-days", "0")

    with pytest.raises(Account.DoesNotExist):
        Account.objects.get(pk=account_pk)
    # CASCADE wiped the credential too.
    assert not EmailCredential.objects.filter(email="purge@x.cz").exists()


@pytest.mark.django_db
def test_purge_command_deletes_avatar_file_after_grace(
    client, fake_oauth, sent_emails, tmp_media
):
    _, token = _register_and_token(client, "purge-avatar@x.cz", "Tr0ub4dor&3")
    account = EmailCredential.objects.get(email="purge-avatar@x.cz").account
    account_pk = account.pk
    avatars_dir = tmp_media / "avatars"
    avatars_dir.mkdir()
    avatar_path = avatars_dir / f"{account.public_id}.webp"
    avatar_path.write_bytes(b"avatar")
    account.avatar = f"avatars/{account.public_id}.webp"
    account.save(update_fields=["avatar"])

    client.delete("/v1/account/me", **_auth(token))
    assert avatar_path.exists()

    call_command("purge_deleted_accounts", "--grace-days", "0")

    assert not avatar_path.exists()
    with pytest.raises(Account.DoesNotExist):
        Account.objects.get(pk=account_pk)


@pytest.mark.django_db
def test_purge_keeps_apple_account_when_revocation_fails(
    client, fake_oauth, sent_emails, monkeypatch
):
    resp = client.post(
        "/v1/auth/apple",
        data={
            "identity_token": "apple:A-PURGE-FAIL:pf@x.cz",
            "authorization_code": "code",
        },
        format="json",
    )
    token = resp.json()["token"]
    identity = AuthIdentity.objects.get(subject="A-PURGE-FAIL")
    account_pk = identity.account_id

    def fail_revoke(token: str, token_type_hint: str = "refresh_token") -> None:
        raise oauth.OAuthError("apple down")

    monkeypatch.setattr(oauth, "revoke_apple_token", fail_revoke)

    deleted = client.delete("/v1/account/me", **_auth(token))
    assert deleted.status_code == status.HTTP_204_NO_CONTENT

    call_command("purge_deleted_accounts", "--grace-days", "0")

    assert Account.objects.filter(pk=account_pk).exists()
    identity.refresh_from_db()
    assert identity.apple_refresh_token == "rt_test"

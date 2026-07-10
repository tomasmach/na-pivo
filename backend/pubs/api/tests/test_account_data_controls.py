from __future__ import annotations

import base64
import uuid

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs import emailer
from pubs.models import (
    Account,
    AuthIdentity,
    ContentReport,
    DrinkLog,
    EmailCredential,
    Friendship,
    PushDevice,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _bootstrap(client) -> tuple[str, str]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    return body["token"], body["id"]


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def test_account_export_email_uses_json_attachment(monkeypatch):
    captured: dict = {}

    def fake_send_email(to, subject, html, *, text=None, attachments=None):
        captured["to"] = to
        captured["subject"] = subject
        captured["html"] = html
        captured["text"] = text
        captured["attachments"] = attachments
        return True

    monkeypatch.setattr(emailer, "send_email", fake_send_email)

    result = emailer.send_account_export_email(
        "export@example.com",
        filename="na-pivo-export.json",
        json_bytes=b'{"ok": true}',
    )

    assert result is True
    assert captured["to"] == "export@example.com"
    attachment = captured["attachments"][0]
    assert attachment["filename"] == "na-pivo-export.json"
    assert attachment["content_type"] == "application/json"
    assert base64.b64decode(attachment["content"]) == b'{"ok": true}'


def test_send_email_logs_no_recipient_or_message_pii(settings, caplog):
    settings.EMAIL_ENABLED = False
    settings.RESEND_API_KEY = ""

    with caplog.at_level("INFO", logger="pubs.emailer"):
        sent = emailer.send_email(
            "person@example.com",
            "Private subject",
            "<p>Private body</p>",
            text="Private text",
        )

    assert sent is True
    assert "person@example.com" not in caplog.text
    assert "Private subject" not in caplog.text
    assert "Private body" not in caplog.text
    assert "Private text" not in caplog.text


def test_verification_email_renders_app_link(monkeypatch):
    captured: dict[str, str | None] = {}

    def fake_send_email(to, subject, html, *, text=None, attachments=None):
        captured["to"] = to
        captured["subject"] = subject
        captured["html"] = html
        captured["text"] = text
        return True

    monkeypatch.setattr(emailer, "send_email", fake_send_email)

    sent = emailer.send_verification_email(
        "person@example.com",
        link="https://api.na-pivo.cz/v1/auth/verify-email?token=verify-token",
        code="verify-token",
    )

    assert sent is True
    assert captured["to"] == "person@example.com"
    assert captured["subject"] == "Ověř si e-mail – Na Pivo"
    assert 'href="https://api.na-pivo.cz/v1/auth/verify-email?token=verify-token"' in captured[
        "html"
    ]
    assert "Ověřit e-mail" in captured["html"]
    assert "Kód pro ruční zadání" not in captured["html"]
    assert "https://api.na-pivo.cz/v1/auth/verify-email?token=verify-token" in (
        captured["text"] or ""
    )


@pytest.mark.django_db
def test_marketing_email_preference_is_returned_and_patchable(client):
    token, _ = _bootstrap(client)

    initial = client.get("/v1/account/me", **_auth(token))
    assert initial.status_code == status.HTTP_200_OK, initial.content
    assert initial.json()["settings"]["marketing_emails_enabled"] is False

    updated = client.patch(
        "/v1/account/me",
        data={"marketing_emails_enabled": True},
        format="json",
        **_auth(token),
    )

    assert updated.status_code == status.HTTP_200_OK, updated.content
    assert updated.json()["settings"]["marketing_emails_enabled"] is True
    assert Account.objects.get(public_id=updated.json()["id"]).marketing_emails_enabled is True


@pytest.mark.django_db
def test_restore_purchases_stores_pending_subscription_identifiers(client):
    token, account_id = _bootstrap(client)
    expires_at = timezone.now() + timezone.timedelta(days=30)

    resp = client.post(
        "/v1/account/me/purchases/restore",
        data={
            "platform": "apple",
            "product_id": "na_pivo_plus_monthly",
            "original_transaction_id": "1000000123456789",
            "expires_at": expires_at.isoformat(),
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_202_ACCEPTED, resp.content
    body = resp.json()["subscription"]
    assert body["tier"] == Account.SubscriptionTier.FREE
    assert body["status"] == Account.SubscriptionStatus.PENDING_VERIFICATION
    assert body["platform"] == "apple"
    assert body["product_id"] == "na_pivo_plus_monthly"
    assert body["original_transaction_id"] == "1000000123456789"

    account = Account.objects.get(public_id=account_id)
    assert account.subscription_status == Account.SubscriptionStatus.PENDING_VERIFICATION
    assert account.subscription_original_transaction_id == "1000000123456789"


@pytest.mark.django_db
def test_account_export_includes_diary_data_and_excludes_secrets(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        name="U Exportu",
        lat=50.08,
        lng=14.45,
        beer_name="Ležák",
        price_czk=59,
        volume_ml=500,
        drank_at=timezone.now(),
    )
    PushDevice.objects.create(
        account=account,
        push_token="ExponentPushToken[exportDevice]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=True,
        app_version="1.2.0",
    )

    resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Disposition"] == 'attachment; filename="na-pivo-export.json"'
    body = resp.json()
    assert body["account"]["id"] == account_id
    assert body["drinks"][0]["beer_name"] == "Ležák"
    assert body["drinks"][0]["drink_type"] == "beer"
    assert body["push_devices"] == [
        {
            "platform": "ios",
            "permission_status": "granted",
            "enabled": True,
            "app_version": "1.2.0",
            "created_at": body["push_devices"][0]["created_at"],
            "updated_at": body["push_devices"][0]["updated_at"],
            "last_registered_at": body["push_devices"][0]["last_registered_at"],
        }
    ]
    assert body["settings"]["marketing_emails_enabled"] is False
    serialized = str(body)
    assert "token_hash" not in serialized
    assert "password" not in serialized
    assert token not in serialized
    assert "ExponentPushToken[exportDevice]" not in serialized


@pytest.mark.django_db
def test_account_export_reuses_loaded_auth_relations(client):
    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="export@example.com",
        password="!",
        email_verified=True,
    )
    AuthIdentity.objects.create(
        account=account,
        provider=AuthIdentity.Provider.GOOGLE,
        subject="google-export",
        email="social@example.com",
    )

    with CaptureQueriesContext(connection) as queries:
        resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["account"]["email"] == "export@example.com"
    assert body["account"]["email_verified"] is True
    assert set(body["account"]["providers"]) == {"email", "google"}

    select_queries = [
        query["sql"].lower()
        for query in queries.captured_queries
        if query["sql"].lstrip().lower().startswith("select")
    ]
    assert sum('"pubs_emailcredential"' in sql for sql in select_queries) == 1
    assert sum('"pubs_authidentity"' in sql for sql in select_queries) == 1


@pytest.mark.django_db
def test_account_export_post_sends_json_export_by_email(client, monkeypatch):
    sent: dict = {}

    def fake_send_account_export_email(to, *, filename, json_bytes):
        sent["to"] = to
        sent["filename"] = filename
        sent["json_bytes"] = json_bytes
        return True

    monkeypatch.setattr(emailer, "send_account_export_email", fake_send_account_export_email)

    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="export@example.com",
        password="!",
        email_verified=True,
    )
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn12",
        name="U Exportu",
        lat=50.08,
        lng=14.45,
        beer_name="Ležák",
        price_czk=59,
        volume_ml=500,
        drank_at=timezone.now(),
    )

    resp = client.post("/v1/account/export", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_202_ACCEPTED, resp.content
    assert resp.json() == {"email": "export@example.com"}
    assert sent["to"] == "export@example.com"
    assert sent["filename"].startswith("na-pivo-export-")
    assert sent["filename"].endswith(".json")
    body = sent["json_bytes"].decode("utf-8")
    assert '"beer_name": "Ležák"' in body
    assert token not in body


@pytest.mark.django_db
def test_account_export_post_requires_verified_email_credential(client, monkeypatch):
    sent = False

    def fake_send_account_export_email(*args, **kwargs):
        nonlocal sent
        sent = True
        return True

    monkeypatch.setattr(emailer, "send_account_export_email", fake_send_account_export_email)

    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="unverified@example.com",
        password="!",
        email_verified=False,
    )

    # Direct authenticated download is still allowed.
    direct = client.get("/v1/account/export", **_auth(token))
    assert direct.status_code == status.HTTP_200_OK, direct.content
    assert direct.json()["account"]["email_verified"] is False

    emailed = client.post("/v1/account/export", data={}, format="json", **_auth(token))
    assert emailed.status_code == status.HTTP_403_FORBIDDEN, emailed.content
    assert emailed.json()["code"] == "email_unverified"
    assert sent is False


@pytest.mark.django_db
def test_account_export_post_requires_account_email(client):
    token, _ = _bootstrap(client)

    resp = client.post("/v1/account/export", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "missing_email"


@pytest.mark.django_db
def test_account_export_post_surfaces_email_failure(client, monkeypatch):
    monkeypatch.setattr(emailer, "send_account_export_email", lambda *args, **kwargs: False)

    token, account_id = _bootstrap(client)
    account = Account.objects.get(public_id=account_id)
    EmailCredential.objects.create(
        account=account,
        email="export@example.com",
        password="!",
        email_verified=True,
    )

    resp = client.post("/v1/account/export", data={}, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_502_BAD_GATEWAY, resp.content
    assert resp.json()["code"] == "email_failed"


@pytest.mark.django_db
def test_content_report_creates_moderation_record(client):
    reporter_token, _ = _bootstrap(client)
    target_token, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.is_public = True
    target.nickname = "BadName"
    target.display_name = "Bad Display"
    target.save(update_fields=["is_public", "nickname", "display_name"])

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.INAPPROPRIATE_NICKNAME,
            "comment": "Sprostá přezdívka.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    body = resp.json()
    assert body["target_account_id"] == target_id
    assert body["status"] == ContentReport.Status.NEW
    report = ContentReport.objects.get()
    assert report.target_snapshot["nickname"] == "BadName"
    assert report.target_snapshot["display_name"] == "Bad Display"

    self_report = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
        },
        format="json",
        **_auth(target_token),
    )
    assert self_report.status_code == status.HTTP_400_BAD_REQUEST
    assert self_report.json()["code"] == "self_report"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("is_public", "status_value"),
    [
        (False, Account.Status.ACTIVE),
        (True, Account.Status.PENDING_DELETION),
    ],
)
def test_content_report_requires_public_active_target(client, is_public, status_value):
    reporter_token, _ = _bootstrap(client)
    _, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.is_public = is_public
    target.status = status_value
    target.save(update_fields=["is_public", "status"])

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
            "comment": "Nemá být reportovatelný.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "profile_not_found"
    assert ContentReport.objects.count() == 0


@pytest.mark.django_db
def test_content_report_allows_reporting_non_public_accepted_friend(client):
    # A non-public profile that is an accepted friend (visible via friends
    # dashboard / RSVP roster) must stay reportable for moderation.
    reporter_token, reporter_id = _bootstrap(client)
    _, target_id = _bootstrap(client)
    reporter = Account.objects.get(public_id=reporter_id)
    target = Account.objects.get(public_id=target_id)
    target.is_public = False
    target.nickname = "PrivatePal"
    target.save(update_fields=["is_public", "nickname"])
    Friendship.objects.create(
        requester=reporter,
        recipient=target,
        status=Friendship.Status.ACCEPTED,
    )

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
            "comment": "Nevhodný obsah u kamaráda.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    report = ContentReport.objects.get()
    assert report.target_account_id == target.pk
    assert report.target_snapshot["nickname"] == "PrivatePal"


@pytest.mark.django_db
def test_content_report_allows_reporting_non_public_pending_requester(client):
    # A non-public account that sent the reporter a friend request is shown to
    # them in the friends dashboard's incoming-requests list, so an abusive
    # requester must stay reportable even though the request is only pending.
    reporter_token, reporter_id = _bootstrap(client)
    _, target_id = _bootstrap(client)
    reporter = Account.objects.get(public_id=reporter_id)
    target = Account.objects.get(public_id=target_id)
    target.is_public = False
    target.nickname = "PushyStranger"
    target.save(update_fields=["is_public", "nickname"])
    Friendship.objects.create(
        requester=target,
        recipient=reporter,
        status=Friendship.Status.PENDING,
    )

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
            "comment": "Otravná žádost s nevhodným jménem.",
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    report = ContentReport.objects.get()
    assert report.target_account_id == target.pk
    assert report.target_snapshot["nickname"] == "PushyStranger"


@pytest.mark.django_db
def test_content_report_rejects_non_public_stranger(client):
    # Without an accepted friendship, a non-public profile stays invisible and
    # therefore unreportable (404), so reports cannot probe private accounts.
    reporter_token, _ = _bootstrap(client)
    _, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.is_public = False
    target.save(update_fields=["is_public"])

    resp = client.post(
        "/v1/content-reports",
        data={
            "target_account_id": target_id,
            "reason": ContentReport.Reason.OTHER,
        },
        format="json",
        **_auth(reporter_token),
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["code"] == "profile_not_found"
    assert ContentReport.objects.count() == 0

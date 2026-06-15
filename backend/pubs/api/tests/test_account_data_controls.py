from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, ContentReport, DrinkLog


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

    resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Disposition"] == 'attachment; filename="na-pivo-export.json"'
    body = resp.json()
    assert body["account"]["id"] == account_id
    assert body["drinks"][0]["beer_name"] == "Ležák"
    assert body["settings"]["marketing_emails_enabled"] is False
    serialized = str(body)
    assert "token_hash" not in serialized
    assert "password" not in serialized
    assert token not in serialized


@pytest.mark.django_db
def test_content_report_creates_moderation_record(client):
    reporter_token, _ = _bootstrap(client)
    target_token, target_id = _bootstrap(client)
    target = Account.objects.get(public_id=target_id)
    target.nickname = "BadName"
    target.display_name = "Bad Display"
    target.save(update_fields=["nickname", "display_name"])

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

"""
Tests for the in-app feedback / bug-report endpoint and its Linear sync command.
"""

from __future__ import annotations

from unittest import mock

import pytest
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, FeedbackReport

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_CLIENT_ID = "9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d"


@pytest.fixture
def client():
    return APIClient()


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(**overrides):
    data = {
        "client_id": _CLIENT_ID,
        "category": "bug",
        "message": "Aplikace spadne při otevření kompasu.",
        "contact_type": "email",
        "contact": "user@example.com",
        "app_version": "v1.2.0 (42)",
        "platform": "ios",
        "os_version": "17.4",
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_create_feedback(client):
    token = _register(client)

    resp = client.post("/v1/feedback", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["client_id"] == _CLIENT_ID
    assert body["category"] == "bug"
    assert body["message"] == "Aplikace spadne při otevření kompasu."
    assert body["status"] == "new"

    report = FeedbackReport.objects.get()
    assert report.account == Account.objects.get(device_id=_DEVICE_ID)
    assert str(report.client_id) == _CLIENT_ID
    assert report.contact_type == FeedbackReport.ContactType.EMAIL
    assert report.contact == "user@example.com"
    assert report.app_version == "v1.2.0 (42)"
    assert report.platform == "ios"
    assert report.os_version == "17.4"
    assert report.status == FeedbackReport.Status.NEW


@pytest.mark.django_db
def test_create_feedback_is_idempotent_per_account_client_id(client):
    token = _register(client)
    first = client.post("/v1/feedback", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post(
        "/v1/feedback",
        data=_payload(message="Aktualizovaný popis.", category="idea"),
        format="json",
        **_auth(token),
    )

    assert second.status_code == status.HTTP_200_OK
    assert FeedbackReport.objects.count() == 1
    report = FeedbackReport.objects.get()
    assert report.message == "Aktualizovaný popis."
    assert report.category == "idea"


@pytest.mark.django_db
def test_create_feedback_requires_account_token(client):
    resp = client.post("/v1/feedback", data=_payload(), format="json")

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert FeedbackReport.objects.count() == 0


@pytest.mark.django_db
def test_create_feedback_without_contact(client):
    token = _register(client)

    payload = _payload()
    payload.pop("contact_type")
    payload.pop("contact")
    resp = client.post("/v1/feedback", data=payload, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["contact_type"] == ""
    assert body["contact"] == ""
    report = FeedbackReport.objects.get()
    assert report.contact_type == ""
    assert report.contact == ""


@pytest.mark.django_db
def test_create_feedback_instagram_handle_is_normalized(client):
    token = _register(client)

    resp = client.post(
        "/v1/feedback",
        data=_payload(contact_type="instagram", contact="@pivni_kompas"),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["contact_type"] == "instagram"
    assert body["contact"] == "pivni_kompas"
    report = FeedbackReport.objects.get()
    assert report.contact_type == FeedbackReport.ContactType.INSTAGRAM
    assert report.contact == "pivni_kompas"


@pytest.mark.django_db
def test_create_feedback_contact_requires_contact_type(client):
    token = _register(client)

    resp = client.post(
        "/v1/feedback",
        data=_payload(contact_type="", contact="user@example.com"),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert "contact_type" in resp.json()
    assert FeedbackReport.objects.count() == 0


@pytest.mark.django_db
def test_create_feedback_email_contact_must_be_valid(client):
    token = _register(client)

    resp = client.post(
        "/v1/feedback",
        data=_payload(contact_type="email", contact="not-an-email"),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert "contact" in resp.json()
    assert FeedbackReport.objects.count() == 0


@pytest.mark.django_db
def test_create_feedback_validation(client):
    token = _register(client)

    missing_message = client.post(
        "/v1/feedback",
        data=_payload(message=""),
        format="json",
        **_auth(token),
    )
    blank_message = client.post(
        "/v1/feedback",
        data=_payload(message="   "),
        format="json",
        **_auth(token),
    )
    bad_category = client.post(
        "/v1/feedback",
        data=_payload(category="spam"),
        format="json",
        **_auth(token),
    )
    too_long = client.post(
        "/v1/feedback",
        data=_payload(message="x" * 4001),
        format="json",
        **_auth(token),
    )

    assert missing_message.status_code == status.HTTP_400_BAD_REQUEST
    assert blank_message.status_code == status.HTTP_400_BAD_REQUEST
    assert bad_category.status_code == status.HTTP_400_BAD_REQUEST
    assert too_long.status_code == status.HTTP_400_BAD_REQUEST
    assert FeedbackReport.objects.count() == 0


# ---------------------------------------------------------------------------
# sync_feedback_linear management command
# ---------------------------------------------------------------------------


def _make_feedback() -> FeedbackReport:
    return FeedbackReport.objects.create(
        account=None,
        client_id=_CLIENT_ID,
        category=FeedbackReport.Category.BUG,
        message="Crash on launch",
        contact_type=FeedbackReport.ContactType.INSTAGRAM,
        contact="pivni_kompas",
        app_version="v1.2.0 (42)",
        platform="ios",
    )


@pytest.mark.django_db
def test_sync_feedback_linear_creates_issue(settings):
    settings.LINEAR_API_KEY = "lin_api_key"
    settings.LINEAR_TEAM_ID = "team-123"
    report = _make_feedback()

    fake_resp = mock.Mock()
    fake_resp.raise_for_status.return_value = None
    fake_resp.json.return_value = {
        "data": {
            "issueCreate": {
                "success": True,
                "issue": {
                    "id": "uuid-1",
                    "identifier": "ABC-123",
                    "url": "https://linear.app/team/issue/ABC-123",
                },
            }
        }
    }

    with mock.patch("requests.post", return_value=fake_resp) as mocked:
        call_command("sync_feedback_linear", "--limit", "20")

    assert mocked.called
    description = mocked.call_args.kwargs["json"]["variables"]["input"]["description"]
    assert "Kontakt: instagram @pivni_kompas" in description
    report.refresh_from_db()
    assert report.linear_issue_id == "ABC-123"
    assert report.linear_issue_url == "https://linear.app/team/issue/ABC-123"
    assert report.linear_synced_at is not None


@pytest.mark.django_db
def test_sync_feedback_linear_noop_without_env(settings):
    settings.LINEAR_API_KEY = ""
    settings.LINEAR_TEAM_ID = ""
    report = _make_feedback()

    with mock.patch("requests.post") as mocked:
        call_command("sync_feedback_linear")

    assert not mocked.called
    report.refresh_from_db()
    assert report.linear_issue_id == ""
    assert report.linear_synced_at is None

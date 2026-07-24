"""
Tests for the in-app feedback / bug-report endpoint and its Linear sync command.
"""

from __future__ import annotations

import io
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, EmailCredential, FeedbackReport

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_CLIENT_ID = "9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return tmp_path / "media"


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


def _image_upload(*, name: str = "screenshot.png") -> SimpleUploadedFile:
    output = io.BytesIO()
    Image.new("RGB", (1800, 900), (232, 163, 23)).save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


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
def test_create_feedback_with_attachment_is_reencoded_and_linked(client, media_root):
    token = _register(client)
    payload = _payload()
    payload["attachment"] = _image_upload()

    resp = client.post("/v1/feedback", data=payload, format="multipart", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    report = FeedbackReport.objects.get()
    assert report.attachment.name.endswith(".webp")
    assert "/media/feedback-attachments/" in report.attachment_url
    assert resp.json()["attachment_url"] == report.attachment_url
    with report.attachment.open("rb") as stored_file:
        with Image.open(stored_file) as stored:
            assert stored.format == "WEBP"
            assert max(stored.size) == 1440
            assert stored.getexif() == {}


@pytest.mark.django_db
def test_feedback_attachment_retry_does_not_create_second_file(client, media_root):
    token = _register(client)
    first_payload = _payload(attachment=_image_upload())
    first = client.post(
        "/v1/feedback", data=first_payload, format="multipart", **_auth(token)
    )
    assert first.status_code == status.HTTP_201_CREATED
    original_name = FeedbackReport.objects.get().attachment.name

    retry_payload = _payload(attachment=_image_upload(name="retry.jpg"))
    retry = client.post(
        "/v1/feedback", data=retry_payload, format="multipart", **_auth(token)
    )

    assert retry.status_code == status.HTTP_200_OK
    report = FeedbackReport.objects.get()
    assert report.attachment.name == original_name
    assert len(list(media_root.rglob("*.webp"))) == 1


@pytest.mark.django_db
def test_feedback_attachment_rejects_invalid_and_oversized_files(client, settings):
    token = _register(client)
    invalid = client.post(
        "/v1/feedback",
        data={
            **_payload(),
            "attachment": SimpleUploadedFile(
                "not-a-photo.jpg", b"not an image", content_type="image/jpeg"
            ),
        },
        format="multipart",
        **_auth(token),
    )
    settings.FEEDBACK_ATTACHMENT_MAX_UPLOAD_BYTES = 3
    oversized = client.post(
        "/v1/feedback",
        data={
            **_payload(),
            "attachment": SimpleUploadedFile(
                "large.jpg", b"1234", content_type="image/jpeg"
            ),
        },
        format="multipart",
        **_auth(token),
    )

    assert invalid.status_code == status.HTTP_400_BAD_REQUEST
    assert invalid.json()["code"] == "attachment_invalid"
    assert oversized.status_code == status.HTTP_400_BAD_REQUEST
    assert oversized.json()["code"] == "attachment_too_large"
    assert FeedbackReport.objects.count() == 0


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


def _make_feedback(*, account: Account | None = None) -> FeedbackReport:
    return FeedbackReport.objects.create(
        account=account,
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
    account = Account.objects.create(
        device_id=_DEVICE_ID,
        nickname="pivni_tester",
        display_name="Pivní Tester",
    )
    EmailCredential.objects.create(
        account=account,
        email="tester@example.com",
        password="unused-test-hash",
        email_verified=True,
    )
    report = _make_feedback(account=account)

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
    assert "- Účet: přihlášený" in description
    assert f"- Veřejné ID účtu: {account.public_id}" in description
    assert f"- Interní ID účtu: {account.pk}" in description
    assert "- Přezdívka: @pivni_tester" in description
    assert "- Jméno: Pivní Tester" in description
    assert "- E-mail účtu: tester@example.com" in description
    report.refresh_from_db()
    assert report.linear_issue_id == "ABC-123"
    assert report.linear_issue_url == "https://linear.app/team/issue/ABC-123"
    assert report.linear_synced_at is not None


@pytest.mark.django_db
def test_sync_feedback_linear_marks_unclaimed_account_as_anonymous(settings):
    settings.LINEAR_API_KEY = "lin_api_key"
    settings.LINEAR_TEAM_ID = "team-123"
    account = Account.objects.create(device_id=_DEVICE_ID)
    _make_feedback(account=account)

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
        call_command("sync_feedback_linear")

    description = mocked.call_args.kwargs["json"]["variables"]["input"]["description"]
    assert "- Účet: anonymní zařízení" in description
    assert f"- Veřejné ID účtu: {account.public_id}" in description
    assert "- Přezdívka:" not in description
    assert "- E-mail účtu:" not in description


@pytest.mark.django_db
def test_sync_feedback_linear_embeds_attachment_link(settings):
    settings.LINEAR_API_KEY = "lin_api_key"
    settings.LINEAR_TEAM_ID = "team-123"
    report = _make_feedback()
    report.attachment_url = "https://api.napivo.app/media/feedback-attachments/a/b.webp"
    report.save(update_fields=["attachment_url"])
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
        call_command("sync_feedback_linear")

    description = mocked.call_args.kwargs["json"]["variables"]["input"]["description"]
    assert "![Příloha z aplikace](https://api.napivo.app/media/" in description


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

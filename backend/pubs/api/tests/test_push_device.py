from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, PushDevice

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11111111-2222-3333-8444-555555555555"
_PUSH_TOKEN = "ExponentPushToken[abc123]"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.mark.django_db
def test_push_device_requires_authentication(client):
    resp = client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN, "platform": "ios"},
        format="json",
    )

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PushDevice.objects.count() == 0


@pytest.mark.django_db
def test_push_device_registers_token_without_echoing_it(client):
    token = _register(client)
    account = Account.objects.get(device_id=_DEVICE_ID)

    resp = client.put(
        "/v1/push-device",
        data={
            "push_token": _PUSH_TOKEN,
            "platform": "ios",
            "permission_status": "granted",
            "enabled": True,
            "app_version": "1.2.0",
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert "push_token" not in body
    assert body["platform"] == "ios"
    assert body["permission_status"] == "granted"
    assert body["enabled"] is True

    device = PushDevice.objects.get()
    assert device.account == account
    assert device.push_token == _PUSH_TOKEN
    assert device.app_version == "1.2.0"


@pytest.mark.django_db
def test_push_device_register_error_does_not_log_push_token(client, monkeypatch, caplog):
    token = _register(client)

    def boom(*args, **kwargs):  # noqa: ARG001
        raise RuntimeError(f"database rejected {_PUSH_TOKEN}")

    monkeypatch.setattr(PushDevice.objects, "update_or_create", boom)

    with caplog.at_level("ERROR", logger="pubs.api.views"):
        resp = client.put(
            "/v1/push-device",
            data={
                "push_token": _PUSH_TOKEN,
                "platform": "ios",
                "permission_status": "granted",
                "enabled": True,
            },
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert _PUSH_TOKEN not in caplog.text


@pytest.mark.django_db
def test_push_device_upsert_moves_existing_token_to_current_account(client):
    first_token = _register(client)
    second_token = _register(client, _OTHER_DEVICE_ID)
    second_account = Account.objects.get(device_id=_OTHER_DEVICE_ID)

    first = client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN, "platform": "ios"},
        format="json",
        **_auth(first_token),
    )
    second = client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN, "platform": "android", "app_version": "1.2.1"},
        format="json",
        **_auth(second_token),
    )

    assert first.status_code == status.HTTP_200_OK
    assert second.status_code == status.HTTP_200_OK
    assert PushDevice.objects.count() == 1
    device = PushDevice.objects.get(push_token=_PUSH_TOKEN)
    assert device.account == second_account
    assert device.platform == PushDevice.Platform.ANDROID
    assert device.app_version == "1.2.1"


@pytest.mark.django_db
def test_push_device_delete_disables_matching_token(client):
    token = _register(client)
    client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN, "platform": "ios"},
        format="json",
        **_auth(token),
    )

    resp = client.delete(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"disabled": 1}
    device = PushDevice.objects.get()
    assert device.enabled is False
    assert device.permission_status == PushDevice.PermissionStatus.DENIED


@pytest.mark.django_db
def test_push_device_delete_error_does_not_log_push_token(client, monkeypatch, caplog):
    token = _register(client)

    class FailingQuerySet:
        def update(self, **kwargs):  # noqa: ARG002
            raise RuntimeError(f"database rejected {_PUSH_TOKEN}")

    monkeypatch.setattr(PushDevice.objects, "filter", lambda *args, **kwargs: FailingQuerySet())

    with caplog.at_level("ERROR", logger="pubs.api.views"):
        resp = client.delete(
            "/v1/push-device",
            data={"push_token": _PUSH_TOKEN},
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert _PUSH_TOKEN not in caplog.text


@pytest.mark.django_db
def test_push_device_rejects_unknown_platform(client):
    token = _register(client)

    resp = client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN, "platform": "web"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PushDevice.objects.count() == 0


@pytest.mark.django_db
def test_push_device_rejects_invalid_push_token(client):
    token = _register(client)

    resp = client.put(
        "/v1/push-device",
        data={"push_token": "not-a-real-token", "platform": "ios"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PushDevice.objects.count() == 0


@pytest.mark.django_db
def test_push_device_delete_requires_valid_token(client):
    token = _register(client)

    resp = client.delete(
        "/v1/push-device",
        data={"push_token": ""},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_400_BAD_REQUEST

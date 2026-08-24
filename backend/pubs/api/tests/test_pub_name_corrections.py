"""
Tests for POST /v1/pub-name-corrections.
"""

from __future__ import annotations

import pytest
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.ugc_consent import UGC_POLICY_HEADER
from pubs.enrichment import geohash8
from pubs.models import Account, PubNameCorrection

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_CLIENT_ID = "aaaaaaaa-1111-2222-3333-444444444444"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _generous_throttle(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "account": "10000/min",
            "pub_reports": "10000/min",
        },
    }


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(**overrides):
    data = {
        "client_id": _CLIENT_ID,
        "name": "Hospoda U Testu",
        "suggested_name": "U Testu po novém",
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "address": "Testovací 12",
        "external_id": "mapy:50.08120,14.41820",
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_name_correction_requires_account_token(client):
    resp = client.post("/v1/pub-name-corrections", data=_payload(), format="json")

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubNameCorrection.objects.count() == 0


@pytest.mark.django_db
def test_name_correction_creates_row(client):
    token = _register(client)

    resp = client.post(
        "/v1/pub-name-corrections",
        data=_payload(),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["cache_key"] == _KEY
    assert body["original_name"] == "Hospoda U Testu"
    assert body["suggested_name"] == "U Testu po novém"
    assert body["active"] is True

    correction = PubNameCorrection.objects.get()
    assert correction.account == Account.objects.get(device_id=_DEVICE_ID)
    assert correction.client_id.hex == _CLIENT_ID.replace("-", "")
    assert correction.cache_key == _KEY
    assert correction.external_id == "mapy:50.08120,14.41820"


@pytest.mark.django_db
def test_name_correction_is_idempotent_on_account_client_id(client):
    token = _register(client)
    first = client.post(
        "/v1/pub-name-corrections",
        data=_payload(),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post(
        "/v1/pub-name-corrections",
        data=_payload(suggested_name="Jiný pokus"),
        format="json",
        **_auth(token),
    )

    assert second.status_code == status.HTTP_200_OK
    assert PubNameCorrection.objects.count() == 1
    assert PubNameCorrection.objects.get().suggested_name == "U Testu po novém"
    assert second.json()["suggested_name"] == "U Testu po novém"


@pytest.mark.django_db
def test_name_correction_validation(client):
    token = _register(client)

    blank_name = client.post(
        "/v1/pub-name-corrections",
        data=_payload(suggested_name="   "),
        format="json",
        **_auth(token),
    )
    bad_lat = client.post(
        "/v1/pub-name-corrections",
        data=_payload(lat=999),
        format="json",
        **_auth(token),
    )

    assert blank_name.status_code == status.HTTP_400_BAD_REQUEST
    assert bad_lat.status_code == status.HTTP_400_BAD_REQUEST
    assert PubNameCorrection.objects.count() == 0


# ---------------------------------------------------------------------------
# UGC consent gating (RED — writes are not gated yet)
# ---------------------------------------------------------------------------


def _policy_header() -> dict[str, str]:
    return {
        "HTTP_" + UGC_POLICY_HEADER.replace("-", "_").upper(): settings.UGC_POLICY_VERSION
    }


@pytest.mark.django_db
def test_name_correction_with_current_header_and_no_acceptance_returns_428(client):
    token = _register(client)

    denied = client.post(
        "/v1/pub-name-corrections",
        data=_payload(),
        format="json",
        **_auth(token),
        **_policy_header(),
    )

    assert denied.status_code == 428, denied.content
    assert denied.json()["code"] == "ugc_consent_required"
    assert PubNameCorrection.objects.count() == 0

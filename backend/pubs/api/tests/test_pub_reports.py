"""
Tests for reporting pubs that should be hidden from the compass.
"""

from __future__ import annotations

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import geohash8
from pubs.models import Account, EnrichTask, PubHours, PubReport

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11111111-2222-3333-4444-555555555555"
_NAME = "Palačinkárna U Testu"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)


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
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "address": "Testovací 12",
        "external_id": "mapy:50.08120,14.41820",
        "reason": "not_pub",
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_create_pub_report(client):
    token = _register(client)

    resp = client.post("/v1/pub-reports", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["cache_key"] == _KEY
    assert body["name"] == _NAME
    assert body["reason"] == "not_pub"
    assert body["active"] is True

    report = PubReport.objects.get()
    assert report.account == Account.objects.get(device_id=_DEVICE_ID)
    assert report.cache_key == _KEY
    assert report.external_id == "mapy:50.08120,14.41820"


@pytest.mark.django_db
def test_create_pub_report_deletes_cached_hours_and_enrich_task(client):
    token = _register(client)
    PubHours.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        status=PubHours.Status.OK,
    )
    EnrichTask.objects.create(cache_key=_KEY, name=_NAME, lat=_LAT, lng=_LNG)

    resp = client.post("/v1/pub-reports", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    assert not PubHours.objects.filter(cache_key=_KEY).exists()
    assert not EnrichTask.objects.filter(cache_key=_KEY).exists()


@pytest.mark.django_db
def test_create_pub_report_is_idempotent_per_account_key_reason(client):
    token = _register(client)
    first = client.post("/v1/pub-reports", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post(
        "/v1/pub-reports",
        data=_payload(name="Aktualizovaný název", address="Nová 1"),
        format="json",
        **_auth(token),
    )

    assert second.status_code == status.HTTP_200_OK
    assert PubReport.objects.count() == 1
    report = PubReport.objects.get()
    assert report.name == "Aktualizovaný název"
    assert report.address == "Nová 1"


@pytest.mark.django_db
def test_create_pub_report_requires_account_token(client):
    resp = client.post("/v1/pub-reports", data=_payload(), format="json")

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubReport.objects.count() == 0


@pytest.mark.django_db
def test_create_pub_report_validation(client):
    token = _register(client)

    bad_reason = client.post(
        "/v1/pub-reports",
        data=_payload(reason="bad"),
        format="json",
        **_auth(token),
    )
    bad_lat = client.post(
        "/v1/pub-reports",
        data=_payload(lat=999),
        format="json",
        **_auth(token),
    )

    assert bad_reason.status_code == status.HTTP_400_BAD_REQUEST
    assert bad_lat.status_code == status.HTTP_400_BAD_REQUEST
    assert PubReport.objects.count() == 0


@pytest.mark.django_db
def test_blocked_reports_returns_active_reports_in_radius_for_all_accounts(client):
    token = _register(client)
    other_token = _register(client, _OTHER_DEVICE_ID)
    client.post("/v1/pub-reports", data=_payload(reason="closed"), format="json", **_auth(token))
    client.post(
        "/v1/pub-reports",
        data=_payload(
            name="Jiná restaurace",
            lat=_LAT + 0.001,
            lng=_LNG + 0.001,
            external_id="mapy:other",
            reason="not_pub",
        ),
        format="json",
        **_auth(other_token),
    )
    far = PubReport.objects.create(
        account=Account.objects.get(device_id=_DEVICE_ID),
        cache_key=geohash8(49.2, 16.6),
        external_id="mapy:far",
        name="Daleko",
        lat=49.2,
        lng=16.6,
        reason=PubReport.Reason.CLOSED,
    )
    inactive = PubReport.objects.create(
        account=Account.objects.get(device_id=_DEVICE_ID),
        cache_key=geohash8(_LAT + 0.002, _LNG + 0.002),
        external_id="mapy:inactive",
        name="Neaktivní",
        lat=_LAT + 0.002,
        lng=_LNG + 0.002,
        reason=PubReport.Reason.NOT_PUB,
        active=False,
    )

    resp = client.get(
        "/v1/pub-reports/blocked",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )

    assert resp.status_code == status.HTTP_200_OK
    blocked = resp.json()["blocked"]
    external_ids = {entry["external_id"] for entry in blocked}
    assert external_ids == {"mapy:50.08120,14.41820", "mapy:other"}
    assert far.external_id not in external_ids
    assert inactive.external_id not in external_ids
    assert set(blocked[0]) == {"cache_key", "external_id", "reason"}


def test_blocked_reports_validates_query(client):
    resp = client.get("/v1/pub-reports/blocked", data={"lat": 999, "lng": 14.4})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST

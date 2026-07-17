"""
Tests for reporting pubs that should be hidden from the compass.
"""

from __future__ import annotations

import pytest
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.enrichment import geohash8
from pubs.models import Account, EnrichTask, PubHours, PubReport

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11111111-2222-3333-4444-555555555555"
_THIRD_DEVICE_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa"
_NAME = "Palačinkárna U Testu"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


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
def test_create_pub_report_preserves_cached_hours_and_enrich_task(client):
    token = _register(client)
    hours = PubHours.objects.create(
        cache_key=_KEY,
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        status=PubHours.Status.OK,
    )
    task = EnrichTask.objects.create(cache_key=_KEY, name=_NAME, lat=_LAT, lng=_LNG)

    resp = client.post("/v1/pub-reports", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    assert PubHours.objects.filter(pk=hours.pk, cache_key=_KEY).exists()
    assert EnrichTask.objects.filter(pk=task.pk, cache_key=_KEY).exists()


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
def test_create_pub_report_is_throttled(client, monkeypatch):
    token = _register(client)
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"pub_reports": "2/min"})

    for i in range(2):
        resp = client.post(
            "/v1/pub-reports",
            data=_payload(lat=_LAT + (i * 0.001), lng=_LNG + (i * 0.001)),
            format="json",
            **_auth(token),
        )
        assert resp.status_code == status.HTTP_201_CREATED

    throttled = client.post(
        "/v1/pub-reports",
        data=_payload(lat=_LAT + 0.003, lng=_LNG + 0.003),
        format="json",
        **_auth(token),
    )

    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_blocked_reports_requires_three_distinct_active_accounts(client):
    token = _register(client)
    other_token = _register(client, _OTHER_DEVICE_ID)
    third_token = _register(client, _THIRD_DEVICE_ID)

    # One account can report both reasons, but it still contributes one vote.
    client.post("/v1/pub-reports", data=_payload(reason="closed"), format="json", **_auth(token))
    client.post(
        "/v1/pub-reports",
        data=_payload(reason="not_pub"),
        format="json",
        **_auth(token),
    )
    client.post(
        "/v1/pub-reports",
        data=_payload(reason="not_pub"),
        format="json",
        **_auth(other_token),
    )

    below_threshold = client.get(
        "/v1/pub-reports/blocked",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )
    assert below_threshold.status_code == status.HTTP_200_OK
    assert below_threshold.json()["blocked"] == []

    client.post(
        "/v1/pub-reports",
        data=_payload(reason="closed"),
        format="json",
        **_auth(third_token),
    )
    far = None
    for device_id in (_DEVICE_ID, _OTHER_DEVICE_ID, _THIRD_DEVICE_ID):
        far = PubReport.objects.create(
            account=Account.objects.get(device_id=device_id),
            cache_key=geohash8(49.2, 16.6),
            external_id="mapy:far",
            name="Daleko",
            lat=49.2,
            lng=16.6,
            reason=PubReport.Reason.CLOSED,
        )
    assert far is not None
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
    assert len(blocked) == 1
    assert blocked[0]["cache_key"] == _KEY
    assert blocked[0]["external_id"] == "mapy:50.08120,14.41820"
    assert far.external_id != blocked[0]["external_id"]
    assert inactive.external_id != blocked[0]["external_id"]
    assert set(blocked[0]) == {"cache_key", "external_id", "reason"}

    # Consensus is derived live: removing one vote restores the pub globally.
    PubReport.objects.filter(
        account__device_id=_THIRD_DEVICE_ID,
        cache_key=_KEY,
        reason=PubReport.Reason.CLOSED,
    ).update(active=False)
    assert client.get(
        "/v1/pub-reports/blocked",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    ).json()["blocked"] == []


@pytest.mark.django_db
def test_blocked_reports_ignore_inactive_or_deleted_accounts(client, settings):
    settings.PUB_REPORT_GLOBAL_HIDE_THRESHOLD = 2
    active = Account.objects.create(device_id="active-reporter")
    pending = Account.objects.create(
        device_id="pending-reporter",
        status=Account.Status.PENDING_DELETION,
    )
    for account in (active, pending, None):
        PubReport.objects.create(
            account=account,
            cache_key=_KEY,
            external_id="mapy:test",
            name=_NAME,
            lat=_LAT,
            lng=_LNG,
            reason=PubReport.Reason.CLOSED,
        )

    resp = client.get(
        "/v1/pub-reports/blocked",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["blocked"] == []

    second_active = Account.objects.create(device_id="second-active-reporter")
    PubReport.objects.create(
        account=second_active,
        cache_key=_KEY,
        external_id="mapy:test",
        name=_NAME,
        lat=_LAT,
        lng=_LNG,
        reason=PubReport.Reason.NOT_PUB,
    )

    assert client.get(
        "/v1/pub-reports/blocked",
        data={"lat": _LAT, "lng": _LNG, "radius_km": 1},
    ).json()["blocked"] != []


def test_blocked_reports_validates_query(client):
    resp = client.get("/v1/pub-reports/blocked", data={"lat": 999, "lng": 14.4})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST

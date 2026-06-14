"""
Tests for the per-user explicit pub-visit endpoints:

    POST   /v1/pub-visits              — push one visit (upsert)
    GET    /v1/pub-visits              — list all visits
    DELETE /v1/pub-visits/<client_id>  — idempotent delete

Covers idempotent upsert (replay + ended_at fill-in), geohash cache_key,
account isolation, auth, DELETE idempotence and throttling.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.enrichment import geohash8
from pubs.models import Account, PubVisit

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11112222-3333-4444-5555-666677778888"
_CLIENT_ID = "9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d"
_NAME = "U Zlatého tygra"
_LAT = 50.0876
_LNG = 14.4214
_KEY = geohash8(_LAT, _LNG)


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


def _payload(**overrides):
    data = {
        "client_id": _CLIENT_ID,
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "external_id": "mapy:50.08755,14.42141",
        "started_at": "2026-06-12T19:00:00+02:00",
        "ended_at": None,
        "updated_at": "2026-06-12T19:00:00+02:00",
    }
    data.update(overrides)
    return data


# ---------------------------------------------------------------------------
# Auth + validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_post_requires_account_token(client):
    resp = client.post("/v1/pub-visits", data=_payload(), format="json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubVisit.objects.count() == 0


@pytest.mark.django_db
def test_get_requires_account_token(client):
    resp = client.get("/v1/pub-visits")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_delete_requires_account_token(client):
    resp = client.delete(f"/v1/pub-visits/{_CLIENT_ID}")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_post_validation_errors(client):
    token = _register(client)

    missing_client_id = client.post(
        "/v1/pub-visits",
        data={k: v for k, v in _payload().items() if k != "client_id"},
        format="json",
        **_auth(token),
    )
    missing_started_at = client.post(
        "/v1/pub-visits",
        data={k: v for k, v in _payload().items() if k != "started_at"},
        format="json",
        **_auth(token),
    )
    missing_name = client.post(
        "/v1/pub-visits",
        data={k: v for k, v in _payload().items() if k != "name"},
        format="json",
        **_auth(token),
    )
    bad_lat = client.post("/v1/pub-visits", data=_payload(lat=999), format="json", **_auth(token))
    ended_before_started = client.post(
        "/v1/pub-visits",
        data=_payload(ended_at="2026-06-12T18:59:59+02:00"),
        format="json",
        **_auth(token),
    )

    for resp in (
        missing_client_id,
        missing_started_at,
        missing_name,
        bad_lat,
        ended_before_started,
    ):
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubVisit.objects.count() == 0


# ---------------------------------------------------------------------------
# Happy path + geohash cache_key
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_post_creates_visit_with_geohash_cache_key(client):
    token = _register(client)
    resp = client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json() == {
        "accepted": True,
        "duplicate": False,
        "cache_key": _KEY,
        "applied": True,
    }

    visit = PubVisit.objects.get()
    assert visit.account == Account.objects.get(device_id=_DEVICE_ID)
    assert str(visit.client_id) == _CLIENT_ID
    assert visit.cache_key == _KEY
    assert visit.name == _NAME
    assert visit.city == "Praha"
    assert visit.external_id == "mapy:50.08755,14.42141"
    assert visit.started_at.isoformat() == "2026-06-12T17:00:00+00:00"
    assert visit.ended_at is None
    assert visit.client_updated_at.isoformat() == "2026-06-12T17:00:00+00:00"


@pytest.mark.django_db
def test_post_with_ended_at(client):
    token = _register(client)
    resp = client.post(
        "/v1/pub-visits",
        data=_payload(ended_at="2026-06-12T23:30:00+02:00"),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_201_CREATED
    assert PubVisit.objects.get().ended_at.isoformat() == "2026-06-12T21:30:00+00:00"


# ---------------------------------------------------------------------------
# Idempotent upsert
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_replay_same_client_id_is_duplicate(client):
    token = _register(client)
    first = client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED
    assert first.json()["duplicate"] is False

    second = client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))
    assert second.status_code == status.HTTP_200_OK
    assert second.json() == {
        "accepted": True,
        "duplicate": True,
        "cache_key": _KEY,
        "applied": True,
    }
    assert PubVisit.objects.count() == 1


@pytest.mark.django_db
def test_upsert_fills_in_ended_at(client):
    token = _register(client)
    # Start the evening (no ended_at).
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))
    assert PubVisit.objects.get().ended_at is None

    # Later POST the same client_id with ended_at filled in.
    resp = client.post(
        "/v1/pub-visits",
        data=_payload(ended_at="2026-06-12T23:30:00+02:00"),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["duplicate"] is True

    assert PubVisit.objects.count() == 1
    visit = PubVisit.objects.get()
    assert visit.ended_at.isoformat() == "2026-06-12T21:30:00+00:00"


@pytest.mark.django_db
def test_stale_visit_replay_does_not_clear_ended_at(client):
    token = _register(client)
    client.post(
        "/v1/pub-visits",
        data=_payload(
            ended_at="2026-06-12T23:30:00+02:00",
            updated_at="2026-06-12T23:30:00+02:00",
        ),
        format="json",
        **_auth(token),
    )

    resp = client.post(
        "/v1/pub-visits",
        data=_payload(ended_at=None, updated_at="2026-06-12T19:05:00+02:00"),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["applied"] is False
    visit = PubVisit.objects.get()
    assert visit.ended_at.isoformat() == "2026-06-12T21:30:00+00:00"


@pytest.mark.django_db
def test_newer_visit_update_can_move_ended_at_backwards(client):
    token = _register(client)
    client.post(
        "/v1/pub-visits",
        data=_payload(
            ended_at="2026-06-12T23:30:00+02:00",
            updated_at="2026-06-12T23:30:00+02:00",
        ),
        format="json",
        **_auth(token),
    )

    resp = client.post(
        "/v1/pub-visits",
        data=_payload(
            ended_at="2026-06-12T22:15:00+02:00",
            updated_at="2026-06-12T23:45:00+02:00",
        ),
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["applied"] is True
    visit = PubVisit.objects.get()
    assert visit.ended_at.isoformat() == "2026-06-12T20:15:00+00:00"


# ---------------------------------------------------------------------------
# GET list
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_lists_all_visits(client):
    token = _register(client)
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))
    client.post(
        "/v1/pub-visits",
        data=_payload(
            client_id="00000000-0000-4000-8000-000000000002",
            name="Brno pub",
            lat=49.1951,
            lng=16.6068,
            started_at="2026-06-13T18:00:00+02:00",
        ),
        format="json",
        **_auth(token),
    )

    resp = client.get("/v1/pub-visits", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    visits = resp.json()["visits"]
    assert len(visits) == 2
    names = {v["name"] for v in visits}
    assert names == {_NAME, "Brno pub"}
    first = next(v for v in visits if v["client_id"] == _CLIENT_ID)
    assert first["cache_key"] == _KEY
    assert first["started_at"] == "2026-06-12T17:00:00+00:00"
    assert first["ended_at"] is None
    assert first["updated_at"] == "2026-06-12T17:00:00+00:00"


@pytest.mark.django_db
def test_get_empty_when_no_visits(client):
    token = _register(client)
    resp = client.get("/v1/pub-visits", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"visits": []}


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_delete_removes_visit(client):
    token = _register(client)
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))
    assert PubVisit.objects.count() == 1

    resp = client.delete(f"/v1/pub-visits/{_CLIENT_ID}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert PubVisit.objects.count() == 0


@pytest.mark.django_db
def test_delete_unknown_client_id_is_idempotent_success(client):
    token = _register(client)
    resp = client.delete(f"/v1/pub-visits/{_CLIENT_ID}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}


@pytest.mark.django_db
def test_delete_twice_second_is_false(client):
    token = _register(client)
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token))

    first = client.delete(f"/v1/pub-visits/{_CLIENT_ID}", **_auth(token))
    assert first.json() == {"deleted": True}
    second = client.delete(f"/v1/pub-visits/{_CLIENT_ID}", **_auth(token))
    assert second.json() == {"deleted": False}


# ---------------------------------------------------------------------------
# Account isolation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_account_isolation_get(client):
    token_a = _register(client)
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.get("/v1/pub-visits", **_auth(token_b))
    assert resp.json() == {"visits": []}


@pytest.mark.django_db
def test_account_isolation_delete(client):
    token_a = _register(client)
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.delete(f"/v1/pub-visits/{_CLIENT_ID}", **_auth(token_b))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}
    assert PubVisit.objects.filter(
        account=Account.objects.get(device_id=_DEVICE_ID), client_id=_CLIENT_ID
    ).count() == 1


@pytest.mark.django_db
def test_same_client_id_different_accounts_are_separate(client):
    """The unique key is (account, client_id), so two accounts may reuse one id."""
    token_a = _register(client)
    client.post("/v1/pub-visits", data=_payload(), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.post(
        "/v1/pub-visits", data=_payload(name="B pub"), format="json", **_auth(token_b)
    )
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["duplicate"] is False
    assert PubVisit.objects.filter(client_id=_CLIENT_ID).count() == 2


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------


def test_pub_visits_throttle_scope_configured(settings):
    assert "pub_visits" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


@pytest.mark.django_db
def test_pub_visits_endpoint_is_throttled(client, monkeypatch):
    token = _register(client)
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["pub_visits"] = "3/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)

    for i in range(3):
        resp = client.post(
            "/v1/pub-visits",
            data=_payload(client_id=f"00000000-0000-4000-8000-00000000000{i}"),
            format="json",
            **_auth(token),
        )
        assert resp.status_code == status.HTTP_201_CREATED

    throttled = client.post(
        "/v1/pub-visits",
        data=_payload(client_id="00000000-0000-4000-8000-000000000009"),
        format="json",
        **_auth(token),
    )
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS

"""
Tests for the per-user explicit pub-visit endpoints:

    POST   /v1/pub-visits              — push one visit (upsert)
    GET    /v1/pub-visits              — list all visits
    DELETE /v1/pub-visits/<client_id>  — idempotent delete

Covers idempotent upsert (replay + ended_at fill-in), geohash cache_key,
account isolation, auth, DELETE idempotence and throttling.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.enrichment import geohash8
from pubs.models import Account, PartyEvening, PartyEveningMember, PubVisit

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


def _active_party(account: Account, code: str = "PRAH24") -> PartyEvening:
    evening = PartyEvening.objects.create(
        host=account,
        client_id=uuid.uuid4(),
        join_code=code,
        pub_name=_NAME,
        pub_city="Praha",
    )
    PartyEveningMember.objects.create(evening=evening, account=account)
    return evening


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


@pytest.mark.django_db
def test_visit_links_active_party_and_closing_it_later_preserves_the_link(client):
    token = _register(client)
    account = Account.objects.get(device_id=_DEVICE_ID)
    evening = _active_party(account)
    evening.started_at = datetime(2026, 6, 12, 16, 30, tzinfo=UTC)
    evening.save(update_fields=["started_at"])

    started = client.post(
        "/v1/pub-visits",
        data=_payload(party_code="PRAH24"),
        format="json",
        **_auth(token),
    )
    assert started.status_code == status.HTTP_201_CREATED, started.content
    assert PubVisit.objects.get().party_evening == evening

    evening.active = False
    evening.save(update_fields=["active"])
    closed = client.post(
        "/v1/pub-visits",
        data=_payload(
            party_code="PRAH24",
            ended_at="2026-06-12T23:30:00+02:00",
            updated_at="2026-06-12T23:30:00+02:00",
        ),
        format="json",
        **_auth(token),
    )
    assert closed.status_code == status.HTTP_200_OK, closed.content
    assert PubVisit.objects.get().party_evening == evening

    listed = client.get("/v1/pub-visits", **_auth(token)).json()["visits"]
    assert listed[0]["party_code"] == "PRAH24"


@pytest.mark.django_db
def test_offline_visit_interval_links_to_ended_party(client):
    token = _register(client)
    account = Account.objects.get(device_id=_DEVICE_ID)
    evening = _active_party(account)
    evening.started_at = datetime(2026, 6, 12, 16, 30, tzinfo=UTC)
    evening.ended_at = datetime(2026, 6, 12, 22, 0, tzinfo=UTC)
    evening.active = False
    evening.save(update_fields=["started_at", "ended_at", "active"])
    membership = PartyEveningMember.objects.get(evening=evening, account=account)

    response = client.post(
        "/v1/pub-visits",
        data=_payload(
            party_code="PRAH24",
            ended_at="2026-06-12T23:30:00+02:00",
            # The upload itself happens much later; only the visit interval is
            # allowed to decide the association.
            updated_at=timezone.now().isoformat(),
        ),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert PubVisit.objects.get().party_evening == evening
    membership.refresh_from_db()
    assert membership.active is True


@pytest.mark.django_db
def test_overlong_visit_interval_does_not_claim_historical_party(client):
    token = _register(client)
    account = Account.objects.get(device_id=_DEVICE_ID)
    evening = _active_party(account)
    evening.started_at = datetime(2026, 6, 12, 16, 30, tzinfo=UTC)
    evening.ended_at = datetime(2026, 6, 12, 22, 0, tzinfo=UTC)
    evening.active = False
    evening.save(update_fields=["started_at", "ended_at", "active"])

    response = client.post(
        "/v1/pub-visits",
        data=_payload(
            party_code="PRAH24",
            started_at="2026-06-11T23:00:00+02:00",
            ended_at="2026-06-13T23:30:00+02:00",
            updated_at=(timezone.now() + timedelta(seconds=1)).isoformat(),
        ),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED, response.content
    assert PubVisit.objects.get().party_evening is None


@pytest.mark.django_db
def test_foreign_or_stale_party_code_never_rejects_primary_visit(client):
    host_token = _register(client)
    host = Account.objects.get(device_id=_DEVICE_ID)
    evening = _active_party(host)
    other_token = _register(client, device_id=_OTHER_DEVICE_ID)

    foreign = client.post(
        "/v1/pub-visits",
        data=_payload(party_code="PRAH24"),
        format="json",
        **_auth(other_token),
    )
    assert foreign.status_code == status.HTTP_201_CREATED, foreign.content
    assert PubVisit.objects.get(account__device_id=_OTHER_DEVICE_ID).party_evening is None

    evening.active = False
    evening.save(update_fields=["active"])
    stale = client.post(
        "/v1/pub-visits",
        data=_payload(
            client_id="00000000-0000-4000-8000-000000000003",
            party_code="PRAH24",
        ),
        format="json",
        **_auth(host_token),
    )
    assert stale.status_code == status.HTTP_201_CREATED, stale.content
    assert (
        PubVisit.objects.get(client_id="00000000-0000-4000-8000-000000000003").party_evening is None
    )


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
    assert (
        PubVisit.objects.filter(
            account=Account.objects.get(device_id=_DEVICE_ID), client_id=_CLIENT_ID
        ).count()
        == 1
    )


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

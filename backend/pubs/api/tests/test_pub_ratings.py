"""
Tests for the per-user private pub-rating sync endpoints:

    PUT    /v1/pub-ratings             — upsert one rating
    GET    /v1/pub-ratings             — list all ratings (pull / restore)
    DELETE /v1/pub-ratings/<cache_key> — idempotent delete

Covers upsert, last-write-wins conflict resolution, empty-rating delete, the
verdict-null serialization, account isolation, geohash cache_key correctness,
auth and throttling.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.enrichment import geohash8
from pubs.models import Account, PubRating

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_OTHER_DEVICE_ID = "11112222-3333-4444-5555-666677778888"
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
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "external_id": "mapy:50.08755,14.42141",
        "verdict": "like",
        "tag": "útulná",
        "note": "Skvělá Plzeň",
        "updated_at": "2026-06-12T19:45:00+02:00",
    }
    data.update(overrides)
    return data


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_requires_account_token(client):
    resp = client.put("/v1/pub-ratings", data=_payload(), format="json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubRating.objects.count() == 0


@pytest.mark.django_db
def test_get_requires_account_token(client):
    resp = client.get("/v1/pub-ratings")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_delete_requires_account_token(client):
    resp = client.delete(f"/v1/pub-ratings/{_KEY}")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# Upsert (PUT) happy path + geohash cache_key
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_creates_rating_with_geohash_cache_key(client):
    token = _register(client)
    resp = client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cache_key"] == _KEY
    assert body["name"] == _NAME
    assert body["verdict"] == "like"
    assert body["tag"] == "útulná"
    assert body["note"] == "Skvělá Plzeň"
    assert body["external_id"] == "mapy:50.08755,14.42141"
    assert body["applied"] is True

    rating = PubRating.objects.get()
    assert rating.account == Account.objects.get(device_id=_DEVICE_ID)
    assert rating.cache_key == _KEY
    assert rating.verdict == "like"
    assert rating.tag == "útulná"
    assert rating.note == "Skvělá Plzeň"
    assert rating.client_updated_at.isoformat() == "2026-06-12T17:45:00+00:00"


@pytest.mark.django_db
def test_put_updates_existing_rating(client):
    token = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))

    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(verdict="dislike", note="Změna názoru", updated_at="2026-06-13T10:00:00+02:00"),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["applied"] is True

    assert PubRating.objects.count() == 1
    rating = PubRating.objects.get()
    assert rating.verdict == "dislike"
    assert rating.note == "Změna názoru"


@pytest.mark.django_db
def test_put_name_optional_defaults_empty(client):
    token = _register(client)
    payload = _payload()
    payload.pop("name")
    resp = client.put("/v1/pub-ratings", data=payload, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["name"] == ""
    assert PubRating.objects.get().name == ""


@pytest.mark.django_db
def test_put_verdict_only_no_tag_no_note(client):
    token = _register(client)
    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(tag=None, note=None),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["verdict"] == "like"
    assert body["tag"] == ""
    assert body["note"] == ""
    assert PubRating.objects.count() == 1


@pytest.mark.django_db
def test_put_note_only_no_verdict(client):
    token = _register(client)
    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(verdict=None, tag=None),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    # Empty verdict serializes as null.
    assert body["verdict"] is None
    assert body["note"] == "Skvělá Plzeň"
    assert PubRating.objects.get().verdict == ""


# ---------------------------------------------------------------------------
# Empty rating deletes
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_empty_rating_deletes_existing(client):
    token = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))
    assert PubRating.objects.count() == 1

    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(verdict=None, tag=None, note=None),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert PubRating.objects.count() == 0


@pytest.mark.django_db
def test_put_empty_rating_when_none_exists_is_ok(client):
    token = _register(client)
    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(verdict=None, tag=None, note=None),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert PubRating.objects.count() == 0


@pytest.mark.django_db
def test_put_blank_strings_count_as_empty_and_delete(client):
    token = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))

    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(verdict="", tag="  ", note="   "),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert PubRating.objects.count() == 0


# ---------------------------------------------------------------------------
# Last-write-wins
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_lww_older_write_does_not_overwrite_newer(client):
    token = _register(client)
    # First store a NEWER rating.
    client.put(
        "/v1/pub-ratings",
        data=_payload(note="newer", updated_at="2026-06-13T12:00:00+02:00"),
        format="json",
        **_auth(token),
    )

    # Now a stale write with an OLDER updated_at must be ignored.
    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(note="older stale", updated_at="2026-06-10T08:00:00+02:00"),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["applied"] is False
    assert body["note"] == "newer"

    rating = PubRating.objects.get()
    assert rating.note == "newer"


@pytest.mark.django_db
def test_lww_newer_write_overwrites_older(client):
    token = _register(client)
    client.put(
        "/v1/pub-ratings",
        data=_payload(note="older", updated_at="2026-06-10T08:00:00+02:00"),
        format="json",
        **_auth(token),
    )

    resp = client.put(
        "/v1/pub-ratings",
        data=_payload(note="newer wins", updated_at="2026-06-13T12:00:00+02:00"),
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["applied"] is True
    assert PubRating.objects.get().note == "newer wins"


@pytest.mark.django_db
def test_lww_equal_timestamp_applies(client):
    token = _register(client)
    ts = "2026-06-12T19:45:00+02:00"
    client.put("/v1/pub-ratings", data=_payload(note="first", updated_at=ts), format="json", **_auth(token))
    resp = client.put(
        "/v1/pub-ratings", data=_payload(note="second", updated_at=ts), format="json", **_auth(token)
    )
    # Not strictly older → applies.
    assert resp.json()["applied"] is True
    assert PubRating.objects.get().note == "second"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_put_validation_errors(client):
    token = _register(client)

    missing_updated_at = client.put(
        "/v1/pub-ratings",
        data={k: v for k, v in _payload().items() if k != "updated_at"},
        format="json",
        **_auth(token),
    )
    bad_verdict = client.put(
        "/v1/pub-ratings", data=_payload(verdict="meh"), format="json", **_auth(token)
    )
    bad_lat = client.put("/v1/pub-ratings", data=_payload(lat=999), format="json", **_auth(token))
    note_too_long = client.put(
        "/v1/pub-ratings", data=_payload(note="x" * 281), format="json", **_auth(token)
    )
    tag_too_long = client.put(
        "/v1/pub-ratings", data=_payload(tag="y" * 65), format="json", **_auth(token)
    )

    for resp in (missing_updated_at, bad_verdict, bad_lat, note_too_long, tag_too_long):
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubRating.objects.count() == 0


# ---------------------------------------------------------------------------
# GET list / restore
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_lists_all_ratings(client):
    token = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))
    # A second pub far away (different geohash cell).
    client.put(
        "/v1/pub-ratings",
        data=_payload(lat=49.1951, lng=16.6068, name="Brno pub", verdict="dislike", tag="", note=""),
        format="json",
        **_auth(token),
    )

    resp = client.get("/v1/pub-ratings", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    ratings = resp.json()["ratings"]
    assert len(ratings) == 2
    by_key = {r["cache_key"]: r for r in ratings}
    assert by_key[_KEY]["verdict"] == "like"
    brno = next(r for r in ratings if r["name"] == "Brno pub")
    assert brno["verdict"] == "dislike"
    # updated_at is the client timestamp (ISO).
    assert by_key[_KEY]["updated_at"] == "2026-06-12T17:45:00+00:00"


@pytest.mark.django_db
def test_get_empty_when_no_ratings(client):
    token = _register(client)
    resp = client.get("/v1/pub-ratings", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"ratings": []}


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_delete_removes_rating(client):
    token = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))
    assert PubRating.objects.count() == 1

    resp = client.delete(f"/v1/pub-ratings/{_KEY}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": True}
    assert PubRating.objects.count() == 0


@pytest.mark.django_db
def test_delete_unknown_key_is_idempotent_success(client):
    token = _register(client)
    resp = client.delete(f"/v1/pub-ratings/{_KEY}", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}


@pytest.mark.django_db
def test_delete_twice_second_is_false(client):
    token = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token))

    first = client.delete(f"/v1/pub-ratings/{_KEY}", **_auth(token))
    assert first.json() == {"deleted": True}
    second = client.delete(f"/v1/pub-ratings/{_KEY}", **_auth(token))
    assert second.json() == {"deleted": False}


# ---------------------------------------------------------------------------
# Account isolation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_account_isolation_get(client):
    token_a = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.get("/v1/pub-ratings", **_auth(token_b))
    assert resp.json() == {"ratings": []}


@pytest.mark.django_db
def test_account_isolation_delete(client):
    token_a = _register(client)
    client.put("/v1/pub-ratings", data=_payload(), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    resp = client.delete(f"/v1/pub-ratings/{_KEY}", **_auth(token_b))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"deleted": False}
    # Account A's rating still exists.
    assert PubRating.objects.filter(
        account=Account.objects.get(device_id=_DEVICE_ID), cache_key=_KEY
    ).count() == 1


@pytest.mark.django_db
def test_account_isolation_put_does_not_clobber(client):
    """Two accounts rating the same pub keep independent rows (unique per account)."""
    token_a = _register(client)
    client.put("/v1/pub-ratings", data=_payload(verdict="like"), format="json", **_auth(token_a))

    token_b = _register(client, device_id=_OTHER_DEVICE_ID)
    client.put("/v1/pub-ratings", data=_payload(verdict="dislike"), format="json", **_auth(token_b))

    assert PubRating.objects.filter(cache_key=_KEY).count() == 2
    assert PubRating.objects.get(account__device_id=_DEVICE_ID).verdict == "like"
    assert PubRating.objects.get(account__device_id=_OTHER_DEVICE_ID).verdict == "dislike"


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------


def test_pub_ratings_throttle_scope_configured(settings):
    assert "pub_ratings" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


@pytest.mark.django_db
def test_pub_ratings_endpoint_is_throttled(client, monkeypatch):
    token = _register(client)
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["pub_ratings"] = "3/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)

    for i in range(3):
        resp = client.put(
            "/v1/pub-ratings",
            data=_payload(lat=50.0 + i * 0.01, note=f"n{i}"),
            format="json",
            **_auth(token),
        )
        assert resp.status_code == status.HTTP_200_OK

    throttled = client.put(
        "/v1/pub-ratings", data=_payload(lat=50.5), format="json", **_auth(token)
    )
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS

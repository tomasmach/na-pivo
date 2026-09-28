"""
Tests for the private favourite-pub sync endpoints:

    PUT    /v1/pub-favorites             — save (or remove) one favourite
    GET    /v1/pub-favorites             — list own favourites (pull / restore)
    DELETE /v1/pub-favorites/<cache_key> — idempotent delete

Mirrors test_pub_ratings, plus the per-account cap and the account lifecycle
(anonymous merge, hard delete, export).
"""

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs import accounts
from pubs.enrichment import geohash8
from pubs.models import Account, PubFavorite

_NAME = "U Zlatého tygra"
_LAT = 50.0876
_LNG = 14.4214
_KEY = geohash8(_LAT, _LNG)
_BRNO_LAT = 49.1951
_BRNO_LNG = 16.6068


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient) -> str:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
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
        "updated_at": "2026-06-12T19:45:00+02:00",
    }
    data.update(overrides)
    return data


def _put(client, token, **overrides):
    return client.put("/v1/pub-favorites", data=_payload(**overrides), format="json", **_auth(token))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("method", "path"),
    [("put", "/v1/pub-favorites"), ("get", "/v1/pub-favorites"), ("delete", f"/v1/pub-favorites/{_KEY}")],
)
def test_every_method_requires_account_token(client, method, path):
    resp = client.generic(method, path, data="{}", content_type="application/json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert PubFavorite.objects.count() == 0


# ---------------------------------------------------------------------------
# PUT / GET wire contract
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_anonymous_device_account_saves_and_lists_favorite(client):
    token = _register(client)

    resp = _put(client, token)

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {
        "cache_key": _KEY,
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "external_id": "mapy:50.08755,14.42141",
        "updated_at": "2026-06-12T17:45:00+00:00",
        "applied": True,
    }
    favorite = PubFavorite.objects.get()
    assert favorite.account.is_claimed is False

    listed = client.get("/v1/pub-favorites", **_auth(token))
    assert listed.status_code == status.HTTP_200_OK
    assert listed.json() == {
        "favorites": [
            {
                "cache_key": _KEY,
                "name": _NAME,
                "lat": _LAT,
                "lng": _LNG,
                "external_id": "mapy:50.08755,14.42141",
                "updated_at": "2026-06-12T17:45:00+00:00",
            }
        ]
    }


@pytest.mark.django_db
def test_name_and_external_id_are_optional(client):
    token = _register(client)
    resp = client.put(
        "/v1/pub-favorites",
        data={"lat": _LAT, "lng": _LNG, "updated_at": "2026-06-12T19:45:00+02:00"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["name"] == ""
    assert resp.json()["external_id"] == ""


@pytest.mark.django_db
def test_get_is_empty_without_favorites(client):
    token = _register(client)
    resp = client.get("/v1/pub-favorites", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"favorites": []}


@pytest.mark.django_db
def test_future_device_clock_cannot_poison_later_sync(client):
    token = _register(client)
    _put(client, token, name="future", updated_at="2999-01-01T00:00:00Z")
    assert PubFavorite.objects.get().client_updated_at <= timezone.now()

    corrected = _put(client, token, name="corrected", updated_at=timezone.now().isoformat())
    assert corrected.json()["applied"] is True
    assert PubFavorite.objects.get().name == "corrected"


@pytest.mark.django_db
def test_put_validation_errors(client):
    token = _register(client)
    missing_updated_at = client.put(
        "/v1/pub-favorites",
        data={k: v for k, v in _payload().items() if k != "updated_at"},
        format="json",
        **_auth(token),
    )
    responses = [
        missing_updated_at,
        _put(client, token, lat=999),
        _put(client, token, lng=-181),
        _put(client, token, name="x" * 256),
        _put(client, token, external_id="y" * 129),
        _put(client, token, favorite="maybe"),
    ]
    for resp in responses:
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert PubFavorite.objects.count() == 0


# ---------------------------------------------------------------------------
# Last-write-wins
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_newer_put_updates_the_single_row(client):
    token = _register(client)
    _put(client, token)
    resp = _put(client, token, name="Tygr", updated_at="2026-06-13T10:00:00+02:00")

    assert resp.json()["applied"] is True
    assert PubFavorite.objects.count() == 1
    assert PubFavorite.objects.get().name == "Tygr"


@pytest.mark.django_db
def test_older_put_is_ignored_and_returns_stored_row(client):
    token = _register(client)
    _put(client, token, name="newer", updated_at="2026-06-13T12:00:00+02:00")

    resp = _put(client, token, name="older stale", updated_at="2026-06-10T08:00:00+02:00")

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["applied"] is False
    assert resp.json()["name"] == "newer"
    assert PubFavorite.objects.get().name == "newer"


@pytest.mark.django_db
def test_equal_timestamp_applies(client):
    token = _register(client)
    ts = "2026-06-12T19:45:00+02:00"
    _put(client, token, name="first", updated_at=ts)
    resp = _put(client, token, name="second", updated_at=ts)
    assert resp.json()["applied"] is True
    assert PubFavorite.objects.get().name == "second"


@pytest.mark.django_db
def test_favorite_false_removes_under_lww(client):
    token = _register(client)
    _put(client, token, updated_at="2026-06-12T19:45:00+02:00")

    stale = _put(client, token, favorite=False, updated_at="2026-06-10T08:00:00+02:00")
    assert stale.json()["applied"] is False
    assert PubFavorite.objects.count() == 1

    removed = _put(client, token, favorite=False, updated_at="2026-06-13T08:00:00+02:00")
    assert removed.json() == {"deleted": True, "applied": True}
    assert PubFavorite.objects.count() == 0

    again = _put(client, token, favorite=False, updated_at="2026-06-13T09:00:00+02:00")
    assert again.json() == {"deleted": False, "applied": True}


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_delete_is_idempotent(client):
    token = _register(client)
    _put(client, token)

    first = client.delete(f"/v1/pub-favorites/{_KEY}", **_auth(token))
    second = client.delete(f"/v1/pub-favorites/{_KEY}", **_auth(token))

    assert first.status_code == status.HTTP_200_OK
    assert first.json() == {"deleted": True}
    assert second.status_code == status.HTTP_200_OK
    assert second.json() == {"deleted": False}
    assert client.get("/v1/pub-favorites", **_auth(token)).json() == {"favorites": []}


# ---------------------------------------------------------------------------
# Account isolation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_accounts_only_see_and_delete_their_own_favorites(client):
    token_a = _register(client)
    token_b = _register(client)
    _put(client, token_a, name="A")
    _put(client, token_b, name="B")
    _put(client, token_b, lat=_BRNO_LAT, lng=_BRNO_LNG, name="B Brno")

    listed_a = client.get("/v1/pub-favorites", **_auth(token_a)).json()["favorites"]
    assert [row["name"] for row in listed_a] == ["A"]

    foreign_brno_key = geohash8(_BRNO_LAT, _BRNO_LNG)
    resp = client.delete(f"/v1/pub-favorites/{foreign_brno_key}", **_auth(token_a))
    assert resp.json() == {"deleted": False}
    assert PubFavorite.objects.filter(cache_key=foreign_brno_key).count() == 1

    client.delete(f"/v1/pub-favorites/{_KEY}", **_auth(token_a))
    assert list(PubFavorite.objects.filter(cache_key=_KEY).values_list("name", flat=True)) == ["B"]


# ---------------------------------------------------------------------------
# Per-account cap
# ---------------------------------------------------------------------------


def test_default_cap_is_500(settings):
    assert settings.PUB_FAVORITES_PER_ACCOUNT_CAP == 500


@pytest.mark.django_db
def test_cap_refuses_only_new_rows_with_retryable_409(client, settings):
    settings.PUB_FAVORITES_PER_ACCOUNT_CAP = 2
    token = _register(client)
    assert _put(client, token).status_code == status.HTTP_200_OK
    assert _put(client, token, lat=_BRNO_LAT, lng=_BRNO_LNG).status_code == status.HTTP_200_OK

    over = _put(client, token, lat=49.8, lng=18.3, name="Ostrava")
    assert over.status_code == status.HTTP_409_CONFLICT
    assert over.json()["code"] == "favorites_limit"
    assert over.json()["limit"] == 2
    assert "2" in over.json()["detail"]
    assert PubFavorite.objects.count() == 2

    # Updating or removing an existing favourite is never capped.
    update = _put(client, token, name="Tygr", updated_at="2026-06-13T10:00:00+02:00")
    assert update.status_code == status.HTTP_200_OK
    remove = _put(client, token, favorite=False, updated_at="2026-06-13T11:00:00+02:00")
    assert remove.json() == {"deleted": True, "applied": True}

    # The same queued save goes through once a slot is free.
    retry = _put(client, token, lat=49.8, lng=18.3, name="Ostrava")
    assert retry.status_code == status.HTTP_200_OK
    assert PubFavorite.objects.count() == 2


# ---------------------------------------------------------------------------
# Account lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_anonymous_merge_moves_favorites_and_keeps_target_duplicate():
    target = Account.objects.create(device_id="favorites-merge-target")
    source = Account.objects.create(device_id="favorites-merge-source")
    brno_key = geohash8(_BRNO_LAT, _BRNO_LNG)
    now = timezone.now()
    PubFavorite.objects.create(
        account=target, cache_key=_KEY, name="target copy", lat=_LAT, lng=_LNG,
        client_updated_at=now,
    )
    PubFavorite.objects.create(
        account=source, cache_key=_KEY, name="source copy", lat=_LAT, lng=_LNG,
        client_updated_at=now,
    )
    PubFavorite.objects.create(
        account=source, cache_key=brno_key, name="Brno", lat=_BRNO_LAT, lng=_BRNO_LNG,
        client_updated_at=now,
    )

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    assert not Account.objects.filter(pk=source.pk).exists()
    rows = dict(PubFavorite.objects.filter(account=target).values_list("cache_key", "name"))
    assert rows == {_KEY: "target copy", brno_key: "Brno"}
    assert PubFavorite.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_hard_delete_removes_favorites_of_that_account_only():
    deleted = Account.objects.create(device_id="favorites-deleted")
    survivor = Account.objects.create(device_id="favorites-survivor")
    for account in (deleted, survivor):
        PubFavorite.objects.create(
            account=account, cache_key=_KEY, name=_NAME, lat=_LAT, lng=_LNG,
            client_updated_at=timezone.now(),
        )

    accounts.hard_delete(deleted)

    assert list(PubFavorite.objects.values_list("account_id", flat=True)) == [survivor.pk]


@pytest.mark.django_db
def test_export_includes_own_favorites_only(client):
    token = _register(client)
    other = _register(client)
    _put(client, token)
    _put(client, other, lat=_BRNO_LAT, lng=_BRNO_LNG, name="Cizí")

    resp = client.get("/v1/account/export", **_auth(token))

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["favorites"] == [
        {
            "cache_key": _KEY,
            "name": _NAME,
            "lat": _LAT,
            "lng": _LNG,
            "external_id": "mapy:50.08755,14.42141",
            "updated_at": "2026-06-12T17:45:00+00:00",
        }
    ]


# ---------------------------------------------------------------------------
# Throttling
# ---------------------------------------------------------------------------


def test_pub_favorites_throttle_scope_configured(settings):
    assert "pub_favorites" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


@pytest.mark.django_db
def test_pub_favorites_endpoint_is_throttled(client, monkeypatch):
    token = _register(client)
    rates = dict(ScopedRateThrottle.THROTTLE_RATES)
    rates["pub_favorites"] = "3/min"
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", rates)

    for i in range(3):
        assert _put(client, token, lat=50.0 + i * 0.01).status_code == status.HTTP_200_OK

    throttled = _put(client, token, lat=50.5)
    assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS

"""
Tests for GET /v1/pubs/near — the server-side Mapy.cz suggest proxy with a
shared DB cache.

All upstream HTTP is mocked: MapySuggestSource is patched where the view imports
it (pubs.api.views.MapySuggestSource) so no real Mapy.cz calls are made.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone as dj_tz
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import (
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestResult,
    geohash6,
)
from pubs.models import PubSearchCache, UserAddedPub

# Prague centre-ish coordinates.
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash6(_LAT, _LNG)

_ITEM = {
    "name": "Hospoda U Testu",
    "label": "Hospoda",
    "position": {"lat": 50.08, "lon": 14.42},
    "regionalStructure": [{"name": "Praha", "type": "regional.municipality"}],
}


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _mapy_key(settings):
    """Configure a Mapy key by default; individual tests can clear it."""
    settings.MAPY_API_KEY = "test-key"
    # Generous throttle so the shared LocMemCache state from other tests can't
    # 429 us (each test patches the source anyway).
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "pubs_near": "10000/min",
        },
    }


def _mock_source(result_or_exc):
    """Return a MagicMock standing in for MapySuggestSource (context manager)."""
    instance = MagicMock()
    if isinstance(result_or_exc, Exception):
        instance.search_near.side_effect = result_or_exc
    else:
        instance.search_near.return_value = result_or_exc
    cm = MagicMock()
    cm.__enter__.return_value = instance
    cm.__exit__.return_value = False
    factory = MagicMock(return_value=cm)
    return factory, instance


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_missing_lat_lng_is_400(client):
    resp = client.get("/v1/pubs/near", data={"radius_km": 10})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_out_of_range_lat_is_400(client):
    resp = client.get("/v1/pubs/near", data={"lat": 999, "lng": 14.0})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_negative_radius_is_400(client):
    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": -5})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------------------
# Cache MISS → fetch + persist + response shape
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cache_miss_fetches_and_persists(client):
    factory, instance = _mock_source(MapySuggestResult(items=[_ITEM]))

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is False
    assert body["items"] == [_ITEM]
    assert "fetched_at" in body and body["fetched_at"]

    # The search runs from the user's actual coordinate with the radius bucket
    # (25 → 50). This keeps dense-city results local even near cache-cell edges.
    instance.search_near.assert_called_once_with(_LAT, _LNG, 50)

    # Row persisted on the (cache_key, radius_bucket=50) key.
    row = PubSearchCache.objects.get(cache_key=_KEY, radius_bucket=50)
    assert row.items == [_ITEM]


@pytest.mark.django_db
def test_response_shape_only_expected_keys(client):
    factory, _ = _mock_source(MapySuggestResult(items=[_ITEM]))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})
    body = resp.json()
    assert set(body.keys()) == {"items", "cached", "fetched_at"}


@pytest.mark.django_db
def test_default_radius_used_when_omitted(client):
    """Omitting radius_km defaults to 25 → bucket 50."""
    factory, instance = _mock_source(MapySuggestResult(items=[]))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG})
    assert resp.status_code == status.HTTP_200_OK
    _clat, _clng, bucket = instance.search_near.call_args.args
    assert bucket == 50


# ---------------------------------------------------------------------------
# Cache HIT (fresh) — no fetch
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_fresh_cache_hit_no_fetch(client):
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now(),
    )
    factory, instance = _mock_source(MapySuggestResult(items=[]))

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"] == [_ITEM]
    factory.assert_not_called()
    instance.search_near.assert_not_called()


@pytest.mark.django_db
def test_stale_row_is_refetched(client, settings):
    settings.PUBS_NEAR_TTL_DAYS = 7
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[{"name": "Old"}],
        fetched_at=dj_tz.now() - timedelta(days=8),
    )
    fresh = MapySuggestResult(items=[_ITEM])
    factory, instance = _mock_source(fresh)

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is False
    assert body["items"] == [_ITEM]
    instance.search_near.assert_called_once()
    # Row updated in place (still one row for this key/bucket).
    assert PubSearchCache.objects.filter(cache_key=_KEY, radius_bucket=50).count() == 1
    assert PubSearchCache.objects.get(cache_key=_KEY, radius_bucket=50).items == [_ITEM]


# ---------------------------------------------------------------------------
# Radius bucketing
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    "radius_km,expected_bucket",
    [(3, 5), (5, 5), (10, 15), (15, 15), (25, 50), (50, 50), (80, 100), (100, 100)],
)
def test_radius_bucketing(client, radius_km, expected_bucket):
    factory, instance = _mock_source(MapySuggestResult(items=[]))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get(
            "/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": radius_km}
        )
    assert resp.status_code == status.HTTP_200_OK
    _clat, _clng, bucket = instance.search_near.call_args.args
    assert bucket == expected_bucket
    assert PubSearchCache.objects.filter(cache_key=_KEY, radius_bucket=expected_bucket).exists()


@pytest.mark.django_db
def test_over_cap_radius_clamped_to_100(client):
    """A radius above 100 is clamped, not rejected, and uses the 100 bucket."""
    factory, instance = _mock_source(MapySuggestResult(items=[]))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 250})
    assert resp.status_code == status.HTTP_200_OK
    _clat, _clng, bucket = instance.search_near.call_args.args
    assert bucket == 100


# ---------------------------------------------------------------------------
# Cell quantization — very nearby coords share one row
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_two_nearby_coords_share_one_cache_row(client):
    factory, instance = _mock_source(MapySuggestResult(items=[_ITEM]))

    with patch("pubs.api.views.MapySuggestSource", factory):
        # First request populates the cell.
        client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
        # A coord ~70 m away falls in the same geohash-6 cell → cache HIT.
        nearby_lat, nearby_lng = _LAT + 0.0005, _LNG + 0.0005
        assert geohash6(nearby_lat, nearby_lng) == _KEY
        resp2 = client.get(
            "/v1/pubs/near", data={"lat": nearby_lat, "lng": nearby_lng, "radius_km": 25}
        )

    assert resp2.json()["cached"] is True
    # Only one upstream fetch happened despite two requests.
    assert instance.search_near.call_count == 1
    assert PubSearchCache.objects.filter(cache_key=_KEY).count() == 1


# ---------------------------------------------------------------------------
# Mapy failure → stale fallback / 503
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_mapy_failure_with_stale_row_serves_stale(client):
    """An upstream failure with an existing (stale) row serves the stale row."""
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now() - timedelta(days=30),
    )
    factory, _ = _mock_source(MapyAllQueriesFailedError("all failed"))

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"] == [_ITEM]


@pytest.mark.django_db
def test_mapy_failure_no_row_is_503(client):
    factory, _ = _mock_source(MapyAllQueriesFailedError("all failed"))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "detail" in resp.json()


@pytest.mark.django_db
def test_daily_cap_no_row_is_503(client):
    """Daily cap exceeded with no cache → 503 so the client falls back to Mapy."""
    factory, _ = _mock_source(MapyDailyCapExceededError("cap hit"))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


@pytest.mark.django_db
def test_daily_cap_with_stale_row_serves_stale(client):
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now() - timedelta(days=30),
    )
    factory, _ = _mock_source(MapyDailyCapExceededError("cap hit"))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["cached"] is True


# ---------------------------------------------------------------------------
# Missing API key → 503 (or stale fallback)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_api_key_no_row_is_503(client, settings):
    settings.MAPY_API_KEY = ""
    factory, instance = _mock_source(MapySuggestResult(items=[]))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    # No upstream attempt without a key.
    factory.assert_not_called()


@pytest.mark.django_db
def test_no_api_key_with_stale_row_serves_stale(client, settings):
    settings.MAPY_API_KEY = ""
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now() - timedelta(days=30),
    )
    factory, _ = _mock_source(MapySuggestResult(items=[]))
    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["cached"] is True
    assert resp.json()["items"] == [_ITEM]


# ---------------------------------------------------------------------------
# Community-added pubs — mixed into every nearby response
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_user_added_pub_is_prepended_to_fresh_cache_hit(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Hospoda Od Komunity",
        lat=_LAT + 0.0001,
        lng=_LNG + 0.0001,
        city="Praha",
        address="Komunitní 1",
    )
    PubSearchCache.objects.create(
        cache_key=_KEY,
        radius_bucket=50,
        items=[_ITEM],
        fetched_at=dj_tz.now(),
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert [item["name"] for item in body["items"]] == ["Hospoda Od Komunity", _ITEM["name"]]
    added = body["items"][0]
    assert added["label"] == "Hospoda"
    assert added["position"] == {"lat": _LAT + 0.0001, "lon": _LNG + 0.0001}
    assert added["source"] == "community"
    assert {"name": "Praha", "type": "regional.municipality"} in added["regionalStructure"]


@pytest.mark.django_db
def test_user_added_pub_served_without_mapy_key_or_cache(client, settings):
    settings.MAPY_API_KEY = ""
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Hospoda Bez Mapy",
        lat=_LAT,
        lng=_LNG,
    )

    resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["cached"] is True
    assert body["items"][0]["name"] == "Hospoda Bez Mapy"


@pytest.mark.django_db
def test_user_added_pub_filters_inactive_and_far_rows(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Blízko",
        lat=_LAT,
        lng=_LNG,
    )
    UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000001",
        cache_key="u2fk3def",
        name="Neaktivní",
        lat=_LAT,
        lng=_LNG,
        active=False,
    )
    UserAddedPub.objects.create(
        client_id="aaaaaaaa-0000-0000-0000-000000000002",
        cache_key="u2fk3ghi",
        name="Daleko",
        lat=49.2,
        lng=16.6,
    )
    factory, _ = _mock_source(MapySuggestResult(items=[]))

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 1})

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["items"]]
    assert names == ["Blízko"]


@pytest.mark.django_db
def test_user_added_pub_is_not_persisted_into_mapy_cache(client):
    UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key="u2fk3abc",
        name="Jen komunitně",
        lat=_LAT,
        lng=_LNG,
    )
    factory, _ = _mock_source(MapySuggestResult(items=[_ITEM]))

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get("/v1/pubs/near", data={"lat": _LAT, "lng": _LNG, "radius_km": 25})

    assert resp.status_code == status.HTTP_200_OK
    assert [item["name"] for item in resp.json()["items"]] == ["Jen komunitně", _ITEM["name"]]
    assert PubSearchCache.objects.get(cache_key=_KEY, radius_bucket=50).items == [_ITEM]

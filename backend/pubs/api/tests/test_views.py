"""
Tests for pubs.api.views (PubHoursView + HealthView).

All tests use pytest-django with APIClient.  FirmyHoursSource is mocked
wherever enrichment would be triggered — no live network traffic.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache import cache
from django.utils import timezone as dj_tz
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from pubs.enrichment import RawHours, geohash8
from pubs.models import EnrichTask, PubHours

pytestmark = pytest.mark.django_db

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_FLEKY_NAME = "Restaurace U Fleků"
_FLEKY_LAT = 50.0812
_FLEKY_LNG = 14.4182
_FLEKY_KEY = geohash8(_FLEKY_LAT, _FLEKY_LNG)
_FLEKY_HOURS = "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

_GOOD_RAW = RawHours(
    opening_hours_raw=_FLEKY_HOURS,
    source="firmy",
    source_ref="272313",
    matched_name=_FLEKY_NAME,
    matched_lat=_FLEKY_LAT,
    matched_lng=_FLEKY_LNG,
    confidence=0.95,
    rating_value=4.1,
    rating_count=364,
    rating_label="Velmi dobré",
)


@pytest.fixture
def client():
    return APIClient()


def _make_fresh_row(**kwargs):
    defaults = dict(
        cache_key=_FLEKY_KEY,
        name=_FLEKY_NAME,
        lat=_FLEKY_LAT,
        lng=_FLEKY_LNG,
        opening_hours_raw=_FLEKY_HOURS,
        source="firmy",
        source_ref="272313",
        confidence=0.95,
        rating_value=4.1,
        rating_count=364,
        rating_label="Velmi dobré",
        status=PubHours.Status.OK,
        fetched_at=dj_tz.now(),
    )
    defaults.update(kwargs)
    return PubHours.objects.create(**defaults)


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_health_returns_ok(client):
    resp = client.get("/v1/health")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


def test_pub_hours_empty_body_returns_400(client):
    resp = client.post("/v1/pub-hours", data={}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_pub_hours_missing_pubs_returns_400(client):
    resp = client.post("/v1/pub-hours", data={"sync_budget": 1}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_pub_hours_empty_pubs_list_returns_400(client):
    resp = client.post("/v1/pub-hours", data={"pubs": []}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_pub_hours_invalid_lat_returns_400(client):
    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": "Test", "lat": 999.0, "lng": 14.0}]},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_pub_hours_invalid_lng_returns_400(client):
    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": "Test", "lat": 50.0, "lng": 200.0}]},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_pub_hours_too_many_pubs_returns_400(client):
    pubs = [{"name": f"Pub {i}", "lat": 50.0, "lng": 14.0} for i in range(51)]
    resp = client.post("/v1/pub-hours", data={"pubs": pubs}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


def test_pub_hours_sync_budget_too_large_returns_400(client):
    """sync_budget above the request-level ceiling (5) is rejected (MEDIUM 6)."""
    resp = client.post(
        "/v1/pub-hours",
        data={"pubs": [{"name": "Test", "lat": 50.0, "lng": 14.0}], "sync_budget": 50},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_pub_hours_is_throttled(client, monkeypatch):
    cache.clear()
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"pub_hours": "2/min"})
    _make_fresh_row()
    payload = {"pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}]}

    try:
        for _ in range(2):
            resp = client.post("/v1/pub-hours", data=payload, format="json")
            assert resp.status_code == status.HTTP_200_OK

        throttled = client.post("/v1/pub-hours", data=payload, format="json")
        assert throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    finally:
        cache.clear()


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_response_shape_from_cache(client):
    """Cached pub → response has all expected fields."""
    _make_fresh_row()

    from pubs.api import cache as cache_module

    with patch.object(cache_module, "is_open_now", return_value=True), \
         patch.object(cache_module, "next_change", return_value=None):
        resp = client.post(
            "/v1/pub-hours",
            data={"pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}]},
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert "results" in body
    assert len(body["results"]) == 1

    r = body["results"][0]
    assert r["key"] == _FLEKY_KEY
    assert r["name"] == _FLEKY_NAME
    assert r["opening_hours"] == _FLEKY_HOURS
    assert r["isOpenNow"] is True
    assert r["nextChange"] is None
    assert r["status"] == "ok"
    assert r["source"] == "firmy"
    assert pytest.approx(r["confidence"]) == 0.95
    assert r["rating"] == pytest.approx(4.1)
    assert r["ratingCount"] == 364
    assert r["ratingLabel"] == "Velmi dobré"
    assert r["hasGarden"] is None
    # venue_kind defaults to 'unknown' on a row that wasn't classified.
    assert r["venueKind"] == "unknown"


@pytest.mark.django_db
def test_response_includes_venue_kind_from_row(client):
    """A classified PubHours row surfaces its venue_kind as venueKind."""
    _make_fresh_row(venue_kind=PubHours.VenueKind.PUB)

    from pubs.api import cache as cache_module

    with patch.object(cache_module, "is_open_now", return_value=True), \
         patch.object(cache_module, "next_change", return_value=None):
        resp = client.post(
            "/v1/pub-hours",
            data={"pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}]},
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["venueKind"] == "pub"


@pytest.mark.django_db
def test_response_includes_garden_flag_from_row(client):
    """A PubHours row surfaces the garden metadata as hasGarden."""
    _make_fresh_row(has_garden=True, venue_tags=["se-zahradkou"])

    from pubs.api import cache as cache_module

    with patch.object(cache_module, "is_open_now", return_value=True), \
         patch.object(cache_module, "next_change", return_value=None):
        resp = client.post(
            "/v1/pub-hours",
            data={"pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}]},
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["hasGarden"] is True


@pytest.mark.django_db
def test_sync_fetch_persists_classified_venue_kind(client):
    """A sync fetch classifies the venue from scraped categories/tags and the
    response + persisted row both carry venueKind 'pub'."""
    raw = RawHours(
        opening_hours_raw=_FLEKY_HOURS,
        source="firmy",
        source_ref="272313",
        matched_name=_FLEKY_NAME,
        matched_lat=_FLEKY_LAT,
        matched_lng=_FLEKY_LNG,
        confidence=0.95,
        categories=["České a staročeské restaurace", "Restaurace"],
        tags=["tocene-pivo", "se-zahradkou"],
    )
    mock_source = MagicMock()
    mock_source.fetch.return_value = raw

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        resp = client.post(
            "/v1/pub-hours",
            data={
                "pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}],
                "sync_budget": 1,
            },
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["venueKind"] == "pub"
    assert resp.json()["results"][0]["hasGarden"] is True
    row = PubHours.objects.get(cache_key=_FLEKY_KEY)
    assert row.venue_kind == "pub"
    assert row.venue_categories == ["České a staročeské restaurace", "Restaurace"]
    assert row.has_garden is True
    assert row.venue_tags == ["tocene-pivo", "se-zahradkou"]


@pytest.mark.django_db
def test_pending_result_venue_kind_unknown(client):
    """A pub with no PubHours row (pending) reports venueKind 'unknown'."""
    resp = client.post(
        "/v1/pub-hours",
        data={
            "pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}],
            "sync_budget": 0,
        },
        format="json",
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["venueKind"] == "unknown"


@pytest.mark.django_db
def test_response_shape_pending(client):
    """Budget=0 + cache miss → result has status pending and null hours."""
    resp = client.post(
        "/v1/pub-hours",
        data={
            "pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}],
            "sync_budget": 0,
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    r = body["results"][0]
    assert r["status"] == "pending"
    assert r["opening_hours"] is None
    assert r["isOpenNow"] is None
    assert r["nextChange"] is None
    assert r["source"] is None
    assert r["confidence"] is None


# ---------------------------------------------------------------------------
# Sync fetch triggered from view
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_view_triggers_sync_fetch_on_miss(client):
    """POST with one missing pub and budget=1 → FirmyHoursSource is called."""
    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        resp = client.post(
            "/v1/pub-hours",
            data={
                "pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}],
                "sync_budget": 1,
            },
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    mock_source.fetch.assert_called_once()
    body = resp.json()
    assert body["results"][0]["status"] == "ok"
    assert body["results"][0]["opening_hours"] == _FLEKY_HOURS
    assert body["results"][0]["rating"] == pytest.approx(4.1)
    assert body["results"][0]["ratingCount"] == 364
    assert body["results"][0]["ratingLabel"] == "Velmi dobré"


@pytest.mark.django_db
def test_view_creates_enrich_task_when_budget_zero(client):
    """Budget=0 → EnrichTask is created for the missing pub."""
    resp = client.post(
        "/v1/pub-hours",
        data={
            "pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}],
            "sync_budget": 0,
        },
        format="json",
    )

    assert resp.status_code == status.HTTP_200_OK
    assert EnrichTask.objects.filter(cache_key=_FLEKY_KEY).exists()


# ---------------------------------------------------------------------------
# isOpenNow computed from known OSM hours at a fixed Prague datetime
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_is_open_now_integrated_with_known_hours(client):
    """
    isOpenNow is computed live from opening_hours_raw.

    U Fleků: Mo-Su 10:00-23:00.  We patch is_open_now in cache module to
    verify it's called with the correct hours string.
    """
    _make_fresh_row()

    from pubs.api import cache as cache_module

    with patch.object(cache_module, "is_open_now", return_value=False) as mock_ion, \
         patch.object(cache_module, "next_change", return_value=None):
        resp = client.post(
            "/v1/pub-hours",
            data={"pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}]},
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    mock_ion.assert_called_once_with(_FLEKY_HOURS)
    assert resp.json()["results"][0]["isOpenNow"] is False


@pytest.mark.django_db
def test_next_change_in_response_is_iso8601(client):
    """nextChange in the response is an ISO-8601 string."""
    _make_fresh_row()

    nc_dt = datetime(2024, 6, 3, 23, 0, 0, tzinfo=UTC)

    from pubs.api import cache as cache_module

    with patch.object(cache_module, "is_open_now", return_value=True), \
         patch.object(cache_module, "next_change", return_value=nc_dt):
        resp = client.post(
            "/v1/pub-hours",
            data={"pubs": [{"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG}]},
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["nextChange"] == nc_dt.isoformat()


# ---------------------------------------------------------------------------
# city hint passed through
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_city_hint_passed_to_fetch(client):
    """The optional city field is forwarded to FirmyHoursSource.fetch."""
    mock_source = MagicMock()
    mock_source.fetch.return_value = _GOOD_RAW

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        resp = client.post(
            "/v1/pub-hours",
            data={
                "pubs": [
                    {
                        "name": _FLEKY_NAME,
                        "lat": _FLEKY_LAT,
                        "lng": _FLEKY_LNG,
                        "city": "Praha",
                    }
                ],
                "sync_budget": 1,
            },
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    mock_source.fetch.assert_called_once_with(
        _FLEKY_NAME, _FLEKY_LAT, _FLEKY_LNG, city="Praha"
    )


# ---------------------------------------------------------------------------
# Multiple pubs in one request
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_multiple_pubs_in_one_request(client):
    """Two pubs → two results in same order."""
    lat2, lng2 = 50.090, 14.430
    key2 = geohash8(lat2, lng2)

    _make_fresh_row()  # first pub — cache hit

    mock_source = MagicMock()
    raw2 = RawHours(
        opening_hours_raw="Mo-Fr 11:00-22:00",
        source="firmy",
        source_ref="111",
        matched_name="Pivnice Kozlovna",
        matched_lat=lat2,
        matched_lng=lng2,
        confidence=0.80,
    )
    mock_source.fetch.return_value = raw2

    with patch("pubs.api.cache.FirmyHoursSource", return_value=mock_source):
        resp = client.post(
            "/v1/pub-hours",
            data={
                "pubs": [
                    {"name": _FLEKY_NAME, "lat": _FLEKY_LAT, "lng": _FLEKY_LNG},
                    {"name": "Pivnice Kozlovna", "lat": lat2, "lng": lng2},
                ],
                "sync_budget": 2,
            },
            format="json",
        )

    assert resp.status_code == status.HTTP_200_OK
    results = resp.json()["results"]
    assert len(results) == 2

    assert results[0]["key"] == _FLEKY_KEY
    assert results[0]["status"] == "ok"

    assert results[1]["key"] == key2
    assert results[1]["status"] == "ok"
    assert results[1]["opening_hours"] == "Mo-Fr 11:00-22:00"

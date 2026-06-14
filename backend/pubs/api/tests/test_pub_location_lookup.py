"""
Tests for Mapy-backed pub location lookup endpoints.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import MapySuggestResult

_ITEM = {
    "name": "Hospoda U Testu",
    "label": "Hospoda",
    "position": {"lat": 50.081, "lon": 14.421},
    "location": "Testovací 12, Praha",
    "regionalStructure": [
        {"name": "12", "type": "regional.address"},
        {"name": "Testovací", "type": "regional.street"},
        {"name": "Praha", "type": "regional.municipality"},
    ],
}


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _mapy_settings(settings):
    settings.MAPY_API_KEY = "test-key"
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "pubs_near": "10000/min",
        },
    }


def _mock_source():
    instance = MagicMock()
    instance.suggest_locations.return_value = MapySuggestResult(items=[_ITEM])
    instance.geocode_location.return_value = MapySuggestResult(items=[_ITEM])
    cm = MagicMock()
    cm.__enter__.return_value = instance
    cm.__exit__.return_value = False
    factory = MagicMock(return_value=cm)
    return factory, instance


@pytest.mark.django_db
def test_suggest_pub_locations(client):
    factory, instance = _mock_source()

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get(
            "/v1/pubs/suggest",
            data={"query": "Hospoda U Te", "lat": 50.08, "lng": 14.42},
        )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"items": [_ITEM]}
    factory.assert_called_once_with(api_key="test-key", daily_cap=5000)
    instance.suggest_locations.assert_called_once_with("Hospoda U Te", lat=50.08, lng=14.42)
    instance.geocode_location.assert_not_called()


@pytest.mark.django_db
def test_geocode_pub_location(client):
    factory, instance = _mock_source()

    with patch("pubs.api.views.MapySuggestSource", factory):
        resp = client.get(
            "/v1/pubs/geocode",
            data={"query": "Hospoda U Testu, Testovací 12, Praha"},
        )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"items": [_ITEM]}
    instance.geocode_location.assert_called_once_with(
        "Hospoda U Testu, Testovací 12, Praha",
        lat=None,
        lng=None,
    )
    instance.suggest_locations.assert_not_called()


@pytest.mark.django_db
def test_lookup_requires_configured_mapy_key(client, settings):
    settings.MAPY_API_KEY = ""

    resp = client.get("/v1/pubs/suggest", data={"query": "Hospoda U Te"})

    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


@pytest.mark.django_db
def test_lookup_validates_query_and_coordinate_pair(client):
    short = client.get("/v1/pubs/suggest", data={"query": "U"})
    missing_lng = client.get("/v1/pubs/suggest", data={"query": "Hospoda", "lat": 50.08})

    assert short.status_code == status.HTTP_400_BAD_REQUEST
    assert missing_lng.status_code == status.HTTP_400_BAD_REQUEST

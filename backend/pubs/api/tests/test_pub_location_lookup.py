"""
Tests for Mapy-backed pub location lookup endpoints.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from requests.models import Response
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import MapySuggestResult
from pubs.enrichment.mapy import MapySuggestSource

_ITEM = {
    "name": "Hospoda U Testu",
    "label": "Hospoda",
    "type": "poi",
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


def _response(payload: dict | str, status_code: int = 200) -> Response:
    resp = Response()
    resp.status_code = status_code
    resp.headers["Content-Type"] = "application/json"
    body = payload if isinstance(payload, str) else json.dumps(payload)
    resp._content = body.encode("utf-8")
    resp.url = "https://api.mapy.cz/v1/suggest"
    resp.encoding = "utf-8"
    return resp


class _FakeMapySession:
    def __init__(self, response: Response) -> None:
        self.response = response
        self.calls: list[tuple[str, list[tuple[str, str]]]] = []

    def get(self, url: str, *, params, timeout: int) -> Response:
        self.calls.append((url, list(params)))
        return self.response


def _real_source_factory(session: _FakeMapySession):
    def factory(*, api_key: str, daily_cap: int) -> MapySuggestSource:
        return MapySuggestSource(api_key=api_key, daily_cap=daily_cap, session=session)

    return factory


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


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("path", "query"),
    [
        ("/v1/pubs/suggest", "Košická hospoda"),
        ("/v1/pubs/geocode", "Košická hospoda, Hlavná 1, Košice"),
    ],
)
def test_lookup_allows_czech_and_slovak_locality(client, path, query):
    session = _FakeMapySession(_response({"items": [_ITEM]}))

    with patch("pubs.api.views.MapySuggestSource", _real_source_factory(session)):
        resp = client.get(path, data={"query": query})

    assert resp.status_code == status.HTTP_200_OK
    assert session.calls
    params = session.calls[0][1]
    assert ("locality", "cz,sk") in params


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/v1/pubs/suggest", "/v1/pubs/geocode"])
def test_lookup_upstream_400_returns_empty_items(client, path):
    session = _FakeMapySession(_response({"error": "bad request"}, status_code=400))

    with patch("pubs.api.views.MapySuggestSource", _real_source_factory(session)):
        resp = client.get(path, data={"query": "Košická hospoda"})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"items": []}


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/v1/pubs/suggest", "/v1/pubs/geocode"])
def test_lookup_upstream_500_still_returns_503(client, path):
    session = _FakeMapySession(_response("upstream error", status_code=500))

    with patch("pubs.api.views.MapySuggestSource", _real_source_factory(session)):
        resp = client.get(path, data={"query": "Košická hospoda"})

    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE

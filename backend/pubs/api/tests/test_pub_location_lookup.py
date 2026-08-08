"""Tests for the local-first pub location compatibility endpoints."""

from __future__ import annotations

from unittest.mock import ANY, MagicMock, patch

import pytest
from django.utils import timezone as dj_tz
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import (
    GoogleAddressCandidate,
    GoogleGeocodingDailyCapExceededError,
    GoogleGeocodingUnavailableError,
    GooglePlacePrediction,
    GooglePlacesUnavailableError,
)
from pubs.models import PubDirectory, PubHours

_QUERY = "Hospoda U Testu, Testovaci 12, Praha"


@pytest.fixture
def client() -> APIClient:
    return APIClient()


@pytest.fixture(autouse=True)
def _lookup_settings(settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = "test-key"
    settings.GOOGLE_MAPS_TIMEOUT = 7
    settings.GOOGLE_MAPS_DAILY_CAP = 25
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "pub_location_lookup": "10000/min",
        },
    }


def _directory_pub() -> PubDirectory:
    return PubDirectory.objects.create(
        name="Hospoda U Testu",
        lat=50.081,
        lng=14.421,
        city="Praha",
        country="cz",
        venue_kind=PubHours.VenueKind.PUB,
        source="test",
        active=True,
        refreshed_at=dj_tz.now(),
    )


def _google_source(candidate: GoogleAddressCandidate | None = None, *, error=None):
    source = MagicMock()
    if error is not None:
        source.geocode_address.side_effect = error
        source.geocode_place_id.side_effect = error
        source.reverse_geocode.side_effect = error
    else:
        source.geocode_address.return_value = candidate
        source.geocode_place_id.return_value = candidate
        source.reverse_geocode.return_value = candidate
    context_manager = MagicMock()
    context_manager.__enter__.return_value = source
    context_manager.__exit__.return_value = False
    return MagicMock(return_value=context_manager), source


def _google_places_source(predictions=None, *, error=None):
    source = MagicMock()
    if error is not None:
        source.autocomplete.side_effect = error
    else:
        source.autocomplete.return_value = predictions or []
    context_manager = MagicMock()
    context_manager.__enter__.return_value = source
    context_manager.__exit__.return_value = False
    return MagicMock(return_value=context_manager), source


@pytest.fixture(autouse=True)
def _disable_live_google_places_requests():
    factory, _ = _google_places_source()
    with patch("pubs.api.views.GooglePlacesAutocompleteSource", factory):
        yield


@pytest.mark.django_db
def test_geocode_local_hit_does_not_require_key_or_call_google(client, settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = ""
    pub = _directory_pub()
    factory, source = _google_source()

    with patch("pubs.api.views.GoogleGeocodingSource", factory):
        response = client.get("/v1/pubs/geocode", data={"query": _QUERY})

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "items": [
            {
                "id": f"local:{pub.pk}",
                "provider": "local",
                "name": "Hospoda U Testu",
                "label": "Hospoda",
                "position": {"lat": 50.081, "lon": 14.421},
                "regionalStructure": [
                    {"name": "Praha", "type": "regional.municipality"},
                    {"name": "Česko", "type": "regional.country", "isoCode": "CZ"},
                ],
            }
        ]
    }
    factory.assert_not_called()
    source.geocode_address.assert_not_called()


@pytest.mark.django_db
def test_suggest_miss_returns_google_places_predictions(client):
    factory, source = _google_places_source(
        [
            GooglePlacePrediction(
                place_id="place-smrk",
                name="Občerstvení U Smrku",
                location="Líšnice ev. č. 7, Líšnice",
                types=("restaurant", "point_of_interest"),
            )
        ]
    )

    with patch("pubs.api.views.GooglePlacesAutocompleteSource", factory):
        response = client.get("/v1/pubs/suggest", data={"query": "Neznama hospoda"})

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "items": [
            {
                "id": "google:place-smrk",
                "provider": "google",
                "providerPlaceId": "place-smrk",
                "name": "Občerstvení U Smrku",
                "label": "Google Maps",
                "location": "Líšnice ev. č. 7, Líšnice",
                "type": "poi",
            }
        ]
    }
    source.autocomplete.assert_called_once_with(
        query="Neznama hospoda",
        lat=None,
        lng=None,
        limit=8,
    )


@pytest.mark.django_db
def test_suggest_keeps_local_results_when_google_is_unavailable(client):
    pub = _directory_pub()
    factory, _ = _google_places_source(
        error=GooglePlacesUnavailableError("unavailable")
    )

    with patch("pubs.api.views.GooglePlacesAutocompleteSource", factory):
        response = client.post(
            "/v1/pubs/suggest",
            data={"query": "Hospoda U Testu", "lat": 50.08, "lng": 14.42},
            format="json",
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["items"][0]["id"] == f"local:{pub.pk}"


@pytest.mark.django_db
def test_geocode_miss_uses_google_fallback(client):
    candidate = GoogleAddressCandidate(
        lat=50.081,
        lng=14.421,
        address="Testovaci 12",
        city="Praha",
        result_type="street_address",
        place_id="google-place-id",
    )
    factory, source = _google_source(candidate)

    with patch("pubs.api.views.GoogleGeocodingSource", factory):
        response = client.get("/v1/pubs/geocode", data={"query": _QUERY})

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {
        "items": [
            {
                "id": "google:google-place-id",
                "provider": "google",
                "providerPlaceId": "google-place-id",
                "name": "Hospoda U Testu",
                "label": "Adresa",
                "position": {"lat": 50.081, "lon": 14.421},
                "type": "regional.address",
                "regionalStructure": [
                    {"name": "Praha", "type": "regional.municipality"},
                    {"name": "Testovaci 12", "type": "regional.street"},
                ],
                "attributions": ["Google Maps"],
            }
        ]
    }
    factory.assert_called_once_with(
        api_key="test-key",
        timeout=7,
        reserve_request=ANY,
    )
    source.geocode_address.assert_called_once_with(address=_QUERY, city="")


@pytest.mark.django_db
def test_geocode_resolves_selected_google_place_id(client):
    candidate = GoogleAddressCandidate(
        lat=50.080123,
        lng=16.510616,
        address="Líšnice ev. č. 7",
        city="Líšnice",
        result_type="premise",
        place_id="place-smrk",
    )
    factory, source = _google_source(candidate)

    with patch("pubs.api.views.GoogleGeocodingSource", factory):
        response = client.post(
            "/v1/pubs/geocode",
            data={"query": "Občerstvení U Smrku", "place_id": "place-smrk"},
            format="json",
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["items"][0]["position"] == {
        "lat": 50.080123,
        "lon": 16.510616,
    }
    source.geocode_place_id.assert_called_once_with("place-smrk")
    source.geocode_address.assert_not_called()


@pytest.mark.django_db
def test_reverse_geocode_prefills_address_for_map_pin(client):
    candidate = GoogleAddressCandidate(
        lat=50.080123,
        lng=16.510616,
        address="Líšnice ev. č. 7",
        city="Líšnice",
        result_type="street_address",
        place_id="place-smrk",
    )
    factory, source = _google_source(candidate)

    with patch("pubs.api.views.GoogleGeocodingSource", factory):
        response = client.post(
            "/v1/pubs/reverse-geocode",
            data={"lat": 50.080123, "lng": 16.510616},
            format="json",
        )

    assert response.status_code == status.HTTP_200_OK
    item = response.json()["items"][0]
    assert item["providerPlaceId"] == "place-smrk"
    assert item["regionalStructure"] == [
        {"name": "Líšnice", "type": "regional.municipality"},
        {"name": "Líšnice ev. č. 7", "type": "regional.street"},
    ]
    source.reverse_geocode.assert_called_once_with(
        lat=50.080123,
        lng=16.510616,
    )


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/v1/pubs/suggest", "/v1/pubs/geocode"])
def test_lookup_accepts_private_post_body_without_dropping_get_compatibility(client, path):
    pub = _directory_pub()

    post_response = client.post(path, data={"query": _QUERY}, format="json")
    get_response = client.get(path, data={"query": _QUERY})

    assert post_response.status_code == status.HTTP_200_OK
    assert get_response.status_code == status.HTTP_200_OK
    assert post_response.json() == get_response.json()
    assert post_response.json()["items"][0]["id"] == f"local:{pub.pk}"


@pytest.mark.django_db
def test_geocode_miss_requires_configured_google_key(client, settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = ""
    factory, source = _google_source()

    with patch("pubs.api.views.GoogleGeocodingSource", factory):
        response = client.get("/v1/pubs/geocode", data={"query": _QUERY})

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json() == {"detail": "Location lookup is not configured."}
    factory.assert_not_called()
    source.geocode_address.assert_not_called()


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/v1/pubs/suggest", "/v1/pubs/geocode"])
def test_lookup_validates_query_and_coordinate_pair(client, path):
    short = client.get(path, data={"query": "U"})
    missing_lng = client.get(path, data={"query": "Hospoda", "lat": 50.08})

    assert short.status_code == status.HTTP_400_BAD_REQUEST
    assert missing_lng.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
@pytest.mark.parametrize(
    "error",
    [
        GoogleGeocodingUnavailableError("unavailable"),
        GoogleGeocodingDailyCapExceededError("cap exceeded"),
    ],
)
def test_geocode_google_failure_returns_503(client, error):
    factory, source = _google_source(error=error)

    with patch("pubs.api.views.GoogleGeocodingSource", factory):
        response = client.get("/v1/pubs/geocode", data={"query": _QUERY})

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json() == {"detail": "Location lookup is temporarily unavailable."}
    source.geocode_address.assert_called_once_with(address=_QUERY, city="")

"""Tests for the narrow Google Places Autocomplete (New) client."""

from __future__ import annotations

import json
from collections.abc import Callable

import pytest
from requests.models import Response

from pubs.enrichment.google_places import (
    GooglePlacesAutocompleteSource,
    GooglePlacesDailyCapExceededError,
)


def _response(payload: dict, *, status_code: int = 200) -> Response:
    response = Response()
    response.status_code = status_code
    response.headers["Content-Type"] = "application/json"
    response._content = json.dumps(payload).encode("utf-8")
    response.encoding = "utf-8"
    return response


class _FakeSession:
    def __init__(self, *responses: Response) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def post(self, url: str, **kwargs) -> Response:
        self.calls.append({"url": url, **kwargs})
        return self._responses.pop(0)


def _source(
    session: _FakeSession,
    *,
    reserve_request: Callable[[], bool] = lambda: True,
) -> GooglePlacesAutocompleteSource:
    return GooglePlacesAutocompleteSource(
        api_key="server-secret-key",
        session=session,  # type: ignore[arg-type]
        timeout=7,
        reserve_request=reserve_request,
    )


def test_autocomplete_returns_named_place_predictions_near_selected_pin() -> None:
    session = _FakeSession(
        _response(
            {
                "suggestions": [
                    {
                        "placePrediction": {
                            "placeId": "place-smrk",
                            "structuredFormat": {
                                "mainText": {"text": "Občerstvení U Smrku"},
                                "secondaryText": {
                                    "text": "Líšnice ev. č. 7, Líšnice"
                                },
                            },
                            "types": ["restaurant", "point_of_interest"],
                        }
                    }
                ]
            }
        )
    )

    predictions = _source(session).autocomplete(
        query="Občerstvení U Smrku",
        lat=50.080123,
        lng=16.510616,
        limit=5,
    )

    assert len(predictions) == 1
    assert predictions[0].place_id == "place-smrk"
    assert predictions[0].name == "Občerstvení U Smrku"
    assert predictions[0].location == "Líšnice ev. č. 7, Líšnice"
    call = session.calls[0]
    assert call["url"] == "https://places.googleapis.com/v1/places:autocomplete"
    assert call["json"] == {
        "input": "Občerstvení U Smrku",
        "languageCode": "cs",
        "includedRegionCodes": ["cz", "sk"],
        "locationBias": {
            "circle": {
                "center": {"latitude": 50.080123, "longitude": 16.510616},
                "radius": 50_000.0,
            }
        },
        "origin": {"latitude": 50.080123, "longitude": 16.510616},
    }
    assert call["headers"]["X-Goog-Api-Key"] == "server-secret-key"
    assert "server-secret-key" not in call["url"]
    assert "reviews" not in call["headers"]["X-Goog-FieldMask"]
    assert call["timeout"] == 7


def test_autocomplete_ignores_short_queries_without_spending_budget() -> None:
    session = _FakeSession(_response({"suggestions": []}))
    reservations = 0

    def reserve_request() -> bool:
        nonlocal reservations
        reservations += 1
        return True

    assert _source(session, reserve_request=reserve_request).autocomplete(
        query="U ",
        lat=None,
        lng=None,
    ) == []
    assert reservations == 0
    assert session.calls == []


def test_exhausted_hard_cap_prevents_autocomplete_request() -> None:
    session = _FakeSession(_response({"suggestions": []}))

    with pytest.raises(GooglePlacesDailyCapExceededError):
        _source(session, reserve_request=lambda: False).autocomplete(
            query="Hospoda",
            lat=None,
            lng=None,
        )

    assert session.calls == []

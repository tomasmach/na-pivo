"""Tests for the narrow Google Geocoding v4 client."""

from __future__ import annotations

import json
from collections.abc import Callable

import pytest
from requests.models import Response

from pubs.enrichment.google_geocoding import (
    GoogleGeocodingDailyCapExceededError,
    GoogleGeocodingSource,
)

_EXPECTED_FIELD_MASK = ",".join(
    (
        "results.placeId",
        "results.location",
        "results.granularity",
        "results.formattedAddress",
        "results.addressComponents",
        "results.types",
    )
)


def _response(payload: dict, *, status_code: int = 200) -> Response:
    response = Response()
    response.status_code = status_code
    response.headers["Content-Type"] = "application/json"
    response._content = json.dumps(payload).encode("utf-8")
    response.encoding = "utf-8"
    return response


def _result(
    *,
    result_type: str = "street_address",
    granularity: str = "ROOFTOP",
    lat: float = 49.1951,
    lng: float = 16.6068,
) -> dict:
    return {
        "placeId": "ChIJ-test-place-id",
        "location": {"latitude": lat, "longitude": lng},
        "granularity": granularity,
        "formattedAddress": "Masarykova 1/2, 602 00 Brno, Česko",
        "addressComponents": [
            {"longText": "Masarykova", "types": ["route"]},
            {"longText": "1/2", "types": ["street_number"]},
            {"longText": "Brno", "types": ["locality", "political"]},
        ],
        "types": [result_type],
    }


class _FakeSession:
    def __init__(self, *responses: Response) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def get(self, url: str, **kwargs) -> Response:
        self.calls.append({"url": url, **kwargs})
        return self._responses.pop(0)


def _source(
    session: _FakeSession,
    *,
    reserve_request: Callable[[], bool] = lambda: True,
) -> GoogleGeocodingSource:
    return GoogleGeocodingSource(
        api_key="server-secret-key",
        session=session,  # type: ignore[arg-type]
        timeout=7,
        reserve_request=reserve_request,
    )


def test_request_keeps_key_in_header_and_safely_encodes_address_path() -> None:
    session = _FakeSession(_response({"results": [_result()]}))

    candidate = _source(session).geocode_address(address="Masarykova 1/2", city="Brno")

    assert candidate is not None
    assert candidate.lat == pytest.approx(49.1951)
    assert candidate.lng == pytest.approx(16.6068)
    assert candidate.address == "Masarykova 1/2"
    assert candidate.city == "Brno"
    assert candidate.place_id == "ChIJ-test-place-id"

    assert len(session.calls) == 1
    call = session.calls[0]
    assert call["url"].endswith("/Masarykova%201%2F2%2C%20Brno")
    assert "server-secret-key" not in call["url"]
    assert call["params"] == {"languageCode": "cs"}
    assert call["headers"] == {
        "X-Goog-Api-Key": "server-secret-key",
        "X-Goog-FieldMask": _EXPECTED_FIELD_MASK,
    }
    assert call["timeout"] == 7
    assert "rating" not in call["headers"]["X-Goog-FieldMask"]
    assert "reviews" not in call["headers"]["X-Goog-FieldMask"]


def test_geocoder_skips_centroid_and_returns_later_precise_result() -> None:
    centroid = _result(result_type="locality", granularity="GEOMETRIC_CENTER")
    precise = _result(result_type="premise", granularity="ROOFTOP", lat=50.08, lng=14.42)
    session = _FakeSession(_response({"results": [centroid, precise]}))

    candidate = _source(session).geocode_address(address="Dlouhá 1", city="Praha")

    assert candidate is not None
    assert candidate.result_type == "premise"
    assert candidate.lat == pytest.approx(50.08)
    assert candidate.lng == pytest.approx(14.42)


def test_place_id_lookup_accepts_known_place_without_address_precision() -> None:
    session = _FakeSession(
        _response(
            {
                "results": [
                    _result(
                        result_type="establishment",
                        granularity="APPROXIMATE",
                    )
                ]
            }
        )
    )

    candidate = _source(session).geocode_place_id("ChIJ-test/place-id")

    assert candidate is not None
    assert candidate.place_id == "ChIJ-test-place-id"
    assert candidate.result_type == "establishment"
    assert session.calls[0]["url"].endswith(
        "/v4/geocode/places/ChIJ-test%2Fplace-id"
    )
    assert session.calls[0]["params"] == {"languageCode": "cs"}


@pytest.mark.parametrize(
    ("result_type", "granularity"),
    [
        ("locality", "GEOMETRIC_CENTER"),
        ("route", "APPROXIMATE"),
        ("street_address", "GEOMETRIC_CENTER"),
    ],
)
def test_geocoder_rejects_centroid_or_imprecise_results(
    result_type: str,
    granularity: str,
) -> None:
    session = _FakeSession(
        _response(
            {
                "results": [
                    _result(result_type=result_type, granularity=granularity),
                ]
            }
        )
    )

    candidate = _source(session).geocode_address(address="Brno", city="Brno")

    assert candidate is None


def test_5xx_retries_once_and_reserves_each_http_attempt() -> None:
    session = _FakeSession(
        _response({"error": "temporary"}, status_code=503),
        _response({"results": [_result()]}),
    )
    reservations = 0

    def reserve_request() -> bool:
        nonlocal reservations
        reservations += 1
        return True

    candidate = _source(session, reserve_request=reserve_request).geocode_address(
        address="Masarykova 1/2",
        city="Brno",
    )

    assert candidate is not None
    assert len(session.calls) == 2
    assert reservations == 2


def test_exhausted_hard_cap_prevents_http_request() -> None:
    session = _FakeSession(_response({"results": [_result()]}))

    with pytest.raises(GoogleGeocodingDailyCapExceededError):
        _source(session, reserve_request=lambda: False).geocode_address(
            address="Masarykova 1/2",
            city="Brno",
        )

    assert session.calls == []

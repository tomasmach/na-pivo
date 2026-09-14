"""Small Google Places Autocomplete (New) client for explicit pub lookup."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import requests

_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
_FIELD_MASK = ",".join(
    (
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.structuredFormat.mainText.text",
        "suggestions.placePrediction.structuredFormat.secondaryText.text",
        "suggestions.placePrediction.types",
    )
)


class GooglePlacesUnavailableError(RuntimeError):
    """Raised when Google Places cannot safely complete an autocomplete."""


class GooglePlacesDailyCapExceededError(GooglePlacesUnavailableError):
    """Raised before an HTTP request when the shared daily budget is spent."""


@dataclass(frozen=True)
class GooglePlacePrediction:
    place_id: str
    name: str
    location: str
    types: tuple[str, ...]


def _text(value: object) -> str:
    if not isinstance(value, dict):
        return ""
    text = value.get("text")
    return text.strip() if isinstance(text, str) else ""


def _prediction(value: object) -> GooglePlacePrediction | None:
    if not isinstance(value, dict):
        return None
    raw = value.get("placePrediction")
    if not isinstance(raw, dict):
        return None
    place_id = raw.get("placeId")
    structured = raw.get("structuredFormat")
    if not isinstance(place_id, str) or not place_id.strip() or not isinstance(structured, dict):
        return None
    name = _text(structured.get("mainText"))
    if not name:
        return None
    location = _text(structured.get("secondaryText"))
    raw_types = raw.get("types")
    types = tuple(item for item in raw_types if isinstance(item, str)) if isinstance(raw_types, list) else ()
    return GooglePlacePrediction(
        place_id=place_id.strip(),
        name=name,
        location=location,
        types=types,
    )


class GooglePlacesAutocompleteSource:
    """Google Places autocomplete with a caller-supplied shared request cap."""

    def __init__(
        self,
        api_key: str,
        *,
        session: requests.Session | None = None,
        timeout: int = 8,
        reserve_request: Callable[[], bool],
    ) -> None:
        self._api_key = api_key
        self._timeout = timeout
        self._reserve_request = reserve_request
        if session is None:
            self._session = requests.Session()
            self._owns_session = True
        else:
            self._session = session
            self._owns_session = False

    def __enter__(self) -> GooglePlacesAutocompleteSource:
        return self

    def __exit__(self, *_args: object) -> None:
        if self._owns_session:
            self._session.close()

    def _check_cap(self) -> None:
        if not self._reserve_request():
            raise GooglePlacesDailyCapExceededError(
                "Google Places daily cap exceeded."
            )

    def autocomplete(
        self,
        *,
        query: str,
        lat: float | None,
        lng: float | None,
        limit: int = 5,
    ) -> list[GooglePlacePrediction]:
        query = query.strip()
        if len(query) < 3:
            return []

        body: dict[str, object] = {
            "input": query,
            "languageCode": "cs",
            "includedRegionCodes": ["cz", "sk"],
        }
        if lat is not None and lng is not None:
            body["locationBias"] = {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": 50_000.0,
                }
            }
            body["origin"] = {"latitude": lat, "longitude": lng}

        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": _FIELD_MASK,
        }
        response = None
        for attempt in range(2):
            self._check_cap()
            try:
                response = self._session.post(
                    _AUTOCOMPLETE_URL,
                    json=body,
                    headers=headers,
                    timeout=self._timeout,
                )
            except requests.RequestException as exc:
                raise GooglePlacesUnavailableError(
                    "Google Places request failed."
                ) from exc
            if response.status_code < 500:
                break
            if attempt == 1:
                raise GooglePlacesUnavailableError(
                    "Google Places retry budget exhausted."
                )

        if response is None or not response.ok:
            raise GooglePlacesUnavailableError(
                "Google Places returned an error response."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise GooglePlacesUnavailableError(
                "Google Places returned invalid JSON."
            ) from exc
        if not isinstance(payload, dict):
            raise GooglePlacesUnavailableError(
                "Google Places returned an invalid payload."
            )
        suggestions = payload.get("suggestions", [])
        if not isinstance(suggestions, list):
            raise GooglePlacesUnavailableError(
                "Google Places returned invalid suggestions."
            )
        predictions = [
            prediction
            for item in suggestions
            if (prediction := _prediction(item)) is not None
        ]
        return predictions[: max(0, limit)]

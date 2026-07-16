"""Strict Google Geocoding v4 client for explicit address resolution."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import quote

import requests

_GEOCODING_URL = "https://geocode.googleapis.com/v4/geocode"
_FIELD_MASK = ",".join(
    (
        "results.placeId",
        "results.location",
        "results.granularity",
        "results.formattedAddress",
        "results.addressComponents",
        "results.types",
    )
)
_PRECISE_TYPES = ("street_address", "premise", "subpremise")
_PRECISE_GRANULARITIES = {"ROOFTOP"}


class GoogleGeocodingUnavailableError(RuntimeError):
    """Raised when Google cannot safely complete an address geocode."""


class GoogleGeocodingDailyCapExceededError(GoogleGeocodingUnavailableError):
    """Raised before an HTTP request when the shared daily budget is spent."""


@dataclass(frozen=True)
class GoogleAddressCandidate:
    lat: float
    lng: float
    address: str
    city: str
    result_type: str
    place_id: str


def _component(components: object, *types: str) -> str:
    if not isinstance(components, list):
        return ""
    requested = set(types)
    for component in components:
        if not isinstance(component, dict):
            continue
        component_types = component.get("types")
        if not isinstance(component_types, list):
            continue
        if not requested.intersection(component_types):
            continue
        value = component.get("longText")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _candidate(
    result: object,
    *,
    require_precise: bool,
) -> GoogleAddressCandidate | None:
    if not isinstance(result, dict):
        return None
    result_types = {
        value for value in result.get("types", []) if isinstance(value, str)
    }
    result_type = next(
        (value for value in _PRECISE_TYPES if value in result_types),
        "",
    )
    if require_precise and (
        not result_type or result.get("granularity") not in _PRECISE_GRANULARITIES
    ):
        return None
    if not result_type:
        result_type = next(iter(result_types), "")

    location = result.get("location")
    if not isinstance(location, dict):
        return None
    lat = location.get("latitude")
    lng = location.get("longitude")
    if (
        not isinstance(lat, (int, float))
        or isinstance(lat, bool)
        or not isinstance(lng, (int, float))
        or isinstance(lng, bool)
        or not -90 <= float(lat) <= 90
        or not -180 <= float(lng) <= 180
    ):
        return None

    components = result.get("addressComponents")
    city = _component(
        components,
        "locality",
        "postal_town",
        "administrative_area_level_2",
    )
    street = _component(components, "route")
    street_number = _component(components, "street_number")
    address = " ".join(value for value in (street, street_number) if value)
    if not address:
        formatted = result.get("formattedAddress")
        address = formatted.strip() if isinstance(formatted, str) else ""
    place_id = result.get("placeId")
    return GoogleAddressCandidate(
        lat=float(lat),
        lng=float(lng),
        address=address,
        city=city,
        result_type=result_type,
        place_id=place_id if isinstance(place_id, str) else "",
    )


class GoogleGeocodingSource:
    """Google Geocoding v4 client with a caller-supplied shared budget."""

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

    def __enter__(self) -> GoogleGeocodingSource:
        return self

    def __exit__(self, *_args: object) -> None:
        if self._owns_session:
            self._session.close()

    def _check_cap(self) -> None:
        if not self._reserve_request():
            raise GoogleGeocodingDailyCapExceededError(
                "Google Geocoding daily cap exceeded."
            )

    def geocode_address(
        self,
        *,
        address: str,
        city: str,
    ) -> GoogleAddressCandidate | None:
        query = ", ".join(value.strip() for value in (address, city) if value.strip())
        if not query:
            return None

        url = f"{_GEOCODING_URL}/address/{quote(query, safe='')}"
        return self._geocode(url=url, require_precise=True)

    def geocode_place_id(self, place_id: str) -> GoogleAddressCandidate | None:
        """Resolve a known Google place without address-search precision gates."""

        place_id = place_id.strip()
        if not place_id:
            return None
        url = f"{_GEOCODING_URL}/places/{quote(place_id, safe='')}"
        return self._geocode(url=url, require_precise=False)

    def _geocode(
        self,
        *,
        url: str,
        require_precise: bool,
    ) -> GoogleAddressCandidate | None:
        headers = {
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": _FIELD_MASK,
        }
        response = None
        for attempt in range(2):
            self._check_cap()
            try:
                response = self._session.get(
                    url,
                    params={"languageCode": "cs"},
                    headers=headers,
                    timeout=self._timeout,
                )
            except requests.RequestException as exc:
                raise GoogleGeocodingUnavailableError(
                    "Google Geocoding request failed."
                ) from exc
            if response.status_code < 500:
                break
            if attempt == 1:
                raise GoogleGeocodingUnavailableError(
                    "Google Geocoding retry budget exhausted."
                )

        if response is None or not response.ok:
            raise GoogleGeocodingUnavailableError(
                "Google Geocoding returned an error response."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise GoogleGeocodingUnavailableError(
                "Google Geocoding returned invalid JSON."
            ) from exc
        if not isinstance(payload, dict):
            raise GoogleGeocodingUnavailableError(
                "Google Geocoding returned an invalid payload."
            )
        results = payload.get("results", [])
        if not isinstance(results, list):
            raise GoogleGeocodingUnavailableError(
                "Google Geocoding returned invalid results."
            )
        return next(
            (
                candidate
                for result in results
                if (
                    candidate := _candidate(
                        result,
                        require_precise=require_precise,
                    )
                )
                is not None
            ),
            None,
        )

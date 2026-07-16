"""Resolve a user-entered pub address to coordinates that may be persisted."""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings

from pubs.enrichment import GoogleGeocodingSource, GoogleGeocodingUnavailableError, geohash8
from pubs.external_api_budget import reserve_external_api_request


@dataclass(frozen=True)
class ResolvedPubLocation:
    name: str
    lat: float
    lng: float
    city: str
    address: str
    result_type: str

    @property
    def cache_key(self) -> str:
        return geohash8(self.lat, self.lng)


def resolve_user_added_pub_location(
    *,
    name: str,
    address: str,
    city: str = "",
    lat: float | None = None,
    lng: float | None = None,
) -> ResolvedPubLocation | None:
    """Geocode a complete address through Google for the compatibility flow.

    ``lat`` and ``lng`` remain accepted so the existing repair command and old
    call sites keep their signatures. They are deliberately not sent as a bias:
    an entered address may be in another city or country than the user.
    """

    del lat, lng
    api_key = getattr(settings, "GOOGLE_MAPS_SERVER_API_KEY", "") or ""
    if not api_key:
        raise GoogleGeocodingUnavailableError(
            "Google Geocoding is not configured."
        )

    timeout = int(getattr(settings, "GOOGLE_MAPS_TIMEOUT", 8))
    daily_cap = int(getattr(settings, "GOOGLE_MAPS_DAILY_CAP", 250))
    with GoogleGeocodingSource(
        api_key=api_key,
        timeout=timeout,
        reserve_request=lambda: reserve_external_api_request(
            provider="google_maps",
            operation="billable",
            cap=daily_cap,
        ),
    ) as source:
        candidate = source.geocode_address(address=address, city=city)

    if candidate is None:
        return None
    return ResolvedPubLocation(
        name=name,
        lat=candidate.lat,
        lng=candidate.lng,
        city=candidate.city or city,
        address=candidate.address or address,
        result_type=candidate.result_type,
    )

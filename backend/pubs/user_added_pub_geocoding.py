"""Resolve a user-entered pub address to coordinates that may be persisted."""

from __future__ import annotations

import json
import logging
import unicodedata
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.crypto import salted_hmac

from pubs.enrichment import GoogleGeocodingSource, GoogleGeocodingUnavailableError, geohash8
from pubs.external_api_budget import reserve_external_api_request
from pubs.models import PubGeocodingMiss

logger = logging.getLogger(__name__)
MISS_TTL = timedelta(hours=1)


@dataclass(frozen=True)
class ResolvedPubLocation:
    name: str
    lat: float
    lng: float
    city: str
    address: str
    result_type: str
    place_id: str = ""

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

    # Share misses across workers and restarts without retaining the submitted
    # address. A correction to either field gets a fresh lookup immediately.
    normalized = [
        " ".join(unicodedata.normalize("NFC", value).casefold().split())
        for value in (address, city)
    ]
    address_hash = salted_hmac(
        "pub-address-miss-v1", json.dumps(normalized), algorithm="sha256"
    ).hexdigest()
    if PubGeocodingMiss.objects.filter(
        address_hash=address_hash, expires_at__gt=timezone.now()
    ).exists():
        _log_miss(cached=True)
        return None

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
        # Only cache a completed no-match. Timeouts, exhausted budgets and
        # provider failures must remain immediately retryable after recovery.
        PubGeocodingMiss.objects.update_or_create(
            address_hash=address_hash,
            defaults={"expires_at": timezone.now() + MISS_TTL},
        )
        _log_miss(cached=False)
        return None
    return ResolvedPubLocation(
        name=name,
        lat=candidate.lat,
        lng=candidate.lng,
        city=candidate.city or city,
        address=candidate.address or address,
        result_type=candidate.result_type,
        place_id=candidate.place_id,
    )


def _log_miss(*, cached: bool) -> None:
    logger.info(
        "pub address lookup did not resolve a precise location",
        extra={
            "event": "pub_address_lookup",
            "observability": {"result": "no_match", "cached": cached},
        },
    )

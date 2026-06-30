from __future__ import annotations

import logging
from dataclasses import dataclass

import requests
from django.conf import settings

from pubs.enrichment import (
    MapyDailyCapExceededError,
    MapySuggestSource,
    geohash8,
    names_match,
)

logger = logging.getLogger(__name__)

SPECIFIC_GEOCODE_TYPES = {"poi", "regional.address"}


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


def build_pub_location_query(*, name: str, address: str, city: str = "") -> str:
    return ", ".join(
        part
        for part in [
            name.strip(),
            address.strip(),
            city.strip(),
            "Česko",
        ]
        if part
    )[:150]


def build_address_location_query(*, address: str, city: str = "") -> str:
    return ", ".join(
        part
        for part in [
            address.strip(),
            city.strip(),
            "Česko",
        ]
        if part
    )[:150]


def _named_entry(regional_structure: list, entry_type: str) -> str | None:
    """Return the ``name`` of the first regionalStructure entry of *entry_type*."""
    return next(
        (
            entry.get("name")
            for entry in regional_structure
            if isinstance(entry, dict) and entry.get("type") == entry_type
        ),
        None,
    )


def pick_city(item: dict) -> str:
    regional_structure = item.get("regionalStructure")
    if not isinstance(regional_structure, list):
        return ""
    for desired_type in ("regional.municipality", "regional.municipality_part"):
        match = _named_entry(regional_structure, desired_type)
        if isinstance(match, str) and match:
            return match
    return ""


def pick_address(item: dict) -> str:
    regional_structure = item.get("regionalStructure")
    if not isinstance(regional_structure, list):
        return ""
    street = _named_entry(regional_structure, "regional.street")
    number = _named_entry(regional_structure, "regional.address")
    if isinstance(street, str) and street and isinstance(number, str) and number:
        return f"{street} {number}"
    if isinstance(street, str) and street:
        return street
    return ""


def resolved_pub_location_from_item(item: dict, requested_name: str) -> ResolvedPubLocation | None:
    item_type = item.get("type")
    position = item.get("position") or {}
    lat = position.get("lat")
    lng = position.get("lon")
    if item_type not in SPECIFIC_GEOCODE_TYPES:
        return None
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    if not (-90.0 <= float(lat) <= 90.0 and -180.0 <= float(lng) <= 180.0):
        return None

    item_name = item.get("name")
    if (
        item_type == "poi"
        and isinstance(item_name, str)
        and item_name
        and not names_match(requested_name, item_name)
    ):
        return None

    return ResolvedPubLocation(
        name=item_name if item_type == "poi" and isinstance(item_name, str) and item_name else requested_name,
        lat=float(lat),
        lng=float(lng),
        city=pick_city(item),
        address=pick_address(item),
        result_type=item_type,
    )


def resolve_user_added_pub_location(
    *,
    name: str,
    address: str,
    city: str = "",
    lat: float | None = None,
    lng: float | None = None,
) -> ResolvedPubLocation | None:
    """Best-effort Mapy geocode for a user-added pub address.

    Returns None when Mapy is unavailable, unconfigured, imprecise, or the result
    name clearly points to another business. Callers then keep the original
    client-submitted coordinates rather than failing the public write endpoint.
    """

    primary_query = build_pub_location_query(name=name, address=address, city=city)
    api_key = getattr(settings, "MAPY_API_KEY", "") or ""
    if not api_key or not primary_query:
        return None

    daily_cap = int(getattr(settings, "MAPY_DAILY_CAP", 5000))
    queries = [primary_query]
    address_query = build_address_location_query(address=address, city=city)
    if address_query and address_query != primary_query:
        queries.append(address_query)

    try:
        with MapySuggestSource(api_key=api_key, daily_cap=daily_cap) as source:
            for query in queries:
                result = source.geocode_location(query, lat=lat, lng=lng, limit=3)
                for item in result.items:
                    resolved = resolved_pub_location_from_item(item, requested_name=name)
                    if resolved is not None:
                        return resolved
    except MapyDailyCapExceededError as exc:
        logger.warning("user-added-pub-geocode: Mapy daily cap hit: %s", exc)
        return None
    except (requests.RequestException, ValueError) as exc:
        logger.warning("user-added-pub-geocode: Mapy lookup failed: %s", exc)
        return None

    return None

"""Read-only client for exporting public beer-price data from Pivařova mapa.

This module deliberately has no database writes.  A reviewed export can later
be matched to our pub directory without presenting third-party data as a user
community contribution.
"""

from __future__ import annotations

import time
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote

import requests

BASE_URL = "https://pivarovamapa.cz"
DEFAULT_BBOX = "12.383589,48.300000,18.316411,51.200000"
SOURCE_NAME = "pivarova_mapa"


class PivarovaMapaError(RuntimeError):
    """The public source returned an unusable response."""


@dataclass(frozen=True)
class ExportProgress:
    """One normalized business row and its position in the requested crawl."""

    row: dict[str, Any]
    completed: int
    total: int


def _required_text(value: object, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise PivarovaMapaError(f"Missing {field}")
    return text


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _number(value: object, field: str) -> float:
    if isinstance(value, bool):
        raise PivarovaMapaError(f"Invalid {field}")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PivarovaMapaError(f"Invalid {field}") from exc
    return result


def _price_czk(value: object) -> int | float:
    """Keep half-crown prices exact while emitting normal whole prices as ints."""
    try:
        price = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise PivarovaMapaError("Invalid priceCzk") from exc
    if not price.is_finite() or price <= 0 or price > 2_000:
        raise PivarovaMapaError("Invalid priceCzk")
    if price == price.to_integral_value():
        return int(price)
    return float(price)


def _beer_name(beer: dict[str, Any], raw_name: object) -> str:
    brand = _optional_text(beer.get("brand"))
    product = _optional_text(beer.get("name"))
    if brand and product and product.casefold() != brand.casefold():
        return f"{brand} {product}"
    return product or brand or _required_text(raw_name, "rawBeerName")


def normalize_business(payload: object) -> dict[str, Any]:
    """Validate and normalize one ``/public/businesses/{slug}`` response."""
    if not isinstance(payload, dict):
        raise PivarovaMapaError("Business detail must be an object")

    slug = _required_text(payload.get("slug"), "slug")
    prices = payload.get("prices")
    if not isinstance(prices, list):
        raise PivarovaMapaError("Business prices must be a list")

    beers: list[dict[str, Any]] = []
    for index, item in enumerate(prices):
        if not isinstance(item, dict):
            raise PivarovaMapaError(f"Invalid price row {index}")
        # Some valid source rows intentionally have no canonical beer object
        # and carry the full tap name only in ``rawBeerName``.
        beer = item.get("beer") if isinstance(item.get("beer"), dict) else {}
        volume_l = _number(item.get("volumeL"), "volumeL")
        volume_ml = round(volume_l * 1_000)
        if volume_ml <= 0 or volume_ml > 2_000 or abs(volume_l * 1_000 - volume_ml) > 0.01:
            raise PivarovaMapaError("Invalid volumeL")

        beers.append(
            {
                "name": _beer_name(beer, item.get("rawBeerName")),
                "price_czk": _price_czk(item.get("priceCzk")),
                "volume_ml": volume_ml,
                "verified_at": _required_text(item.get("verifiedAt"), "verifiedAt"),
                "verification_method": _required_text(
                    item.get("verificationMethod"), "verificationMethod"
                ),
                "source_beer_id": _optional_text(beer.get("id")),
                "raw_name": _optional_text(item.get("rawBeerName")),
                "brand": _optional_text(beer.get("brand")),
                "brewery": _optional_text(beer.get("brewery")),
                "degree": _optional_text(beer.get("degree")),
                "alcohol": beer.get("alcohol") if isinstance(beer.get("alcohol"), int | float) else None,
            }
        )

    return {
        "source": SOURCE_NAME,
        "source_id": _required_text(payload.get("id"), "id"),
        "source_slug": slug,
        "source_url": f"{BASE_URL}/podnik/{quote(slug, safe='')}",
        "name": _required_text(payload.get("name"), "name"),
        "address": _optional_text(payload.get("address")),
        "city": _optional_text(payload.get("city")),
        "lat": _number(payload.get("lat"), "lat"),
        "lng": _number(payload.get("lng"), "lng"),
        "draft_offer_type": _optional_text(payload.get("draftOfferType")),
        "cid": _optional_text(payload.get("cid")),
        "beers": beers,
    }


class PivarovaMapaClient:
    """Small, rate-limited client for the source's public read endpoints."""

    def __init__(
        self,
        *,
        session: requests.Session | None = None,
        delay_seconds: float = 1.0,
        timeout_seconds: float = 15.0,
        sleep=time.sleep,
    ) -> None:
        if delay_seconds < 0:
            raise ValueError("delay_seconds must not be negative")
        self.session = session or requests.Session()
        self.delay_seconds = delay_seconds
        self.timeout_seconds = timeout_seconds
        self.sleep = sleep
        self.session.headers.setdefault(
            "User-Agent",
            "NaPivoDataExport/1.0 (+https://na-pivo.app; contact: info@na-pivo.app)",
        )

    def _get_json(self, path: str, *, params: dict[str, str] | None = None) -> object:
        try:
            response = self.session.get(
                f"{BASE_URL}{path}",
                params=params,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            raise PivarovaMapaError(f"Source request failed for {path}: {exc}") from exc

    def list_slugs(self, *, bbox: str = DEFAULT_BBOX) -> list[str]:
        payload = self._get_json("/public/map/pins", params={"bbox": bbox})
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise PivarovaMapaError("Map pins response must contain an items list")

        slugs: list[str] = []
        seen: set[str] = set()
        for item in payload["items"]:
            if not isinstance(item, dict) or item.get("hiddenOnPublicMap") is True:
                continue
            slug = _optional_text(item.get("slug"))
            if slug and slug not in seen:
                seen.add(slug)
                slugs.append(slug)
        return slugs

    def fetch_business(self, slug: str) -> dict[str, Any]:
        safe_slug = quote(_required_text(slug, "slug"), safe="")
        return normalize_business(self._get_json(f"/public/businesses/{safe_slug}"))

    def export(
        self,
        slugs: Iterable[str],
        *,
        skip_slugs: set[str] | None = None,
    ) -> Iterable[ExportProgress]:
        requested = [slug for slug in slugs if slug not in (skip_slugs or set())]
        total = len(requested)
        for index, slug in enumerate(requested):
            if index:
                self.sleep(self.delay_seconds)
            yield ExportProgress(
                row=self.fetch_business(slug),
                completed=index + 1,
                total=total,
            )

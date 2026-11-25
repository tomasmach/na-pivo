"""
pubs.label_scan — read one beer from a photo of its bottle or can label.

The sibling of :mod:`pubs.menu_scan` for drinking at home: the same image
pipeline, OpenRouter vision provider, shared daily budget and limits, but the
model is asked for a single beer and its packaging. The name is matched against
the beer catalogue so the drink lands under its canonical name.

No database writes, no XP, no stored image. The client logs the drink through
the existing ``POST /v1/drinks`` path after the user confirms it.
"""

from __future__ import annotations

import base64
import json

from django.conf import settings

from pubs.beer_catalog import BeerCatalogMatchCache, match_beer, match_beer_identity
from pubs.enrichment.openrouter import (
    OpenRouterUnavailableError,
    OpenRouterVisionSource,
    _strip_code_fences,
)
from pubs.external_api_budget import reserve_external_api_request

SERVING_TYPES = ("bottle", "can", "plastic_bottle")
_MAX_NAME_LENGTH = 120

_LABEL_PROMPT = (
    "Na fotce je láhev, plechovka nebo PET lahev piva. Přečti z etikety jedno pivo. "
    "Vrať STRIKTNĚ validní JSON přesně ve tvaru "
    '{"name":<string nebo null>,"brewery":<string nebo null>,'
    '"serving_type":"bottle"|"can"|"plastic_bottle"|null,"volume_ml":<integer nebo null>}. '
    "name je název piva včetně stupňovitosti, jak je na etiketě (např. Bernard 11°). "
    "brewery je pivovar. serving_type: bottle = skleněná láhev, can = plechovka, "
    "plastic_bottle = PET lahev. volume_ml je objem v mililitrech (0,5 l = 500, 0,33 l = 330). "
    "Nehádej nečitelné hodnoty, dej null. Když na fotce není pivo, vrať všude null. "
    "Nevracej nic jiného než tento JSON."
)


class LabelVisionSource(OpenRouterVisionSource):
    """OpenRouter vision client asking for one beer label instead of a menu."""

    def extract_label(self, jpeg_bytes: bytes) -> dict:
        if not self._api_key:
            raise OpenRouterUnavailableError("openrouter: API key not configured")
        b64 = base64.b64encode(jpeg_bytes).decode("ascii")
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _LABEL_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                    ],
                }
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "max_tokens": 256,
            "reasoning": {"enabled": False},
            "provider": {"data_collection": "deny"},
        }
        return parse_label(self._post_chat(payload))


def parse_label(content: str) -> dict:
    """Model text to a dict; anything unparseable reads as nothing recognized."""
    try:
        data = json.loads(_strip_code_fences(content))
    except ValueError, TypeError:
        return {}
    return data if isinstance(data, dict) else {}


def _clean_text(value) -> str:
    return value.strip()[:_MAX_NAME_LENGTH] if isinstance(value, str) else ""


def _build_label_source() -> LabelVisionSource:
    """Isolated so tests can inject a mocked session (the suite never hits the network)."""
    return LabelVisionSource(
        api_key=settings.OPENROUTER_API_KEY,
        model=settings.OPENROUTER_MODEL,
        timeout=settings.OPENROUTER_TIMEOUT,
        daily_cap=settings.OPENROUTER_DAILY_CAP,
        request_budget=lambda cap: reserve_external_api_request(
            provider="openrouter",
            operation="chat",
            cap=cap,
            reset_timezone="UTC",
        ),
    )


def canonical_label(raw: dict) -> dict | None:
    """Bound the model output and match the beer against the catalogue."""
    name = _clean_text(raw.get("name"))
    if not name:
        return None
    brewery = _clean_text(raw.get("brewery"))
    match_cache = BeerCatalogMatchCache()
    match = match_beer_identity(name, brewery, match_cache=match_cache) or match_beer(
        name, fuzzy=False, match_cache=match_cache
    )
    serving_type = raw.get("serving_type")
    volume = raw.get("volume_ml")
    return {
        "name": match.beer_name if match else name,
        "brewery": match.brand.name if match else brewery,
        "matched": match is not None,
        "serving_type": serving_type if serving_type in SERVING_TYPES else None,
        "volume_ml": volume if isinstance(volume, int) and 100 <= volume <= 3000 else None,
    }


def scan_label(jpeg_bytes: bytes) -> dict | None:
    """Run the vision model on a prepared JPEG; None when no beer was read.

    Raises the same OpenRouter errors as menu scan; the view maps them to 503.
    """
    with _build_label_source() as source:
        raw = source.extract_label(jpeg_bytes)
    return canonical_label(raw)

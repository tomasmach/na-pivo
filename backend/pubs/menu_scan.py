"""
pubs.menu_scan — orchestration for the AI beer-menu scan helper.

Two pure-ish steps the view (``MenuScanView``) composes:

1. :func:`validate_and_prepare_image` — turn an untrusted upload into a clean,
   downscaled JPEG byte string (decompression-bomb guards, EXIF transpose, RGB,
   longest-edge cap), modelled on ``pubs.accounts.process_avatar``. NEVER trusts
   the client's declared content-type.
2. :func:`extract_drinks_from_image` — send the JPEG to the OpenRouter vision
   client, categorize drinks, canonicalize beer names against the catalogue and
   bound price/volume values.

This module performs NO database writes, awards NO XP, and stores NO image — the
user reviews the result and the existing ``POST /v1/pub-community`` path does the
actual save + XP.
"""

from __future__ import annotations

import io

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError

# The volume set and price bounds are the SAME domain rules the community-save
# endpoint (CommunityBeerSerializer) validates against; sourcing them from the
# domain layer keeps the scan output and the write contract from ever drifting
# apart — a canonicalized beer is then guaranteed to pass the write serializer.
from pubs.beer_catalog import (
    ALLOWED_BEER_VOLUMES_ML,
    BEER_PRICE_MAX_CZK,
    BEER_PRICE_MIN_CZK,
    normalize_beer_payload,
)
from pubs.enrichment.openrouter import MAX_DRINKS, OpenRouterVisionSource
from pubs.models import DrinkLog

# Decoded-pixel ceiling so a tiny highly-compressed file cannot blow up memory
# (matches the avatar pipeline's generous phone-photo headroom).
_MAX_IMAGE_PIXELS = 50_000_000

# Bounds MUST match the community-save contract (CommunityBeerSerializer) so a
# scanned value can never be prefilled into a row that POST /v1/pub-community
# would 400 on — that would loop forever in the offline queue while the optimistic
# UI claims the contribution was saved. Both the price range and the allowed glass
# volumes come from pubs.beer_catalog so the two paths can never drift apart.
_PRICE_MIN, _PRICE_MAX = BEER_PRICE_MIN_CZK, BEER_PRICE_MAX_CZK


class MenuScanError(Exception):
    """A domain error the API layer maps to a 4xx response.

    Mirrors ``pubs.accounts.AccountError``: ``code`` is a stable machine string
    the mobile app branches on; ``message`` is human-facing Czech.
    """

    def __init__(
        self, message: str, *, code: str = "image_invalid", http_status: int = 400
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status


def validate_and_prepare_image(uploaded_file) -> bytes:
    """Re-encode an uploaded image to a downscaled JPEG byte string.

    NEVER trusts the client's content-type — every upload is decoded and
    re-encoded. Guards run BEFORE decode (size cap + decompression-bomb ceiling).
    Pipeline: ``exif_transpose`` → ``RGB`` → longest-edge downscale → JPEG.

    Raises :class:`MenuScanError` (``image_too_large`` | ``image_invalid``).
    """
    max_bytes = settings.MENU_SCAN_MAX_UPLOAD_BYTES

    # --- size guard (before any decode) ---
    size = getattr(uploaded_file, "size", None)
    if size is None and isinstance(uploaded_file, (bytes, bytearray)):
        size = len(uploaded_file)
    if size is not None and size > max_bytes:
        raise MenuScanError("Fotka je příliš velká.", code="image_too_large")

    if isinstance(uploaded_file, (bytes, bytearray)):
        raw = bytes(uploaded_file)
    else:
        # Read at most max_bytes + 1 so a lying/streaming Content-Length cannot
        # let an oversized body slip past the size attribute above.
        try:
            uploaded_file.seek(0)
        except (AttributeError, OSError):
            pass
        raw = uploaded_file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise MenuScanError("Fotka je příliš velká.", code="image_too_large")
    if not raw:
        raise MenuScanError("Fotku se nepodařilo načíst.", code="image_invalid")

    # --- decompression-bomb ceiling (before decode), restored in finally ---
    max_edge = settings.MENU_SCAN_IMAGE_PX
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
    try:
        try:
            with Image.open(io.BytesIO(raw)) as img:
                img.load()
                img = ImageOps.exif_transpose(img)
                img = img.convert("RGB")
                # Downscale the longest edge to max_edge (no upscaling); keeps
                # aspect ratio. Large enough that menu text stays legible for OCR.
                img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                out = io.BytesIO()
                img.save(
                    out,
                    format="JPEG",
                    quality=settings.MENU_SCAN_JPEG_QUALITY,
                    optimize=True,
                )
        except (DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise MenuScanError(
                "Fotku se nepodařilo načíst.", code="image_invalid"
            ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit

    return out.getvalue()


def _coerce_int(value, *, low: int, high: int) -> int | None:
    """Coerce a model-supplied number to an int within [low, high], else None."""
    if value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < low or number > high:
        return None
    return number


def _coerce_volume(value) -> int | None:
    """Coerce a model-supplied volume to an allowed glass size, else None.

    The community-save contract (CommunityBeerSerializer.volume_ml) accepts ONLY
    ``ALLOWED_BEER_VOLUMES_ML``, so a scanned volume outside that set (e.g. 250,
    568, 700) is nulled out here rather than passed through — otherwise the
    prefilled row would 400 on save and never land. Set membership is the whole
    rule; no separate range bound is needed.
    """
    if value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number in ALLOWED_BEER_VOLUMES_ML else None


def _coerce_other_volume(value) -> int | None:
    """Keep realistic soft-drink/shot/wine volumes without beer-menu restrictions."""
    return _coerce_int(value, low=10, high=3000)


def _canonicalize_drinks(raw_drinks: list[dict]) -> list[dict]:
    """Normalize AI output while keeping non-beers out of the beer catalogue.

    Drops empty/garbage names. The output mirrors the community-beer wire shape
    (``name`` / ``price_czk`` / ``volume_ml``) so mobile maps it straight via
    ``beerFromWire``.
    """
    out: list[dict] = []
    allowed_types = set(DrinkLog.DrinkType.values)
    for drink in raw_drinks:
        if not isinstance(drink, dict):
            continue
        drink_type = drink.get("drink_type", DrinkLog.DrinkType.BEER)
        if drink_type not in allowed_types:
            continue
        name = drink.get("name")
        if not isinstance(name, str):
            continue
        name = name.strip()
        if not name:
            continue
        price_czk = _coerce_int(drink.get("price_czk"), low=_PRICE_MIN, high=_PRICE_MAX)
        if drink_type == DrinkLog.DrinkType.BEER:
            volume_ml = _coerce_volume(drink.get("volume_ml"))
        else:
            volume_ml = _coerce_other_volume(drink.get("volume_ml"))
            if drink_type == DrinkLog.DrinkType.SHOT and volume_ml is not None and volume_ml > 200:
                volume_ml = None
        canonical = (
            normalize_beer_payload(
                {"name": name, "price_czk": price_czk, "volume_ml": volume_ml}
            )
            if drink_type == DrinkLog.DrinkType.BEER
            else {"name": name, "price_czk": price_czk, "volume_ml": volume_ml}
        )
        out.append(
            {
                "drink_type": drink_type,
                "name": canonical["name"],
                "price_czk": canonical.get("price_czk"),
                "volume_ml": canonical.get("volume_ml"),
            }
        )
        if len(out) >= MAX_DRINKS:
            break
    return out


def _build_vision_source() -> OpenRouterVisionSource:
    """Construct the OpenRouter client from settings.

    Isolated so tests can monkeypatch it to inject a mocked ``requests.Session``
    (the suite never hits the network).
    """
    return OpenRouterVisionSource(
        api_key=settings.OPENROUTER_API_KEY,
        model=settings.OPENROUTER_MODEL,
        timeout=settings.OPENROUTER_TIMEOUT,
        daily_cap=settings.OPENROUTER_DAILY_CAP,
    )


def extract_drinks_from_image(jpeg_bytes: bytes) -> list[dict]:
    """Run the vision model and return canonical categorized drinks.

    Raises ``OpenRouterUnavailableError`` / ``OpenRouterDailyCapExceededError``
    (and ``requests`` errors) up to the view, which maps them to 503.
    """
    with _build_vision_source() as source:
        raw_drinks = source.extract_drinks(jpeg_bytes)
    return _canonicalize_drinks(raw_drinks)

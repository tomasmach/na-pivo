"""
pubs.photos — beer-photo processing pipeline (upload → downscaled webp).

Cloned from :func:`pubs.accounts.process_avatar` with one deliberate
difference: a diary photo keeps its ASPECT RATIO (thumbnail-style downscale of
the long edge, never ``ImageOps.fit`` cropping) because the photo itself is the
content, not a square UI element. Everything else matches the avatar pipeline:
NEVER trust the client's content-type or extension, guard size and decoded
pixel count BEFORE decoding, ``exif_transpose``, RGB, re-encode to webp (which
also strips EXIF, so no GPS/location metadata ever reaches storage).
"""

from __future__ import annotations

import io

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.translation import gettext
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError

# Decoded-pixel ceiling so a tiny highly-compressed file cannot blow up memory
# (matches the avatar / menu-scan pipelines' generous phone-photo headroom).
_MAX_IMAGE_PIXELS = 50_000_000


class BeerPhotoError(Exception):
    """A domain error the API layer maps to a 4xx response.

    Mirrors ``pubs.accounts.AccountError``: ``code`` is a stable machine string
    the mobile app branches on; ``message`` is human-facing Czech.
    """

    def __init__(
        self, message: str, *, code: str = "photo_invalid", http_status: int = 400
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status


def process_beer_photo(file_or_bytes) -> ContentFile:
    """Re-encode an uploaded image to a downscaled webp ContentFile.

    Pipeline: size cap + decompression-bomb ceiling (both BEFORE decode) →
    ``exif_transpose`` (honour orientation) → ``RGB`` → thumbnail-style downscale
    so the LONG edge is at most ``BEER_PHOTO_MAX_EDGE_PX`` (aspect ratio kept,
    never upscaled, never cropped) → webp. Raises :class:`BeerPhotoError`
    (``photo_too_large`` | ``photo_invalid``).
    """
    max_bytes = settings.BEER_PHOTO_MAX_UPLOAD_BYTES

    # --- size guard (before any decode) ---
    size = getattr(file_or_bytes, "size", None)
    if size is None and isinstance(file_or_bytes, (bytes, bytearray)):
        size = len(file_or_bytes)
    if size is not None and size > max_bytes:
        raise BeerPhotoError(gettext("Fotka je příliš velká."), code="photo_too_large", http_status=400)

    if isinstance(file_or_bytes, (bytes, bytearray)):
        raw = bytes(file_or_bytes)
    else:
        # Read at most max_bytes + 1 so a lying/streaming Content-Length cannot
        # let an oversized body slip past the size attribute above.
        try:
            file_or_bytes.seek(0)
        except (AttributeError, OSError):
            pass
        raw = file_or_bytes.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise BeerPhotoError(gettext("Fotka je příliš velká."), code="photo_too_large", http_status=400)
    if not raw:
        raise BeerPhotoError(gettext("Fotku se nepodařilo načíst."), code="photo_invalid", http_status=400)

    # --- decompression-bomb ceiling (before decode), restored in finally ---
    max_edge = settings.BEER_PHOTO_MAX_EDGE_PX
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
    try:
        try:
            with Image.open(io.BytesIO(raw)) as img:
                img.load()
                img = ImageOps.exif_transpose(img)
                img = img.convert("RGB")
                # Downscale the longest edge to max_edge (no upscaling); keeps
                # aspect ratio — a diary photo must never be cropped square.
                img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                out = io.BytesIO()
                img.save(
                    out,
                    format="WEBP",
                    quality=settings.BEER_PHOTO_WEBP_QUALITY,
                    method=6,
                )
        except (DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise BeerPhotoError(
                gettext("Fotku se nepodařilo načíst."), code="photo_invalid", http_status=400
            ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit

    return ContentFile(out.getvalue(), name="photo.webp")

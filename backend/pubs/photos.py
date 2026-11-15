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
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.translation import gettext
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError

from pubs.models import BeerPhoto, beer_photo_thumbnail_name

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


@dataclass(frozen=True)
class ProcessedBeerPhoto:
    image: ContentFile
    thumbnail: ContentFile


def process_beer_photo(file_or_bytes) -> ProcessedBeerPhoto:
    """Re-encode an uploaded image to a downscaled webp and its list thumbnail.

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

    max_edge = settings.BEER_PHOTO_MAX_EDGE_PX
    with _decoded(raw) as img:
        img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        return ProcessedBeerPhoto(
            image=_webp(img, "photo.webp"),
            thumbnail=_webp(_thumbnail(img), "thumbnail.webp"),
        )


def beer_photo_thumbnail(stored: bytes) -> ContentFile:
    """List thumbnail of a photo that is already stored (backfill)."""

    with _decoded(stored) as img:
        return _webp(_thumbnail(img), "thumbnail.webp")


def store_beer_photo_thumbnail(photo: BeerPhoto, content: ContentFile) -> None:
    """Write the thumbnail at its derived name and point ``photo.thumbnail`` at it."""

    storage = photo.thumbnail.storage
    name = beer_photo_thumbnail_name(photo.image.name)
    if storage.exists(name):
        storage.delete(name)
    stored = storage.save(name, content)
    if stored != name:
        storage.delete(stored)
        raise OSError("beer photo thumbnail name is taken")
    photo.thumbnail.name = name


@contextmanager
def _decoded(raw: bytes) -> Iterator[Image.Image]:
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
    try:
        try:
            with Image.open(io.BytesIO(raw)) as img:
                img.load()
                yield ImageOps.exif_transpose(img).convert("RGB")
        except (DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise BeerPhotoError(
                gettext("Fotku se nepodařilo načíst."), code="photo_invalid", http_status=400
            ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


def _thumbnail(img: Image.Image) -> Image.Image:
    scale = settings.BEER_PHOTO_THUMB_SHORT_EDGE_PX / min(img.size)
    if scale >= 1:
        return img
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, Image.Resampling.LANCZOS)


def _webp(img: Image.Image, name: str) -> ContentFile:
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=settings.BEER_PHOTO_WEBP_QUALITY, method=6)
    return ContentFile(out.getvalue(), name=name)

"""Privacy-safe processing for one in-app feedback screenshot/photo."""

from __future__ import annotations

import io

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.translation import gettext
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError

_MAX_IMAGE_PIXELS = 50_000_000


class FeedbackAttachmentError(Exception):
    """A stable API error for invalid or oversized feedback media."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = 400


def process_feedback_attachment(uploaded_file) -> ContentFile:
    """Validate, downscale and re-encode an upload as metadata-free WebP."""
    max_bytes = settings.FEEDBACK_ATTACHMENT_MAX_UPLOAD_BYTES
    size = getattr(uploaded_file, "size", None)
    if size is not None and size > max_bytes:
        raise FeedbackAttachmentError(
            gettext("Příloha je příliš velká."), code="attachment_too_large"
        )

    try:
        uploaded_file.seek(0)
    except (AttributeError, OSError):
        pass
    raw = uploaded_file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise FeedbackAttachmentError(
            gettext("Příloha je příliš velká."), code="attachment_too_large"
        )
    if not raw:
        raise FeedbackAttachmentError(
            gettext("Přílohu se nepodařilo načíst."), code="attachment_invalid"
        )

    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
    try:
        try:
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGB")
                edge = settings.FEEDBACK_ATTACHMENT_MAX_EDGE_PX
                image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(
                    output,
                    format="WEBP",
                    quality=settings.FEEDBACK_ATTACHMENT_WEBP_QUALITY,
                    method=6,
                )
        except (DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
            raise FeedbackAttachmentError(
                gettext("Přílohu se nepodařilo načíst."), code="attachment_invalid"
            ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit

    return ContentFile(output.getvalue(), name="attachment.webp")

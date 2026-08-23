"""UGC content moderation via the OpenAI omni-moderation endpoint.

Callers with nothing to moderate skip this helper entirely: empty or
whitespace-only total input fails closed as sanitized invalid_input and is
never auto-approved.
"""

from __future__ import annotations

import base64
import io
import logging
import math
import time
import warnings
from dataclasses import dataclass
from enum import StrEnum
from typing import BinaryIO

import requests
from django.conf import settings
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations"
_MODERATION_MODEL = "omni-moderation-latest"
_MAX_TOTAL_TEXT_LENGTH = 32_000
_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_MAX_IMAGE_PIXELS = 50_000_000
_THUMBNAIL_EDGE = 1024
_WEBP_QUALITY = 80
_WEBP_METHOD = 6
_DEFAULT_CONNECT_TIMEOUT_S = 2
_DEFAULT_READ_TIMEOUT_S = 5
MAX_MODERATION_CONNECT_TIMEOUT_SECONDS = 10
MAX_MODERATION_READ_TIMEOUT_SECONDS = 30

_UNAVAILABLE_MESSAGE = "Content moderation is temporarily unavailable."
_LOG_MESSAGE = "ugc moderation"


class ModerationOutcome(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"


class ModerationSurface(StrEnum):
    PUB_NAME_CORRECTION = "pub_name_correction"
    USER_PUB = "user_pub"
    PUB_COMMUNITY = "pub_community"
    PUB_AMENITY_VOTE = "pub_amenity_vote"
    FRIEND_PUB_ACTIVITY = "friend_pub_activity"
    PUBLISHED_NIGHT = "published_night"
    PUBLISHED_NIGHT_COMMENT = "published_night_comment"
    COMMUNITY_EVENT = "community_event"
    COMMUNITY_EVENT_JOIN = "community_event_join"
    COMMUNITY_EVENT_TEAM = "community_event_team"
    PUB_EVENT = "pub_event"
    ACCOUNT_PROFILE = "account_profile"
    ACCOUNT_AVATAR = "account_avatar"
    AUTH_PROFILE = "auth_profile"
    DRINK_PUBLICATION = "drink_publication"
    BEER_CHECKIN = "beer_checkin"
    BEER_PHOTO = "beer_photo"
    PHOTO_CONTEST_ENTRY = "photo_contest_entry"
    PARTY_EVENING = "party_evening"
    PARTY_DRINK = "party_drink"
    PARTY_GAME = "party_game"
    PARTY_EVENT = "party_event"


class ModerationUnavailableError(Exception):
    """Moderation could not be completed; details are never exposed."""


@dataclass(frozen=True)
class ModerationResult:
    outcome: ModerationOutcome

    @property
    def approved(self) -> bool:
        return self.outcome is ModerationOutcome.APPROVED


def _unavailable() -> ModerationUnavailableError:
    return ModerationUnavailableError(_UNAVAILABLE_MESSAGE)


def _elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def _log_values(
    surface_value: str,
    outcome: str,
    latency_ms: int,
    *,
    status_code: int | None = None,
    failure_kind: str | None = None,
) -> None:
    observability: dict[str, object] = {
        "surface": surface_value,
        "outcome": outcome,
        "latency_ms": latency_ms,
    }
    if status_code is not None:
        observability["status_code"] = int(status_code)
    elif failure_kind is not None:
        observability["failure_kind"] = failure_kind
    logger.info(
        _LOG_MESSAGE,
        extra={"event": "ugc_moderation", "observability": observability},
    )


def _log(
    surface: ModerationSurface,
    outcome: str,
    latency_ms: int,
    *,
    status_code: int | None = None,
    failure_kind: str | None = None,
) -> None:
    _log_values(
        surface.value,
        outcome,
        latency_ms,
        status_code=status_code,
        failure_kind=failure_kind,
    )


def _required_api_key() -> str:
    key = getattr(settings, "OPENAI_MODERATION_API_KEY", "")
    if not isinstance(key, str) or not key.strip():
        raise _unavailable()
    return key.strip()


def _required_model() -> str:
    model = getattr(settings, "OPENAI_MODERATION_MODEL", _MODERATION_MODEL)
    if model != _MODERATION_MODEL:
        raise _unavailable()
    return model


def _timeout_settings() -> tuple[float, float]:
    values = []
    for name, default, maximum in (
        (
            "OPENAI_MODERATION_CONNECT_TIMEOUT_SECONDS",
            _DEFAULT_CONNECT_TIMEOUT_S,
            MAX_MODERATION_CONNECT_TIMEOUT_SECONDS,
        ),
        (
            "OPENAI_MODERATION_READ_TIMEOUT_SECONDS",
            _DEFAULT_READ_TIMEOUT_S,
            MAX_MODERATION_READ_TIMEOUT_SECONDS,
        ),
    ):
        raw = getattr(settings, name, default)
        if isinstance(raw, bool):
            raise _unavailable()
        value = 0.0
        parsed = False
        try:
            value = float(raw)
            parsed = True
        except (TypeError, ValueError):
            parsed = False
        if not parsed or not math.isfinite(value) or value <= 0 or value > maximum:
            raise _unavailable()
        values.append(value)
    return values[0], values[1]


def _validated_text(texts: tuple[str, ...]) -> str:
    cleaned: list[str] = []
    total = 0
    try:
        iterator = iter(texts)
    except TypeError:
        iterator = None
    if iterator is None:
        raise _unavailable()
    for text in iterator:
        if not isinstance(text, str):
            raise _unavailable()
        stripped = text.strip()
        if stripped:
            total += len(stripped) + (1 if cleaned else 0)
            if total > _MAX_TOTAL_TEXT_LENGTH:
                raise _unavailable()
            cleaned.append(stripped)
    return "\n".join(cleaned)


def _read_stream(stream: BinaryIO) -> bytes | None:
    # Untrusted boundary: any ordinary Exception from attribute access, seek()
    # or read() fails closed to an invalid image; BaseException is never caught.
    try:
        seek = getattr(stream, "seek", None)
        if callable(seek):
            try:
                seek(0)
            except Exception:
                # A stream whose seek() fails is in an unknown state; read() must
                # never run after it, so this fails closed immediately.
                return None
        data = stream.read(_MAX_IMAGE_BYTES + 1)
    except Exception:
        return None
    if not isinstance(data, bytes):
        return None
    return data


def _webp_data_url(
    image: bytes | bytearray | memoryview | BinaryIO, *, surface: ModerationSurface, started: float
) -> str:
    raw = b""
    failed = False
    if isinstance(image, bytes):
        raw = image
    elif isinstance(image, bytearray):
        if len(image) > _MAX_IMAGE_BYTES:
            failed = True
        else:
            raw = bytes(image)
    elif isinstance(image, memoryview):
        if image.nbytes > _MAX_IMAGE_BYTES:
            failed = True
        else:
            raw = image.tobytes()
    else:
        streamed = _read_stream(image)
        if streamed is None:
            failed = True
        else:
            raw = streamed
    if not failed and (not raw or len(raw) > _MAX_IMAGE_BYTES):
        failed = True

    buffer = io.BytesIO()
    too_large = False
    if not failed:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                source = Image.open(io.BytesIO(raw))
                try:
                    width, height = source.size
                    if width * height > _MAX_IMAGE_PIXELS:
                        too_large = True
                    else:
                        source.load()
                        frame = ImageOps.exif_transpose(source).convert("RGB")
                        frame.thumbnail((_THUMBNAIL_EDGE, _THUMBNAIL_EDGE))
                        frame.save(
                            buffer, format="WEBP", quality=_WEBP_QUALITY, method=_WEBP_METHOD
                        )
                finally:
                    source.close()
        except Exception:
            # The whole decode/transpose/convert/thumbnail/save boundary fails
            # closed; BaseException (KeyboardInterrupt & co.) is never swallowed.
            failed = True
    if failed or too_large:
        _log(surface, "unavailable", _elapsed_ms(started), failure_kind="invalid_image")
        raise _unavailable()
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{encoded}"


def moderate_ugc(
    *,
    surface: ModerationSurface,
    texts: tuple[str, ...] = (),
    image: bytes | bytearray | memoryview | BinaryIO | None = None,
    session: requests.Session | None = None,
) -> ModerationResult:
    """Moderate user-generated content; returns a result or raises a sanitized error."""
    started = time.monotonic()

    if not isinstance(surface, ModerationSurface):
        # The supplied value is untrusted; only the constant "invalid" is
        # logged, never its repr or string form.
        _log_values("invalid", "unavailable", _elapsed_ms(started), failure_kind="invalid_surface")
        raise _unavailable()

    try:
        text = _validated_text(texts)
    except ModerationUnavailableError:
        _log(surface, "unavailable", _elapsed_ms(started), failure_kind="invalid_text")
        raise

    image_url = (
        _webp_data_url(image, surface=surface, started=started) if image is not None else None
    )

    if not text and image_url is None:
        # Callers with nothing to moderate skip the helper; reaching this point
        # with empty input is a caller bug and must never auto-approve.
        _log(
            surface,
            "unavailable",
            _elapsed_ms(started),
            failure_kind="invalid_input",
        )
        raise _unavailable()

    try:
        api_key = _required_api_key()
        model = _required_model()
        connect_timeout, read_timeout = _timeout_settings()
    except ModerationUnavailableError:
        _log(surface, "unavailable", _elapsed_ms(started), failure_kind="config")
        raise

    if image_url is not None:
        input_parts: list[dict | str] = []
        if text:
            input_parts.append({"type": "text", "text": text})
        input_parts.append({"type": "image_url", "image_url": {"url": image_url}})
        request_input: str | list[dict | str] = input_parts
    else:
        request_input = text
    payload = {"model": model, "input": request_input}

    owned_session = session is None
    http: requests.Session | None = None
    session_failed = False
    if owned_session:
        try:
            http = requests.Session()
        except requests.RequestException:
            session_failed = True
    else:
        http = session
    if session_failed or http is None:
        _log(surface, "unavailable", _elapsed_ms(started), failure_kind="network_error")
        raise _unavailable()
    try:
        network_failed = False
        try:
            response = http.post(  # type: ignore[union-attr]
                OPENAI_MODERATION_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=(connect_timeout, read_timeout),
            )
        except requests.RequestException:
            network_failed = True
        if network_failed:
            _log(surface, "unavailable", _elapsed_ms(started), failure_kind="network_error")
            raise _unavailable()

        status_failed = False
        status_code: int | None = None
        try:
            status_code = int(response.status_code)  # type: ignore[union-attr]
        except AttributeError, TypeError, ValueError:
            status_failed = True
        if status_failed:
            _log(surface, "unavailable", _elapsed_ms(started), failure_kind="invalid_response")
            raise _unavailable()
        if not 200 <= status_code < 300:
            _log(surface, "unavailable", _elapsed_ms(started), status_code=status_code)
            raise _unavailable()

        parse_failed = False
        flagged = False
        try:
            results = response.json()["results"]  # type: ignore[union-attr]
            valid = (
                isinstance(results, list)
                and len(results) == 1
                and isinstance(results[0], dict)
                and type(results[0].get("flagged")) is bool
            )
            if valid:
                flagged = bool(results[0]["flagged"])
            else:
                parse_failed = True
        except KeyError, ValueError, TypeError, AttributeError:
            parse_failed = True
        if parse_failed:
            _log(surface, "unavailable", _elapsed_ms(started), failure_kind="invalid_response")
            raise _unavailable()
    finally:
        if owned_session:
            http.close()  # type: ignore[union-attr]

    outcome = ModerationOutcome.REJECTED if flagged else ModerationOutcome.APPROVED
    _log(surface, outcome.value, _elapsed_ms(started), status_code=status_code)
    return ModerationResult(outcome=outcome)

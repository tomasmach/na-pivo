"""Small observability helpers for structured logs and privacy-safe request IDs."""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from asgiref.sync import iscoroutinefunction, markcoroutinefunction
from django.conf import settings
from django.http import HttpRequest, HttpResponse

from pubs.privacy import redact_party_codes

logger = logging.getLogger("pubs.request")


def _safe_request_id(value: str | None) -> str:
    if not value:
        return uuid.uuid4().hex
    cleaned = value.strip()
    if not cleaned or len(cleaned) > 80:
        return uuid.uuid4().hex
    return "".join(ch for ch in cleaned if ch.isalnum() or ch in "-_.:")[:80] or uuid.uuid4().hex


def get_client_ip_hash(request: HttpRequest) -> str:
    """Return a stable, non-reversible hash for request origin grouping.

    The raw IP address is deliberately not logged or stored. This still lets us
    spot single-source error bursts without keeping the address itself.
    """

    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    raw_ip = forwarded_for.split(",", 1)[0].strip() or request.META.get("REMOTE_ADDR", "")
    if not raw_ip:
        return ""
    secret = str(getattr(settings, "SECRET_KEY", ""))
    return hashlib.sha256(f"{secret}:{raw_ip}".encode()).hexdigest()[:16]


def _truncated_header(request: HttpRequest, name: str, max_len: int = 180) -> str:
    value = request.headers.get(name, "").strip()
    return value[:max_len]


def _request_fields(
    request: HttpRequest,
    *,
    request_id: str,
    status_code: int,
    duration_ms: int,
) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "request_id": request_id,
        "method": request.method,
        "path": redact_party_codes(request.path),
        "status_code": status_code,
        "duration_ms": duration_ms,
        "client_ip_hash": get_client_ip_hash(request),
    }

    account_id = getattr(request, "na_pivo_account_id", "")
    if account_id:
        fields["account_id"] = account_id

    for header, field_name in (
        ("User-Agent", "user_agent"),
        ("X-Na-Pivo-App-Version", "app_version"),
        ("X-Na-Pivo-Platform", "platform"),
        ("X-Na-Pivo-OS-Version", "os_version"),
    ):
        value = _truncated_header(request, header)
        if value:
            fields[field_name] = value

    return fields


class RequestLogMiddleware:
    """Log every HTTP request once with duration, status and request id."""

    sync_capable = True
    async_capable = True

    def __init__(self, get_response):
        self.get_response = get_response
        self.is_async = iscoroutinefunction(get_response)
        if self.is_async:
            markcoroutinefunction(self)

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if self.is_async:
            return self.__acall__(request)

        started = time.perf_counter()
        request_id = _safe_request_id(request.headers.get("X-Request-ID"))
        request.na_pivo_request_id = request_id

        try:
            response = self.get_response(request)
        except Exception:
            duration_ms = round((time.perf_counter() - started) * 1000)
            logger.exception(
                "request failed",
                extra={
                    "event": "http_request_error",
                    "observability": _request_fields(
                        request,
                        request_id=request_id,
                        status_code=500,
                        duration_ms=duration_ms,
                    ),
                },
            )
            raise

        return self._complete_request(request, response, started, request_id)

    async def __acall__(self, request: HttpRequest) -> HttpResponse:
        started = time.perf_counter()
        request_id = _safe_request_id(request.headers.get("X-Request-ID"))
        request.na_pivo_request_id = request_id

        try:
            response = await self.get_response(request)
        except Exception:
            duration_ms = round((time.perf_counter() - started) * 1000)
            logger.exception(
                "request failed",
                extra={
                    "event": "http_request_error",
                    "observability": _request_fields(
                        request,
                        request_id=request_id,
                        status_code=500,
                        duration_ms=duration_ms,
                    ),
                },
            )
            raise

        return self._complete_request(request, response, started, request_id)

    @staticmethod
    def _complete_request(
        request: HttpRequest,
        response: HttpResponse,
        started: float,
        request_id: str,
    ) -> HttpResponse:
        duration_ms = round((time.perf_counter() - started) * 1000)
        status_code = getattr(response, "status_code", 0)
        response["X-Request-ID"] = request_id

        if status_code >= 500:
            level = logging.ERROR
        elif status_code >= 400:
            level = logging.WARNING
        else:
            level = logging.INFO

        logger.log(
            level,
            "request completed",
            extra={
                "event": "http_request",
                "observability": _request_fields(
                    request,
                    request_id=request_id,
                    status_code=status_code,
                    duration_ms=duration_ms,
                ),
            },
        )
        return response


class JsonLogFormatter(logging.Formatter):
    """JSON formatter used by Django and app logs in production containers."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": redact_party_codes(record.getMessage()),
        }

        event = getattr(record, "event", None)
        if event:
            payload["event"] = event

        observability = getattr(record, "observability", None)
        if isinstance(observability, dict):
            payload.update(observability)

        if record.exc_info:
            payload["exception"] = redact_party_codes(
                self.formatException(record.exc_info)
            )

        return json.dumps(payload, ensure_ascii=False, default=str)

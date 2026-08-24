import json
import logging

import pytest
from asgiref.sync import iscoroutinefunction
from django.http import JsonResponse
from django.test import RequestFactory

from pubs.observability import JsonLogFormatter, RequestLogMiddleware, _request_fields


def test_request_log_redacts_party_join_code() -> None:
    request = RequestFactory().get("/v1/party-evenings/PRAH24/games/stream")

    fields = _request_fields(
        request,
        request_id="request-1",
        status_code=200,
        duration_ms=1,
    )

    assert fields["path"] == "/v1/party-evenings/[redacted-party-code]/games/stream"
    assert "PRAH24" not in str(fields)


def test_request_log_redacts_web_party_route() -> None:
    request = RequestFactory().get("/party/EFJ66G")

    fields = _request_fields(
        request,
        request_id="request-2",
        status_code=200,
        duration_ms=1,
    )

    assert fields["path"] == "/party/[redacted-party-code]"
    assert "EFJ66G" not in str(fields)


def test_request_log_redacts_friend_invite_token() -> None:
    token = "Ab3xK9_pQ2sT"
    request = RequestFactory().get(f"/p/{token}")

    fields = _request_fields(
        request,
        request_id="request-3",
        status_code=200,
        duration_ms=1,
    )

    assert fields["path"] == "/p/[redacted-invite-token]"
    assert token not in str(fields)


def test_formatter_redacts_invite_token_from_django_request_warning() -> None:
    record = logging.LogRecord(
        name="django.request",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="Not Found: /p/Ab3xK9_pQ2sT",
        args=(),
        exc_info=None,
    )

    payload = json.loads(JsonLogFormatter().format(record))

    assert payload["message"] == "Not Found: /p/[redacted-invite-token]"
    assert "Ab3xK9_pQ2sT" not in str(payload)


def test_formatter_redacts_codes_in_query_and_percent_encoded_forms() -> None:
    record = logging.LogRecord(
        name="django.request",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg=(
            "Bad Request: /party/STUL24?next=%2Fv1%2Fparty-evenings%2FPRAH24"
            "&code=EFJ66G"
        ),
        args=(),
        exc_info=None,
    )

    payload = json.loads(JsonLogFormatter().format(record))
    message = payload["message"]

    assert "PRAH24" not in message
    assert "STUL24" not in message
    assert "EFJ66G" not in message


def test_formatter_redacts_party_code_from_django_request_warning() -> None:
    record = logging.LogRecord(
        name="django.request",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="Not Found: /v1/party-evenings/PRAH24/join",
        args=(),
        exc_info=None,
    )

    payload = json.loads(JsonLogFormatter().format(record))

    assert payload["message"] == (
        "Not Found: /v1/party-evenings/[redacted-party-code]/join"
    )
    assert "PRAH24" not in str(payload)


def test_formatter_redacts_party_codes_from_json_and_python_dicts() -> None:
    record = logging.LogRecord(
        name="pubs.worker",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=(
            'payload={"join_code": "PRAH24"} '
            "context={'party_code': 'STUL24'}"
        ),
        args=(),
        exc_info=None,
    )

    payload = json.loads(JsonLogFormatter().format(record))

    assert "PRAH24" not in payload["message"]
    assert "STUL24" not in payload["message"]
    assert payload["message"].count("[redacted-party-code]") == 2


@pytest.mark.asyncio
async def test_request_log_middleware_keeps_asgi_requests_async() -> None:
    async def get_response(request):
        return JsonResponse({"ok": True})

    middleware = RequestLogMiddleware(get_response)
    request = RequestFactory().get("/v1/health")

    assert iscoroutinefunction(middleware)
    response = await middleware(request)

    assert response.status_code == 200
    assert response["X-Request-ID"]

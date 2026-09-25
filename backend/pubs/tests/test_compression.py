"""Response compression: JSON is gzipped on request, streams never are."""

from __future__ import annotations

import gzip
import json
import uuid

import pytest
from asgiref.sync import sync_to_async
from django.db import connections
from django.http import HttpResponse, StreamingHttpResponse
from django.test import AsyncClient, RequestFactory
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.tests.test_party_games import _table
from pubs.compression import BufferedGZipMiddleware


def _register(client: APIClient) -> str:
    response = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["token"]


@pytest.mark.django_db
def test_json_endpoint_is_gzipped_only_when_the_client_accepts_it():
    client = APIClient()
    token = _register(client)
    auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    plain = client.get("/v1/account/me", **auth)
    assert plain.status_code == status.HTTP_200_OK
    assert not plain.has_header("Content-Encoding")
    assert "Accept-Encoding" in plain["Vary"]

    compressed = client.get("/v1/account/me", HTTP_ACCEPT_ENCODING="gzip, deflate", **auth)
    assert compressed.status_code == status.HTTP_200_OK
    assert compressed["Content-Encoding"] == "gzip"
    assert int(compressed["Content-Length"]) == len(compressed.content)
    assert len(compressed.content) < len(plain.content)
    body = json.loads(gzip.decompress(compressed.content))
    assert body["id"] == plain.json()["id"]


def test_streamed_responses_pass_through_untouched():
    request = RequestFactory().get("/", HTTP_ACCEPT_ENCODING="gzip")
    middleware = BufferedGZipMiddleware(lambda request: None)

    stream = StreamingHttpResponse(iter([b"x" * 500]), content_type="application/json")
    assert middleware.process_response(request, stream) is stream
    assert not stream.has_header("Content-Encoding")
    assert b"".join(stream.streaming_content) == b"x" * 500

    buffered_sse = HttpResponse(b"data: x\n\n" * 100, content_type="text/event-stream")
    assert middleware.process_response(request, buffered_sse) is buffered_sse
    assert not buffered_sse.has_header("Content-Encoding")


@pytest.fixture
async def _close_stream_database_connection():
    yield
    await sync_to_async(connections.close_all, thread_sensitive=True)()


@pytest.mark.django_db(transaction=True)
async def test_live_game_stream_is_never_gzipped(
    settings, monkeypatch, _close_stream_database_connection
):
    from pubs.api import party_views

    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "account": "10000/min",
            "friends": "10000/min",
        },
    }
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.05)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 1)
    _host_token, _host, guest_token, _guest, code = await sync_to_async(
        _table, thread_sensitive=True
    )(APIClient())

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream",
        headers={"authorization": f"Bearer {guest_token}", "accept-encoding": "gzip"},
    )

    assert response["Content-Type"].startswith("text/event-stream")
    assert not response.has_header("Content-Encoding")
    first_chunk = await anext(response.streaming_content)
    assert b"event: open" in first_chunk
    async for _chunk in response.streaming_content:
        pass

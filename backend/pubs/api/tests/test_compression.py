"""Large API snapshots keep their JSON contract when clients accept gzip."""

import gzip
import json

import pytest
from django.http import HttpResponse, StreamingHttpResponse
from django.test import RequestFactory

from pubs.api.compression import LargeSnapshotGZipMiddleware


@pytest.mark.parametrize("path", ["/v1/pubs/near", "/v1/drinks", "/v1/pub-visits"])
def test_large_snapshots_compress_only_when_requested(path):
    middleware = LargeSnapshotGZipMiddleware(lambda request: None)
    payload = json.dumps({"items": ["pub"] * 100}).encode()
    factory = RequestFactory()

    compressed = middleware.process_response(
        factory.get(path, HTTP_ACCEPT_ENCODING="gzip"),
        HttpResponse(payload, content_type="application/json"),
    )
    assert compressed["Content-Encoding"] == "gzip"
    assert "Accept-Encoding" in compressed["Vary"]
    assert gzip.decompress(compressed.content) == payload
    assert json.loads(gzip.decompress(compressed.content))["items"] == ["pub"] * 100

    uncompressed = middleware.process_response(
        factory.get(path),
        HttpResponse(payload, content_type="application/json"),
    )
    assert "Content-Encoding" not in uncompressed
    assert uncompressed.content == payload

    post_response = middleware.process_response(
        factory.post(path, HTTP_ACCEPT_ENCODING="gzip"),
        HttpResponse(payload, content_type="application/json"),
    )
    assert "Content-Encoding" not in post_response
    assert post_response.content == payload


def test_streams_and_unrelated_json_are_untouched():
    middleware = LargeSnapshotGZipMiddleware(lambda request: None)
    factory = RequestFactory()
    body = b"data: " + b"x" * 1000
    stream = StreamingHttpResponse([body], content_type="application/json")
    response = middleware.process_response(
        factory.get("/v1/drinks", HTTP_ACCEPT_ENCODING="gzip"),
        stream,
    )
    assert response is stream
    assert "Content-Encoding" not in response

    other = HttpResponse(b"x" * 1000, content_type="application/json")
    response = middleware.process_response(
        factory.get("/v1/account/me", HTTP_ACCEPT_ENCODING="gzip"),
        other,
    )
    assert response is other
    assert "Content-Encoding" not in response

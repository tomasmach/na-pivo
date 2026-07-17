"""
Tests for the AI beer-menu scan endpoint (POST /v1/pub-menu-scan).

Network policy
--------------
The suite NEVER hits the live network. The OpenRouter HTTP call is replaced by a
mock ``requests`` adapter (same pattern as test_mapy.py) wired into a real
``OpenRouterVisionSource``, and ``pubs.menu_scan._build_vision_source`` is
monkeypatched to return it — so the view exercises the real image pipeline,
parsing, and canonicalization, just not the network.
"""

from __future__ import annotations

import io
import json
import uuid
from collections.abc import Callable

import pytest
import requests
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from requests.adapters import HTTPAdapter
from requests.models import Response
from rest_framework import status
from rest_framework.test import APIClient

from pubs import menu_scan
from pubs.enrichment import openrouter as openrouter_mod
from pubs.enrichment.openrouter import OpenRouterVisionSource

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    # MenuScanView is per-IP throttled (scope "menu_scan"); DRF stores the
    # request history in the default cache. Clear it around every test so the
    # shared 127.0.0.1 counter never bleeds across tests.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _reset_counter():
    """Reset the process-wide OpenRouter daily counter between tests."""
    openrouter_mod._global_counter._day = None
    openrouter_mod._global_counter._count = 0
    yield
    openrouter_mod._global_counter._day = None
    openrouter_mod._global_counter._count = 0


@pytest.fixture(autouse=True)
def _vision_key(settings):
    """Default the tests to a configured key (the unset-key case sets its own)."""
    settings.OPENROUTER_API_KEY = "test-key"
    settings.OPENROUTER_MODEL = "google/gemini-2.5-flash"


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _register(client: APIClient) -> str:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------


def _jpeg_bytes(size: tuple[int, int] = (800, 600), color=(210, 160, 40)) -> bytes:
    """A solid-colour JPEG of the given size."""
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _upload(content: bytes | None = None, *, content_type: str = "image/jpeg") -> SimpleUploadedFile:
    """Wrap bytes in an uploaded file so they land in request.FILES."""
    return SimpleUploadedFile("menu.jpg", content if content is not None else _jpeg_bytes(), content_type=content_type)


# ---------------------------------------------------------------------------
# Mock OpenRouter session (mirror test_mapy._MockAdapter)
# ---------------------------------------------------------------------------


def _chat_response(beers_json: str, status_code: int = 200) -> Response:
    """Build a fake OpenAI-style chat-completion body wrapping ``beers_json``."""
    payload = {
        "choices": [{"message": {"role": "assistant", "content": beers_json}}],
        "model": "google/gemini-2.5-flash",
    }
    resp = Response()
    resp.status_code = status_code
    resp.headers["Content-Type"] = "application/json"
    resp._content = json.dumps(payload).encode("utf-8")
    resp.url = "https://openrouter.ai/api/v1/chat/completions"
    resp.encoding = "utf-8"
    return resp


class _MockAdapter(HTTPAdapter):
    def __init__(self, handler: Callable[[requests.PreparedRequest], Response]) -> None:
        super().__init__()
        self._handler = handler

    def send(self, request: requests.PreparedRequest, **kwargs) -> Response:  # type: ignore[override]
        return self._handler(request)


def _make_source(handler: Callable, daily_cap: int = 2000) -> OpenRouterVisionSource:
    session = requests.Session()
    adapter = _MockAdapter(handler)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return OpenRouterVisionSource(
        api_key="test-key", session=session, daily_cap=daily_cap
    )


def _patch_source(monkeypatch, source: OpenRouterVisionSource) -> None:
    monkeypatch.setattr(menu_scan, "_build_vision_source", lambda: source)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_happy_path_returns_mapped_beers(client, monkeypatch):
    # "Kozel 11" canonicalizes to the catalogue product name, proving the
    # extraction output is normalized just like the community-write path.
    content = json.dumps(
        {
            "beers": [
                {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500},
                {"name": "Kozel 11", "price_czk": 45, "volume_ml": 500},
            ]
        }
    )
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response(content)))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["model"] == "google/gemini-2.5-flash"
    assert body["beers"] == [
        {"name": "Pilsner Urquell", "price_czk": 59, "volume_ml": 500},
        {"name": "Velkopopovický Kozel 11°", "price_czk": 45, "volume_ml": 500},
    ]


@pytest.mark.django_db
def test_scan_returns_categorized_drinks_and_legacy_beers(client, monkeypatch):
    content = json.dumps(
        {
            "drinks": [
                {"drink_type": "beer", "name": "Plzeň", "price_czk": 62, "volume_ml": 500},
                {"drink_type": "soft_drink", "name": "Kofola", "price_czk": 49, "volume_ml": 400},
                {"drink_type": "shot", "name": "Slivovice", "price_czk": 65, "volume_ml": 40},
                {"drink_type": "wine", "name": "Ryzlink", "price_czk": 70, "volume_ml": 200},
            ]
        }
    )
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response(content)))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert body["beers"] == [
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}
    ]
    assert body["drinks"] == [
        {"drink_type": "beer", "name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
        {"drink_type": "soft_drink", "name": "Kofola", "price_czk": 49, "volume_ml": 400},
        {"drink_type": "shot", "name": "Slivovice", "price_czk": 65, "volume_ml": 40},
    ]


@pytest.mark.django_db
def test_markdown_fenced_json_is_parsed(client, monkeypatch):
    """The model may wrap JSON in a ```json code fence — we strip it.

    "Plzeň" also canonicalizes to "Pilsner Urquell" via the catalogue aliases.
    """
    fenced = "```json\n" + json.dumps({"beers": [{"name": "Plzeň", "price_czk": 60}]}) + "\n```"
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response(fenced)))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["beers"] == [{"name": "Pilsner Urquell", "price_czk": 60, "volume_ml": None}]


@pytest.mark.django_db
def test_bounds_caps_and_garbage_are_cleaned(client, monkeypatch):
    """Out-of-range price/volume → null; empty names dropped; capped at 12."""
    beers = [{"name": f"Beer {i}", "price_czk": 50} for i in range(15)]
    beers.append({"name": "  ", "price_czk": 40})  # blank name → dropped
    beers.append({"name": "Weird", "price_czk": 999999, "volume_ml": 99})  # out of range
    content = json.dumps({"beers": beers})
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response(content)))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    out = resp.json()["beers"]
    assert len(out) == 12  # capped before the blank/weird ones are even reached
    assert all(b["name"].startswith("Beer ") for b in out)


@pytest.mark.django_db
def test_unsaveable_price_and_volume_are_nulled(client, monkeypatch):
    """Scan output must match the community-save contract, else the prefilled row
    400s forever in the offline queue.

    CommunityBeerSerializer caps ``price_czk`` at 1000 and only accepts
    ``volume_ml`` in {300,330,400,500,1000}. A scanned price > 1000 or a volume
    outside that set must come back as null (not passed straight through), while a
    legal value survives unchanged.
    """
    content = json.dumps(
        {
            "beers": [
                {"name": "Pilsner Urquell", "price_czk": 1500, "volume_ml": 250},
                {"name": "Birell", "price_czk": 1290, "volume_ml": 700},
                {"name": "Kozel 11", "price_czk": 49, "volume_ml": 330},
            ]
        }
    )
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response(content)))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    out = resp.json()["beers"]
    # Over-cap price (1500, 1290) and disallowed volumes (250, 700) are nulled.
    assert out[0]["price_czk"] is None
    assert out[0]["volume_ml"] is None
    assert out[1]["price_czk"] is None
    assert out[1]["volume_ml"] is None
    # An in-contract price/volume passes through untouched.
    assert out[2]["price_czk"] == 49
    assert out[2]["volume_ml"] == 330


@pytest.mark.django_db
def test_empty_extraction_returns_200_with_empty_list(client, monkeypatch):
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response('{"beers": []}')))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["beers"] == []


@pytest.mark.django_db
def test_unparseable_model_output_returns_200_empty(client, monkeypatch):
    """Garbage (non-JSON) model text must NOT 500 — it yields an empty list."""
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response("sorry, no menu here")))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["beers"] == []


# ---------------------------------------------------------------------------
# Input validation (400)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_missing_image_returns_400_image_missing(client):
    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan", data={}, format="multipart", **_auth(token)
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "image_missing"


@pytest.mark.django_db
def test_invalid_image_returns_400_image_invalid(client):
    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload(b"this is not an image")},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "image_invalid"


@pytest.mark.django_db
def test_oversize_image_returns_400_image_too_large(client, settings):
    settings.MENU_SCAN_MAX_UPLOAD_BYTES = 64  # tiny → any real JPEG exceeds it
    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "image_too_large"


# ---------------------------------------------------------------------------
# Vision failures (503)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_vision_network_failure_returns_503_unavailable(client, monkeypatch):
    def handler(req):
        raise requests.exceptions.ConnectionError("network down")

    _patch_source(monkeypatch, _make_source(handler))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert resp.json()["code"] == "vision_unavailable"


@pytest.mark.django_db
def test_daily_cap_returns_503_daily_cap(client, monkeypatch):
    # daily_cap=0 → the first request is refused before any HTTP happens.
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response('{"beers": []}'), daily_cap=0))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert resp.json()["code"] == "daily_cap"


@pytest.mark.django_db
def test_unset_key_returns_503_unavailable(client, settings):
    settings.OPENROUTER_API_KEY = ""
    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert resp.json()["code"] == "vision_unavailable"


# ---------------------------------------------------------------------------
# Auth (401)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_unauthenticated_returns_401(client):
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
    )
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# Cost / privacy guards on the outgoing OpenRouter request
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_request_payload_caps_cost_and_denies_data_collection(client, monkeypatch):
    """The chat payload bounds output cost and opts out of provider data logging."""
    captured: dict = {}

    def handler(req):
        captured.update(json.loads(req.body))
        return _chat_response('{"beers": []}')

    _patch_source(monkeypatch, _make_source(handler))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    # Bounded output + no reasoning tokens on a deterministic JSON extraction.
    assert captured["max_tokens"] == 2048
    assert captured["reasoning"] == {"enabled": False}
    # Only route to providers that do not store/train on the menu photo.
    assert captured["provider"] == {"data_collection": "deny"}


@pytest.mark.django_db
def test_prompt_includes_non_alcoholic_beer_and_volume_pairing_rules(
    client, monkeypatch
):
    """The model instructions must keep Czech menu edge cases explicit."""
    captured: dict = {}

    def handler(req):
        captured.update(json.loads(req.body))
        return _chat_response('{"beers": []}')

    _patch_source(monkeypatch, _make_source(handler))

    token = _register(client)
    resp = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content

    prompt = captured["messages"][0]["content"][0]["text"]
    assert "nealkoholická piva" in prompt
    assert "radlery" in prompt
    assert "soft_drink" in prompt
    assert "shot" in prompt
    assert "20/40/50 ml" in prompt
    assert "0,4 l" in prompt
    assert "400 ml" in prompt
    assert "přednostně půllitr 500 ml" in prompt
    assert "Nehádej" in prompt


# ---------------------------------------------------------------------------
# Per-account daily cap (503 daily_cap)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_per_account_daily_cap_returns_503(client, monkeypatch, settings):
    """A single account that exceeds the daily cap is blocked (others unaffected)."""
    settings.MENU_SCAN_DAILY_PER_ACCOUNT_CAP = 2
    _patch_source(monkeypatch, _make_source(lambda req: _chat_response('{"beers": []}')))

    token = _register(client)
    for _ in range(2):
        ok = client.post(
            "/v1/pub-menu-scan",
            data={"image": _upload()},
            format="multipart",
            **_auth(token),
        )
        assert ok.status_code == status.HTTP_200_OK, ok.content

    blocked = client.post(
        "/v1/pub-menu-scan",
        data={"image": _upload()},
        format="multipart",
        **_auth(token),
    )
    assert blocked.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert blocked.json()["code"] == "daily_cap"

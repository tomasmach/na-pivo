"""POST /v1/beer-label-scan — one beer read from a bottle or can label.

The OpenRouter call is replaced by a mocked ``requests`` adapter wired into a
real ``LabelVisionSource``; the suite never reaches the network or a paid API.
"""

from __future__ import annotations

import json
import uuid

import pytest
import requests
from django.core.cache import cache
from rest_framework.test import APIClient

from pubs import label_scan
from pubs.api.tests.test_pub_menu_scan import _chat_response, _MockAdapter, _upload
from pubs.enrichment import openrouter as openrouter_mod
from pubs.models import ExternalApiDailyUsage


@pytest.fixture(autouse=True)
def _isolate(settings):
    settings.OPENROUTER_API_KEY = "test-key"
    settings.OPENROUTER_MODEL = "google/gemini-2.5-flash"
    cache.clear()
    openrouter_mod._global_counter._day = None
    openrouter_mod._global_counter._count = 0
    yield
    cache.clear()


def _auth(client: APIClient) -> dict[str, str]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == 201
    return {"HTTP_AUTHORIZATION": f"Bearer {resp.json()['token']}"}


def _patch(monkeypatch, content: str, calls: list | None = None) -> None:
    def handler(request):
        if calls is not None:
            calls.append(json.loads(request.body))
        return _chat_response(content)

    session = requests.Session()
    session.mount("https://", _MockAdapter(handler))
    source = label_scan.LabelVisionSource(api_key="test-key", session=session)
    monkeypatch.setattr(label_scan, "_build_label_source", lambda: source)


@pytest.mark.django_db
def test_label_scan_matches_the_catalogue_beer_and_serving(monkeypatch):
    calls: list = []
    _patch(
        monkeypatch,
        json.dumps({"name": "Kozel 11", "brewery": None, "serving_type": "can", "volume_ml": 500}),
        calls,
    )
    client = APIClient()

    resp = client.post(
        "/v1/beer-label-scan", data={"image": _upload()}, format="multipart", **_auth(client)
    )

    assert resp.status_code == 200, resp.content
    assert resp.json() == {
        "beer": {
            "name": "Velkopopovický Kozel 11°",
            "brewery": "Velkopopovický Kozel",
            "matched": True,
            "serving_type": "can",
            "volume_ml": 500,
        },
        "model": "google/gemini-2.5-flash",
    }
    assert calls[0]["provider"] == {"data_collection": "deny"}


@pytest.mark.django_db
def test_label_scan_keeps_unknown_beers_and_bounds_values(monkeypatch):
    _patch(
        monkeypatch,
        json.dumps(
            {
                "name": "Domácí Ležák 12°",
                "brewery": "Pivovar U Nás",
                "serving_type": "keg",
                "volume_ml": 9000,
            }
        ),
    )
    client = APIClient()

    beer = client.post(
        "/v1/beer-label-scan", data={"image": _upload()}, format="multipart", **_auth(client)
    ).json()["beer"]

    assert beer == {
        "name": "Domácí Ležák 12°",
        "brewery": "Pivovar U Nás",
        "matched": False,
        "serving_type": None,
        "volume_ml": None,
    }


@pytest.mark.django_db
def test_label_scan_returns_null_when_nothing_is_read(monkeypatch):
    _patch(monkeypatch, "not json at all")
    client = APIClient()

    resp = client.post(
        "/v1/beer-label-scan", data={"image": _upload()}, format="multipart", **_auth(client)
    )

    assert resp.status_code == 200
    assert resp.json()["beer"] is None


@pytest.mark.django_db
def test_label_scan_errors_match_menu_scan_codes(monkeypatch, settings):
    client = APIClient()
    auth = _auth(client)

    missing = client.post("/v1/beer-label-scan", data={}, format="multipart", **auth)
    assert missing.status_code == 400
    assert missing.json()["code"] == "image_missing"

    settings.OPENROUTER_API_KEY = ""
    unavailable = client.post(
        "/v1/beer-label-scan", data={"image": _upload()}, format="multipart", **auth
    )
    assert unavailable.status_code == 503
    assert unavailable.json()["code"] == "vision_unavailable"

    assert APIClient().post(
        "/v1/beer-label-scan", data={"image": _upload()}, format="multipart"
    ).status_code in (401, 403)


@pytest.mark.django_db
def test_production_label_source_spends_the_shared_openrouter_budget(settings):
    settings.OPENROUTER_DAILY_CAP = 1
    with label_scan._build_label_source() as source:
        source._check_cap()
    usage = ExternalApiDailyUsage.objects.get(provider="openrouter", operation="chat")
    assert usage.request_count == 1

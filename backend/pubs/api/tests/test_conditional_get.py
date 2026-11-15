from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient) -> dict[str, str]:
    response = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    return {"HTTP_AUTHORIZATION": f"Bearer {response.json()['token']}"}


def _rate(client: APIClient, auth: dict[str, str], verdict: str) -> None:
    response = client.put(
        "/v1/pub-ratings",
        data={
            "name": "U Zlatého tygra",
            "lat": 50.0876,
            "lng": 14.4214,
            "verdict": verdict,
            "updated_at": timezone.now().isoformat(),
        },
        format="json",
        **auth,
    )
    assert response.status_code == status.HTTP_200_OK, response.content


@pytest.mark.django_db
def test_unchanged_api_read_answers_304_without_a_body(client):
    auth = _register(client)
    _rate(client, auth, "like")

    first = client.get("/v1/pub-ratings", **auth)
    assert first.status_code == status.HTTP_200_OK
    assert first["Cache-Control"] == "private, no-cache"
    etag = first["ETag"]

    again = client.get("/v1/pub-ratings", HTTP_IF_NONE_MATCH=etag, **auth)
    assert again.status_code == status.HTTP_304_NOT_MODIFIED
    assert again.content == b""

    _rate(client, auth, "dislike")
    changed = client.get("/v1/pub-ratings", HTTP_IF_NONE_MATCH=etag, **auth)
    assert changed.status_code == status.HTTP_200_OK
    assert changed["ETag"] != etag
    assert changed.json()["ratings"][0]["verdict"] == "dislike"


@pytest.mark.django_db
def test_gzip_weak_etag_still_matches(client):
    auth = _register(client)
    for index in range(20):
        client.put(
            "/v1/pub-ratings",
            data={
                "name": f"Hospoda číslo {index}",
                "lat": 50.08 + index / 1000,
                "lng": 14.42,
                "verdict": "like",
                "note": "Pěna jak smetana",
                "updated_at": timezone.now().isoformat(),
            },
            format="json",
            **auth,
        )
    first = client.get("/v1/pub-ratings", HTTP_ACCEPT_ENCODING="gzip", **auth)
    assert first["Content-Encoding"] == "gzip"
    assert first["ETag"].startswith('W/"')

    again = client.get(
        "/v1/pub-ratings", HTTP_ACCEPT_ENCODING="gzip", HTTP_IF_NONE_MATCH=first["ETag"], **auth
    )
    assert again.status_code == status.HTTP_304_NOT_MODIFIED


@pytest.mark.django_db
def test_another_account_never_gets_304_for_a_different_body(client):
    first_auth = _register(client)
    _rate(client, first_auth, "like")
    etag = client.get("/v1/pub-ratings", **first_auth)["ETag"]

    other = client.get("/v1/pub-ratings", HTTP_IF_NONE_MATCH=etag, **_register(client))
    assert other.status_code == status.HTTP_200_OK
    assert other.json()["ratings"] == []


@pytest.mark.django_db
def test_writes_and_errors_keep_their_answers(client):
    auth = _register(client)
    unauthorized = client.get("/v1/pub-ratings", HTTP_IF_NONE_MATCH="*")
    assert unauthorized.status_code == status.HTTP_401_UNAUTHORIZED

    written = client.put(
        "/v1/pub-ratings",
        data={"name": "U Fleků", "lat": 50.0, "lng": 14.4, "verdict": "like", "updated_at": timezone.now().isoformat()},
        format="json",
        HTTP_IF_NONE_MATCH="*",
        **auth,
    )
    assert written.status_code == status.HTTP_200_OK
    assert not written.has_header("ETag")

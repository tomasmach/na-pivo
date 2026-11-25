"""A crawler on the web pages cannot take the database connections the app's API needs.

On 24 November 2026 PerplexityBot walked the pub and city pages, every connection of the shared
pool went to them, and the app's requests failed after waiting 10 s for one (HTTP 500).
"""

from __future__ import annotations

import asyncio
import threading

import pytest
from asgiref.sync import ThreadSensitiveContext
from django.test import AsyncClient

from pubs.web import capacity, pubs_data
from pubs.web.assets import asset_url, stylesheet_name


async def _get(path: str):
    # Like Django's ASGI handler: every request runs its sync code in a thread of its own.
    async with ThreadSensitiveContext():
        return await AsyncClient().get(path)


@pytest.fixture
def one_place(settings):
    settings.WEB_PAGE_CONCURRENCY = 1
    settings.WEB_PAGE_QUEUE_SECONDS = 0.05


@pytest.mark.parametrize(
    ("path", "text"),
    [("/hospody/praha", "Je tu teď narváno"), ("/en/pub/u-kocoura-u2fkbfqw", "packed in here")],
)
async def test_a_web_page_past_the_last_place_gets_a_503_without_the_database(one_place, path, text):
    # No django_db mark: reading the database from any thread would turn the answer into a 500.
    places = capacity._places_of_this_loop()
    await places.acquire()
    try:
        response = await _get(path)
    finally:
        places.release()

    assert response.status_code == 503
    assert response["Retry-After"] == "30"
    assert response["Cache-Control"] == "no-store"
    assert text in response.content.decode()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    "path",
    [
        "/v1/pubs/near?lat=50.08&lng=14.43&radius_km=1",
        "/robots.txt",
        "/.well-known/assetlinks.json",
        asset_url(stylesheet_name(("pubs.css",))),
        "/favicon.ico",
    ],
)
async def test_the_api_and_files_answer_while_every_web_place_is_taken(one_place, path):
    places = capacity._places_of_this_loop()
    await places.acquire()
    try:
        response = await _get(path)
    finally:
        places.release()

    assert response.status_code == 200


async def test_a_missing_file_answers_404_without_the_database_while_every_web_place_is_taken(one_place):
    places = capacity._places_of_this_loop()
    await places.acquire()
    try:
        response = await _get("/web/old.css")
    finally:
        places.release()

    assert response.status_code == 404


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    ("module", "name"), [(pubs_data, "cities_by_size"), (capacity, "_return_connections")], ids=["view", "returning"]
)
async def test_a_client_that_hangs_up_keeps_its_place_until_its_connection_is_back(one_place, monkeypatch, module, name):
    reached, finish = threading.Event(), threading.Event()
    original = getattr(module, name)

    def slow():
        reached.set()
        finish.wait(5)
        return original()

    monkeypatch.setattr(module, name, slow)
    gone = asyncio.ensure_future(_get("/hospody"))
    assert await asyncio.to_thread(reached.wait, 5)
    gone.cancel()

    # The request's thread still holds its connection, so the place is not free yet.
    assert (await _get("/hospody")).status_code == 503

    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await gone
    assert (await _get("/hospody")).status_code == 200

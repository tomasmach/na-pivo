"""The request body survives a client that hangs up while the API still works on it.

Production served these through gunicorn's uvicorn workers. A phone that dropped the
connection a few milliseconds after sending a POST got Django to close the request body
before the view read it, so /v1/pub-hours and /v1/client-events failed with
"I/O operation on closed file" (500) and the hours or event were lost.
"""

from __future__ import annotations

import asyncio
import json
import threading

import pytest
from asgiref.sync import AsyncToSync
from django.conf import settings
from django.core.handlers.asgi import ASGIHandler
from django.test import Client
from django.utils.module_loading import import_string

from pubs.api import views
from pubs.models import ClientEvent

_PUB = {"name": "U Zlatého tygra", "lat": 50.0857, "lng": 14.4189}


def _scope(path: str, body: bytes) -> dict:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"localhost"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("localhost", 80),
    }


def test_every_middleware_runs_async():
    """A sync-only middleware puts a thread between the event loop and the views, see the next test."""

    sync_only = [
        path
        for path in settings.MIDDLEWARE
        if not getattr(import_string(path), "async_capable", False)
    ]
    assert sync_only == []


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    ("path", "view_class", "payload"),
    [
        ("/v1/pub-hours", views.PubHoursView, {"pubs": [_PUB]}),
        ("/v1/client-events", views.ClientEventsView, {"event": "app_open"}),
    ],
)
async def test_view_reads_the_body_of_a_client_that_hung_up(monkeypatch, path, view_class, payload):
    # The disconnect is delivered at the two moments the event loop and the view's thread can
    # disagree: once the middleware hands the request back to the event loop (only a sync
    # middleware does that), or once the view runs. Holding both until the handler is done
    # makes the few-millisecond race from production happen on every run.
    reached = threading.Event()
    handler_done = threading.Event()
    view_done = threading.Event()
    view_errors: list[BaseException] = []
    enriched: list[list[dict]] = []

    original_main_wrap = AsyncToSync.main_wrap

    async def late_main_wrap(self, *args, **kwargs):
        reached.set()
        await asyncio.to_thread(handler_done.wait, 2)
        return await original_main_wrap(self, *args, **kwargs)

    original_throttles = view_class.check_throttles

    def check_throttles(self, request):
        reached.set()
        handler_done.wait(0.3)
        return original_throttles(self, request)

    original_post = view_class.post

    def post(self, request):
        try:
            return original_post(self, request)
        except BaseException as exc:
            view_errors.append(exc)
            raise
        finally:
            view_done.set()

    def get_or_enrich(pubs, sync_budget=None):
        enriched.append(pubs)
        return []

    monkeypatch.setattr(AsyncToSync, "main_wrap", late_main_wrap)
    monkeypatch.setattr(view_class, "check_throttles", check_throttles)
    monkeypatch.setattr(view_class, "post", post)
    monkeypatch.setattr(views, "get_or_enrich", get_or_enrich)

    body = json.dumps(payload).encode()
    messages = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive():
        if messages:
            return messages.pop(0)
        await asyncio.to_thread(reached.wait, 5)
        return {"type": "http.disconnect"}

    async def send(message):
        pass

    try:
        await ASGIHandler()(_scope(path, body), receive, send)
    finally:
        handler_done.set()
    assert await asyncio.to_thread(view_done.wait, 5)

    assert view_errors == []
    if view_class is views.PubHoursView:
        assert [pub["name"] for pub in enriched[0]] == [_PUB["name"]]
    else:
        assert await ClientEvent.objects.filter(event="app_open").acount() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("path", ["/v1/pub-hours", "/v1/client-events"])
async def test_body_cut_off_mid_upload_never_reaches_the_view(monkeypatch, path):
    called: list[str] = []
    monkeypatch.setattr(views.PubHoursView, "post", lambda *a, **kw: called.append("pub-hours"))
    monkeypatch.setattr(views.ClientEventsView, "post", lambda *a, **kw: called.append("events"))
    body = json.dumps({"pubs": [_PUB], "event": "app_open"}).encode()
    messages = [
        {"type": "http.request", "body": body[:10], "more_body": True},
        {"type": "http.disconnect"},
    ]
    sent: list[dict] = []

    async def receive():
        return messages.pop(0)

    async def send(message):
        sent.append(message)

    await ASGIHandler()(_scope(path, body), receive, send)

    assert called == []
    assert sent == []


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/v1/pub-hours", "/v1/client-events"])
@pytest.mark.parametrize("body", ['{"pubs": [', "not json", '{"event": "app_open"'])
def test_broken_json_is_a_bad_request(path, body):
    response = Client().post(path, data=body, content_type="application/json")

    assert response.status_code == 400

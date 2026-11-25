"""How many web requests one worker serves at once, so the app's API always has database connections left.

The web and the API share each worker's pool of database connections, and nothing limited how many
requests a worker takes on at once. A crawler walking thousands of pub pages used every connection,
and the app's requests waited ``DB_POOL_TIMEOUT`` for one and failed with a 500. A web request now
first waits for one of ``WEB_PAGE_CONCURRENCY`` places, before anything that reads the database. Past
``WEB_PAGE_QUEUE_SECONDS`` it gets a 503 with Retry-After, which crawlers read as "come back later".
"""

from __future__ import annotations

import asyncio
import threading
import weakref

from asgiref.sync import iscoroutinefunction, sync_to_async
from django.conf import settings
from django.db import connections
from django.http import HttpRequest, HttpResponse
from django.urls import Resolver404, resolve
from django.utils import translation
from django.utils.decorators import sync_and_async_middleware
from django.utils.translation import gettext

from pubs.web.assets import web_asset
from pubs.web.pages import _path_lang, render_page
from pubs.web_views import (
    android_asset_statements,
    apple_app_site_association,
    invite_asset,
    llms_txt,
    robots_txt,
)

RETRY_AFTER_SECONDS = 30
# Files that never read the database. The 503 page needs its stylesheet, and robots and phones read
# robots.txt and /.well-known/ about the whole site: a 503 on robots.txt stops Google crawling for hours.
_FILES = frozenset(
    {web_asset, invite_asset, robots_txt, llms_txt, apple_app_site_association, android_asset_statements}
)

_places: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = weakref.WeakKeyDictionary()


def _limited(request: HttpRequest) -> bool:
    if request.path_info.startswith("/v1/"):
        return False
    try:
        return resolve(request.path_info).func not in _FILES
    except Resolver404:
        return True


def _busy(request: HttpRequest) -> HttpResponse:
    with translation.override(_path_lang(request)):
        response = render_page(request, "web/busy.html", title=gettext("Zkus to prosím za chvíli"), status=503)
    response["Retry-After"] = str(RETRY_AFTER_SECONDS)
    response["Cache-Control"] = "no-store"
    return response


def _places_of_this_loop() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _places:
        _places[loop] = asyncio.Semaphore(settings.WEB_PAGE_CONCURRENCY)
    return _places[loop]


def _return_connections() -> None:
    """Hand the request's connection back to the pool now, not once the body has gone out to the client."""

    for connection in connections.all(initialized_only=True):
        if not connection.in_atomic_block:
            connection.close_if_unusable_or_obsolete()


@sync_and_async_middleware
def web_capacity_middleware(get_response):
    if iscoroutinefunction(get_response):

        async def middleware(request: HttpRequest) -> HttpResponse:
            if not _limited(request):
                return await get_response(request)
            places = _places_of_this_loop()
            try:
                async with asyncio.timeout(settings.WEB_PAGE_QUEUE_SECONDS):
                    await places.acquire()
            except TimeoutError:
                return _busy(request)
            try:
                return await get_response(request)
            finally:
                # The request's own thread runs this once the view is done. A client that hangs up ends
                # the waits here, not the view's thread, so the place is freed when the connection is back.
                returned = asyncio.ensure_future(sync_to_async(_return_connections)())
                returned.add_done_callback(lambda _: places.release())
                await asyncio.shield(returned)

    else:
        places = threading.BoundedSemaphore(settings.WEB_PAGE_CONCURRENCY)

        def middleware(request: HttpRequest) -> HttpResponse:
            if not _limited(request):
                return get_response(request)
            if not places.acquire(timeout=settings.WEB_PAGE_QUEUE_SECONDS):
                return _busy(request)
            try:
                return get_response(request)
            finally:
                places.release()

    return middleware

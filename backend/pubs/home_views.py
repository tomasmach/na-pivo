"""Store links, structured data and the host rule every public page of na-pivo.cz shares.

The pages themselves are in ``pubs.web_views``; this module stays free of the web
shell so ``pubs.web.pages`` can import it.
"""

from __future__ import annotations

import json
from functools import wraps
from urllib.parse import quote, urlsplit

from django.conf import settings
from django.http import HttpRequest, HttpResponse, HttpResponsePermanentRedirect
from django.utils.safestring import SafeString, mark_safe

HOME_OG_PATH = "/og/home.png"
# The rules for reusing the site's data (quote a fact with the source, never copy the whole).
DATA_LICENSE_PATH = "/llms.txt"
APP_STORE_URL = "https://apps.apple.com/cz/app/id6773790025"
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.tomasmach.na_pivo"
PATHS = {"cs": "/", "en": "/en"}
AUTHOR = {"@type": "Person", "name": "Tomáš Mach", "url": "https://www.instagram.com/jsem_mach/"}
# Keeps "</script>" inside a value from ending the block early.
_LD_ESCAPES = {ord("<"): "\\u003c", ord(">"): "\\u003e", ord("&"): "\\u0026"}


# App Store Connect's provider token (App Analytics, campaign links). Without it the
# campaign rides along in the link, but App Analytics does not count it.
APP_STORE_PROVIDER_TOKEN = ""


def app_store_url(page: str) -> str:
    """App Store link tagged with the web page, Apple's twin of ``play_store_url``."""

    provider = f"pt={APP_STORE_PROVIDER_TOKEN}&" if APP_STORE_PROVIDER_TOKEN else ""
    return f"{APP_STORE_URL}?{provider}ct=web-{page}&mt=8"


def play_store_url(page: str) -> str:
    """Play link tagged with the web page, so Play Console counts the installs each page brings."""

    referrer = f"utm_source=na-pivo.cz&utm_medium=web&utm_campaign={page}"
    return f"{PLAY_STORE_URL}&referrer={quote(referrer, safe='')}"


def ld_json(data: dict) -> SafeString:
    """Structured data search engines read from the page."""

    text = json.dumps({"@context": "https://schema.org", **data}, ensure_ascii=False)
    return mark_safe(f'<script type="application/ld+json">{text.translate(_LD_ESCAPES)}</script>')


def canonical_host(view):
    """Send a public page asked for on the API host to the same path on na-pivo.cz.

    Both hosts reach the same Django, so without this every page has a duplicate.
    Local dev serves everything from one host and keeps it.
    """

    @wraps(view)
    def wrapper(request: HttpRequest, *args, **kwargs) -> HttpResponse:
        web_host = urlsplit(settings.PUBLIC_WEB_ORIGIN).netloc
        api_host = urlsplit(settings.PUBLIC_API_ORIGIN).netloc
        if not settings.DEBUG and request.get_host() == api_host != web_host:
            return HttpResponsePermanentRedirect(f"{settings.PUBLIC_WEB_ORIGIN}{request.get_full_path()}")
        return view(request, *args, **kwargs)

    return wrapper

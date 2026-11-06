"""Store links, structured data and the host rule every public page of na-pivo.cz shares.

The pages themselves are in ``pubs.web_views``; this module stays free of the web
shell so ``pubs.web.pages`` can import it.
"""

from __future__ import annotations

import hashlib
import json
from functools import wraps
from pathlib import Path
from urllib.parse import quote, urlsplit

from django.conf import settings
from django.http import HttpRequest, HttpResponse, HttpResponsePermanentRedirect
from django.utils.safestring import SafeString, mark_safe
from django.utils.translation import gettext

_ASSETS = Path(__file__).resolve().parent / "static" / "pubs" / "invite"


def _versioned(path: str, filename: str) -> str:
    """The image's address with its content hash: it is served as immutable, so a new image needs a new address."""

    return f"{path}?v={hashlib.sha256((_ASSETS / filename).read_bytes()).hexdigest()[:10]}"


HOME_OG_PATH = _versioned("/og/home.png", "og-home.png")
INVITE_OG_PATH = _versioned("/og/invite.png", "og-invite.png")
# The rules for reusing the site's data (quote a fact with the source, never copy the whole).
DATA_LICENSE_PATH = "/llms.txt"
APP_STORE_URL = "https://apps.apple.com/cz/app/id6773790025"
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.tomasmach.na_pivo"
PATHS = {"cs": "/", "en": "/en"}
AUTHOR = {"@type": "Person", "name": "Tomáš Mach", "url": "https://www.instagram.com/jsem_mach/"}
# Stable ids, so any page can name the publisher and the site the home page describes.
ORGANIZATION_ID = "/#org"
WEBSITE_ID = "/#website"


def organization_ref(origin: str) -> dict:
    # The name too, so a page without the full node still says who published it.
    return {"@type": "Organization", "@id": f"{origin}{ORGANIZATION_ID}", "name": "Na pivo"}


def price_variables() -> list[dict]:
    """What the price datasets measure: per pub the cheapest beer from 0,4 l, per area its spread and pub count."""

    return [
        {"@type": "PropertyValue", "name": gettext("Medián ceny nejlevnějšího piva"), "unitText": "CZK"},
        {"@type": "PropertyValue", "name": gettext("Dolní a horní kvartil ceny"), "unitText": "CZK"},
        {"@type": "PropertyValue", "name": gettext("Počet hospod s cenou")},
    ]


def breadcrumb_list(items: list[tuple[str, str]]) -> dict:
    """BreadcrumbList of (name, absolute url). A crumb repeating the one before it is the same page, so it goes."""

    crumbs: list[tuple[str, str]] = []
    for name, url in items:
        if not crumbs or crumbs[-1][1] != url:
            crumbs.append((name, url))
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": position, "name": name, "item": url}
            for position, (name, url) in enumerate(crumbs, start=1)
        ],
    }


def organization(origin: str) -> dict:
    """Who publishes the site and the app."""

    return {
        "@type": "Organization",
        "@id": f"{origin}{ORGANIZATION_ID}",
        "name": "Na pivo",
        "url": f"{origin}/",
        "logo": {"@type": "ImageObject", "url": f"{origin}/apple-touch-icon.png", "width": 180, "height": 180},
        "founder": {**AUTHOR, "sameAs": [AUTHOR["url"]]},
        "sameAs": [APP_STORE_URL, PLAY_STORE_URL, AUTHOR["url"]],
    }


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

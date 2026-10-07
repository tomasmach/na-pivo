"""Public home page of na-pivo.cz and the few files it loads.

Caddy proxies the whole na-pivo.cz host to Django and nothing serves /static/ in
production, so the page's own files come through ``landing_asset``. Everything is
first party: no CDN, web fonts, analytics or trackers.
"""

from __future__ import annotations

import hashlib
import json
from functools import wraps
from pathlib import Path
from urllib.parse import quote, urlsplit

from django.conf import settings
from django.http import (
    FileResponse,
    Http404,
    HttpRequest,
    HttpResponse,
    HttpResponsePermanentRedirect,
)
from django.shortcuts import render
from django.utils import translation
from django.utils.safestring import SafeString, mark_safe
from django.utils.translation import gettext

from pubs.price_map import PATHS as PRICE_PATHS

_LANDING_ROOT = Path(__file__).resolve().parent / "static" / "pubs" / "landing"
_CONTENT_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".webp": "image/webp",
    ".png": "image/png",
    ".woff2": "font/woff2",
}
# Only files present at startup can be served. The URL name is looked up here and
# never joined onto a path, so nothing outside the folder is reachable.
_LANDING_FILES: dict[str, Path] = {
    path.name: path
    for path in sorted(_LANDING_ROOT.iterdir())
    if path.is_file() and path.suffix in _CONTENT_TYPES
}
# Scripts are read once; a complete response lets the gzip middleware compress them.
_SCRIPTS = {name: path.read_bytes() for name, path in _LANDING_FILES.items() if path.suffix == ".js"}
# Content hash in the URL lets browsers keep a file for a year and still pick up a new deploy.
_LANDING_URLS: dict[str, str] = {
    name.replace(".", "_").replace("-", "_"): (
        f"/landing/{name}?v={hashlib.sha256(path.read_bytes()).hexdigest()[:10]}"
    )
    for name, path in _LANDING_FILES.items()
}

APP_STORE_URL = "https://apps.apple.com/cz/app/id6773790025"
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.tomasmach.na_pivo"
_LEGAL_ROOT = "https://tomasmach.github.io/na-pivo"
_OG_LOCALES = {"cs": "cs_CZ", "en": "en_US"}
PATHS = {"cs": "/", "en": "/en"}
AUTHOR = {"@type": "Person", "name": "Tomáš Mach", "url": "https://www.instagram.com/jsem_mach/"}
# Keeps "</script>" inside a value from ending the block early.
_LD_ESCAPES = {ord("<"): "\\u003c", ord(">"): "\\u003e", ord("&"): "\\u0026"}


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


def _home_structured_data(origin: str, lang: str) -> SafeString:
    """The site name Google shows above the result, and the app the page offers."""

    return ld_json({
        "@graph": [
            {
                "@type": "WebSite",
                "@id": f"{origin}/#website",
                "url": f"{origin}/",
                "name": "Na pivo",
                "alternateName": ["Na Pivo", "na-pivo.cz"],
                "inLanguage": ["cs", "en"],
            },
            {
                "@type": "MobileApplication",
                "@id": f"{origin}/#app",
                "name": "Na pivo",
                "url": f"{origin}{PATHS[lang]}",
                "description": gettext(
                    "Kompas ukáže nejbližší hospodu, na počítadle čárkuješ piva a parta hned ví, kde sedíš. Zdarma a bez reklam."
                ),
                "image": f"{origin}{_LANDING_URLS['icon_144_png']}",
                "operatingSystem": "iOS, Android",
                "applicationCategory": "LifestyleApplication",
                "inLanguage": ["cs", "en"],
                "installUrl": [APP_STORE_URL, PLAY_STORE_URL],
                "sameAs": [APP_STORE_URL, PLAY_STORE_URL],
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "CZK"},
                "author": AUTHOR,
            },
        ],
    })


@canonical_host
def home(request: HttpRequest, lang: str = "cs") -> HttpResponse:
    """Render the home page. ``/`` is always Czech and ``/en`` always English."""

    origin = settings.PUBLIC_WEB_ORIGIN
    legal = _LEGAL_ROOT if lang == "cs" else f"{_LEGAL_ROOT}/en"
    with translation.override(lang):
        response = render(
            request,
            "pubs/home.html",
            {
                "LANGUAGE_CODE": lang,
                "og_locale": _OG_LOCALES[lang],
                "canonical_url": f"{origin}{PATHS[lang]}",
                "cs_url": f"{origin}{PATHS['cs']}",
                "en_url": f"{origin}{PATHS['en']}",
                "switch_url": PATHS["en" if lang == "cs" else "cs"],
                "prices_url": PRICE_PATHS[lang],
                "structured_data": _home_structured_data(origin, lang),
                "og_image_url": f"{origin}{_LANDING_URLS['og_home_png']}",
                "app_store_url": APP_STORE_URL,
                "play_store_url": play_store_url("home"),
                "privacy_url": f"{legal}/privacy.html",
                "terms_url": f"{legal}/terms.html",
                "delete_account_url": f"{legal}/delete-account.html",
                "asset": _LANDING_URLS,
                # Strings the coaster script writes into the tally as it changes.
                "tally_copy": {
                    "empty": gettext("Čistej tácek."),
                    "tap": gettext("Ťukni na tácek."),
                    "more": gettext("Ještě jedno?"),
                    "fifth": gettext("Pátá čárka se škrtá."),
                    "full": gettext("Víc se jich sem nevejde. Do appky jo."),
                    "one": gettext("pivo"),
                    "few": gettext("piva"),
                    "many": gettext("piv"),
                },
            },
        )
    response.headers["Content-Language"] = lang
    response.headers["Cache-Control"] = "public, max-age=600"
    return response


def landing_asset(_request: HttpRequest, filename: str) -> HttpResponse:
    """Serve one of the home page files."""

    path = _LANDING_FILES.get(filename)
    if path is None:
        raise Http404
    content_type = _CONTENT_TYPES[path.suffix]
    if filename in _SCRIPTS:
        response = HttpResponse(_SCRIPTS[filename], content_type=content_type)
    else:
        response = FileResponse(path.open("rb"), content_type=content_type)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

"""Public home page of na-pivo.cz and the few files it loads.

Caddy proxies the whole na-pivo.cz host to Django and nothing serves /static/ in
production, so the page's own files come through ``landing_asset``. Everything is
first party: no CDN, web fonts, analytics or trackers.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest, HttpResponse
from django.shortcuts import render
from django.utils import translation
from django.utils.translation import gettext

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
_PATHS = {"cs": "/", "en": "/en"}


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
                "canonical_url": f"{origin}{_PATHS[lang]}",
                "cs_url": f"{origin}{_PATHS['cs']}",
                "en_url": f"{origin}{_PATHS['en']}",
                "switch_url": _PATHS["en" if lang == "cs" else "cs"],
                "og_image_url": f"{origin}{_LANDING_URLS['og_home_png']}",
                "app_store_url": APP_STORE_URL,
                "play_store_url": PLAY_STORE_URL,
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

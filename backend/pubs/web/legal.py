"""/ochrana-soukromi and /podminky: the privacy policy and terms of use the app and the stores link to.

The text lives in ``web/legal/<document>_<lang>.html`` whole, not in the translation
catalogue, so each language reads exactly as published.
"""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.utils import translation
from django.utils.translation import gettext

from pubs.home_views import WEBSITE_ID, breadcrumb_list, ld_json, organization_ref
from pubs.web.pages import render_page, web_page
from pubs.web.public_common import public_cache
from pubs.web.routes import web_reverse


def _document(request: HttpRequest, name: str, document: str, title: str, crumb: str, description: str) -> HttpResponse:
    origin = settings.PUBLIC_WEB_ORIGIN
    lang = translation.get_language()
    url = f"{origin}{web_reverse(name)}"
    structured = ld_json({"@graph": [
        breadcrumb_list([("Na pivo", f"{origin}{web_reverse('home')}"), (crumb, url)]),
        {
            "@type": "WebPage",
            "@id": f"{url}#page",
            "url": url,
            "name": title,
            "description": description,
            "inLanguage": lang,
            "isPartOf": {"@id": f"{origin}{WEBSITE_ID}"},
            "publisher": organization_ref(origin),
        },
    ]})
    response = render_page(
        request,
        "web/public/legal.html",
        {
            "crumbs": [{"label": "Na pivo", "url": web_reverse("home")}, {"label": crumb}],
            "document": f"web/legal/{document}_{lang}.html",
            # The old GitHub Pages documents kept "#content" for the main text, and their redirect keeps the hash.
            # It also leaves "obsah", the shell's usual skip-link target, to the terms section of that name.
            "main_id": "content",
            "structured_data": structured,
        },
        title=title,
        description=description,
    )
    return public_cache(response, 3600)


@web_page
def privacy(request: HttpRequest) -> HttpResponse:
    return _document(
        request,
        "web-privacy",
        "privacy",
        gettext("Zásady ochrany osobních údajů"),
        gettext("Ochrana soukromí"),
        gettext("Jak aplikace Na pivo pracuje s polohou, Pivním deníkem, fotkami, komunitou a službami třetích stran."),
    )


@web_page
def terms(request: HttpRequest) -> HttpResponse:
    return _document(
        request,
        "web-terms",
        "terms",
        gettext("Podmínky použití"),
        gettext("Podmínky"),
        gettext("Pravidla používání aplikace Na pivo: účty, uživatelský obsah, komunita, odpovědnost a kontakt."),
    )


def sitemap_paths() -> list[str]:
    return [web_reverse("web-privacy", "cs"), web_reverse("web-terms", "cs")]

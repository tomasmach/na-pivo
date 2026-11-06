"""/o-appce: who makes Na pivo, where its pubs, menus and prices come from, and how to write."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.utils.translation import gettext

from pubs.home_views import AUTHOR
from pubs.web.pages import render_page, web_page
from pubs.web.public_common import home_og_image, public_cache
from pubs.web.routes import web_reverse
from pubs.web.words import plural


def _report_text() -> str:
    """The same bar that hides a reported pub for everyone."""

    people = max(2, int(getattr(settings, "PUB_REPORT_GLOBAL_HIDE_THRESHOLD", 3)))
    return plural(
        people,
        gettext("Zavřenou hospodu nebo podnik, který hospodou není, nahlásíš v appce. Zmizí, až ho nahlásí %(n)s člověk."),
        gettext("Zavřenou hospodu nebo podnik, který hospodou není, nahlásíš v appce. Zmizí, až ho nahlásí %(n)s různí lidé."),
        gettext("Zavřenou hospodu nebo podnik, který hospodou není, nahlásíš v appce. Zmizí, až ho nahlásí %(n)s různých lidí."),
    ) % {"n": people}


@web_page
def about(request: HttpRequest) -> HttpResponse:
    response = render_page(
        request,
        "web/public/about.html",
        {
            "crumbs": [{"label": "Na pivo", "url": web_reverse("home")}, {"label": gettext("O appce")}],
            "author_url": AUTHOR["url"],
            "report_text": _report_text(),
            "og_image_url": home_og_image(),
        },
        title=gettext("O appce Na pivo a kdo ji dělá"),
        description=gettext(
            "Na pivo dělá jeden člověk, Tomáš Mach. Odkud jsou hospody, lístky a ceny, jak je počítám a jak mi napsat."
        ),
        section="about",
    )
    return public_cache(response, 3600)


def sitemap_paths() -> list[str]:
    return [web_reverse("web-about", "cs")]

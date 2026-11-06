"""/o-appce: who makes Na pivo, where its pubs, menus and prices come from, and how to write."""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from django.utils.translation import gettext

from pubs.home_views import AUTHOR
from pubs.web.pages import render_page, web_page
from pubs.web.public_common import home_og_image, public_cache
from pubs.web.routes import web_reverse


@web_page
def about(request: HttpRequest) -> HttpResponse:
    response = render_page(
        request,
        "web/public/about.html",
        {
            "crumbs": [{"label": "Na pivo", "url": web_reverse("home")}, {"label": gettext("O appce")}],
            "author_url": AUTHOR["url"],
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

"""URL table of the web. One line per page: Czech path, English path, view, name.

A page that is not built yet points at ``coming_soon`` (404 inside the right
shell); the PR that builds it swaps in its own view on the same line.
``/ceny``, ``/pivo``, ``/`` and the invite links live in ``config/urls.py``.
"""

from __future__ import annotations

from django.conf import settings
from django.urls import path

from pubs.web.assets import web_asset
from pubs.web.auth_views import (
    diary,
    forgot_password,
    login,
    logout,
    oauth_return,
    oauth_start,
    register,
)
from pubs.web.pages import coming_soon, component_gallery
from pubs.web.pubs_views import pub_og_image, pub_page, pubs_city, pubs_index, search_page
from pubs.web.routes import bilingual

urlpatterns = [
    path("web/<str:filename>", web_asset, name="web-asset"),

    *bilingual("hospody", "en/pubs", pubs_index, "web-pubs"),
    *bilingual("hospody/<slug:city>", "en/pubs/<slug:city>", pubs_city, "web-pubs-city"),
    *bilingual("hospoda/<str:key>", "en/pub/<str:key>", pub_page, "web-pub"),
    *bilingual("hospoda/<str:key>/og.png", "en/pub/<str:key>/og.png", pub_og_image, "pub-og-image"),

    *bilingual("hledat", "en/search", search_page, "web-search"),

    *bilingual("zebricky", "en/rankings", coming_soon, "web-rankings"),

    *bilingual("novinky", "en/news", coming_soon, "web-news"),

    *bilingual("trasy", "en/tours", coming_soon, "web-tours"),
    *bilingual("trasy/<str:tour_id>", "en/tours/<str:tour_id>", coming_soon, "web-tour"),

    *bilingual("pivni-index", "en/beer-index", coming_soon, "web-beer-index"),

    *bilingual("smazat-ucet", "en/delete-account", coming_soon, "web-delete-account"),

    *bilingual("prihlaseni", "en/login", login, "web-login"),
    *bilingual("prihlaseni/<slug:provider>", "en/login/<slug:provider>", oauth_start, "web-oauth"),
    # The one return address registered at Google and Apple; the language travels in the session.
    path("prihlaseni/<slug:provider>/navrat", oauth_return, name="web-oauth-return"),
    *bilingual("zapomenute-heslo", "en/forgot-password", forgot_password, "web-forgot-password"),
    *bilingual("odhlasit", "en/logout", logout, "web-logout"),

    *bilingual("registrace", "en/register", register, "web-register"),

    *bilingual("denik", "en/diary", diary, "web-diary"),
    *bilingual("denik/zapsat", "en/diary/log", coming_soon, "web-log-beer"),

    *bilingual("piva", "en/my-beers", coming_soon, "web-beers"),

    *bilingual("moje-hospody", "en/my-pubs", coming_soon, "web-my-pubs"),

    *bilingual("vycep", "en/taproom", coming_soon, "web-taproom"),

    *bilingual("parta", "en/crew", coming_soon, "web-crew"),

    *bilingual("profil", "en/profile", coming_soon, "web-profile"),

    *bilingual("nastaveni", "en/settings", coming_soon, "web-settings"),
]

if settings.DEBUG:
    urlpatterns.append(path("_komponenty", component_gallery, name="web-components"))

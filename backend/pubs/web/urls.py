"""URL table of the web. One line per page: Czech path, English path, view, name.

A page that is not built yet points at ``coming_soon`` (404 inside the right
shell); the PR that builds it swaps in its own view on the same line.
``/ceny``, ``/pivo``, ``/`` and the invite links live in ``config/urls.py``.
"""

from __future__ import annotations

from django.conf import settings
from django.urls import path

from pubs.web.account_views import (
    account_deleted,
    add_pub,
    beers,
    crew,
    logout_everywhere,
    my_pubs,
    settings_page,
    taproom,
)
from pubs.web.assets import web_asset
from pubs.web.auth_views import (
    forgot_password,
    login,
    logout,
    oauth_return,
    oauth_start,
    register,
)
from pubs.web.beer_index import beer_index, beer_index_csv, beer_index_og
from pubs.web.delete_account_views import delete_account, delete_account_confirm
from pubs.web.diary_views import diary, log_beer, night, profile
from pubs.web.invite_views import plan_invite, plan_invite_calendar, plan_invite_og
from pubs.web.news import news
from pubs.web.pages import component_gallery
from pubs.web.pubs_views import pub_og_image, pub_page, pubs_city, pubs_index, search_page
from pubs.web.rankings import rankings
from pubs.web.routes import bilingual
from pubs.web.tours import tour, tour_og, tours

urlpatterns = [
    path("web/<str:filename>", web_asset, name="web-asset"),

    *bilingual("hospody", "en/pubs", pubs_index, "web-pubs"),
    *bilingual("hospody/<slug:city>", "en/pubs/<slug:city>", pubs_city, "web-pubs-city"),
    *bilingual("hospoda/<str:key>", "en/pub/<str:key>", pub_page, "web-pub"),
    *bilingual("hospoda/<str:key>/og.png", "en/pub/<str:key>/og.png", pub_og_image, "pub-og-image"),

    *bilingual("hledat", "en/search", search_page, "web-search"),

    *bilingual("zebricky", "en/rankings", rankings, "web-rankings"),

    *bilingual("novinky", "en/news", news, "web-news"),

    *bilingual("trasy", "en/tours", tours, "web-tours"),
    *bilingual("trasy/<str:tour_id>", "en/tours/<str:tour_id>", tour, "web-tour"),
    *bilingual("trasy/<str:tour_id>/og.png", "en/tours/<str:tour_id>/og.png", tour_og, "tour-og"),

    *bilingual("pivni-index", "en/beer-index", beer_index, "web-beer-index"),
    *bilingual("pivni-index/data.csv", "en/beer-index/data.csv", beer_index_csv, "beer-index-csv"),
    *bilingual("pivni-index/og.png", "en/beer-index/og.png", beer_index_og, "beer-index-og"),

    *bilingual("smazat-ucet", "en/delete-account", delete_account, "web-delete-account"),
    *bilingual("smazat-ucet/potvrdit", "en/delete-account/confirm", delete_account_confirm, "web-delete-account-confirm"),

    *bilingual("pozvanka/<slug:token>", "en/invite/<slug:token>", plan_invite, "web-plan-invite"),
    *bilingual("pozvanka/<slug:token>/og.png", "en/invite/<slug:token>/og.png", plan_invite_og, "web-plan-invite-og"),
    *bilingual("pozvanka/<slug:token>/kalendar.ics", "en/invite/<slug:token>/calendar.ics", plan_invite_calendar, "web-plan-invite-calendar"),

    *bilingual("prihlaseni", "en/login", login, "web-login"),
    *bilingual("prihlaseni/<slug:provider>", "en/login/<slug:provider>", oauth_start, "web-oauth"),
    # The one return address registered at Google and Apple; the language travels in the session.
    path("prihlaseni/<slug:provider>/navrat", oauth_return, name="web-oauth-return"),
    *bilingual("zapomenute-heslo", "en/forgot-password", forgot_password, "web-forgot-password"),
    *bilingual("odhlasit", "en/logout", logout, "web-logout"),

    *bilingual("registrace", "en/register", register, "web-register"),

    *bilingual("denik", "en/diary", diary, "web-diary"),
    *bilingual("denik/zapsat", "en/diary/log", log_beer, "web-log-beer"),
    *bilingual("denik/vecer/<str:day>", "en/diary/night/<str:day>", night, "web-night"),

    *bilingual("piva", "en/my-beers", beers, "web-beers"),

    *bilingual("moje-hospody", "en/my-pubs", my_pubs, "web-my-pubs"),
    *bilingual("moje-hospody/pridat", "en/my-pubs/add", add_pub, "web-add-pub"),

    *bilingual("vycep", "en/taproom", taproom, "web-taproom"),

    *bilingual("parta", "en/crew", crew, "web-crew"),

    *bilingual("profil", "en/profile", profile, "web-profile"),

    *bilingual("nastaveni", "en/settings", settings_page, "web-settings"),
    *bilingual("odhlasit-vsude", "en/logout-everywhere", logout_everywhere, "web-logout-everywhere"),
    *bilingual("ucet-smazan", "en/account-deleted", account_deleted, "web-account-deleted"),
]

if settings.DEBUG:
    urlpatterns.append(path("_komponenty", component_gallery, name="web-components"))

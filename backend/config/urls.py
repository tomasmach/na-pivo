"""na-pivo URL configuration."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

from pubs.models import BeerPage
from pubs.profile_pages import public_profile_page
from pubs.pub_web_views import pub_share_landing
from pubs.web.routes import bilingual
from pubs.web_views import (
    android_asset_statements,
    apple_app_site_association,
    beer_pages,
    beer_pages_og_image,
    beer_prices,
    beer_prices_og_image,
    home,
    invite_asset,
    invite_landing,
    llms_txt,
    party_invite_landing,
    robots_txt,
    sitemap_xml,
    tour_invite_landing,
)

handler404 = "pubs.web.pages.not_found"
handler500 = "pubs.web.pages.server_error"

urlpatterns = [
    path("", home, name="home"),
    path("en", home, {"lang": "en"}, name="home-en"),
    path("en/", RedirectView.as_view(url="/en", permanent=True)),
    path("robots.txt", robots_txt, name="robots-txt"),
    path("llms.txt", llms_txt, name="llms-txt"),
    path("sitemap.xml", sitemap_xml, name="sitemap-xml"),
    path("ceny", beer_prices, name="beer-prices"),
    path("ceny/", RedirectView.as_view(url="/ceny", permanent=True)),
    path("ceny/og.png", beer_prices_og_image, name="beer-prices-og-image"),
    path("ceny/<slug:city>", beer_prices, name="beer-prices-city"),
    path("ceny/<slug:city>/og.png", beer_prices_og_image, name="beer-prices-city-og-image"),
    path("en/prices", beer_prices, {"lang": "en"}, name="beer-prices-en"),
    path("en/prices/", RedirectView.as_view(url="/en/prices", permanent=True)),
    path("en/prices/og.png", beer_prices_og_image, {"lang": "en"}, name="beer-prices-og-image-en"),
    path("en/prices/<slug:city>", beer_prices, {"lang": "en"}, name="beer-prices-city-en"),
    path("en/prices/<slug:city>/og.png", beer_prices_og_image, {"lang": "en"}, name="beer-prices-city-og-image-en"),
    path("pivo", beer_pages, name="beer-list"),
    path("pivo/", RedirectView.as_view(url="/pivo", permanent=True)),
    path("pivo/og.png", beer_pages_og_image, name="beer-list-og-image"),
    path("pivo/znacka/<slug:key>", beer_pages, {"kind": BeerPage.Kind.BRAND}, name="beer-brand"),
    path("pivo/znacka/<slug:key>/og.png", beer_pages_og_image, {"kind": BeerPage.Kind.BRAND}, name="beer-brand-og-image"),
    path("pivo/<slug:key>", beer_pages, {"kind": BeerPage.Kind.BEER}, name="beer"),
    path("pivo/<slug:key>/og.png", beer_pages_og_image, {"kind": BeerPage.Kind.BEER}, name="beer-og-image"),
    path("en/beer", beer_pages, {"lang": "en"}, name="beer-list-en"),
    path("en/beer/", RedirectView.as_view(url="/en/beer", permanent=True)),
    path("en/beer/og.png", beer_pages_og_image, {"lang": "en"}, name="beer-list-og-image-en"),
    path("en/beer/brand/<slug:key>", beer_pages, {"lang": "en", "kind": BeerPage.Kind.BRAND}, name="beer-brand-en"),
    path("en/beer/brand/<slug:key>/og.png", beer_pages_og_image, {"lang": "en", "kind": BeerPage.Kind.BRAND}, name="beer-brand-og-image-en"),
    path("en/beer/<slug:key>", beer_pages, {"lang": "en", "kind": BeerPage.Kind.BEER}, name="beer-en"),
    path("en/beer/<slug:key>/og.png", beer_pages_og_image, {"lang": "en", "kind": BeerPage.Kind.BEER}, name="beer-og-image-en"),
    # Shared from the app without a language; /en/… is the English page of the footer switch.
    *bilingual("t/<slug:token>", "en/t/<slug:token>", tour_invite_landing, "tour-invite-landing"),
    *bilingual("p/<slug:code>", "en/p/<slug:code>", invite_landing, "friend-invite-landing"),
    path("h/<str:key>", pub_share_landing, name="pub-share-landing"),
    *bilingual("u/<str:nickname>", "en/u/<str:nickname>", public_profile_page, "public-profile"),
    *bilingual("party/<slug:code>", "en/party/<slug:code>", party_invite_landing, "party-invite-landing"),
    path(
        ".well-known/apple-app-site-association",
        apple_app_site_association,
        name="apple-app-site-association",
    ),
    path(
        ".well-known/assetlinks.json",
        android_asset_statements,
        name="android-app-links-assetlinks",
    ),
    path("favicon.ico", invite_asset, {"filename": "favicon.ico"}, name="favicon"),
    path(
        "apple-touch-icon.png",
        invite_asset,
        {"filename": "apple-touch-icon.png"},
        name="apple-touch-icon",
    ),
    path(
        "og/invite.png",
        invite_asset,
        {"filename": "og-invite.png"},
        name="invite-og-image",
    ),
    path("og/home.png", invite_asset, {"filename": "og-home.png"}, name="home-og-image"),
    path("", include("pubs.web.urls")),
    # All v1 API routes live in the pubs app — the api agent will create pubs/api/urls.py
    path("v1/", include("pubs.api.urls")),
]

if settings.ENABLE_DJANGO_ADMIN:
    urlpatterns.append(path("admin/", admin.site.urls))

# In DEBUG (local dev + the test suite) Django serves user-uploaded avatars from
# MEDIA_ROOT so the absolute avatar_url resolves. In production Caddy serves
# /media/* directly and Django never touches it (see docker-compose / .env).
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

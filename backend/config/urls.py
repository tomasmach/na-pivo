"""na-pivo URL configuration."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

from pubs.home_views import home, landing_asset
from pubs.web_views import (
    android_asset_statements,
    apple_app_site_association,
    beer_prices,
    beer_prices_og_image,
    invite_asset,
    invite_landing,
    party_invite_landing,
    robots_txt,
    sitemap_xml,
    tour_invite_landing,
)

urlpatterns = [
    path("", home, name="home"),
    path("en", home, {"lang": "en"}, name="home-en"),
    path("en/", RedirectView.as_view(url="/en", permanent=True)),
    path("landing/<str:filename>", landing_asset, name="landing-asset"),
    path("robots.txt", robots_txt, name="robots-txt"),
    path("sitemap.xml", sitemap_xml, name="sitemap-xml"),
    path("ceny", beer_prices, name="beer-prices"),
    path("ceny/", RedirectView.as_view(url="/ceny", permanent=True)),
    path("ceny/og.png", beer_prices_og_image, name="beer-prices-og-image"),
    path("en/prices", beer_prices, {"lang": "en"}, name="beer-prices-en"),
    path("en/prices/", RedirectView.as_view(url="/en/prices", permanent=True)),
    path("en/prices/og.png", beer_prices_og_image, {"lang": "en"}, name="beer-prices-og-image-en"),
    path("t/<slug:token>", tour_invite_landing, name="tour-invite-landing"),
    path("p/<slug:code>", invite_landing, name="friend-invite-landing"),
    path("party/<slug:code>", party_invite_landing, name="party-invite-landing"),
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

"""na-pivo URL configuration."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from pubs.web_views import apple_app_site_association, invite_asset, invite_landing

urlpatterns = [
    path("p/<slug:code>", invite_landing, name="friend-invite-landing"),
    path(
        ".well-known/apple-app-site-association",
        apple_app_site_association,
        name="apple-app-site-association",
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

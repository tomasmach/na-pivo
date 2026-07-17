"""na-pivo URL configuration."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
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

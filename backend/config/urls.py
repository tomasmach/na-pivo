"""na-pivo URL configuration."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    # All v1 API routes live in the pubs app — the api agent will create pubs/api/urls.py
    path("v1/", include("pubs.api.urls")),
]

if settings.ENABLE_DJANGO_ADMIN:
    urlpatterns.append(path("admin/", admin.site.urls))

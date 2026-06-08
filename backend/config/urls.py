"""na-pivo URL configuration."""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    # All v1 API routes live in the pubs app — the api agent will create pubs/api/urls.py
    path("v1/", include("pubs.api.urls")),
]

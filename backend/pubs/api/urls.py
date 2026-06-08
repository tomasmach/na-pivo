"""
URL patterns for the pubs v1 API.

Routes
------
POST pub-hours/   → PubHoursView
GET  health/      → HealthView
"""

from django.urls import path

from .views import HealthView, PubHoursView

urlpatterns = [
    path("pub-hours", PubHoursView.as_view(), name="pub-hours"),
    path("health", HealthView.as_view(), name="health"),
]

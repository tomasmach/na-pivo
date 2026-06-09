"""
URL patterns for the pubs v1 API.

Routes
------
POST pub-hours/   → PubHoursView
POST pub-reports/ → PubReportView
GET  pub-reports/blocked → BlockedPubReportsView
GET  health/      → HealthView
"""

from django.urls import path

from .views import (
    AccountMeView,
    AccountView,
    BlockedPubReportsView,
    HealthView,
    PubHoursView,
    PubReportView,
)

urlpatterns = [
    path("pub-hours", PubHoursView.as_view(), name="pub-hours"),
    path("pub-reports", PubReportView.as_view(), name="pub-reports"),
    path("pub-reports/blocked", BlockedPubReportsView.as_view(), name="pub-reports-blocked"),
    path("health", HealthView.as_view(), name="health"),
    path("account", AccountView.as_view(), name="account"),
    path("account/me", AccountMeView.as_view(), name="account-me"),
]

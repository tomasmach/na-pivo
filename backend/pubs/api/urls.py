"""
URL patterns for the pubs v1 API.

Routes
------
POST pub-hours/   → PubHoursView
POST pub-reports/ → PubReportView
GET  pub-reports/blocked → BlockedPubReportsView
GET  release-notes → ReleaseNotesView
GET  health/      → HealthView
"""

from django.urls import path

from .views import (
    AccountMeView,
    AccountView,
    BlockedPubReportsView,
    FeedbackView,
    HealthView,
    PubCommunityView,
    PubHoursView,
    PubReportView,
    PubsNearView,
    ReleaseNotesView,
)

urlpatterns = [
    path("pub-hours", PubHoursView.as_view(), name="pub-hours"),
    path("pub-community", PubCommunityView.as_view(), name="pub-community"),
    path("pubs/near", PubsNearView.as_view(), name="pubs-near"),
    path("pub-reports", PubReportView.as_view(), name="pub-reports"),
    path("pub-reports/blocked", BlockedPubReportsView.as_view(), name="pub-reports-blocked"),
    path("feedback", FeedbackView.as_view(), name="feedback"),
    path("release-notes", ReleaseNotesView.as_view(), name="release-notes"),
    path("health", HealthView.as_view(), name="health"),
    path("account", AccountView.as_view(), name="account"),
    path("account/me", AccountMeView.as_view(), name="account-me"),
]

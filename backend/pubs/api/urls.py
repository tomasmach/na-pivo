"""
URL patterns for the pubs v1 API.

Routes
------
POST   pub-hours/   → PubHoursView
POST   pubs/        → UserAddedPubView
POST   pub-reports/ → PubReportView
GET    pub-reports/blocked → BlockedPubReportsView
GET    pubs/suggest → PubLocationSuggestView
GET    pubs/geocode → PubLocationGeocodeView
POST   drinks       → DrinksView
DELETE drinks/<client_id> → DrinksView
GET    release-notes → ReleaseNotesView
GET    health/      → HealthView
"""

from django.urls import path

from .views import (
    AccountMeView,
    AccountView,
    BlockedPubReportsView,
    ClientEventsView,
    DrinksView,
    FeedbackView,
    HealthView,
    PubCommunityView,
    PubHoursView,
    PubLocationGeocodeView,
    PubLocationSuggestView,
    PubRatingView,
    PubReportView,
    PubsNearView,
    PubVisitView,
    ReleaseNotesView,
    UserAddedPubView,
)

urlpatterns = [
    path("pub-hours", PubHoursView.as_view(), name="pub-hours"),
    path("pub-community", PubCommunityView.as_view(), name="pub-community"),
    path("drinks", DrinksView.as_view(), name="drinks"),
    path("drinks/<uuid:client_id>", DrinksView.as_view(), name="drinks-delete"),
    path("pub-ratings", PubRatingView.as_view(), name="pub-ratings"),
    path("pub-ratings/<str:cache_key>", PubRatingView.as_view(), name="pub-ratings-delete"),
    path("pub-visits", PubVisitView.as_view(), name="pub-visits"),
    path("pub-visits/<uuid:client_id>", PubVisitView.as_view(), name="pub-visits-delete"),
    path("pubs", UserAddedPubView.as_view(), name="user-added-pubs"),
    path("pubs/near", PubsNearView.as_view(), name="pubs-near"),
    path("pubs/suggest", PubLocationSuggestView.as_view(), name="pubs-suggest"),
    path("pubs/geocode", PubLocationGeocodeView.as_view(), name="pubs-geocode"),
    path("pub-reports", PubReportView.as_view(), name="pub-reports"),
    path("pub-reports/blocked", BlockedPubReportsView.as_view(), name="pub-reports-blocked"),
    path("feedback", FeedbackView.as_view(), name="feedback"),
    path("client-events", ClientEventsView.as_view(), name="client-events"),
    path("release-notes", ReleaseNotesView.as_view(), name="release-notes"),
    path("health", HealthView.as_view(), name="health"),
    path("account", AccountView.as_view(), name="account"),
    path("account/me", AccountMeView.as_view(), name="account-me"),
]

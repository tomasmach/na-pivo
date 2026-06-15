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

from .auth_views import (
    AppleAuthView,
    GoogleAuthView,
    LinkView,
    LoginView,
    LogoutView,
    RegisterView,
    RequestEmailVerificationView,
    RequestPasswordResetView,
    ResetPasswordView,
    SetPasswordView,
    UnlinkView,
    VerifyEmailView,
)
from .views import (
    AccountAvatarView,
    AccountMeView,
    AccountView,
    BlockedPubReportsView,
    ClientEventsView,
    DrinksView,
    FeedbackView,
    HealthView,
    NicknameAvailableView,
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
    path("account/me/avatar", AccountAvatarView.as_view(), name="account-me-avatar"),
    path(
        "account/nickname-available",
        NicknameAvailableView.as_view(),
        name="account-nickname-available",
    ),
    # --- user accounts / auth ---
    path("auth/register", RegisterView.as_view(), name="auth-register"),
    path("auth/login", LoginView.as_view(), name="auth-login"),
    path("auth/google", GoogleAuthView.as_view(), name="auth-google"),
    path("auth/apple", AppleAuthView.as_view(), name="auth-apple"),
    path("auth/link", LinkView.as_view(), name="auth-link"),
    path("auth/unlink", UnlinkView.as_view(), name="auth-unlink"),
    path("auth/set-password", SetPasswordView.as_view(), name="auth-set-password"),
    path("auth/logout", LogoutView.as_view(), name="auth-logout"),
    path(
        "auth/request-password-reset",
        RequestPasswordResetView.as_view(),
        name="auth-request-password-reset",
    ),
    path("auth/reset-password", ResetPasswordView.as_view(), name="auth-reset-password"),
    path(
        "auth/request-email-verify",
        RequestEmailVerificationView.as_view(),
        name="auth-request-email-verify",
    ),
    path("auth/verify-email", VerifyEmailView.as_view(), name="auth-verify-email"),
]

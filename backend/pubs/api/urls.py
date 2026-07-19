"""
URL patterns for the pubs v1 API.

Routes
------
POST   pub-hours/   → PubHoursView
POST   pubs/        → UserAddedPubView
POST   pub-reports/ → PubReportView
POST   pub-name-corrections/ → PubNameCorrectionView
GET    pub-reports/blocked → BlockedPubReportsView
GET    pubs/suggest → PubLocationSuggestView
GET    pubs/geocode → PubLocationGeocodeView
GET    beer-brands/suggest → BeerBrandSuggestView
GET    drinks       → DrinksView
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
    ResetPasswordLandingView,
    ResetPasswordView,
    SetPasswordView,
    UnlinkView,
    VerifyEmailView,
)
from .party_views import (
    PartyEveningCollectionView,
    PartyEveningDetailView,
    PartyEveningDrinkView,
    PartyEveningEndView,
    PartyEveningJoinView,
)
from .views import (
    AccountAvatarView,
    AccountExportView,
    AccountMeView,
    AccountView,
    BeerBrandSuggestView,
    BeerCheckInFeedView,
    BeerCheckInReactView,
    BeerCheckInView,
    BeerDetailView,
    BeerMemoryView,
    BeerPhotoView,
    BlockedPubReportsView,
    ClientEventsView,
    ContentReportView,
    DrinksView,
    FeedbackView,
    FriendActivityReactView,
    FriendActivityRespondView,
    FriendActivityView,
    FriendBeerPhotosView,
    FriendBlockView,
    FriendDetailView,
    FriendInviteResolveView,
    FriendInviteView,
    FriendNotificationReadView,
    FriendRequestActionView,
    FriendRequestView,
    FriendsBeerPhotosFeedView,
    FriendSearchView,
    FriendSettingsView,
    FriendsLiveView,
    FriendsView,
    HealthView,
    LeaderboardsView,
    MenuScanView,
    MyStatsView,
    NicknameAvailableView,
    PhotoContestEntryView,
    PhotoContestView,
    PhotoContestVoteView,
    PubAmenityKindsView,
    PubAmenityReadView,
    PubAmenityVoteView,
    PubCommunityView,
    PubHoursView,
    PubLocationGeocodeView,
    PubLocationSuggestView,
    PubNameCorrectionView,
    PubRatingView,
    PubReportView,
    PubsNearView,
    PubVisitView,
    PushDeviceView,
    ReleaseNotesView,
    RestorePurchasesView,
    UserAddedPubView,
)

urlpatterns = [
    path("party-evenings", PartyEveningCollectionView.as_view(), name="party-evenings"),
    path(
        "party-evenings/<str:code>/join",
        PartyEveningJoinView.as_view(),
        name="party-evening-join",
    ),
    path(
        "party-evenings/<str:code>/end",
        PartyEveningEndView.as_view(),
        name="party-evening-end",
    ),
    path(
        "party-evenings/<str:code>/drinks",
        PartyEveningDrinkView.as_view(),
        name="party-evening-drinks",
    ),
    path(
        "party-evenings/<str:code>",
        PartyEveningDetailView.as_view(),
        name="party-evening-detail",
    ),
    path("pub-hours", PubHoursView.as_view(), name="pub-hours"),
    path("pub-community", PubCommunityView.as_view(), name="pub-community"),
    path("pub-menu-scan", MenuScanView.as_view(), name="pub-menu-scan"),
    path("drinks", DrinksView.as_view(), name="drinks"),
    path("drinks/<uuid:client_id>", DrinksView.as_view(), name="drinks-delete"),
    path("beer-checkins", BeerCheckInView.as_view(), name="beer-checkins"),
    path("beer-checkins/feed", BeerCheckInFeedView.as_view(), name="beer-checkins-feed"),
    path("beer-checkins/<uuid:client_id>", BeerCheckInView.as_view(), name="beer-checkins-delete"),
    path(
        "beer-checkins/<uuid:checkin_id>/react",
        BeerCheckInReactView.as_view(),
        name="beer-checkins-react",
    ),
    path("beers/memory", BeerMemoryView.as_view(), name="beer-memory"),
    path("beers/detail", BeerDetailView.as_view(), name="beer-detail"),
    # --- photo diary + FotoPivař contest ---
    path("beer-photos", BeerPhotoView.as_view(), name="beer-photos"),
    path("beer-photos/<uuid:photo_id>", BeerPhotoView.as_view(), name="beer-photos-delete"),
    path(
        "friends/beer-photos/feed",
        FriendsBeerPhotosFeedView.as_view(),
        name="friends-beer-photos-feed",
    ),
    path("photo-contest", PhotoContestView.as_view(), name="photo-contest"),
    path(
        "photo-contest/entries",
        PhotoContestEntryView.as_view(),
        name="photo-contest-entries",
    ),
    path("photo-contest/vote", PhotoContestVoteView.as_view(), name="photo-contest-vote"),
    path("beer-brands/suggest", BeerBrandSuggestView.as_view(), name="beer-brands-suggest"),
    path("pub-ratings", PubRatingView.as_view(), name="pub-ratings"),
    path("pub-ratings/<str:cache_key>", PubRatingView.as_view(), name="pub-ratings-delete"),
    path("pub-visits", PubVisitView.as_view(), name="pub-visits"),
    path("pub-visits/<uuid:client_id>", PubVisitView.as_view(), name="pub-visits-delete"),
    path("pub-amenities/kinds", PubAmenityKindsView.as_view(), name="pub-amenity-kinds"),
    path("pub-amenities/votes", PubAmenityVoteView.as_view(), name="pub-amenity-votes"),
    # Retraction is the null-value PUT above; this DELETE is an idempotent
    # convenience filtering only by (account, cache_key, amenity_key) with NO
    # AmenityKind existence check, so a vote for a since-deactivated kind can
    # always be cleared. Both segments are URL-encoded.
    path(
        "pub-amenities/votes/<str:cache_key>/<str:amenity_key>",
        PubAmenityVoteView.as_view(),
        name="pub-amenity-votes-delete",
    ),
    path("pub-amenities", PubAmenityReadView.as_view(), name="pub-amenities-read"),
    path("pubs/<uuid:client_id>", UserAddedPubView.as_view(), name="user-added-pub-detail"),
    path("pubs", UserAddedPubView.as_view(), name="user-added-pubs"),
    path("pubs/near", PubsNearView.as_view(), name="pubs-near"),
    path("pubs/suggest", PubLocationSuggestView.as_view(), name="pubs-suggest"),
    path("pubs/geocode", PubLocationGeocodeView.as_view(), name="pubs-geocode"),
    path("pub-name-corrections", PubNameCorrectionView.as_view(), name="pub-name-corrections"),
    path("pub-reports", PubReportView.as_view(), name="pub-reports"),
    path("pub-reports/blocked", BlockedPubReportsView.as_view(), name="pub-reports-blocked"),
    path("content-reports", ContentReportView.as_view(), name="content-reports"),
    path("feedback", FeedbackView.as_view(), name="feedback"),
    path("client-events", ClientEventsView.as_view(), name="client-events"),
    path("leaderboards", LeaderboardsView.as_view(), name="leaderboards"),
    path("push-device", PushDeviceView.as_view(), name="push-device"),
    path("friends", FriendsView.as_view(), name="friends"),
    path("friends/live", FriendsLiveView.as_view(), name="friends-live"),
    path("friends/search", FriendSearchView.as_view(), name="friends-search"),
    path("friends/requests", FriendRequestView.as_view(), name="friends-requests"),
    path(
        "friends/requests/<uuid:request_id>/<str:action>",
        FriendRequestActionView.as_view(),
        name="friends-request-action",
    ),
    # Growth: my reusable invite code + resolve-a-code-to-inviter (claim screen).
    path("friends/invite", FriendInviteView.as_view(), name="friends-invite"),
    path(
        "friends/invite/<str:code>",
        FriendInviteResolveView.as_view(),
        name="friends-invite-resolve",
    ),
    # Safety: block (POST + GET list) / unblock (DELETE with account id).
    path("friends/blocks", FriendBlockView.as_view(), name="friends-blocks"),
    path(
        "friends/blocks/<uuid:account_id>",
        FriendBlockView.as_view(),
        name="friends-block-delete",
    ),
    # RSVP loop + reactions + social settings — placed ABOVE friends/<uuid:account_id>
    # so the static segments are never shadowed by the account-id catch-all.
    path(
        "friends/pub-activity/<uuid:activity_id>/respond",
        FriendActivityRespondView.as_view(),
        name="friends-activity-respond",
    ),
    path(
        "friends/pub-activity/<uuid:activity_id>/react",
        FriendActivityReactView.as_view(),
        name="friends-activity-react",
    ),
    path("friends/settings", FriendSettingsView.as_view(), name="friends-settings"),
    path(
        "friends/<uuid:public_id>/beer-photos",
        FriendBeerPhotosView.as_view(),
        name="friend-beer-photos",
    ),
    path("friends/<uuid:account_id>", FriendDetailView.as_view(), name="friend-detail"),
    path("friends/pub-activity", FriendActivityView.as_view(), name="friends-pub-activity"),
    path(
        "friends/pub-activity/<uuid:activity_id>",
        FriendActivityView.as_view(),
        name="friends-pub-activity-end",
    ),
    path(
        "friends/notifications/read",
        FriendNotificationReadView.as_view(),
        name="friends-notifications-read",
    ),
    path("me/stats", MyStatsView.as_view(), name="me-stats"),
    path("release-notes", ReleaseNotesView.as_view(), name="release-notes"),
    path("health", HealthView.as_view(), name="health"),
    path("account", AccountView.as_view(), name="account"),
    path("account/me", AccountMeView.as_view(), name="account-me"),
    path("account/me/avatar", AccountAvatarView.as_view(), name="account-me-avatar"),
    path("account/me/purchases/restore", RestorePurchasesView.as_view(), name="account-restore-purchases"),
    path("account/export", AccountExportView.as_view(), name="account-export"),
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
    path("auth/reset", ResetPasswordLandingView.as_view(), name="auth-reset-page"),
    path("auth/reset-password", ResetPasswordView.as_view(), name="auth-reset-password"),
    path(
        "auth/request-email-verify",
        RequestEmailVerificationView.as_view(),
        name="auth-request-email-verify",
    ),
    path("auth/verify-email", VerifyEmailView.as_view(), name="auth-verify-email"),
]

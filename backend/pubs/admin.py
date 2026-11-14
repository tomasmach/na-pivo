import hashlib
from datetime import date, timedelta

from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from unfold.admin import ModelAdmin, TabularInline
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from . import community_event_admin, pub_event_admin, pub_reach, web_stats  # noqa: F401
from .enrichment import geohash8
from .models import (
    Account,
    AccountUsageStats,
    BeerBrand,
    BeerProduct,
    BeerProductMergeAudit,
    CanonicalPub,
    ClientEvent,
    ContentReport,
    DrinkLog,
    EnrichTask,
    FeedbackReport,
    PubAlias,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubContributionLog,
    PubExternalBeerMenu,
    PubFavorite,
    PubHours,
    PublishedNight,
    PublishedNightComment,
    PubMergeAudit,
    PubNameCorrection,
    PubRating,
    PubReachDaily,
    PubReport,
    PubSearchCache,
    PubVisit,
    PushDevice,
    ReleaseNote,
    ReleaseNoteItem,
    TourPublication,
    UserAddedPub,
    WebStatsDaily,
)


def _truncate(value: str | None, limit: int) -> str:
    """Clip an admin list-cell string to ``limit`` chars with an ellipsis."""
    text = value or ""
    return text if len(text) <= limit else f"{text[:limit - 3]}..."


admin.site.index_template = "admin/pubs/dashboard.html"
admin.site.index_title = "Nástěnka"
admin.site.unregister(User)
admin.site.unregister(Group)


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass


def _account_label(account: Account | None) -> str:
    if account is None:
        return "-"
    return f"@{account.nickname}" if account.nickname else str(account.public_id)[:8]


class _ReadOnlyAdmin:
    """Mixin for append-only / audit tables: forbid add and change in admin."""

    def has_add_permission(self, request) -> bool:  # noqa: ARG002
        return False

    def has_change_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


class _ImmutableAdmin(_ReadOnlyAdmin):
    """Read-only admin that also protects non-destructive merge history."""

    def has_delete_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


@admin.register(PubHours)
class PubHoursAdmin(ModelAdmin):
    list_display = ("name", "cache_key", "status", "venue_kind", "confidence", "source", "fetched_at", "updated_at")
    list_filter = ("status", "venue_kind", "source")
    search_fields = ("name", "cache_key", "source_ref")
    readonly_fields = ("cache_key", "updated_at", "fetched_at")
    ordering = ("-updated_at",)


@admin.register(CanonicalPub)
class CanonicalPubAdmin(_ImmutableAdmin, ModelAdmin):
    list_display = ("name", "cache_key", "city", "country", "active", "updated_at")
    list_filter = ("active", "country")
    search_fields = ("name", "cache_key", "city", "external_id")
    readonly_fields = (
        "public_id",
        "cache_key",
        "name",
        "name_key",
        "lat",
        "lng",
        "city",
        "country",
        "external_id",
        "active",
        "created_at",
        "updated_at",
    )


@admin.register(PubAlias)
class PubAliasAdmin(_ImmutableAdmin, ModelAdmin):
    list_display = (
        "name",
        "cache_key",
        "canonical_pub",
        "is_primary",
        "active",
        "updated_at",
    )
    list_select_related = ("canonical_pub",)
    list_filter = ("is_primary", "active")
    search_fields = ("name", "cache_key", "canonical_pub__name")
    readonly_fields = (
        "canonical_pub",
        "cache_key",
        "name",
        "name_key",
        "lat",
        "lng",
        "is_primary",
        "active",
        "created_at",
        "updated_at",
    )


@admin.register(PubMergeAudit)
class PubMergeAuditAdmin(_ImmutableAdmin, ModelAdmin):
    list_display = (
        "created_at",
        "source_name",
        "target_name",
        "actor",
        "reverted_at",
    )
    list_select_related = ("canonical_pub",)
    search_fields = (
        "source_name",
        "source_cache_key",
        "target_name",
        "target_cache_key",
        "actor",
    )
    readonly_fields = (
        "canonical_pub",
        "source_cache_key",
        "source_name",
        "target_cache_key",
        "target_name",
        "actor",
        "reason",
        "affected_rows",
        "deactivated_directory_ids",
        "deactivated_user_added_ids",
        "reverted_at",
        "reverted_by",
        "created_at",
    )


@admin.register(PubSearchCache)
class PubSearchCacheAdmin(ModelAdmin):
    list_display = ("cache_key", "radius_bucket", "fetched_at", "updated_at")
    list_filter = ("radius_bucket",)
    search_fields = ("cache_key",)
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(UserAddedPub)
class UserAddedPubAdmin(ModelAdmin):
    list_display = ("name", "active", "cache_key", "city", "address", "account", "updated_at")
    list_select_related = ("account",)
    list_filter = ("active",)
    search_fields = ("name", "cache_key", "city", "address")
    readonly_fields = ("cache_key", "client_id", "created_at", "updated_at")
    ordering = ("-updated_at",)

    def save_model(self, request, obj, form, change) -> None:
        if {"lat", "lng"}.intersection(form.changed_data):
            obj.cache_key = geohash8(obj.lat, obj.lng)
        super().save_model(request, obj, form, change)


@admin.register(EnrichTask)
class EnrichTaskAdmin(ModelAdmin):
    list_display = ("name", "cache_key", "attempts", "max_attempts", "done", "created_at", "last_attempt_at")
    list_filter = ("done",)
    search_fields = ("name", "cache_key")
    readonly_fields = ("cache_key", "created_at")
    ordering = ("created_at",)


@admin.register(Account)
class AccountAdmin(ModelAdmin):
    list_display = (
        "public_id",
        "nickname",
        "device_id",
        "is_public",
        "excluded_from_leaderboards",
        "marketing_emails_enabled",
        "subscription_tier",
        "subscription_status",
        "created_at",
        "last_seen_at",
    )
    list_filter = (
        "is_public",
        "excluded_from_leaderboards",
        "marketing_emails_enabled",
        "subscription_tier",
        "subscription_status",
    )
    search_fields = ("public_id", "device_id", "nickname")
    # Only the SHA-256 token_hash is stored (never the raw bearer secret), so it
    # is safe to surface read-only — it cannot be reversed into a usable token.
    readonly_fields = ("public_id", "token_hash", "created_at", "last_seen_at")
    ordering = ("-created_at",)


@admin.register(PushDevice)
class PushDeviceAdmin(ModelAdmin):
    list_display = (
        "created_at",
        "account",
        "platform",
        "permission_status",
        "enabled",
        "app_version",
        "last_registered_at",
    )
    list_select_related = ("account",)
    list_filter = ("platform", "permission_status", "enabled")
    search_fields = ("account__public_id", "account__nickname")
    exclude = ("push_token",)
    readonly_fields = ("token_fingerprint", "created_at", "updated_at", "last_registered_at")
    ordering = ("-last_registered_at",)

    @admin.display(description="Push token hash")
    def token_fingerprint(self, obj: PushDevice) -> str:
        return hashlib.sha256(obj.push_token.encode("utf-8")).hexdigest()[:16]

    def has_add_permission(self, request) -> bool:
        return False


@admin.register(ContentReport)
class ContentReportAdmin(ModelAdmin):
    list_display = (
        "created_at",
        "reason",
        "status",
        "target_nickname",
        "reporter_nickname",
        "short_comment",
    )
    list_select_related = ("target_account", "reporter")
    list_filter = ("reason", "status", "created_at")
    list_editable = ("status",)
    search_fields = (
        "comment",
        "moderator_note",
        "target_account__public_id",
        "target_account__nickname",
        "reporter__public_id",
        "reporter__nickname",
    )
    readonly_fields = ("reporter", "target_account", "target_snapshot", "created_at", "updated_at")
    actions = ("hide_target_profiles", "clear_target_avatars", "clear_target_nicknames")
    ordering = ("-created_at",)

    @admin.display(description="comment")
    def short_comment(self, obj: ContentReport) -> str:
        return _truncate(obj.comment, 60)

    @admin.display(description="target account")
    def target_nickname(self, obj: ContentReport) -> str:
        return _account_label(obj.target_account)

    @admin.display(description="reporter")
    def reporter_nickname(self, obj: ContentReport) -> str:
        return _account_label(obj.reporter)

    @admin.action(description="Hide target profiles")
    def hide_target_profiles(self, request, queryset) -> None:  # noqa: ARG002
        now = timezone.now()
        for report in queryset.select_related("target_account"):
            target = report.target_account
            if target is None:
                continue
            target.is_public = False
            target.save(update_fields=["is_public", "last_seen_at"])
            report.status = ContentReport.Status.ACTIONED
            report.actioned_at = now
            report.save(update_fields=["status", "actioned_at", "updated_at"])

    @admin.action(description="Clear target avatars")
    def clear_target_avatars(self, request, queryset) -> None:  # noqa: ARG002
        now = timezone.now()
        for report in queryset.select_related("target_account"):
            target = report.target_account
            if target is None or not target.avatar:
                continue
            target.avatar.delete(save=False)
            target.avatar = ""
            target.save(update_fields=["avatar", "last_seen_at"])
            report.status = ContentReport.Status.ACTIONED
            report.actioned_at = now
            report.save(update_fields=["status", "actioned_at", "updated_at"])

    @admin.action(description="Clear target nicknames")
    def clear_target_nicknames(self, request, queryset) -> None:  # noqa: ARG002
        now = timezone.now()
        for report in queryset.select_related("target_account"):
            target = report.target_account
            if target is None:
                continue
            target.nickname = None
            target.save(update_fields=["nickname", "last_seen_at"])
            report.status = ContentReport.Status.ACTIONED
            report.actioned_at = now
            report.save(update_fields=["status", "actioned_at", "updated_at"])


@admin.register(PublishedNight)
class PublishedNightAdmin(ModelAdmin):
    """Moderation surface: published content is immutable except its kill switch."""

    list_display = (
        "created_at",
        "account",
        "drinking_day",
        "visibility",
        "beer_count",
        "is_removed",
    )
    list_select_related = ("account",)
    list_filter = ("visibility", "is_removed", "created_at")
    list_editable = ("is_removed",)
    search_fields = (
        "public_id",
        "client_id",
        "account__public_id",
        "account__nickname",
        "city",
    )
    readonly_fields = (
        "account",
        "public_id",
        "client_id",
        "drinking_day",
        "started_at",
        "ended_at",
        "beer_count",
        "wine_count",
        "soft_drink_count",
        "shot_count",
        "pub_names",
        "city",
        "duration_minutes",
        "visibility",
        "created_at",
        "updated_at",
    )
    ordering = ("-created_at", "-id")


@admin.register(PublishedNightComment)
class PublishedNightCommentAdmin(ModelAdmin):
    """Moderation surface for night comments: authored content is immutable,
    moderation only flips the soft-removed kill switch."""

    list_display = ("created_at", "account", "night", "short_body", "is_removed")
    list_select_related = ("account", "night")
    list_filter = ("is_removed", "created_at")
    search_fields = (
        "body",
        "public_id",
        "account__public_id",
        "account__nickname",
        "night__public_id",
    )
    readonly_fields = (
        "public_id",
        "night",
        "account",
        "client_id",
        "body",
        "created_at",
        "updated_at",
    )
    actions = ("remove_comments",)
    ordering = ("-created_at", "-id")

    @admin.display(description="body")
    def short_body(self, obj: PublishedNightComment) -> str:
        return _truncate(obj.body, 60)

    @admin.action(description="Remove selected comments")
    def remove_comments(self, request, queryset) -> None:  # noqa: ARG002
        # One shared timestamp for the whole bulk update, matching the API view
        # delete (which saves is_removed + updated_at together).
        queryset.filter(is_removed=False).update(is_removed=True, updated_at=timezone.now())


@admin.register(PubReport)
class PubReportAdmin(ModelAdmin):
    list_display = ("name", "reason", "active", "cache_key", "external_id", "account", "created_at")
    list_select_related = ("account",)
    list_filter = ("reason", "active")
    search_fields = ("name", "cache_key", "external_id", "city", "address")
    readonly_fields = ("cache_key", "created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(PubNameCorrection)
class PubNameCorrectionAdmin(ModelAdmin):
    list_display = (
        "suggested_name",
        "original_name",
        "active",
        "cache_key",
        "external_id",
        "account",
        "updated_at",
    )
    list_select_related = ("account",)
    list_filter = ("active",)
    search_fields = ("suggested_name", "original_name", "cache_key", "external_id", "city", "address")
    readonly_fields = ("cache_key", "client_id", "created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(FeedbackReport)
class FeedbackReportAdmin(ModelAdmin):
    list_display = (
        "created_at",
        "category",
        "status",
        "short_message",
        "contact",
        "app_version",
        "platform",
        "account",
        "linear_issue_id",
    )
    list_select_related = ("account",)
    list_filter = ("category", "status", "contact_type", "platform")
    list_editable = ("status",)
    search_fields = ("message", "contact")
    readonly_fields = (
        "client_id",
        "category",
        "message",
        "contact_type",
        "contact",
        "app_version",
        "platform",
        "os_version",
        "attachment",
        "attachment_url",
        "account",
        "linear_issue_id",
        "linear_issue_url",
        "linear_synced_at",
        "created_at",
        "updated_at",
    )
    ordering = ("-created_at",)

    @admin.display(description="message")
    def short_message(self, obj: FeedbackReport) -> str:
        return _truncate(obj.message, 60)


@admin.register(ClientEvent)
class ClientEventAdmin(_ReadOnlyAdmin, ModelAdmin):
    # Diagnostic telemetry is append-only. It is intentionally small and
    # sanitized by the API serializer, but still read-only in admin.
    list_display = (
        "created_at",
        "event",
        "severity",
        "app_version",
        "platform",
        "account",
        "short_message",
    )
    list_select_related = ("account",)
    list_filter = ("event", "severity", "platform", "app_version", "created_at")
    search_fields = ("message", "account__public_id")
    readonly_fields = (
        "account",
        "event",
        "severity",
        "message",
        "context",
        "app_version",
        "platform",
        "os_version",
        "created_at",
    )
    ordering = ("-created_at",)

    @admin.display(description="message")
    def short_message(self, obj: ClientEvent) -> str:
        return _truncate(obj.message, 80)


@admin.register(AccountUsageStats)
class AccountUsageStatsAdmin(_ReadOnlyAdmin, ModelAdmin):
    list_display = (
        "account_public_id",
        "app_open_count",
        "app_foreground_count",
        "walked_distance_km",
        "client_error_count",
        "api_failure_count",
        "last_app_open_at",
        "last_app_version",
        "last_platform",
    )
    list_select_related = ("account",)
    list_filter = ("last_platform", "last_app_version", "last_app_open_at")
    search_fields = ("account__public_id", "account__device_id")
    readonly_fields = (
        "account",
        "app_open_count",
        "app_foreground_count",
        "walked_distance_m",
        "client_warning_count",
        "client_error_count",
        "api_failure_count",
        "last_app_open_at",
        "last_event_at",
        "last_app_version",
        "last_platform",
        "last_os_version",
        "created_at",
        "updated_at",
    )
    ordering = ("-walked_distance_m", "-app_open_count")

    @admin.display(description="account")
    def account_public_id(self, obj: AccountUsageStats) -> str:
        return str(obj.account.public_id)


@admin.register(PubCommunityData)
class PubCommunityDataAdmin(ModelAdmin):
    # Fully editable so the owner can fix or revert community data. cache_key and
    # the timestamps stay read-only (cache_key is identity; timestamps are
    # bookkeeping).
    list_display = (
        "name",
        "cache_key",
        "city",
        "hours_updated_at",
        "beers_updated_at",
        "account",
        "updated_at",
    )
    list_select_related = ("account",)
    search_fields = ("name", "cache_key", "external_id", "city")
    readonly_fields = ("cache_key", "created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(PubExternalBeerMenu)
class PubExternalBeerMenuAdmin(ModelAdmin):
    list_display = ("name", "source", "cache_key", "verified_at", "active", "updated_at")
    list_filter = ("source", "active")
    search_fields = ("name", "cache_key", "source_id", "city")
    readonly_fields = ("created_at", "updated_at", "fetched_at")
    ordering = ("-verified_at",)


@admin.register(BeerBrand)
class BeerBrandAdmin(ModelAdmin):
    list_display = ("name", "key", "rank", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("name", "key", "aliases")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("rank", "name")


@admin.register(BeerProduct)
class BeerProductAdmin(ModelAdmin):
    list_display = ("name", "brand_name", "key", "rank", "active", "updated_at")
    list_filter = ("brand_key", "active")
    search_fields = ("name", "key", "brand_name", "aliases")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("rank", "name")


@admin.register(BeerProductMergeAudit)
class BeerProductMergeAuditAdmin(_ReadOnlyAdmin, ModelAdmin):
    list_display = ("source_key", "target_key", "actor", "created_at")
    search_fields = ("source_key", "source_name", "target_key", "target_name", "actor")
    readonly_fields = (
        "source_product_id",
        "source_key",
        "source_name",
        "target_product_id",
        "target_key",
        "target_name",
        "actor",
        "rewired",
        "created_at",
    )
    ordering = ("-created_at",)


@admin.register(PubBeerBrand)
class PubBeerBrandAdmin(ModelAdmin):
    list_display = ("brand_name", "name", "cache_key", "last_price_czk", "last_volume_ml", "source", "active", "last_seen_at")
    list_filter = ("brand_key", "source", "active", "last_seen_at")
    search_fields = ("brand_name", "name", "cache_key", "city", "external_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-last_seen_at",)


@admin.register(PubBeerProduct)
class PubBeerProductAdmin(ModelAdmin):
    list_display = ("product_name", "brand_name", "name", "cache_key", "last_price_czk", "last_volume_ml", "source", "active", "last_seen_at")
    list_filter = ("brand_key", "product_key", "source", "active", "last_seen_at")
    search_fields = ("product_name", "brand_name", "name", "cache_key", "city", "external_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-last_seen_at",)


@admin.register(PubContributionLog)
class PubContributionLogAdmin(_ReadOnlyAdmin, ModelAdmin):
    # Append-only audit history — fully read-only.
    list_display = ("created_at", "kind", "name", "cache_key", "account")
    list_select_related = ("account",)
    list_filter = ("kind", "created_at")
    search_fields = ("name", "cache_key")
    readonly_fields = (
        "account",
        "cache_key",
        "name",
        "lat",
        "lng",
        "kind",
        "payload",
        "client_id",
        "created_at",
    )
    ordering = ("-created_at",)


@admin.register(DrinkLog)
class DrinkLogAdmin(_ReadOnlyAdmin, ModelAdmin):
    # Append-only per-user drink history — fully read-only, like the
    # contribution log.
    list_display = ("drank_at", "drink_type", "beer_name", "beer_brand_name", "beer_product_name", "price_czk", "volume_ml", "is_suspect", "suspect_reason", "name", "cache_key", "account")
    list_select_related = ("account", "beer_brand", "beer_product")
    list_filter = ("is_suspect", "suspect_reason", "drink_type", "beer_brand_key", "beer_product_key", "volume_ml", "drank_at")
    search_fields = ("beer_name", "beer_brand_name", "beer_product_name", "name", "cache_key", "city")
    readonly_fields = (
        "account",
        "client_id",
        "cache_key",
        "name",
        "lat",
        "lng",
        "city",
        "external_id",
        "drink_type",
        "beer_name",
        "beer_brand",
        "beer_brand_key",
        "beer_brand_name",
        "beer_product",
        "beer_product_key",
        "beer_product_name",
        "price_czk",
        "volume_ml",
        "is_suspect",
        "suspect_reason",
        "drank_at",
        "created_at",
    )
    actions = ("mark_as_suspect", "clear_suspect_flag")
    ordering = ("-drank_at",)

    @admin.action(description="Mark as suspect (manual)")
    def mark_as_suspect(self, request, queryset):  # noqa: ARG002
        queryset.update(is_suspect=True, suspect_reason="manual")

    @admin.action(description="Clear suspect flag")
    def clear_suspect_flag(self, request, queryset):  # noqa: ARG002
        queryset.update(is_suspect=False, suspect_reason="")


@admin.register(PubRating)
class PubRatingAdmin(_ReadOnlyAdmin, ModelAdmin):
    # Per-user private ratings — read-only audit view (the user owns the data via
    # the API; admin is for inspection / moderation only).
    list_display = ("client_updated_at", "name", "cache_key", "verdict", "tag", "account", "updated_at")
    list_select_related = ("account",)
    list_filter = ("verdict",)
    search_fields = ("name", "cache_key", "tag", "note")
    readonly_fields = (
        "account",
        "cache_key",
        "name",
        "lat",
        "lng",
        "external_id",
        "verdict",
        "tag",
        "note",
        "client_updated_at",
        "created_at",
        "updated_at",
    )
    ordering = ("-client_updated_at",)


@admin.register(PubFavorite)
class PubFavoriteAdmin(_ReadOnlyAdmin, ModelAdmin):
    # Per-user private favourites — read-only audit view, like PubRatingAdmin.
    list_display = ("client_updated_at", "name", "cache_key", "account", "updated_at")
    list_select_related = ("account",)
    search_fields = ("name", "cache_key")
    readonly_fields = (
        "account",
        "cache_key",
        "name",
        "lat",
        "lng",
        "external_id",
        "client_updated_at",
        "created_at",
        "updated_at",
    )
    ordering = ("-client_updated_at",)


@admin.register(PubVisit)
class PubVisitAdmin(_ReadOnlyAdmin, ModelAdmin):
    # Per-user explicit visits — read-only audit view.
    list_display = ("started_at", "ended_at", "name", "cache_key", "city", "account", "updated_at")
    list_select_related = ("account",)
    list_filter = ("started_at",)
    search_fields = ("name", "cache_key", "city")
    readonly_fields = (
        "account",
        "client_id",
        "cache_key",
        "name",
        "lat",
        "lng",
        "city",
        "external_id",
        "started_at",
        "ended_at",
        "created_at",
        "updated_at",
    )
    ordering = ("-started_at",)


class ReleaseNoteItemInline(TabularInline):
    model = ReleaseNoteItem
    show_title = False
    extra = 1
    fields = ("order", "icon", "text", "text_en")
    ordering = ("order",)


@admin.register(ReleaseNote)
class ReleaseNoteAdmin(ModelAdmin):
    # Leave title_en and text_en empty to keep a note Czech-only; the app then
    # hides the popup for users running the app in English.
    list_display = ("version", "title", "is_published", "published_at", "updated_at")
    list_filter = ("is_published",)
    search_fields = ("version", "title")
    readonly_fields = ("published_at", "created_at", "updated_at")
    ordering = ("-created_at",)
    inlines = [ReleaseNoteItemInline]


@admin.register(TourPublication)
class TourPublicationAdmin(ModelAdmin):
    """Public tours: a reported one hides itself, and only this admin brings it back."""

    list_display = ("title", "status", "hidden_reason", "city", "stop_count", "people_count", "published_at")
    list_filter = ("status", "hidden_reason")
    search_fields = ("title", "city", "plan__owner__nickname", "public_id", "token")
    readonly_fields = ("plan", "public_id", "token", "snapshot", "published_at", "updated_at")
    actions = ("restore_publications", "hide_publications", "reset_people_counts")

    @admin.action(description="Restore selected tours")
    def restore_publications(self, request, queryset) -> None:  # noqa: ARG002
        restored = list(queryset.filter(status=TourPublication.Status.HIDDEN).values_list("public_id", flat=True))
        # The reports behind a restore are settled; otherwise one new report would hide it again.
        ContentReport.objects.filter(
            target_snapshot__tour_publication_id__in=[str(public_id) for public_id in restored],
            status__in=[ContentReport.Status.NEW, ContentReport.Status.TRIAGED],
        ).update(status=ContentReport.Status.DISMISSED)
        TourPublication.objects.filter(public_id__in=restored).update(status=TourPublication.Status.ACTIVE, hidden_reason="")

    @admin.action(description="Hide selected tours")
    def hide_publications(self, request, queryset) -> None:  # noqa: ARG002
        queryset.filter(status=TourPublication.Status.ACTIVE).update(status=TourPublication.Status.HIDDEN, hidden_reason="admin")

    @admin.action(description="Reset people counts")
    def reset_people_counts(self, request, queryset) -> None:  # noqa: ARG002
        queryset.update(people_count=0, people_count_at=None, count_since=timezone.now())


@admin.register(PubReachDaily)
class PubReachDailyAdmin(_ImmutableAdmin, ModelAdmin):
    list_display = ("day", "cache_key", "channel", "metric", "source", "count", "visitors")
    list_filter = ("channel", "metric", "source", "day")
    search_fields = ("cache_key",)
    ordering = ("-day", "cache_key")
    change_list_template = "admin/pubs/pubreachdaily/change_list.html"

    def get_urls(self):
        report = path("report/", self.admin_site.admin_view(self.report_view), name="pubs_pubreachdaily_report")
        return [report, *super().get_urls()]

    def report_view(self, request):
        """One pub's map pins, page views and navigation taps over a chosen range, app and web apart."""

        today = pub_reach.reach_day(timezone.now())
        start, end = _report_range(request, today)
        query = (request.GET.get("pub") or "").strip()
        matches = pub_reach.find_pubs(query) if query else []
        chosen = matches[0] if len(matches) == 1 else None
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": "Dosah hospod",
            "query": query,
            "start": start,
            "end": end,
            "today": today,
            "ranges": _ranges(today),
            "matches": matches if len(matches) > 1 else [],
            "no_match": bool(query) and not matches,
            "chosen": {"cache_key": chosen[0], "name": chosen[1]} if chosen else None,
            "report": pub_reach.pub_report(chosen[0], start, end, today) if chosen else None,
            "top": [] if query else pub_reach.top_pubs(start, end),
            "visitor_history_start": pub_reach.visitor_history_start(today),
            "report_url": reverse("admin:pubs_pubreachdaily_report"),
        }
        return TemplateResponse(request, "admin/pubs/pub_reach_report.html", context)


@admin.register(WebStatsDaily)
class WebStatsDailyAdmin(_ImmutableAdmin, ModelAdmin):
    """The list is the report: page views, sources, store taps and Google search for a range."""

    def changelist_view(self, request, extra_context=None):  # noqa: ARG002
        today = pub_reach.reach_day(timezone.now())
        start, end = _report_range(request, today)
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": "Web analytika",
            "start": start,
            "end": end,
            "ranges": _ranges(today),
            "report": web_stats.report(start, end, today),
        }
        return TemplateResponse(request, "admin/pubs/web_stats_report.html", context)


def _report_range(request, today: date) -> tuple[date, date]:
    try:
        days = max(1, min(int(request.GET.get("days") or 30), 3660))
    except ValueError:
        days = 30
    end = _parse_day(request.GET.get("to")) or today
    start = _parse_day(request.GET.get("from")) or end - timedelta(days=days - 1)
    return (end, start) if start > end else (start, end)


def _ranges(today: date) -> list[dict]:
    return [{"days": n, "from": today - timedelta(days=n - 1), "to": today} for n in (7, 30, 90, 365)]


def _parse_day(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None

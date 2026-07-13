import hashlib

from django.contrib import admin
from django.utils import timezone

from .models import (
    Account,
    AccountUsageStats,
    BeerBrand,
    BeerProduct,
    ClientEvent,
    ContentReport,
    DrinkLog,
    EnrichTask,
    FeedbackReport,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubContributionLog,
    PubHours,
    PubNameCorrection,
    PubRating,
    PubReport,
    PubSearchCache,
    PubVisit,
    PushDevice,
    ReleaseNote,
    ReleaseNoteItem,
    UserAddedPub,
)


def _truncate(value: str | None, limit: int) -> str:
    """Clip an admin list-cell string to ``limit`` chars with an ellipsis."""
    text = value or ""
    return text if len(text) <= limit else f"{text[:limit - 3]}..."


class _ReadOnlyAdmin:
    """Mixin for append-only / audit tables: forbid add and change in admin."""

    def has_add_permission(self, request) -> bool:  # noqa: ARG002
        return False

    def has_change_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


@admin.register(PubHours)
class PubHoursAdmin(admin.ModelAdmin):
    list_display = ("name", "cache_key", "status", "venue_kind", "confidence", "source", "fetched_at", "updated_at")
    list_filter = ("status", "venue_kind", "source")
    search_fields = ("name", "cache_key", "source_ref")
    readonly_fields = ("cache_key", "updated_at", "fetched_at")
    ordering = ("-updated_at",)


@admin.register(PubSearchCache)
class PubSearchCacheAdmin(admin.ModelAdmin):
    list_display = ("cache_key", "radius_bucket", "fetched_at", "updated_at")
    list_filter = ("radius_bucket",)
    search_fields = ("cache_key",)
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(UserAddedPub)
class UserAddedPubAdmin(admin.ModelAdmin):
    list_display = ("name", "active", "cache_key", "city", "address", "account", "updated_at")
    list_select_related = ("account",)
    list_filter = ("active",)
    search_fields = ("name", "cache_key", "city", "address")
    readonly_fields = ("cache_key", "client_id", "created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(EnrichTask)
class EnrichTaskAdmin(admin.ModelAdmin):
    list_display = ("name", "cache_key", "attempts", "max_attempts", "done", "created_at", "last_attempt_at")
    list_filter = ("done",)
    search_fields = ("name", "cache_key")
    readonly_fields = ("cache_key", "created_at")
    ordering = ("created_at",)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = (
        "public_id",
        "nickname",
        "device_id",
        "is_public",
        "marketing_emails_enabled",
        "subscription_tier",
        "subscription_status",
        "created_at",
        "last_seen_at",
    )
    list_filter = (
        "is_public",
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
class PushDeviceAdmin(admin.ModelAdmin):
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
class ContentReportAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "reason",
        "status",
        "target_account",
        "reporter",
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


@admin.register(PubReport)
class PubReportAdmin(admin.ModelAdmin):
    list_display = ("name", "reason", "active", "cache_key", "external_id", "account", "created_at")
    list_select_related = ("account",)
    list_filter = ("reason", "active")
    search_fields = ("name", "cache_key", "external_id", "city", "address")
    readonly_fields = ("cache_key", "created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(PubNameCorrection)
class PubNameCorrectionAdmin(admin.ModelAdmin):
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
class FeedbackReportAdmin(admin.ModelAdmin):
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
class ClientEventAdmin(_ReadOnlyAdmin, admin.ModelAdmin):
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
class AccountUsageStatsAdmin(_ReadOnlyAdmin, admin.ModelAdmin):
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
class PubCommunityDataAdmin(admin.ModelAdmin):
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


@admin.register(BeerBrand)
class BeerBrandAdmin(admin.ModelAdmin):
    list_display = ("name", "key", "rank", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("name", "key", "aliases")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("rank", "name")


@admin.register(BeerProduct)
class BeerProductAdmin(admin.ModelAdmin):
    list_display = ("name", "brand_name", "key", "rank", "active", "updated_at")
    list_filter = ("brand_key", "active")
    search_fields = ("name", "key", "brand_name", "aliases")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("rank", "name")


@admin.register(PubBeerBrand)
class PubBeerBrandAdmin(admin.ModelAdmin):
    list_display = ("brand_name", "name", "cache_key", "last_price_czk", "last_volume_ml", "source", "active", "last_seen_at")
    list_filter = ("brand_key", "source", "active", "last_seen_at")
    search_fields = ("brand_name", "name", "cache_key", "city", "external_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-last_seen_at",)


@admin.register(PubBeerProduct)
class PubBeerProductAdmin(admin.ModelAdmin):
    list_display = ("product_name", "brand_name", "name", "cache_key", "last_price_czk", "last_volume_ml", "source", "active", "last_seen_at")
    list_filter = ("brand_key", "product_key", "source", "active", "last_seen_at")
    search_fields = ("product_name", "brand_name", "name", "cache_key", "city", "external_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-last_seen_at",)


@admin.register(PubContributionLog)
class PubContributionLogAdmin(_ReadOnlyAdmin, admin.ModelAdmin):
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
class DrinkLogAdmin(_ReadOnlyAdmin, admin.ModelAdmin):
    # Append-only per-user drink history — fully read-only, like the
    # contribution log.
    list_display = ("drank_at", "drink_type", "beer_name", "beer_brand_name", "beer_product_name", "price_czk", "volume_ml", "name", "cache_key", "account")
    list_select_related = ("account", "beer_brand", "beer_product")
    list_filter = ("drink_type", "beer_brand_key", "beer_product_key", "volume_ml", "drank_at")
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
        "drank_at",
        "created_at",
    )
    ordering = ("-drank_at",)


@admin.register(PubRating)
class PubRatingAdmin(_ReadOnlyAdmin, admin.ModelAdmin):
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


@admin.register(PubVisit)
class PubVisitAdmin(_ReadOnlyAdmin, admin.ModelAdmin):
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


class ReleaseNoteItemInline(admin.TabularInline):
    model = ReleaseNoteItem
    extra = 1
    fields = ("order", "icon", "text")
    ordering = ("order",)


@admin.register(ReleaseNote)
class ReleaseNoteAdmin(admin.ModelAdmin):
    list_display = ("version", "title", "is_published", "published_at", "updated_at")
    list_filter = ("is_published",)
    search_fields = ("version", "title")
    readonly_fields = ("published_at", "created_at", "updated_at")
    ordering = ("-created_at",)
    inlines = [ReleaseNoteItemInline]

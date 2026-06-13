from django.contrib import admin

from .models import (
    Account,
    AccountUsageStats,
    ClientEvent,
    DrinkLog,
    EnrichTask,
    FeedbackReport,
    PubCommunityData,
    PubContributionLog,
    PubHours,
    PubReport,
    PubSearchCache,
    ReleaseNote,
    ReleaseNoteItem,
)


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


@admin.register(EnrichTask)
class EnrichTaskAdmin(admin.ModelAdmin):
    list_display = ("name", "cache_key", "attempts", "max_attempts", "done", "created_at", "last_attempt_at")
    list_filter = ("done",)
    search_fields = ("name", "cache_key")
    readonly_fields = ("cache_key", "created_at")
    ordering = ("created_at",)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("public_id", "device_id", "created_at", "last_seen_at")
    search_fields = ("public_id", "device_id")
    # Only the SHA-256 token_hash is stored (never the raw bearer secret), so it
    # is safe to surface read-only — it cannot be reversed into a usable token.
    readonly_fields = ("public_id", "token_hash", "created_at", "last_seen_at")
    ordering = ("-created_at",)


@admin.register(PubReport)
class PubReportAdmin(admin.ModelAdmin):
    list_display = ("name", "reason", "active", "cache_key", "external_id", "account", "created_at")
    list_filter = ("reason", "active")
    search_fields = ("name", "cache_key", "external_id", "city", "address")
    readonly_fields = ("cache_key", "created_at", "updated_at")
    ordering = ("-created_at",)


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
        msg = obj.message or ""
        return msg if len(msg) <= 60 else f"{msg[:57]}..."


@admin.register(ClientEvent)
class ClientEventAdmin(admin.ModelAdmin):
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
        msg = obj.message or ""
        return msg if len(msg) <= 80 else f"{msg[:77]}..."

    def has_add_permission(self, request) -> bool:  # noqa: ARG002
        return False

    def has_change_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


@admin.register(AccountUsageStats)
class AccountUsageStatsAdmin(admin.ModelAdmin):
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

    def has_add_permission(self, request) -> bool:  # noqa: ARG002
        return False

    def has_change_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


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
    search_fields = ("name", "cache_key", "external_id", "city")
    readonly_fields = ("cache_key", "created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(PubContributionLog)
class PubContributionLogAdmin(admin.ModelAdmin):
    # Append-only audit history — fully read-only.
    list_display = ("created_at", "kind", "name", "cache_key", "account")
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

    def has_add_permission(self, request) -> bool:  # noqa: ARG002
        return False

    def has_change_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


@admin.register(DrinkLog)
class DrinkLogAdmin(admin.ModelAdmin):
    # Append-only per-user drink history — fully read-only, like the
    # contribution log.
    list_display = ("drank_at", "beer_name", "price_czk", "volume_ml", "name", "cache_key", "account")
    list_filter = ("volume_ml", "drank_at")
    search_fields = ("beer_name", "name", "cache_key", "city")
    readonly_fields = (
        "account",
        "client_id",
        "cache_key",
        "name",
        "lat",
        "lng",
        "city",
        "external_id",
        "beer_name",
        "price_czk",
        "volume_ml",
        "drank_at",
        "created_at",
    )
    ordering = ("-drank_at",)

    def has_add_permission(self, request) -> bool:  # noqa: ARG002
        return False

    def has_change_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


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

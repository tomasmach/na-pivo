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

from . import admin_queue, community_event_admin, pub_event_admin, pub_reach, web_stats  # noqa: F401
from .admin_base import AppCreatedMixin, PubsAdmin, short
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
class PubHoursAdmin(PubsAdmin):
    list_display = ("name", "status", "venue_kind", "confidence", "source", "fetched_at")
    list_filter = ("status", "venue_kind", "source")
    search_fields = ("name", "cache_key", "source_ref")
    readonly_fields = ("cache_key", "updated_at", "fetched_at")
    ordering = ("-updated_at",)


@admin.register(CanonicalPub)
class CanonicalPubAdmin(_ImmutableAdmin, PubsAdmin):
    list_display = ("name", "city", "country", "active", "updated_at")
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
class PubAliasAdmin(_ImmutableAdmin, PubsAdmin):
    list_display = ("name", "canonical_pub", "is_primary", "active", "updated_at")
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
class PubMergeAuditAdmin(_ImmutableAdmin, PubsAdmin):
    list_display = ("created_at", "source_name", "target_name", "actor", "reverted_at")
    list_select_related = ("canonical_pub",)
    search_fields = ("source_name", "source_cache_key", "target_name", "target_cache_key", "actor")
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
class PubSearchCacheAdmin(PubsAdmin):
    list_display = ("fetched_at", "radius_bucket", "updated_at")
    list_filter = ("radius_bucket",)
    search_fields = ("cache_key",)
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(UserAddedPub)
class UserAddedPubAdmin(PubsAdmin):
    list_display = ("name", "city", "address", "account", "active", "updated_at")
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
class EnrichTaskAdmin(PubsAdmin):
    list_display = ("name", "attempts", "max_attempts", "done", "created_at", "last_attempt_at")
    list_filter = ("done",)
    search_fields = ("name", "cache_key")
    readonly_fields = ("cache_key", "created_at")
    ordering = ("created_at",)


@admin.register(Account)
class AccountAdmin(AppCreatedMixin, PubsAdmin):
    list_display = ("person", "display_name", "is_public", "subscription_tier", "created_at", "last_seen_at")
    list_filter = ("is_public", "excluded_from_leaderboards", "marketing_emails_enabled", "subscription_tier", "subscription_status")
    search_fields = ("nickname", "display_name", "public_id", "device_id")
    readonly_fields = (
        "public_id", "device_id", "deletion_epoch", "ugc_terms_version", "ugc_terms_accepted_at",
        "quorum_trusted_at", "beer_watch_lat", "beer_watch_lng", "beer_watch_located_at", "created_at", "last_seen_at",
    )
    ordering = ("-created_at",)
    change_form_outer_before_template = "admin/pubs/account/profile.html"
    fieldsets = (
        ("Profil", {"classes": ["tab"], "fields": (
            "nickname", "display_name", "avatar", "is_public", "excluded_from_leaderboards",
            "show_as_pub_regular", "status", "deleted_at",
        )}),
        ("Sdílení", {"classes": ["tab"], "fields": (
            "share_default", "night_autopublish", "ghost_mode", "share_drinks_with_parta",
            "share_spend_with_parta", "table_visible_until", "hide_pub_names",
        )}),
        ("Nastavení appky", {"classes": ["tab"], "fields": (
            "locale", "compass_mode", "max_distance_km", "price_currency", "haptic_enabled",
            "sound_enabled", "hide_closed_pubs", "marketing_emails_enabled", "quiet_hours_enabled",
            "quiet_hours_start", "quiet_hours_end", "beer_watch_radius_m",
        )}),
        ("Předplatné", {"classes": ["tab"], "fields": (
            "subscription_tier", "subscription_status", "subscription_platform", "subscription_product_id",
            "subscription_original_transaction_id", "subscription_expires_at", "subscription_updated_at",
        )}),
        ("Technické", {"classes": ["tab"], "fields": (
            "public_id", "device_id", "deletion_epoch", "ugc_terms_version",
            "ugc_terms_accepted_at", "quorum_trusted_at", "beer_watch_lat", "beer_watch_lng",
            "beer_watch_located_at", "created_at", "last_seen_at",
        )}),
    )

    @admin.display(description="Účet", ordering="nickname")
    def person(self, obj: Account) -> str:
        return admin_queue.account_name(obj)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        account = self.get_object(request, object_id)
        if account is not None:
            extra_context = {**(extra_context or {}), "profile": admin_queue.account_profile(account)}
        return super().change_view(request, object_id, form_url, extra_context)


@admin.register(PushDevice)
class PushDeviceAdmin(PubsAdmin):
    list_display = ("account", "platform", "permission_status", "enabled", "app_version", "last_registered_at")
    list_select_related = ("account",)
    list_filter = ("platform", "permission_status", "enabled")
    search_fields = ("account__public_id", "account__nickname")
    exclude = ("push_token",)
    readonly_fields = ("token_fingerprint", "created_at", "updated_at", "last_registered_at")
    ordering = ("-last_registered_at",)

    @admin.display(description="Otisk tokenu (technické)")
    def token_fingerprint(self, obj: PushDevice) -> str:
        return hashlib.sha256(obj.push_token.encode("utf-8")).hexdigest()[:16]

    def has_add_permission(self, request) -> bool:
        return False


def _report_action(handler):
    def action(modeladmin, request, queryset) -> None:  # noqa: ARG001
        for report in queryset.select_related("target_account"):
            handler(report)

    return action


@admin.register(ContentReport)
class ContentReportAdmin(AppCreatedMixin, PubsAdmin):
    list_display = ("created_at", "reason", "status", "target", "reporter_name", "short_comment")
    list_select_related = ("target_account", "reporter")
    list_filter = ("reason", "status", "created_at")
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

    @admin.display(description="Poznámka")
    def short_comment(self, obj: ContentReport) -> str:
        return short(obj.comment, 60)

    @admin.display(description="Nahlášený účet")
    def target(self, obj: ContentReport) -> str:
        return admin_queue.account_name(obj.target_account)

    @admin.display(description="Nahlásil(a)")
    def reporter_name(self, obj: ContentReport) -> str:
        return admin_queue.account_name(obj.reporter)

    hide_target_profiles = admin.action(description="Skrýt profily")(_report_action(admin_queue.hide_profile))
    clear_target_avatars = admin.action(description="Smazat profilové fotky")(_report_action(admin_queue.clear_avatar))
    clear_target_nicknames = admin.action(description="Smazat přezdívky")(_report_action(admin_queue.clear_nickname))


@admin.register(PublishedNight)
class PublishedNightAdmin(AppCreatedMixin, PubsAdmin):
    """Moderation surface: published content is immutable except its kill switch."""

    list_display = ("created_at", "account", "drinking_day", "pubs", "beer_count", "visibility", "is_removed")
    list_select_related = ("account",)
    list_filter = ("visibility", "is_removed", "created_at")
    search_fields = ("public_id", "client_id", "account__public_id", "account__nickname", "city")
    exclude = ("pub_names",)
    ordering = ("-created_at", "-id")

    @admin.display(description="Hospody")
    def pubs(self, obj: PublishedNight) -> str:
        return short(", ".join(obj.pub_names or []) or obj.city, 60)

    def get_readonly_fields(self, request, obj=None):
        return ["pubs", *(field.name for field in self.model._meta.fields if field.name not in ("id", "is_removed", "pub_names"))]


@admin.register(PublishedNightComment)
class PublishedNightCommentAdmin(AppCreatedMixin, PubsAdmin):
    """Moderation surface for night comments: authored content is immutable,
    moderation only flips the soft-removed kill switch."""

    list_display = ("created_at", "account", "short_body", "night", "is_removed")
    list_select_related = ("account", "night", "night__account")
    list_filter = ("is_removed", "created_at")
    search_fields = ("body", "public_id", "account__public_id", "account__nickname", "night__public_id")
    readonly_fields = ("public_id", "night", "account", "client_id", "body", "created_at", "updated_at")
    actions = ("remove_comments",)
    ordering = ("-created_at", "-id")

    @admin.display(description="Komentář")
    def short_body(self, obj: PublishedNightComment) -> str:
        return short(obj.body, 60)

    @admin.action(description="Skrýt vybrané komentáře")
    def remove_comments(self, request, queryset) -> None:  # noqa: ARG002
        # One shared timestamp for the whole bulk update, matching the API view
        # delete (which saves is_removed + updated_at together).
        queryset.filter(is_removed=False).update(is_removed=True, updated_at=timezone.now())


@admin.register(PubReport)
class PubReportAdmin(AppCreatedMixin, PubsAdmin):
    list_display = ("name", "city", "reason", "active", "account", "created_at")
    list_select_related = ("account",)
    list_filter = ("reason", "active")
    search_fields = ("name", "cache_key", "external_id", "city", "address")
    readonly_fields = ("cache_key", "created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(PubNameCorrection)
class PubNameCorrectionAdmin(AppCreatedMixin, PubsAdmin):
    list_display = ("original_name", "suggested_name", "city", "active", "account", "updated_at")
    list_select_related = ("account",)
    list_filter = ("active",)
    search_fields = ("suggested_name", "original_name", "cache_key", "external_id", "city", "address")
    readonly_fields = ("cache_key", "client_id", "created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(FeedbackReport)
class FeedbackReportAdmin(AppCreatedMixin, PubsAdmin):
    list_display = ("created_at", "category", "status", "short_message", "account", "contact", "app_version", "platform")
    list_select_related = ("account",)
    list_filter = ("category", "status", "contact_type", "platform")
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

    @admin.display(description="Zpráva")
    def short_message(self, obj: FeedbackReport) -> str:
        return short(obj.message, 60)


@admin.register(ClientEvent)
class ClientEventAdmin(_ReadOnlyAdmin, PubsAdmin):
    # Diagnostic telemetry is append-only. It is intentionally small and
    # sanitized by the API serializer, but still read-only in admin.
    list_display = ("created_at", "event", "severity", "short_message", "account", "app_version", "platform")
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

    @admin.display(description="Zpráva")
    def short_message(self, obj: ClientEvent) -> str:
        return short(obj.message, 80)


@admin.register(AccountUsageStats)
class AccountUsageStatsAdmin(_ReadOnlyAdmin, PubsAdmin):
    list_display = (
        "account",
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
    search_fields = ("account__nickname", "account__public_id", "account__device_id")
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


@admin.register(PubCommunityData)
class PubCommunityDataAdmin(PubsAdmin):
    # Fully editable so the owner can fix or revert community data. cache_key and
    # the timestamps stay read-only (cache_key is identity; timestamps are
    # bookkeeping).
    list_display = ("name", "city", "hours_updated_at", "beers_updated_at", "account", "updated_at")
    list_select_related = ("account",)
    search_fields = ("name", "cache_key", "external_id", "city")
    readonly_fields = ("cache_key", "name_key", "created_at", "updated_at")
    ordering = ("-updated_at",)


@admin.register(PubExternalBeerMenu)
class PubExternalBeerMenuAdmin(PubsAdmin):
    list_display = ("name", "source", "verified_at", "active", "updated_at")
    list_filter = ("source", "active")
    search_fields = ("name", "cache_key", "source_id", "city")
    readonly_fields = ("created_at", "updated_at", "fetched_at")
    ordering = ("-verified_at",)


@admin.register(BeerBrand)
class BeerBrandAdmin(PubsAdmin):
    list_display = ("name", "rank", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("name", "key", "aliases")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("rank", "name")


@admin.register(BeerProduct)
class BeerProductAdmin(PubsAdmin):
    list_display = ("name", "brand_name", "rank", "active", "updated_at")
    list_filter = ("brand_name", "active")
    search_fields = ("name", "key", "brand_name", "aliases")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("rank", "name")


@admin.register(BeerProductMergeAudit)
class BeerProductMergeAuditAdmin(_ReadOnlyAdmin, PubsAdmin):
    list_display = ("source_name", "target_name", "actor", "created_at")
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
class PubBeerBrandAdmin(PubsAdmin):
    list_display = ("brand_name", "name", "last_price_czk", "last_volume_ml", "source", "active", "last_seen_at")
    list_filter = ("brand_name", "source", "active", "last_seen_at")
    search_fields = ("brand_name", "name", "cache_key", "city", "external_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-last_seen_at",)


@admin.register(PubBeerProduct)
class PubBeerProductAdmin(PubsAdmin):
    list_display = ("product_name", "brand_name", "name", "last_price_czk", "last_volume_ml", "source", "active", "last_seen_at")
    list_filter = ("brand_name", "product_name", "source", "active", "last_seen_at")
    search_fields = ("product_name", "brand_name", "name", "cache_key", "city", "external_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-last_seen_at",)


@admin.register(PubContributionLog)
class PubContributionLogAdmin(_ReadOnlyAdmin, PubsAdmin):
    # Append-only audit history — fully read-only.
    list_display = ("created_at", "kind", "name", "account")
    list_select_related = ("account",)
    list_filter = ("kind", "created_at")
    search_fields = ("name", "cache_key")
    readonly_fields = ("account", "cache_key", "name", "lat", "lng", "kind", "payload", "client_id", "created_at")
    ordering = ("-created_at",)


@admin.register(DrinkLog)
class DrinkLogAdmin(_ReadOnlyAdmin, PubsAdmin):
    # Append-only per-user drink history — fully read-only, like the
    # contribution log.
    list_display = ("drank_at", "account", "drink_type", "beer", "name", "price_czk", "volume_ml", "is_suspect")
    list_select_related = ("account", "beer_brand", "beer_product")
    list_filter = ("is_suspect", "suspect_reason", "drink_type", "beer_brand_name", "volume_ml", "drank_at")
    search_fields = ("beer_name", "beer_brand_name", "beer_product_name", "name", "cache_key", "city", "account__nickname")
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

    @admin.display(description="Pivo", ordering="beer_name")
    def beer(self, obj: DrinkLog) -> str:
        return obj.beer_product_name or obj.beer_name or ""

    @admin.action(description="Označit jako podezřelé")
    def mark_as_suspect(self, request, queryset):  # noqa: ARG002
        queryset.update(is_suspect=True, suspect_reason="manual")

    @admin.action(description="Zrušit označení podezřelé")
    def clear_suspect_flag(self, request, queryset):  # noqa: ARG002
        queryset.update(is_suspect=False, suspect_reason="")


@admin.register(PubRating)
class PubRatingAdmin(_ReadOnlyAdmin, PubsAdmin):
    # Per-user private ratings — read-only audit view (the user owns the data via
    # the API; admin is for inspection / moderation only).
    list_display = ("client_updated_at", "name", "verdict", "tag", "account")
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
class PubFavoriteAdmin(_ReadOnlyAdmin, PubsAdmin):
    # Per-user private favourites — read-only audit view, like PubRatingAdmin.
    list_display = ("client_updated_at", "name", "account")
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
class PubVisitAdmin(_ReadOnlyAdmin, PubsAdmin):
    # Per-user explicit visits — read-only audit view.
    list_display = ("started_at", "ended_at", "name", "city", "account")
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
class ReleaseNoteAdmin(PubsAdmin):
    # Leave title_en and text_en empty to keep a note Czech-only; the app then
    # hides the popup for users running the app in English.
    list_display = ("version", "title", "is_published", "published_at", "updated_at")
    list_filter = ("is_published",)
    search_fields = ("version", "title")
    readonly_fields = ("published_at", "created_at", "updated_at")
    ordering = ("-created_at",)
    inlines = [ReleaseNoteItemInline]


@admin.register(TourPublication)
class TourPublicationAdmin(AppCreatedMixin, PubsAdmin):
    """Public tours: a reported one hides itself, and only this admin brings it back."""

    list_display = ("title", "owner", "status", "hidden_why", "city", "stop_count", "people_count", "published_at")
    list_select_related = ("plan__owner",)
    list_filter = ("status", "hidden_reason")
    search_fields = ("title", "city", "plan__owner__nickname", "public_id", "token")
    readonly_fields = ("plan", "public_id", "token", "snapshot", "published_at", "updated_at")
    actions = ("restore_publications", "hide_publications", "reset_people_counts")

    @admin.display(description="Autor")
    def owner(self, obj: TourPublication) -> str:
        return admin_queue.account_name(obj.plan.owner)

    @admin.display(description="Proč skrytá", ordering="hidden_reason")
    def hidden_why(self, obj: TourPublication) -> str:
        return {"reports": "nahlášení", "admin": "skryl admin"}.get(obj.hidden_reason, obj.hidden_reason)

    @admin.action(description="Vrátit vybrané túry")
    def restore_publications(self, request, queryset) -> None:  # noqa: ARG002
        admin_queue.restore_tours(queryset)

    @admin.action(description="Skrýt vybrané túry")
    def hide_publications(self, request, queryset) -> None:  # noqa: ARG002
        queryset.filter(status=TourPublication.Status.ACTIVE).update(status=TourPublication.Status.HIDDEN, hidden_reason="admin")

    @admin.action(description="Vynulovat počty lidí")
    def reset_people_counts(self, request, queryset) -> None:  # noqa: ARG002
        queryset.update(people_count=0, people_count_at=None, count_since=timezone.now())


@admin.register(PubReachDaily)
class PubReachDailyAdmin(_ImmutableAdmin, PubsAdmin):
    list_display = ("day", "pub", "channel", "metric", "source", "count", "visitors")
    list_filter = ("channel", "metric", "source", "day")
    search_fields = ("cache_key",)
    ordering = ("-day", "cache_key")
    change_list_template = "admin/pubs/pubreachdaily/change_list.html"

    def get_changelist(self, request, **kwargs):
        base = super().get_changelist(request, **kwargs)

        class WithPubNames(base):
            def get_results(self, request):
                super().get_results(request)
                names = pub_reach.pub_names({row.cache_key for row in self.result_list})
                for row in self.result_list:
                    row.pub_name = names.get(row.cache_key, "")

        return WithPubNames

    @admin.display(description="Hospoda", ordering="cache_key")
    def pub(self, obj: PubReachDaily) -> str:
        return getattr(obj, "pub_name", "") or "neznámá hospoda"

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
class WebStatsDailyAdmin(_ImmutableAdmin, PubsAdmin):
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

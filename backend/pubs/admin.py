from django.contrib import admin

from .models import Account, EnrichTask, PubHours


@admin.register(PubHours)
class PubHoursAdmin(admin.ModelAdmin):
    list_display = ("name", "cache_key", "status", "confidence", "source", "fetched_at", "updated_at")
    list_filter = ("status", "source")
    search_fields = ("name", "cache_key", "source_ref")
    readonly_fields = ("cache_key", "updated_at", "fetched_at")
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

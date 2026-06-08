from django.contrib import admin

from .models import EnrichTask, PubHours


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

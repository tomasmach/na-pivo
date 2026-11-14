from django.contrib import admin, messages
from django.utils import timezone

from .admin_base import PubsAdmin
from .pub_events import PubEvent


@admin.register(PubEvent)
class PubEventAdmin(PubsAdmin):
    list_display = ("title", "name", "account", "status", "starts_at", "ends_at", "created_at")
    list_select_related = ("account",)
    list_filter = ("status", "starts_at", "ends_at")
    search_fields = ("title", "details", "name", "city", "cache_key")
    readonly_fields = ("account", "client_id", "cache_key", "created_at", "updated_at", "verified_at")
    ordering = ("-created_at",)
    actions = ("verify_selected", "reject_selected", "return_to_pending")

    @admin.action(description="Ověřit vybrané akce")
    def verify_selected(self, request, queryset):
        updated = queryset.update(status=PubEvent.Status.VERIFIED, verified_at=timezone.now())
        self.message_user(request, f"Ověřeno: {updated}", messages.SUCCESS)

    @admin.action(description="Zamítnout vybrané akce")
    def reject_selected(self, request, queryset):
        updated = queryset.update(status=PubEvent.Status.REJECTED, verified_at=None)
        self.message_user(request, f"Zamítnuto: {updated}", messages.SUCCESS)

    @admin.action(description="Vrátit vybrané akce k ověření")
    def return_to_pending(self, request, queryset):
        updated = queryset.update(status=PubEvent.Status.PENDING, verified_at=None)
        self.message_user(request, f"Čeká na ověření: {updated}", messages.SUCCESS)

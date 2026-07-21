from django.contrib import admin, messages
from django.utils import timezone

from .pub_events import PubEvent


@admin.register(PubEvent)
class PubEventAdmin(admin.ModelAdmin):
    list_display = ("title", "name", "status", "starts_at", "ends_at", "verified_at", "created_at")
    list_filter = ("status", "starts_at", "ends_at")
    search_fields = ("title", "details", "name", "city", "cache_key")
    readonly_fields = ("account", "client_id", "cache_key", "created_at", "updated_at", "verified_at")
    ordering = ("-created_at",)
    actions = ("verify_selected", "reject_selected", "return_to_pending")

    @admin.action(description="Verify selected events")
    def verify_selected(self, request, queryset):
        updated = queryset.update(status=PubEvent.Status.VERIFIED, verified_at=timezone.now())
        self.message_user(request, f"Verified: {updated}", messages.SUCCESS)

    @admin.action(description="Reject selected events")
    def reject_selected(self, request, queryset):
        updated = queryset.update(status=PubEvent.Status.REJECTED, verified_at=None)
        self.message_user(request, f"Rejected: {updated}", messages.SUCCESS)

    @admin.action(description="Return selected events to pending")
    def return_to_pending(self, request, queryset):
        updated = queryset.update(status=PubEvent.Status.PENDING, verified_at=None)
        self.message_user(request, f"Pending: {updated}", messages.SUCCESS)

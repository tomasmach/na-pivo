from django.contrib import admin

from .community_events import CommunityEvent, CommunityEventMembership


class MembershipInline(admin.TabularInline):
    model = CommunityEventMembership
    extra = 0
    readonly_fields = ("account", "message", "status", "requested_at", "decided_at")


@admin.register(CommunityEvent)
class CommunityEventAdmin(admin.ModelAdmin):
    list_display = ("title", "city", "host", "starts_at", "capacity", "status")
    list_filter = ("status", "city", "starts_at")
    search_fields = ("title", "city", "area_label", "host__nickname")
    readonly_fields = ("client_id", "created_at", "updated_at", "cancelled_at")
    inlines = (MembershipInline,)

from unfold.admin import ModelAdmin

TECHNICAL_FIELDS = {
    "aliases",
    "attachment_url",
    "beer_brand_key",
    "beer_product_key",
    "brand_key",
    "cache_key",
    "client_id",
    "context",
    "deactivated_directory_ids",
    "deactivated_user_added_ids",
    "device_id",
    "deletion_epoch",
    "external_id",
    "key",
    "lat",
    "lng",
    "linear_issue_id",
    "linear_synced_at",
    "name_key",
    "payload",
    "product_key",
    "public_id",
    "snapshot",
    "source_cache_key",
    "source_id",
    "source_key",
    "source_product_id",
    "source_ref",
    "target_cache_key",
    "target_key",
    "target_product_id",
    "target_snapshot",
    "token",
    "token_fingerprint",
    "token_hash",
}


def short(value: str | None, limit: int) -> str:
    text = value or ""
    return text if len(text) <= limit else f"{text[:limit - 1]}…"


class PubsAdmin(ModelAdmin):
    def get_fieldsets(self, request, obj=None):
        if self.fieldsets:
            return super().get_fieldsets(request, obj)
        fields = self.get_fields(request, obj)
        main = [name for name in fields if name not in TECHNICAL_FIELDS]
        technical = [name for name in fields if name in TECHNICAL_FIELDS]
        fieldsets = [(None, {"fields": main})]
        if technical:
            fieldsets.append(("Technické", {"fields": technical, "classes": ["collapse"]}))
        return fieldsets

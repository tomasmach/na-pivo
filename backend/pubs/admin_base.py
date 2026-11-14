from django.core.exceptions import FieldDoesNotExist
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


def is_technical(model, name: str) -> bool:
    if name in TECHNICAL_FIELDS:
        return True
    try:
        return "(technické)" in str(model._meta.get_field(name).verbose_name)
    except FieldDoesNotExist:
        return False


class AppCreatedMixin:
    def has_add_permission(self, request, obj=None) -> bool:  # noqa: ARG002
        return False


class PubsAdmin(ModelAdmin):
    def get_form(self, request, obj=None, change=False, **kwargs):
        names = [field.name for field in self.model._meta.get_fields()]
        kwargs["help_texts"] = dict.fromkeys([*names, *self.get_readonly_fields(request, obj)], "")
        return super().get_form(request, obj, change, **kwargs)

    def get_fieldsets(self, request, obj=None):
        if self.fieldsets:
            return super().get_fieldsets(request, obj)
        fields = self.get_fields(request, obj)
        main = [name for name in fields if not is_technical(self.model, name)]
        technical = [name for name in fields if is_technical(self.model, name)]
        fieldsets = [(None, {"fields": main})]
        if technical:
            fieldsets.append(("Technické", {"fields": technical, "classes": ["collapse"]}))
        return fieldsets

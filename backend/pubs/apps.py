from django.apps import AppConfig


class PubsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "pubs"
    verbose_name = "Pubs"

    def ready(self) -> None:
        # Import registers deploy-only configuration checks.
        from . import checks  # noqa: F401

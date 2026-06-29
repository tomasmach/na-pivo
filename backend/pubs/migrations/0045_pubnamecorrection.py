import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0044_pushdevice"),
    ]

    operations = [
        migrations.CreateModel(
            name="PubNameCorrection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "client_id",
                    models.UUIDField(
                        db_index=True,
                        help_text="Client-generated UUID; idempotency key for offline retries.",
                    ),
                ),
                (
                    "cache_key",
                    models.CharField(
                        db_index=True,
                        help_text="Geohash-8 of the corrected place coordinates.",
                        max_length=12,
                    ),
                ),
                (
                    "external_id",
                    models.CharField(
                        blank=True,
                        db_index=True,
                        help_text="Client-side provider id, e.g. Mapy.cz item id.",
                        max_length=128,
                        null=True,
                    ),
                ),
                ("original_name", models.CharField(max_length=255)),
                ("suggested_name", models.CharField(max_length=255)),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("city", models.CharField(blank=True, max_length=128, null=True)),
                ("address", models.CharField(blank=True, max_length=255, null=True)),
                (
                    "active",
                    models.BooleanField(
                        db_index=True,
                        default=True,
                        help_text="Inactive corrections are retained for audit but no longer rename /v1/pubs/near results.",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        blank=True,
                        help_text="The account that submitted this name correction.",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pub_name_corrections",
                        to="pubs.account",
                    ),
                ),
            ],
            options={
                "verbose_name": "Pub Name Correction",
                "verbose_name_plural": "Pub Name Corrections",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.AddIndex(
            model_name="pubnamecorrection",
            index=models.Index(
                fields=["active", "cache_key", "updated_at"],
                name="pubname_active_key_upd_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="pubnamecorrection",
            constraint=models.UniqueConstraint(
                fields=("account", "client_id"),
                name="unique_pub_name_correction_per_account_client_id",
            ),
        ),
    ]

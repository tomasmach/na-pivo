# Generated manually for the additive PIV-59 pub-event API.

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0084_pubdirectory_discovery"),
    ]

    operations = [
        migrations.CreateModel(
            name="PubEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("client_id", models.UUIDField()),
                ("cache_key", models.CharField(db_index=True, max_length=12)),
                ("name", models.CharField(max_length=200)),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("city", models.CharField(blank=True, max_length=200)),
                ("external_id", models.CharField(blank=True, max_length=255)),
                ("title", models.CharField(max_length=120)),
                ("details", models.CharField(blank=True, max_length=500)),
                ("starts_at", models.DateTimeField(db_index=True)),
                ("ends_at", models.DateTimeField(db_index=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("verified", "Verified"), ("rejected", "Rejected")],
                        db_index=True,
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pub_event_suggestions",
                        to="pubs.account",
                    ),
                ),
            ],
            options={
                "ordering": ["starts_at", "created_at"],
                "indexes": [
                    models.Index(fields=["cache_key", "status", "ends_at"], name="pub_event_active_lookup")
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("account", "client_id"),
                        name="unique_pub_event_client_id_per_account",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("ends_at__gt", models.F("starts_at"))),
                        name="pub_event_ends_after_start",
                    ),
                ],
            },
        ),
    ]

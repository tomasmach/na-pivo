import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0103_repair_published_night_client_aliases"),
    ]

    operations = [
        migrations.CreateModel(
            name="BeerPhotoDeletionTombstone",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "client_id",
                    models.UUIDField(
                        help_text="Deleted client-generated idempotency key."
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="beer_photo_deletion_tombstones",
                        to="pubs.account",
                    ),
                ),
            ],
            options={
                "verbose_name": "Beer photo deletion tombstone",
                "verbose_name_plural": "Beer photo deletion tombstones",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("account", "client_id"),
                        name="unique_beer_photo_deletion_per_account_client",
                    )
                ],
            },
        ),
    ]

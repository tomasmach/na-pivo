import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0104_beer_photo_deletion_tombstones"),
    ]

    operations = [
        migrations.CreateModel(
            name="BeerPhotoFileDeletion",
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
                        help_text="Client identity of the deleted beer photo."
                    ),
                ),
                (
                    "photo_public_id",
                    models.UUIDField(
                        blank=True,
                        help_text=(
                            "Former public id, retained only while file cleanup is pending."
                        ),
                        null=True,
                    ),
                ),
                (
                    "image_name",
                    models.CharField(
                        help_text="Storage-relative file name queued for deletion.",
                        max_length=500,
                        unique=True,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "last_attempted_at",
                    models.DateTimeField(blank=True, null=True),
                ),
                (
                    "account",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pending_beer_photo_file_deletions",
                        to="pubs.account",
                    ),
                ),
            ],
            options={
                "verbose_name": "Beer photo file deletion",
                "verbose_name_plural": "Beer photo file deletions",
                "indexes": [
                    models.Index(
                        fields=["account", "client_id"],
                        name="photo_file_del_client_idx",
                    ),
                    models.Index(
                        fields=["account", "photo_public_id"],
                        name="photo_file_del_public_idx",
                    ),
                ],
            },
        ),
    ]

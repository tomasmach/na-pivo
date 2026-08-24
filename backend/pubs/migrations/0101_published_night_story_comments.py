import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0100_harden_community_event_teams"),
    ]

    operations = [
        migrations.AddField(
            model_name="publishednight",
            name="game_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="publishednight",
            name="participant_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="publishednight",
            name="photo_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="publishednight",
            name="roast_basis",
            field=models.CharField(blank=True, default="", max_length=280),
        ),
        migrations.AddField(
            model_name="publishednight",
            name="roast_line",
            field=models.CharField(blank=True, default="", max_length=280),
        ),
        migrations.AddField(
            model_name="publishednight",
            name="title",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.CreateModel(
            name="PublishedNightComment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("public_id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True)),
                ("client_id", models.UUIDField(help_text="Client-generated idempotency key.")),
                ("body", models.CharField(max_length=500)),
                ("is_removed", models.BooleanField(db_index=True, default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="published_night_comments", to="pubs.account")),
                ("night", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="comments", to="pubs.publishednight")),
            ],
            options={
                "verbose_name": "Published night comment",
                "verbose_name_plural": "Published night comments",
                "ordering": ["created_at", "id"],
                "indexes": [models.Index(fields=["night", "is_removed", "created_at"], name="night_comment_visible_idx")],
                "constraints": [models.UniqueConstraint(fields=("account", "client_id"), name="unique_night_comment_account_client")],
            },
        ),
    ]

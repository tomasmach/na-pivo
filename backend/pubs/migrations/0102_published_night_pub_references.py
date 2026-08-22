import re

import django.db.models.deletion
from django.db import migrations, models


def backfill_pub_references(apps, schema_editor):
    PublishedNight = apps.get_model("pubs", "PublishedNight")
    PublishedNightPubReference = apps.get_model(
        "pubs", "PublishedNightPubReference"
    )
    pending = []
    for night in PublishedNight.objects.only("id", "pub_names").iterator(chunk_size=500):
        keys = {
            re.sub(r"\s+", " ", str(name or "").strip().casefold())
            for name in (night.pub_names or [])
        }
        pending.extend(
            PublishedNightPubReference(night_id=night.pk, name_key=key)
            for key in keys
            if key
        )
        if len(pending) >= 1000:
            PublishedNightPubReference.objects.bulk_create(
                pending,
                ignore_conflicts=True,
            )
            pending = []
    if pending:
        PublishedNightPubReference.objects.bulk_create(
            pending,
            ignore_conflicts=True,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0101_published_night_story_comments"),
    ]

    operations = [
        migrations.CreateModel(
            name="PublishedNightPubReference",
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
                ("name_key", models.CharField(db_index=True, max_length=255)),
                (
                    "night",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pub_references",
                        to="pubs.publishednight",
                    ),
                ),
            ],
            options={
                "verbose_name": "Published night pub reference",
                "verbose_name_plural": "Published night pub references",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("night", "name_key"),
                        name="unique_published_night_pub_name",
                    )
                ],
            },
        ),
        migrations.RunPython(backfill_pub_references, migrations.RunPython.noop),
    ]

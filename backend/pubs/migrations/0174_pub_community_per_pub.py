from django.db import migrations, models

from pubs.identity import normalize_pub_name


def fill_name_keys(apps, schema_editor):
    PubCommunityData = apps.get_model("pubs", "PubCommunityData")
    batch = []
    for row in PubCommunityData.objects.only("pk", "name").iterator(chunk_size=500):
        row.name_key = normalize_pub_name(row.name)
        batch.append(row)
        if len(batch) >= 500:
            PubCommunityData.objects.bulk_update(batch, ["name_key"])
            batch = []
    if batch:
        PubCommunityData.objects.bulk_update(batch, ["name_key"])


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0173_web_stats"),
    ]

    operations = [
        migrations.AddField(
            model_name="pubcommunitydata",
            name="name_key",
            field=models.CharField(default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="pubcommunitydata",
            name="cache_key",
            field=models.CharField(
                db_index=True,
                help_text="Geohash-8 of (lat, lng) — ~38 m precision; matches PubHours.cache_key.",
                max_length=12,
            ),
        ),
        migrations.AddConstraint(
            model_name="pubcommunitydata",
            constraint=models.UniqueConstraint(
                fields=("cache_key", "name_key"), name="unique_pub_community_identity"
            ),
        ),
        migrations.RunPython(fill_name_keys, migrations.RunPython.noop),
    ]

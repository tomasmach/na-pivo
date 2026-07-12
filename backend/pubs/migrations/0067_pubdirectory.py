from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0066_beercheckin_ended_at")]

    operations = [
        migrations.AddField(
            model_name="pubhours",
            name="city",
            field=models.CharField(blank=True, max_length=128),
        ),
        migrations.CreateModel(
            name="PubDirectory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("name_key", models.CharField(max_length=255)),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("cache_key", models.CharField(db_index=True, max_length=12)),
                ("city", models.CharField(blank=True, max_length=128)),
                ("country", models.CharField(db_index=True, max_length=2)),
                ("venue_kind", models.CharField(choices=[("pub", "Pub"), ("maybe", "Maybe"), ("not_pub", "Not a pub"), ("unknown", "Unknown")], db_index=True, default="unknown", max_length=16)),
                ("source", models.CharField(max_length=32)),
                ("active", models.BooleanField(default=True)),
                ("refreshed_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Pub Directory Entry",
                "verbose_name_plural": "Pub Directory Entries",
                "indexes": [models.Index(fields=["lat", "lng"], name="pubs_pubdir_lat_66fb84_idx")],
                "constraints": [models.UniqueConstraint(fields=("cache_key", "name_key"), name="unique_pub_directory_identity")],
            },
        )
    ]

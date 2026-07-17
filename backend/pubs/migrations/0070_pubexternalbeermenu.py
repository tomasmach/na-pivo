import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0069_feedbackreport_attachment")]

    operations = [
        migrations.CreateModel(
            name="PubExternalBeerMenu",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("cache_key", models.CharField(db_index=True, max_length=12)),
                ("name", models.CharField(max_length=255)),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("city", models.CharField(blank=True, default="", max_length=128)),
                ("source", models.CharField(choices=[("pivarova_mapa", "Pivařova mapa")], db_index=True, max_length=32)),
                ("source_id", models.CharField(max_length=128)),
                ("source_url", models.URLField(max_length=500)),
                ("beers", models.JSONField(default=list, help_text='Reviewed fallback rows: [{"name": str, "price_czk": number, "volume_ml": int}].')),
                ("verified_at", models.DateTimeField(blank=True, help_text="Newest source verification timestamp represented by this snapshot.", null=True)),
                ("fetched_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "External Beer Menu",
                "verbose_name_plural": "External Beer Menus",
                "indexes": [models.Index(fields=["cache_key", "active"], name="pubs_pubext_cache_k_1ae2a5_idx")],
                "constraints": [models.UniqueConstraint(fields=("source", "source_id"), name="unique_external_beer_menu_source")],
            },
        ),
    ]

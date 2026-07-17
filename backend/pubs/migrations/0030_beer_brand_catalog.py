# Hand-written: beer-brand catalogue and per-pub brand index.

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0029_release_note_1_1_5"),
    ]

    operations = [
        migrations.CreateModel(
            name="BeerBrand",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.SlugField(db_index=True, help_text="Stable ASCII identifier, e.g. pilsner-urquell.", max_length=80, unique=True)),
                ("name", models.CharField(help_text="Canonical display name.", max_length=120)),
                ("aliases", models.JSONField(blank=True, default=list, help_text="Common typed aliases used for matching and suggestions.")),
                ("rank", models.PositiveSmallIntegerField(db_index=True, default=1000, help_text="Lower ranks appear earlier in suggestions.")),
                ("source_label", models.CharField(blank=True, default="", max_length=160)),
                ("source_url", models.URLField(blank=True, default="", max_length=500)),
                ("active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Beer Brand",
                "verbose_name_plural": "Beer Brands",
                "ordering": ["rank", "name"],
            },
        ),
        migrations.CreateModel(
            name="PubBeerBrand",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("cache_key", models.CharField(db_index=True, help_text="Geohash-8 of (lat, lng) — matches PubCommunityData.cache_key.", max_length=12)),
                ("name", models.TextField(help_text="Pub name as submitted by the client.")),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("city", models.TextField(blank=True, default="")),
                ("external_id", models.TextField(blank=True, default="")),
                ("brand_key", models.SlugField(db_index=True, max_length=80)),
                ("brand_name", models.CharField(max_length=120)),
                ("last_price_czk", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("last_volume_ml", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("source", models.CharField(choices=[("community", "Community menu"), ("drink", "Drink log")], max_length=16)),
                ("active", models.BooleanField(db_index=True, default=True)),
                ("last_seen_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("account", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="pub_beer_brands", to="pubs.account")),
                ("brand", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="pub_links", to="pubs.beerbrand")),
            ],
            options={
                "verbose_name": "Pub Beer Brand",
                "verbose_name_plural": "Pub Beer Brands",
                "ordering": ["-last_seen_at"],
                "indexes": [
                    models.Index(fields=["brand_key", "active"], name="pubs_pubbee_brand_k_4d7e82_idx"),
                    models.Index(fields=["cache_key", "active"], name="pubs_pubbee_cache_k_5d4fd7_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(fields=("cache_key", "brand"), name="unique_pub_beer_brand"),
                ],
            },
        ),
        migrations.AddField(
            model_name="drinklog",
            name="beer_brand",
            field=models.ForeignKey(blank=True, help_text="Matched canonical brand, if the submitted beer name was recognized.", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="drinks", to="pubs.beerbrand"),
        ),
        migrations.AddField(
            model_name="drinklog",
            name="beer_brand_key",
            field=models.SlugField(blank=True, db_index=True, default="", help_text="Denormalized BeerBrand.key for future stats/filter queries.", max_length=80),
        ),
        migrations.AddField(
            model_name="drinklog",
            name="beer_brand_name",
            field=models.CharField(blank=True, default="", help_text="Denormalized BeerBrand.name as it was at log time.", max_length=120),
        ),
    ]

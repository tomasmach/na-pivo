from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0034_backfill_beer_catalog_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="pubhours",
            name="has_garden",
            field=models.BooleanField(
                blank=True,
                db_index=True,
                help_text="Whether the source listing explicitly marks a beer garden/outdoor seating.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="pubhours",
            name="venue_tags",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Firmy.cz tag slugs used for lightweight pub metadata such as garden.",
            ),
        ),
    ]

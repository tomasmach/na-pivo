from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0057_beercheckin_tags"),
    ]

    operations = [
        migrations.AddField(
            model_name="beercheckin",
            name="ended_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="beercheckin",
            name="quantity",
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="beercheckin",
            name="price_czk",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]

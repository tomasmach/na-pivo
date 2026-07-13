from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0067_pubdirectory")]

    operations = [
        migrations.AddField(
            model_name="pubcommunitydata",
            name="historical_beers",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text=(
                    "Previously confirmed beers that are no longer on the current tap list. "
                    "Kept separately so released clients can continue reading `beers` as the "
                    "current menu."
                ),
            ),
        ),
    ]

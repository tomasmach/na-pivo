from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0094_release_note_1_5_0"),
    ]

    operations = [
        migrations.AddField(
            model_name="pubvisit",
            name="closed_at",
            field=models.DateTimeField(
                blank=True,
                help_text=(
                    "Explicit client-side session closure; None preserves legacy recency inference."
                ),
                null=True,
            ),
        ),
    ]

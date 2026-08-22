from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0105_beer_photo_file_deletion_outbox"),
    ]

    operations = [
        migrations.AlterField(
            model_name="partygameevent",
            name="kind",
            field=models.CharField(
                choices=[
                    ("start", "Start"),
                    ("score", "Score"),
                    ("finish", "Finish"),
                    ("answer", "Answer"),
                ],
                max_length=8,
            ),
        ),
    ]

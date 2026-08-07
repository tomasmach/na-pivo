from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0112_account_media_file_deletion"),
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
                    ("action", "Action"),
                ],
                max_length=8,
            ),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0071_release_note_1_4_0")]

    operations = [
        migrations.CreateModel(
            name="ExternalApiDailyUsage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(max_length=32)),
                ("operation", models.CharField(max_length=64)),
                ("day", models.DateField()),
                ("request_count", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddConstraint(
            model_name="externalapidailyusage",
            constraint=models.UniqueConstraint(
                fields=("provider", "operation", "day"),
                name="unique_external_api_daily_usage",
            ),
        ),
    ]

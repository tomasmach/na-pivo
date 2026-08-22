from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0108_unique_party_game_catalog"),
    ]

    operations = [
        migrations.CreateModel(
            name="AccountDeletionOperation",
            fields=[
                (
                    "operation_id",
                    models.UUIDField(editable=False, primary_key=True, serialize=False),
                ),
                ("account_fingerprint", models.CharField(editable=False, max_length=64)),
                ("completed_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Account deletion operation",
                "verbose_name_plural": "Account deletion operations",
                "ordering": ["-completed_at"],
            },
        ),
    ]

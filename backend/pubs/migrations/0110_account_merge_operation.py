from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0109_account_deletion_operation"),
    ]

    operations = [
        migrations.CreateModel(
            name="AccountMergeOperation",
            fields=[
                (
                    "operation_id",
                    models.UUIDField(editable=False, primary_key=True, serialize=False),
                ),
                (
                    "source_account_fingerprint",
                    models.CharField(editable=False, max_length=64),
                ),
                (
                    "target_account_fingerprint",
                    models.CharField(editable=False, max_length=64),
                ),
                ("completed_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Account merge operation",
                "verbose_name_plural": "Account merge operations",
                "ordering": ["-completed_at"],
            },
        ),
    ]

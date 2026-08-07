from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0110_account_merge_operation"),
    ]

    operations = [
        migrations.AlterField(
            model_name="accountdeletionoperation",
            name="account_fingerprint",
            field=models.CharField(db_index=True, editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name="account",
            name="deletion_epoch",
            field=models.BigIntegerField(
                default=0,
                help_text=(
                    "Server-only generation for account-deletion authorization. "
                    "Credential auth advances it so already-issued sessions cannot "
                    "commit a delayed DELETE after reactivation."
                ),
            ),
        ),
        migrations.AddField(
            model_name="authtoken",
            name="deletion_epoch",
            field=models.BigIntegerField(
                default=0,
                help_text=(
                    "Snapshot of Account.deletion_epoch at issuance; never exposed "
                    "on the wire or in request logs."
                ),
            ),
        ),
    ]

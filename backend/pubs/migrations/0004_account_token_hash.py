# Hand-written: store account tokens hashed at rest. The raw `token` column is
# replaced by `token_hash`. We add the column nullable, backfill the SHA-256 of
# any existing raw token, enforce uniqueness, then drop the raw column — so the
# migration is safe whether or not the table already holds rows.
#
# token_hash uses unique=True only (NOT db_index=True as well). On PostgreSQL the
# AddField(db_index)→AlterField(unique) path created the varchar_pattern_ops
# "_like" index twice and failed with 'relation "..._like" already exists'.
# unique=True alone provides the index the auth exact-match lookup needs.

import hashlib

from django.db import migrations, models


def hash_existing_tokens(apps, schema_editor):
    Account = apps.get_model("pubs", "Account")
    for account in Account.objects.all():
        account.token_hash = hashlib.sha256(account.token.encode("utf-8")).hexdigest()
        account.save(update_fields=["token_hash"])


def noop_reverse(apps, schema_editor):
    # Hashing is one-way — raw tokens cannot be restored on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0003_account"),
    ]

    operations = [
        migrations.AddField(
            model_name="account",
            name="token_hash",
            field=models.CharField(
                help_text=(
                    "SHA-256 hex digest of the bearer token. The raw token is "
                    "returned once at registration and never stored, so a DB leak "
                    "exposes only non-reversible hashes."
                ),
                max_length=64,
                null=True,
            ),
        ),
        migrations.RunPython(hash_existing_tokens, noop_reverse),
        migrations.AlterField(
            model_name="account",
            name="token_hash",
            field=models.CharField(
                help_text=(
                    "SHA-256 hex digest of the bearer token. The raw token is "
                    "returned once at registration and never stored, so a DB leak "
                    "exposes only non-reversible hashes."
                ),
                max_length=64,
                unique=True,
            ),
        ),
        migrations.RemoveField(
            model_name="account",
            name="token",
        ),
    ]

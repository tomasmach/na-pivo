"""
Backfill existing per-device bearer tokens into the new AuthToken table.

Authentication now resolves a Bearer token via AuthToken (see
pubs/api/authentication.py). Existing accounts still carry their token only in
the legacy Account.token_hash column, so without this backfill every already-
installed app would get a 401 and silently re-register (losing its account).

We copy each non-empty Account.token_hash into an AuthToken row (kind="device").
The legacy column is left in place (now nullable, unused) so the migration is
non-destructive and reversible.
"""

from __future__ import annotations

from django.db import migrations


def backfill(apps, schema_editor):
    Account = apps.get_model("pubs", "Account")
    AuthToken = apps.get_model("pubs", "AuthToken")

    existing_hashes = set(AuthToken.objects.values_list("token_hash", flat=True))
    to_create = []
    for account in Account.objects.exclude(token_hash__isnull=True).exclude(token_hash="").iterator():
        if account.token_hash in existing_hashes:
            continue
        to_create.append(
            AuthToken(
                account=account,
                token_hash=account.token_hash,
                kind="device",
            )
        )
        if len(to_create) >= 1000:
            AuthToken.objects.bulk_create(to_create, ignore_conflicts=True)
            to_create.clear()
    if to_create:
        AuthToken.objects.bulk_create(to_create, ignore_conflicts=True)


def reverse(apps, schema_editor):
    # Non-destructive: drop the device tokens we created. The legacy
    # Account.token_hash column still holds the original values.
    AuthToken = apps.get_model("pubs", "AuthToken")
    AuthToken.objects.filter(kind="device").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0024_account_deleted_at_account_display_name_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill, reverse),
    ]

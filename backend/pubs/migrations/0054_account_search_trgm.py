"""Index-back the account search (`icontains`) with pg_trgm GIN indexes.

`GET /v1/friends/search` filters accounts with `nickname__icontains` /
`display_name__icontains`, which compiles to `LIKE '%q%'` and forces a full
table scan. A `gin_trgm_ops` GIN index lets Postgres serve that pattern from an
index without touching the query or the API (transparent for old clients).

pg_trgm is Postgres-only. Everything here is done inside a vendor-guarded
`RunPython` so the migration is a clean no-op on the SQLite dev/test DB in BOTH
directions. NOTE: Django's own `TrigramExtension` / `CreateExtension` is NOT
usable here — its `database_backwards` is not vendor-guarded and queries
`pg_extension` on rollback, which errors on SQLite (the migration-executor
round-trip tests unapply this migration on SQLite). Managing the extension by
hand keeps forwards and backwards symmetric and backend-safe.

The GIN indexes are intentionally kept out of the model `Meta` (and thus out of
Django's migration state) because they are Postgres-specific DDL Django cannot
portably model — a common, accepted pattern for pg_trgm.
"""

from django.contrib.postgres.indexes import GinIndex
from django.db import migrations

# (index name, account field) — reused by forwards + backwards.
_TRGM_INDEXES = [
    ("acct_nick_trgm", "nickname"),
    ("acct_dispname_trgm", "display_name"),
]


def _gin_index(name: str, field: str) -> GinIndex:
    return GinIndex(fields=[field], name=name, opclasses=["gin_trgm_ops"])


def add_trgm_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    account = apps.get_model("pubs", "Account")
    for name, field in _TRGM_INDEXES:
        schema_editor.add_index(account, _gin_index(name, field))


def drop_trgm_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    account = apps.get_model("pubs", "Account")
    for name, field in _TRGM_INDEXES:
        schema_editor.remove_index(account, _gin_index(name, field))
    # Drop the extension only after its dependent indexes are gone.
    schema_editor.execute("DROP EXTENSION IF EXISTS pg_trgm")


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0053_friend_notification_kinds"),
    ]

    operations = [
        migrations.RunPython(add_trgm_indexes, drop_trgm_indexes),
    ]

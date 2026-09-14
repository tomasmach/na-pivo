from django.db import migrations


def ensure_client_aliases(apps, schema_editor):
    """Heal feature databases that applied the earlier 0098 file revision.

    Migration 0098 was corrected before release so a clean production upgrade
    preserves every released night id while deduplicating drinking days. Some
    development databases had already recorded its earlier revision, though,
    and Django never reruns an applied migration. Introspect before adding the
    column so this forward repair is safe for both database histories.
    """

    PublishedNight = apps.get_model("pubs", "PublishedNight")
    table_name = PublishedNight._meta.db_table
    with schema_editor.connection.cursor() as cursor:
        columns = {
            column.name
            for column in schema_editor.connection.introspection.get_table_description(
                cursor, table_name
            )
        }
    if "client_aliases" not in columns:
        schema_editor.add_field(
            PublishedNight,
            PublishedNight._meta.get_field("client_aliases"),
        )

    for night in PublishedNight.objects.all().iterator(chunk_size=500):
        aliases = list(
            dict.fromkeys([*(night.client_aliases or []), night.client_id])
        )
        PublishedNight.objects.filter(pk=night.pk).update(client_aliases=aliases)


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0102_published_night_pub_references"),
    ]

    operations = [
        migrations.RunPython(ensure_client_aliases, migrations.RunPython.noop),
    ]

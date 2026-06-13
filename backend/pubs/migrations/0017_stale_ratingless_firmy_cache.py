from datetime import UTC, datetime

from django.db import migrations


# Old enough to be outside any reasonable HOURS_TTL_DAYS value. Keeping a
# non-null timestamp means refresh_hours will pick these rows up in its stale
# refresh phase; setting fetched_at=NULL would only refresh them on direct API
# requests.
STALE_FETCHED_AT = datetime(2000, 1, 1, tzinfo=UTC)


def stale_ratingless_firmy_rows(apps, schema_editor):
    PubHours = apps.get_model("pubs", "PubHours")

    PubHours.objects.filter(
        source="firmy",
        source_ref__isnull=False,
        rating_value__isnull=True,
        status__in=["ok", "unknown"],
    ).exclude(source_ref="").update(fetched_at=STALE_FETCHED_AT)


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0016_release_note_1_1_3"),
    ]

    operations = [
        migrations.RunPython(
            stale_ratingless_firmy_rows,
            reverse_code=migrations.RunPython.noop,
        ),
    ]

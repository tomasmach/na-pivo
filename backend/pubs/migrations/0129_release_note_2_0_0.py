# Hand-written: correct the upcoming release note from 3.0.0 to 2.0.0.
#
# Keep 0125 immutable because it may already be applied in development. A fresh
# backend deploy runs both migrations before serving traffic, while an existing
# development database is corrected in place by this migration.

from django.db import migrations

VERSION = "2.0.0"
OLD_VERSION = "3.0.0"


def correct_release_note_version(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNote.objects.filter(version=VERSION).delete()
    ReleaseNote.objects.filter(version=OLD_VERSION).update(version=VERSION)


def restore_release_note_version(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNote.objects.filter(version=OLD_VERSION).delete()
    ReleaseNote.objects.filter(version=VERSION).update(version=OLD_VERSION)


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0128_partygame_payloads_redacted"),
    ]

    operations = [
        migrations.RunPython(correct_release_note_version, restore_release_note_version),
    ]

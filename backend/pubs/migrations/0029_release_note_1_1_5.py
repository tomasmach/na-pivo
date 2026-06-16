# Hand-written: seed the "what's new" popup for app version 1.1.5.
#
# Same approach as 0023 (the 1.1.4 note): ship the note as a migration so it
# lands on the next deploy (git pull -> migrate) without a manual admin step. It
# is published immediately — the app only fetches the note matching the build
# the user is running, so a 1.1.5 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`, so re-running (or running
# after the note was already authored by hand) is a no-op.

from django.db import migrations
from django.utils import timezone

VERSION = "1.1.5"
TITLE = "Počítadlo bez boje s klávesnicí"
ITEMS = [
    ("⌨️", "Formulář piva se teď posune nad klávesnici — cenu i velikost vyplníš na jednu obrazovku."),
    ("🍺", "Přidali jsme velikost 0,4 l."),
    ("✏️", "U „Jiné“ si teď napíšeš libovolnou velikost piva."),
]


def add_release_note(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")

    note, created = ReleaseNote.objects.get_or_create(
        version=VERSION,
        defaults={
            "title": TITLE,
            "is_published": True,
            # Historical models skip the model's custom save(), so stamp the
            # publish date here instead of relying on it.
            "published_at": timezone.now(),
        },
    )
    if not created:
        return

    for order, (icon, text) in enumerate(ITEMS, start=1):
        ReleaseNoteItem.objects.create(
            release_note=note,
            icon=icon,
            text=text,
            order=order,
        )


def remove_release_note(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    # Cascade deletes the items.
    ReleaseNote.objects.filter(version=VERSION).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0028_account_marketing_emails_enabled_and_more"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

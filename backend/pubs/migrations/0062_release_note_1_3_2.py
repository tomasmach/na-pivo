# Hand-written: seed the "what's new" popup for app version 1.3.2.
#
# Same approach as 0058 (the 1.3.0 note): ship the note as a migration so it
# lands on the next deploy (git pull -> migrate) without a manual admin step. It
# is published immediately — the app only fetches the note matching the build
# the user is running, so a 1.3.2 note never shows to anyone until they update.
#
# 1.3.2 is a bugfix release after 1.3.1 (which shipped without its own note).
# The headline is taming the pub reminder notification, which had been firing
# far too often, plus the counter's new menu-scan shortcut and a keyboard fix.
#
# Idempotent via get_or_create on the unique `version`, so re-running is a no-op.

from django.db import migrations
from django.utils import timezone

VERSION = "1.3.2"
TITLE = "Míň randálu, víc klidu 🍻"
ITEMS = [
    ("🔔", "Připomínka do hospody se umoudřila. Chodí míň a jen když fakt sedíš v hospodě, ne v jednom kuse."),
    ("📸", "V počítadle je nová zkratka: přidáváš pivo a rovnou můžeš vyfotit lístek a načíst menu."),
    ("⌨️", "Klávesnice ti už nezakrývá políčka, do kterých píšeš."),
    ("🛠️", "Pár oprav kolem dialogů a úprav naskenovaného menu, ať to líp šlape."),
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
        ("pubs", "0061_alter_clientevent_event"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

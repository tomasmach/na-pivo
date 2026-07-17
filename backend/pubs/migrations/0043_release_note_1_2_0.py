# Hand-written: seed the "what's new" popup for app version 1.2.0.
#
# Same approach as 0029 (the 1.1.5 note): ship the note as a migration so it
# lands on the next deploy (git pull -> migrate) without a manual admin step. It
# is published immediately — the app only fetches the note matching the build
# the user is running, so a 1.2.0 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`, so re-running (or running
# after the note was already authored by hand) is a no-op.

from django.db import migrations
from django.utils import timezone

VERSION = "1.2.0"
TITLE = "Největší přídavek zatím 🍺"
ITEMS = [
    ("👤", "Máš účet. Přihlas se a tvoje piva i hospody jdou s tebou na každý telefon."),
    ("✨", "Profil s přezdívkou a avatarem. Co ukážeš, je na tobě."),
    ("🍺", "Počítadlo a historie spadly do jednoho tabu — Štamgast. Načatý večer v klidu dopiješ pozdějc."),
    ("🗺️", "Nově Zmapuj hospodu: otevíračka, piva i vybavení na jednom místě. A bereš za to Mapér body."),
    ("✍️", "Když zapisuješ pivo, název i značku ti napovíme."),
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
        ("pubs", "0042_pubcommunityxpledger"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

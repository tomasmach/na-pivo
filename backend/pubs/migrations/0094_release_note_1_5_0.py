# Hand-written: seed the "what's new" popup for app version 1.5.0.
#
# Same approach as 0082 (the 1.4.1 note): ship the note as a migration so it
# lands on the next deploy without a manual admin step. It is published
# immediately — the app only fetches the note matching the build the user is
# running, so a 1.5.0 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`.

from django.db import migrations
from django.utils import timezone

VERSION = "1.5.0"
TITLE = "Nový kabát, Výčep a živá aktivita 🍻"
ITEMS = [
    ("🎨", "Celá appka dostala nový vzhled. Vypadá jako tácek pod pivem a míň se v tom bloudí."),
    ("🍺", "Výčep: pověsíš tam svůj večer a mrkneš, co pili ostatní."),
    ("📱", "Živá aktivita na zamčené obrazovce. Pivo přidáš, aniž bys appku otevíral."),
    ("👥", "V partě vidíš, kdo právě sedí v hospodě a co má před sebou."),
    ("📓", "Deník spojil historii a statistiky do jedné obrazovky. Přibyly měsíční a roční přehledy."),
    ("📍", "Chybějící hospodu přidáš pinem na mapě, otevíračku opravíš rovnou v detailu."),
    ("🛠️", "Opravy přihlašování, mapy a hromada drobností."),
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
        ("pubs", "0093_alter_clientevent_event"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

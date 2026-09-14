# Hand-written: seed the "what's new" popup for app version 1.5.1.
#
# Same approach as 0094 (the 1.5.0 note): ship the note as a migration so it
# lands on the next deploy without a manual admin step. It is published
# immediately — the app only fetches the note matching the build the user is
# running, so a 1.5.1 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`.

from django.db import migrations
from django.utils import timezone

VERSION = "1.5.1"
TITLE = "Deník je celý zpátky a žebříček s ním 🍻"
ITEMS = [
    (
        "📓",
        "Deník ukazuje celou historii. Vrátily se i starší večery a ty, co jsi dopsal ručně.",
    ),
    ("🏆", "Žebříček v Partě je zpátky. Piva i návštěvy za posledních 30 dní."),
    ("📍", "Nová hospoda si sama doplní adresu a město."),
    ("👥", "Když dáš „Dopito“, zmizíš partě z hospody hned."),
    (
        "⏰",
        "Připomínka počítadla se posune správně, i když pivo přidáš z oznámení nebo z Live Activity.",
    ),
    ("📷", "Foťák na počítadle se zeptá, jestli fotíš pivo do deníčku, nebo nápoják."),
    ("🛠️", "Hromada drobných oprav na Androidu i iPhonu."),
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
        ("pubs", "0095_pubvisit_closed_at"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

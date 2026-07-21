# Hand-written: seed the "what's new" popup for app version 1.4.1.
#
# Same approach as 0071 (the 1.4.0 note): ship the note as a migration so it
# lands on the next deploy without a manual admin step. It is published
# immediately — the app only fetches the note matching the build the user is
# running, so a 1.4.1 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`.

from django.db import migrations
from django.utils import timezone

VERSION = "1.4.1"
TITLE = "Levnější pivo a nové odznaky 🍻"
ITEMS = [
    ("💸", "Nový filtr na mapě: hospody, kde pivo nestojí majlant."),
    ("🏅", "Pivař XP – nové úrovně a odznaky za každé zapsané pivo."),
    ("⏰", "Připomínky počítadla si teď nastavíš podle sebe."),
    ("🌳", "Pivo si zapíšeš i mimo hospodu – doma, na zahrádce, na vodě."),
    ("✏️", "Minulé večery jdou upravit a stejná piva se v detailu přehledně seskupí."),
    ("🛠️", "Opravy přihlašování, resetu hesla a rychlejší start kompasu."),
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
        ("pubs", "0081_pubgoogleplace"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

# Hand-written: seed the "what's new" popup for app version 2.1.0.
#
# 2.1.0 ships the 1.5.1 app again after the 2.0.0 redesign. Same approach as
# 0094/0096: the note lands with the deploy and only shows to the build it
# names. English copy stays empty on purpose: this build is Czech-only.

from django.db import migrations
from django.utils import timezone

VERSION = "2.1.0"
TITLE = "Zpátky stará jednoduchá Na pivo 🍻"
ITEMS = [
    ("🧭", "Kompas, počítadlo, deník a parta. Nic víc, jak to bylo předtím."),
    ("🧹", "Večer, společný stůl a hry jsem vyhodil. Bylo toho moc a psali jste mi to."),
    ("☁️", "Zapsaná piva, návštěvy i fotky ti zůstaly."),
    ("🙏", "Díky za upřímný feedback. Kdyby ti něco chybělo, napiš mi."),
]


def add_release_note(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")

    note, created = ReleaseNote.objects.get_or_create(
        version=VERSION,
        defaults={
            "title": TITLE,
            "is_published": True,
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
    ReleaseNote.objects.filter(version=VERSION).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0137_offlinemutationtombstone_drinklog_evening_client_id"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

# Hand-written: seed the "what's new" popup for app version 3.0.0.
#
# The note ships with the backend before the mobile release. The app only asks
# for the exact version it is running, so publishing it here cannot show it to
# users on an older build.

from django.db import migrations
from django.utils import timezone

VERSION = "3.0.0"
TITLE = "Celý večer v jedné appce 🍻"
ITEMS = [
    ("🍺", "Večer drží pohromadě piva, hospodu, fotky i partu."),
    ("👥", "U jednoho stolu se spojíš s partou kódem a hrajete spolu."),
    ("🎲", "Přibylo devět her: kvíz, kostky, Flaška, Runda a další."),
    ("🍻", "Nový feed, výzvy a profily ukážou, co se děje v partě."),
    ("📶", "Offline zápisy počkají na signál a odešlou se později."),
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
        ("pubs", "0124_quorum_trust"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

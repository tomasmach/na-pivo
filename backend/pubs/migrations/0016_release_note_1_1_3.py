# Hand-written: seed the "what's new" popup for app version 1.1.3.
#
# Same approach as 0010 (the 1.1.2 note): ship the note as a migration so it
# lands on the next deploy (git pull -> migrate) without a manual admin step. It
# is published immediately — the app only fetches the note matching the build
# the user is running, so a 1.1.3 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`, so re-running (or running
# after the note was already authored by hand) is a no-op.

from django.db import migrations
from django.utils import timezone

VERSION = "1.1.3"
TITLE = "Čerstvě naraženo!"
ITEMS = [
    ("🍺", "Máme Počítadlo piv. Odklikni každé vypité a měj přehled, kolik už toho je."),
    ("💰", "Uvidíš, za kolik chodí pivo jinde, díky ostatním pivařům. A kdo je na Slovensku, přepne si ceny do eur."),
    ("⭐", "U hospod přibyla hodnocení, ať netápeš, kam vyrazit."),
    ("✨", "Hlášení hospody a okno „Co je nového“ jsou teď svižnější a líp vypadají."),
    ("🔧", "Plus pár vychytávek u kompasu a příchodu do hospody."),
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
        ("pubs", "0015_pubhours_rating_count_pubhours_rating_label_and_more"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

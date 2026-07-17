# Hand-written: seed the "what's new" popup for app version 1.1.2.
#
# Release notes normally live in the DB and are authored in the Django admin, but
# shipping this one as a migration means it lands automatically on the next
# deploy (git pull -> migrate) instead of needing a manual admin step. It is
# published immediately: the app only fetches the note whose version matches the
# build the user is running, so a 1.1.2 note never shows to anyone until they
# actually update to 1.1.2.
#
# Idempotent via get_or_create on the unique `version`, so re-running (or running
# after the note was already authored by hand) is a no-op.

from django.db import migrations
from django.utils import timezone

VERSION = "1.1.2"
TITLE = "Už jen pořádné hospody 🍺"
ITEMS = [
    ("🍺", "Ve výpisu i v kompasu teď najdeš jen opravdové hospody — podniky, kde nečepují, schováváme."),
    ("🧭", "Ovládání kompasu už neposkakuje, rozvržení je stabilní."),
    ("⌨️", "Klávesnice ve formuláři pro přispívání už nepřekrývá pole."),
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
        ("pubs", "0009_pubhours_venue_categories_pubhours_venue_kind"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

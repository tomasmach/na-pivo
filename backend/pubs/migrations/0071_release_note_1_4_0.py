# Hand-written: seed the "what's new" popup for app version 1.4.0.
#
# Same approach as 0058 (the 1.3.0 note): ship the note as a migration so it
# lands on the next deploy (git pull -> migrate) without a manual admin step. It
# is published immediately — the app only fetches the note matching the build
# the user is running, so a 1.4.0 note never shows to anyone until they update.
#
# Idempotent via get_or_create on the unique `version`, so re-running (or running
# after the note was already authored by hand) is a no-op.

from django.db import migrations
from django.utils import timezone

VERSION = "1.4.0"
TITLE = "Mapa, žebříčky a fotky 🍻"
ITEMS = [
    ("🗺️", "Nová mapa piv a hospod. Kompas přepneš na mapu jedním ťuknutím, hospody si vyfiltruješ a detail otevřeš rovnou z mapy."),
    ("🏆", "Celostátní žebříčky, nové úrovně a odznaky. Týdenní pořadí uvidíš i v partě a u počítadla."),
    ("📸", "Pivní fotodeník. Cvakni pivo rovnou z počítadla — fotky se ti sejdou na profilu a parta je uvidí čerstvě cvaknuté."),
    ("🥃", "Zapíšeš si i jiné pití než pivo. Víno, panák nebo limo, ať večer sedí celý."),
    ("👤", "Nový profil a nastavení. A přibyl odkaz na Discord, kde se apka řeší."),
    ("🛠️", "Ceny v místní měně, filtr hospod podle výbavy a hromada oprav."),
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
        ("pubs", "0070_pubexternalbeermenu"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

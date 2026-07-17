# Hand-written: tighten the 1.3.0 release-note copy before production rollout.
#
# 0058 used wording that made Parta sound like an existing feature. For users
# updating from 1.2.1, friends/Parta are new in 1.3.0, so keep the migration
# additive and update the seeded note explicitly.

from django.db import migrations
from django.utils import timezone

VERSION = "1.3.0"
TITLE = "Parta, piva a lepší večer 🍻"
ITEMS = [
    ("👥", "Parta je tady: přátelé, pozvánky, plány, reakce, připíjení a výběr, komu chceš dát vědět."),
    ("🍺", "Pivo si zapíšeš konkrétněji: značka, název, styl, tagy a detail piva."),
    ("📸", "Beta čtení pivního menu z fotky. Vyfoť lístek a nech apku napovědět."),
    ("🕰️", "Zapomněl sis pivo zapsat včas? Přidej ho zpětně do správného večera."),
    ("💧", "Po pár kouscích tě apka jemně šťouchne na vodu. Ne moralizování, jen hospodská péče."),
    ("🛠️", "Lepší zmapování hospod, přejmenování vlastních podniků, slovenské adresy a hromada drobného leštění."),
]


def update_release_note(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")

    note, _created = ReleaseNote.objects.update_or_create(
        version=VERSION,
        defaults={
            "title": TITLE,
            "is_published": True,
            "published_at": timezone.now(),
        },
    )

    ReleaseNoteItem.objects.filter(release_note=note).delete()
    for order, (icon, text) in enumerate(ITEMS, start=1):
        ReleaseNoteItem.objects.create(
            release_note=note,
            icon=icon,
            text=text,
            order=order,
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0058_release_note_1_3_0"),
    ]

    operations = [
        migrations.RunPython(update_release_note, noop_reverse),
    ]

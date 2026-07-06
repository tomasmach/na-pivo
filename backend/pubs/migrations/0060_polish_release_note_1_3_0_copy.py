# Hand-written: polish the 1.3.0 release note into the shorter house style.

from django.db import migrations
from django.utils import timezone

VERSION = "1.3.0"
TITLE = "Parta si přisedla 🍻"
ITEMS = [
    ("👥", "Parta je tady. Přidej kamarády, pošli pozvánku a domluv, kdo kam dorazí."),
    ("🍻", "Připij si, hoď reakci a dej vědět jen těm, kterým chceš."),
    ("🍺", "Pivo už není jen čárka. Zapiš značku, název, styl, hodnocení i poznámku."),
    ("📸", "Vyfoť pivní menu a apka ti z něj v betě zkusí přečíst, co je na čepu."),
    ("🕰️", "Zapomenuté pivo dopíšeš zpětně do správného večera."),
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
        ("pubs", "0059_update_release_note_1_3_0_copy"),
    ]

    operations = [
        migrations.RunPython(update_release_note, noop_reverse),
    ]

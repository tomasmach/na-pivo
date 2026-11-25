# Hand-written: seed the "what's new" popup for app version 2.3.0.
#
# The 2.3.0 store build bundles no note for its own version and asks this
# endpoint. Builds with the bundled 2.3.0 pager never ask, so this note only
# reaches the store build and the "O appce" changelog. Copy matches the pager
# slides in src/i18n (whatsNew.v221).

from django.db import migrations
from django.utils import timezone

VERSION = "2.3.0"
TITLE = "Co je nového"
TITLE_EN = "What's new"
ITEMS = [
    (
        "Ze zapsaného pití ti na počítadle odhadnu promile a kdy budeš na nule. "
        "Je to jen odhad, za volant podle něj nesedej.",
        "In the Counter I'll estimate your blood alcohol and when you'll be back to zero. "
        "It's only an estimate, so never drive based on it.",
    ),
    (
        "Na lístku hospody ťukni na pivo a vyber Hlídat pivo. "
        "Až ho začnou čepovat poblíž, dám ti vědět.",
        "Tap a beer on a pub's tap list and pick Watch this beer. "
        "I'll tell you when a pub nearby starts pouring it.",
    ),
    (
        "Medaile s\u00a0každou úrovní roste a ukážu ti, kolik do další chybí. "
        "Přibyly nové, třeba Silvestr, a\u00a0některé jsou tajné.",
        "Medals grow with every level, and you'll see what's left until the next one. "
        "New ones include New Year's Eve, and some are secret.",
    ),
    (
        "Na Profilu máš srdcovky, odznaky, fotky i\u00a0přidané hospody. "
        "Nastavení je pod ozubeným\u00a0kolem.",
        "Your profile now shows your favourite pubs, badges, photos and the pubs you added. "
        "Settings are behind the gear icon.",
    ),
]


def add_release_note(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")

    note, created = ReleaseNote.objects.get_or_create(
        version=VERSION,
        defaults={
            "title": TITLE,
            "title_en": TITLE_EN,
            "is_published": True,
            "published_at": timezone.now(),
        },
    )
    if not created:
        return

    for order, (text, text_en) in enumerate(ITEMS, start=1):
        ReleaseNoteItem.objects.create(
            release_note=note,
            icon="",
            text=text,
            text_en=text_en,
            order=order,
        )


def remove_release_note(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNote.objects.filter(version=VERSION).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0157_beer_watch"),
    ]

    operations = [
        migrations.RunPython(add_release_note, remove_release_note),
    ]

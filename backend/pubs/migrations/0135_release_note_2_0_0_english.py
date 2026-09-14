# Hand-written: English copy for the 2.0.0 "what's new" popup.
#
# Release notes are authored data, not gettext strings, so the English variant
# lives in the DB next to the Czech one. Only 2.0.0 is translated; older notes
# stay Czech-only and the app hides the popup for English users when the
# English text is empty. Items are matched on their final Czech text (0130 and
# 0132 hold that copy), so a hand-edited note is never overwritten blindly.

from django.db import migrations

VERSION = "2.0.0"
TITLE_EN = "Your whole night in one app"
ITEMS_EN = [
    (
        "Večer drží pohromadě piva, hospodu, fotky i partu.",
        "A night keeps your beers, the pub, photos and your crew in one place.",
    ),
    (
        "U jednoho stolu se spojíš s partou kódem.",
        "Sit down at one table and join your crew with a code.",
    ),
    (
        "Hry u stolu ještě dolaďuju, přijdou v další verzi.",
        "Table games still need work, they arrive in the next version.",
    ),
    (
        "Nový feed, výzvy a profily ukážou, co se děje v partě.",
        "A new feed, challenges and profiles show what your crew is up to.",
    ),
    (
        "Offline zápisy počkají na signál a odešlou se později.",
        "Offline entries wait for a signal and send themselves later.",
    ),
]


def add_english_copy(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")
    note = ReleaseNote.objects.filter(version=VERSION).first()
    if note is None:
        return
    ReleaseNote.objects.filter(pk=note.pk).update(title_en=TITLE_EN)
    for text_cs, text_en in ITEMS_EN:
        ReleaseNoteItem.objects.filter(release_note=note, text=text_cs).update(text_en=text_en)


def remove_english_copy(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")
    note = ReleaseNote.objects.filter(version=VERSION).first()
    if note is None:
        return
    ReleaseNote.objects.filter(pk=note.pk).update(title_en="")
    ReleaseNoteItem.objects.filter(release_note=note).update(text_en="")


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0134_seed_amenity_kind_english_labels"),
    ]

    operations = [
        migrations.RunPython(add_english_copy, remove_english_copy),
    ]

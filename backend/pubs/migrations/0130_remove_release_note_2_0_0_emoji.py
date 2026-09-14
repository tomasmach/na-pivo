import re

from django.db import migrations

VERSION = "2.0.0"
TITLE = "Celý večer v jedné appce"

EMOJI_RE = re.compile(
    "["
    "\U0001F1E6-\U0001F1FF"
    "\U0001F300-\U0001FAFF"
    "\u2600-\u27BF"
    "\u200D"
    "\uFE0E-\uFE0F"
    "]"
)
WHITESPACE_RE = re.compile(r"\s+")


def _without_emoji(value):
    return WHITESPACE_RE.sub(" ", EMOJI_RE.sub("", value)).strip()


def remove_release_note_emoji(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")

    note = ReleaseNote.objects.filter(version=VERSION).first()
    if note is None:
        return

    ReleaseNote.objects.filter(pk=note.pk).update(title=TITLE)
    for item in ReleaseNoteItem.objects.filter(release_note=note):
        icon = _without_emoji(item.icon)
        text = _without_emoji(item.text)
        if (icon, text) != (item.icon, item.text):
            ReleaseNoteItem.objects.filter(pk=item.pk).update(icon=icon, text=text)


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0129_release_note_2_0_0"),
    ]

    operations = [
        migrations.RunPython(remove_release_note_emoji, migrations.RunPython.noop),
    ]

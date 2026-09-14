from django.db import migrations

VERSION = "2.0.0"
OLD_TABLE = "U jednoho stolu se spojíš s partou kódem a hrajete spolu."
NEW_TABLE = "U jednoho stolu se spojíš s partou kódem."
OLD_GAMES = "Přibylo devět her: kvíz, kostky, Flaška, Runda a další."
NEW_GAMES = "Hry u stolu ještě dolaďuju, přijdou v další verzi."


def reword(apps, schema_editor):
    """2.0.0 ships with the games locked behind a "brzy" badge; the release
    note must not promise nine playable games."""
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")
    note = ReleaseNote.objects.filter(version=VERSION).first()
    if note is None:
        return
    ReleaseNoteItem.objects.filter(release_note=note, text=OLD_TABLE).update(text=NEW_TABLE)
    ReleaseNoteItem.objects.filter(release_note=note, text=OLD_GAMES).update(text=NEW_GAMES)


def restore(apps, schema_editor):
    ReleaseNote = apps.get_model("pubs", "ReleaseNote")
    ReleaseNoteItem = apps.get_model("pubs", "ReleaseNoteItem")
    note = ReleaseNote.objects.filter(version=VERSION).first()
    if note is None:
        return
    ReleaseNoteItem.objects.filter(release_note=note, text=NEW_TABLE).update(text=OLD_TABLE)
    ReleaseNoteItem.objects.filter(release_note=note, text=NEW_GAMES).update(text=OLD_GAMES)


class Migration(migrations.Migration):
    dependencies = [("pubs", "0131_activate_tank_beer_amenity")]
    operations = [migrations.RunPython(reword, restore)]

from django.db import migrations

KEY = "practical_tank_beer"


def activate_tank_beer(apps, schema_editor):
    """The 3.0 pub list ships a "Tank" chip that filters on this amenity, but
    the kind was seeded inactive, so the server rejected every such request
    with 400 and the chip could never match a pub. Activate it so the filter
    works and pubs can be mapped as tank pubs."""
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    AmenityKind.objects.filter(key=KEY).update(active=True, filter_candidate=True)


def deactivate_tank_beer(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    AmenityKind.objects.filter(key=KEY).update(active=False)


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0130_remove_release_note_2_0_0_emoji"),
    ]

    operations = [
        migrations.RunPython(activate_tank_beer, deactivate_tank_beer),
    ]

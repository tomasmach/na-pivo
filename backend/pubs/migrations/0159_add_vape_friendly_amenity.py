from django.db import migrations

KEY = "practical_vape_friendly"


def add_vape_friendly(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    AmenityKind.objects.update_or_create(
        key=KEY,
        defaults={
            "label": "E-cigarety a IQOS povoleny",
            "short_label": "E-cig / IQOS",
            "label_en": "E-cigarettes and IQOS allowed",
            "short_label_en": "E-cig / IQOS",
            "group": "practical",
            "icon": "WindIcon",
            "filter_candidate": True,
            "active": True,
            "rank": 155,
        },
    )


def remove_vape_friendly(apps, schema_editor):
    """Deactivate rather than delete: votes and aggregates reference the key,
    and a key is never reused."""
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    AmenityKind.objects.filter(key=KEY).update(active=False)


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0158_release_note_2_3_0"),
    ]

    operations = [
        migrations.RunPython(add_vape_friendly, remove_vape_friendly),
    ]

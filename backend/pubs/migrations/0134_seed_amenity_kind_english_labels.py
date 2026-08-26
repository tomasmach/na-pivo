# Hand-written: fill label_en / short_label_en for the v1 amenity taxonomy.
#
# The amenity catalogue is DB-backed (the app renders whatever /kinds returns),
# so English labels are data, not gettext strings. Idempotent update over the
# 18 keys seeded in 0037; reverse_code blanks the English columns again and
# leaves the Czech ones untouched.

from django.db import migrations

# (key, label_en, short_label_en)
AMENITY_KIND_ENGLISH = [
    ("payment_card", "Card payment", "Card"),
    ("payment_cash_only", "Cash only", "Cash"),
    ("seating_garden", "Beer garden", "Garden"),
    ("seating_barrier_free", "Step-free access", "Step-free"),
    ("seating_kids_corner", "Kids corner", "Kids"),
    ("game_darts", "Darts", "Darts"),
    ("game_billiards", "Pool table", "Pool"),
    ("game_foosball", "Table football", "Foosball"),
    ("game_jukebox", "Jukebox", "Jukebox"),
    ("atmosphere_live_music", "Live music", "Live music"),
    ("atmosphere_sports_tv", "Sport on TV", "Sport"),
    ("atmosphere_dogs_welcome", "Dogs welcome", "Dogs"),
    ("atmosphere_smoking", "Smoking room", "Smoking"),
    ("practical_wifi", "Wi-Fi", "Wi-Fi"),
    ("practical_parking", "Parking", "Parking"),
    ("practical_food", "Kitchen", "Food"),
    ("practical_outdoor_tap", "Outdoor tap", "Tap"),
    ("practical_tank_beer", "Tank beer", "Tank"),
]


def add_english_labels(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    for key, label_en, short_label_en in AMENITY_KIND_ENGLISH:
        AmenityKind.objects.filter(key=key).update(
            label_en=label_en,
            short_label_en=short_label_en,
        )


def remove_english_labels(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    AmenityKind.objects.filter(key__in=[row[0] for row in AMENITY_KIND_ENGLISH]).update(
        label_en="",
        short_label_en="",
    )


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0133_add_locale_and_english_labels"),
    ]

    operations = [
        migrations.RunPython(add_english_labels, remove_english_labels),
    ]

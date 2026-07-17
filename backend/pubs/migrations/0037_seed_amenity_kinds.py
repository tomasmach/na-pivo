# Hand-written: seed the v1 "Zmapuj hospodu" amenity taxonomy.
#
# 16 active + 2 reserved (active=False) AmenityKind rows. Idempotent
# update_or_create over the v1 set; reverse_code deletes the seeded keys. No
# vote backfill (seeding scraped booleans as community votes would pollute
# yes_count/confidence and steal first-mapper credit — see spec §2.5).

from django.db import migrations

# (key, label, short_label, group, icon, filter_candidate, active, rank)
AMENITY_KINDS = [
    ("payment_card", "Platba kartou", "Karta", "payment", "CreditCardIcon", True, True, 10),
    ("payment_cash_only", "Jen hotovost", "Hotovost", "payment", "BanknoteIcon", True, True, 20),
    ("seating_garden", "Zahrádka / terasa", "Zahrádka", "seating", "TreePineIcon", True, True, 30),
    ("seating_barrier_free", "Bezbariérový přístup", "Bezbariér", "seating", "AccessibilityIcon", True, True, 40),
    ("seating_kids_corner", "Dětský koutek", "Děti", "seating", "BabyIcon", True, True, 50),
    ("game_darts", "Šipky", "Šipky", "games", "TargetIcon", True, True, 60),
    ("game_billiards", "Kulečník", "Kulečník", "games", "CircleDotIcon", True, True, 70),
    ("game_foosball", "Stolní fotbal", "Fotbálek", "games", "SoccerBallIcon", True, True, 80),
    ("game_jukebox", "Jukebox", "Jukebox", "games", "RadioIcon", False, True, 90),
    ("atmosphere_live_music", "Živá hudba", "Živá hudba", "atmosphere", "MicIcon", False, True, 100),
    ("atmosphere_sports_tv", "Sport v televizi", "Sport v TV", "atmosphere", "TvIcon", True, True, 110),
    ("atmosphere_dogs_welcome", "Psi vítáni", "Psi", "atmosphere", "DogIcon", True, True, 120),
    ("atmosphere_smoking", "Kuřárna / kouření povoleno", "Kouření", "atmosphere", "CigaretteIcon", True, True, 130),
    ("practical_wifi", "Wi-Fi", "Wi-Fi", "practical", "WifiIcon", True, True, 140),
    ("practical_parking", "Parkování", "Parkování", "practical", "SquareParkingIcon", True, True, 150),
    ("practical_food", "Kuchyně / dá se najíst", "Kuchyně", "practical", "UtensilsIcon", True, True, 160),
    # Reserved (active=False): excluded from /kinds, the sheet, and completeness.
    # practical_outdoor_tap has NO glyph yet — assign one (NOT BeerIcon) before
    # activation in a future taxonomy bump.
    ("practical_outdoor_tap", "Venkovní výčep", "Výčep", "practical", "", False, False, 170),
    ("practical_tank_beer", "Tankové pivo", "Tank", "practical", "BeerIcon", True, False, 180),
]


def add_amenity_kinds(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    for key, label, short_label, group, icon, filter_candidate, active, rank in AMENITY_KINDS:
        AmenityKind.objects.update_or_create(
            key=key,
            defaults={
                "label": label,
                "short_label": short_label,
                "group": group,
                "icon": icon,
                "filter_candidate": filter_candidate,
                "active": active,
                "rank": rank,
            },
        )


def remove_amenity_kinds(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    AmenityKind.objects.filter(key__in=[row[0] for row in AMENITY_KINDS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0036_amenitykind_pubamenity_pubamenityvote"),
    ]

    operations = [
        migrations.RunPython(add_amenity_kinds, remove_amenity_kinds),
    ]

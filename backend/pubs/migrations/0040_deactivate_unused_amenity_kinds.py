# Hand-written: deactivate unused amenity kinds via the deactivation contract.
#
# Product decision drops the v1 active set from 16 to 12:
#   * seating_kids_corner (Dětský koutek) — unnecessary.
#   * payment_cash_only (Jen hotovost) — exact inverse of payment_card
#     (card=yes ⇒ cash-only=no), so asking both is redundant and can contradict.
#   * atmosphere_dogs_welcome (Psi vítáni) — dropped by product.
#   * practical_food (Kuchyně / dá se najíst) — assumed for a pub, low signal.
#
# Per the deactivation contract (spec §3): we set active=False rather than
# delete, so any existing votes/aggregates survive and stay excluded from
# GET /v1/pub-amenities/kinds, the sheet, and the completeness numerator AND
# denominator. Idempotent forward; reverse_code re-activates the keys.

from django.db import migrations

DEACTIVATED_KEYS = [
    "seating_kids_corner",
    "payment_cash_only",
    "atmosphere_dogs_welcome",
    "practical_food",
]


def deactivate_amenity_kinds(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    for kind in AmenityKind.objects.filter(key__in=DEACTIVATED_KEYS):
        kind.active = False
        kind.save()


def reactivate_amenity_kinds(apps, schema_editor):
    AmenityKind = apps.get_model("pubs", "AmenityKind")
    for kind in AmenityKind.objects.filter(key__in=DEACTIVATED_KEYS):
        kind.active = True
        kind.save()


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0039_accountpubcompletion_amenityxpledger"),
    ]

    operations = [
        migrations.RunPython(deactivate_amenity_kinds, reactivate_amenity_kinds),
    ]

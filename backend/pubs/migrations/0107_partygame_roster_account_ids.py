from django.db import migrations, models
from django.db.models import Q


def backfill_game_rosters(apps, schema_editor):
    PartyGame = apps.get_model("pubs", "PartyGame")
    PartyEveningMember = apps.get_model("pubs", "PartyEveningMember")

    for game in PartyGame.objects.all().iterator(chunk_size=500):
        memberships = PartyEveningMember.objects.filter(
            evening_id=game.evening_id,
            joined_at__lte=game.started_at,
        ).filter(Q(left_at__isnull=True) | Q(left_at__gte=game.started_at))
        account_ids = list(
            memberships.order_by("joined_at", "id").values_list(
                "account__public_id", flat=True
            )
        )
        if not account_ids:
            # Client-provided `started_at` can predate the server membership
            # rows after a long offline retry. Active members are the safest
            # canonical fallback for those legacy rows.
            account_ids = list(
                PartyEveningMember.objects.filter(
                    evening_id=game.evening_id,
                    active=True,
                )
                .order_by("joined_at", "id")
                .values_list("account__public_id", flat=True)
            )
        game.roster_account_ids = [str(value) for value in account_ids]
        game.save(update_fields=["roster_account_ids"])


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0106_alter_partygameevent_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="partygame",
            name="roster_account_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(backfill_game_rosters, migrations.RunPython.noop),
    ]

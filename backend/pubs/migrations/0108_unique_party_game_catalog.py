from django.db import migrations, models
from django.db.models import Count


def canonicalize_party_games(apps, schema_editor):
    PartyGame = apps.get_model("pubs", "PartyGame")
    PartyGameEvent = apps.get_model("pubs", "PartyGameEvent")
    PublishedNight = apps.get_model("pubs", "PublishedNight")

    duplicate_keys = (
        PartyGame.objects.values("evening_id", "catalog_key")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for key in duplicate_keys.iterator():
        games = list(
            PartyGame.objects.filter(
                evening_id=key["evening_id"],
                catalog_key=key["catalog_key"],
            ).order_by("started_at", "id")
        )
        canonical = games[0]
        for duplicate in games[1:]:
            for event in PartyGameEvent.objects.filter(game_id=duplicate.pk).order_by("id"):
                if PartyGameEvent.objects.filter(
                    game_id=canonical.pk,
                    client_id=event.client_id,
                ).exists():
                    event.delete()
                else:
                    event.game_id = canonical.pk
                    event.save(update_fields=["game"])

            old_id = str(duplicate.public_id)
            canonical_id = str(canonical.public_id)
            for night in PublishedNight.objects.exclude(game_ids=[]).only("pk", "game_ids"):
                game_ids = night.game_ids or []
                if old_id not in game_ids:
                    continue
                night.game_ids = list(
                    dict.fromkeys(
                        canonical_id if game_id == old_id else game_id
                        for game_id in game_ids
                    )
                )
                night.save(update_fields=["game_ids"])
            duplicate.delete()


class Migration(migrations.Migration):
    dependencies = [("pubs", "0107_partygame_roster_account_ids")]

    operations = [
        migrations.RunPython(canonicalize_party_games, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="partygame",
            constraint=models.UniqueConstraint(
                fields=("evening", "catalog_key"),
                name="unique_party_game_catalog",
            ),
        ),
    ]

import uuid

from django.db import migrations, models
from django.db.models import Count, Q


def finish_superseded_party_games(apps, schema_editor):
    PartyGame = apps.get_model("pubs", "PartyGame")
    PartyGameEvent = apps.get_model("pubs", "PartyGameEvent")

    duplicate_evenings = (
        PartyGame.objects.filter(ended_at__isnull=True)
        .values("evening_id")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for row in duplicate_evenings.iterator():
        active_games = list(
            PartyGame.objects.filter(
                evening_id=row["evening_id"],
                ended_at__isnull=True,
            ).order_by("-started_at", "-id")
        )
        canonical = active_games[0]
        for superseded in active_games[1:]:
            superseded.ended_at = canonical.started_at
            superseded.save(update_fields=["ended_at"])
            PartyGameEvent.objects.get_or_create(
                game_id=superseded.pk,
                client_id=uuid.uuid5(
                    superseded.client_id,
                    "na-pivo-party-game-superseded",
                ),
                defaults={
                    "account_id": superseded.started_by_id,
                    "kind": "finish",
                    "created_at": canonical.started_at,
                },
            )


class Migration(migrations.Migration):
    dependencies = [("pubs", "0117_backend_release_review")]

    operations = [
        migrations.RunPython(
            finish_superseded_party_games,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="partygame",
            constraint=models.UniqueConstraint(
                condition=Q(ended_at__isnull=True),
                fields=("evening",),
                name="unique_active_party_game_evening",
            ),
        ),
    ]

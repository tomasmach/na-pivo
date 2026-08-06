from django.db import migrations, models
from django.db.models import Count


def deduplicate_published_nights(apps, schema_editor):
    PublishedNight = apps.get_model("pubs", "PublishedNight")
    NightRound = apps.get_model("pubs", "NightRound")

    duplicates = (
        PublishedNight.objects.values("account_id", "drinking_day")
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )
    for group in duplicates.iterator():
        rows = list(
            PublishedNight.objects.filter(
                account_id=group["account_id"],
                drinking_day=group["drinking_day"],
            ).order_by("-updated_at", "-id")
        )
        keeper, *removed = rows
        for duplicate in removed:
            reacting_account_ids = NightRound.objects.filter(
                night_id=duplicate.id
            ).values_list("account_id", flat=True)
            for account_id in reacting_account_ids.iterator():
                if account_id != keeper.account_id:
                    NightRound.objects.get_or_create(
                        night_id=keeper.id,
                        account_id=account_id,
                    )
            duplicate.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0097_party_evening_photos_visits"),
    ]

    operations = [
        migrations.RunPython(deduplicate_published_nights, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name="publishednight",
            name="pubs_night_account_day_idx",
        ),
        migrations.AddConstraint(
            model_name="publishednight",
            constraint=models.UniqueConstraint(
                fields=("account", "drinking_day"),
                name="unique_published_night_per_account_drinking_day",
            ),
        ),
    ]

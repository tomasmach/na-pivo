import django.db.models.deletion
from django.db import migrations, models


def remove_orphaned_event_teams(apps, schema_editor):
    CommunityEventTeam = apps.get_model("pubs", "CommunityEventTeam")
    CommunityEventTeam.objects.filter(created_by__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0099_community_event_teams"),
    ]

    operations = [
        migrations.RunPython(
            remove_orphaned_event_teams,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="communityeventteam",
            name="created_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="created_community_event_teams",
                to="pubs.account",
            ),
        ),
    ]

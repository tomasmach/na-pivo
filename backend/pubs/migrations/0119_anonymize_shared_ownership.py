import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pubs", "0118_unique_active_party_game"),
    ]

    operations = [
        migrations.AlterField(
            model_name="partyevening",
            name="host",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="hosted_party_evenings",
                to="pubs.account",
            ),
        ),
        migrations.AlterField(
            model_name="partygame",
            name="started_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="started_party_games",
                to="pubs.account",
            ),
        ),
        migrations.AlterField(
            model_name="communityevent",
            name="host",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="hosted_community_events",
                to="pubs.account",
            ),
        ),
        migrations.AlterField(
            model_name="communityeventteam",
            name="created_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="created_community_event_teams",
                to="pubs.account",
            ),
        ),
        migrations.AlterField(
            model_name="partygameevent",
            name="account",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="party_game_events",
                to="pubs.account",
            ),
        ),
        migrations.AlterField(
            model_name="partygameevent",
            name="subject",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="party_game_scores",
                to="pubs.account",
            ),
        ),
    ]

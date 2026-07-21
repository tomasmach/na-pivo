import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0082_beer_product_canonical_merge")]

    operations = [
        migrations.CreateModel(
            name="PartyEvening",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "public_id",
                    models.UUIDField(
                        db_index=True, default=uuid.uuid4, editable=False, unique=True
                    ),
                ),
                (
                    "client_id",
                    models.UUIDField(
                        help_text="Host-generated idempotency key for offline create retries."
                    ),
                ),
                ("join_code", models.CharField(db_index=True, max_length=8, unique=True)),
                ("pub_name", models.CharField(max_length=200)),
                ("pub_city", models.CharField(blank=True, default="", max_length=120)),
                ("active", models.BooleanField(db_index=True, default=True)),
                (
                    "started_at",
                    models.DateTimeField(db_index=True, default=django.utils.timezone.now),
                ),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "host",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="hosted_party_evenings",
                        to="pubs.account",
                    ),
                ),
            ],
            options={"ordering": ["-started_at"]},
        ),
        migrations.CreateModel(
            name="PartyEveningMember",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("active", models.BooleanField(db_index=True, default=True)),
                ("joined_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("left_at", models.DateTimeField(blank=True, null=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="party_evening_memberships",
                        to="pubs.account",
                    ),
                ),
                (
                    "evening",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="memberships",
                        to="pubs.partyevening",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="PartyEveningDrink",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("client_id", models.UUIDField()),
                ("beer_name", models.CharField(max_length=120)),
                ("quantity", models.PositiveSmallIntegerField(default=1)),
                (
                    "shared_at",
                    models.DateTimeField(db_index=True, default=django.utils.timezone.now),
                ),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="party_evening_drinks",
                        to="pubs.account",
                    ),
                ),
                (
                    "evening",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="shared_drinks",
                        to="pubs.partyevening",
                    ),
                ),
            ],
            options={"ordering": ["shared_at", "id"]},
        ),
        migrations.AddConstraint(
            model_name="partyevening",
            constraint=models.UniqueConstraint(
                fields=("host", "client_id"), name="unique_party_evening_host_client"
            ),
        ),
        migrations.AddIndex(
            model_name="partyevening",
            index=models.Index(
                fields=["host", "active", "started_at"], name="pubs_partye_host_id_310b62_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="partyeveningmember",
            constraint=models.UniqueConstraint(
                fields=("evening", "account"), name="unique_party_evening_member"
            ),
        ),
        migrations.AddIndex(
            model_name="partyeveningmember",
            index=models.Index(
                fields=["account", "active", "joined_at"], name="pubs_partye_account_bf67fe_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="partyeveningdrink",
            constraint=models.UniqueConstraint(
                fields=("account", "client_id"), name="unique_party_evening_drink_client"
            ),
        ),
        migrations.AddIndex(
            model_name="partyeveningdrink",
            index=models.Index(
                fields=["evening", "shared_at"], name="pubs_partye_evening_c017e6_idx"
            ),
        ),
    ]

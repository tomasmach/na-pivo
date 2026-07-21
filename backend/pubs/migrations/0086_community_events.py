import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0085_pub_events")]

    operations = [
        migrations.CreateModel(
            name="CommunityEvent",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("client_id", models.UUIDField()),
                ("title", models.CharField(max_length=120)),
                ("description", models.CharField(blank=True, default="", max_length=800)),
                ("city", models.CharField(max_length=120)),
                ("area_label", models.CharField(blank=True, default="", max_length=120)),
                ("exact_address", models.CharField(max_length=300)),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("starts_at", models.DateTimeField(db_index=True)),
                ("ends_at", models.DateTimeField(db_index=True)),
                ("capacity", models.PositiveSmallIntegerField()),
                ("adults_only", models.BooleanField(default=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("active", "Active"), ("cancelled", "Cancelled")],
                        db_index=True,
                        default="active",
                        max_length=16,
                    ),
                ),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "host",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="hosted_community_events",
                        to="pubs.account",
                    ),
                ),
            ],
            options={"ordering": ["starts_at", "created_at"]},
        ),
        migrations.CreateModel(
            name="CommunityEventMembership",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("message", models.CharField(blank=True, default="", max_length=240)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("cancelled", "Cancelled"),
                            ("left", "Left"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("requested_at", models.DateTimeField(auto_now_add=True)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="community_event_memberships",
                        to="pubs.account",
                    ),
                ),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="memberships",
                        to="pubs.communityevent",
                    ),
                ),
            ],
            options={"ordering": ["requested_at"]},
        ),
        migrations.AddConstraint(
            model_name="communityevent",
            constraint=models.UniqueConstraint(
                fields=("host", "client_id"),
                name="unique_community_event_host_client",
            ),
        ),
        migrations.AddConstraint(
            model_name="communityevent",
            constraint=models.CheckConstraint(
                condition=models.Q(ends_at__gt=models.F("starts_at")),
                name="community_event_ends_after_start",
            ),
        ),
        migrations.AddConstraint(
            model_name="communityevent",
            constraint=models.CheckConstraint(
                condition=models.Q(capacity__gte=2, capacity__lte=20),
                name="community_event_capacity_2_20",
            ),
        ),
        migrations.AddConstraint(
            model_name="communityevent",
            constraint=models.CheckConstraint(
                condition=models.Q(adults_only=True),
                name="community_event_adults_only",
            ),
        ),
        migrations.AddIndex(
            model_name="communityevent",
            index=models.Index(
                fields=["status", "starts_at", "ends_at"],
                name="community_event_discovery",
            ),
        ),
        migrations.AddIndex(
            model_name="communityevent",
            index=models.Index(
                fields=["host", "status", "starts_at"],
                name="community_event_host_lookup",
            ),
        ),
        migrations.AddConstraint(
            model_name="communityeventmembership",
            constraint=models.UniqueConstraint(
                fields=("event", "account"),
                name="unique_community_event_member",
            ),
        ),
        migrations.AddIndex(
            model_name="communityeventmembership",
            index=models.Index(
                fields=["event", "status", "requested_at"],
                name="community_event_request_lookup",
            ),
        ),
    ]

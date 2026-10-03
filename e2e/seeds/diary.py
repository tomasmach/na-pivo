"""Small diary fixtures and read-only projections of actual UI writes."""

import os

from django.contrib.auth.hashers import make_password
from e2e.seeds.base import seed as seed_base

from pubs.api.stats import compute_my_stats
from pubs.models import (
    Account,
    BeerCheckIn,
    DrinkLog,
    EmailCredential,
    PublishedNight,
    PubVisit,
    TourPlan,
    TourPublication,
    TourShare,
)


def seed():
    seed_base()
    Account.objects.filter(nickname="E2EPivar").update(is_public=True)
    recipient = Account.objects.create(
        device_id="e2e-diary-recipient", nickname="E2ERecipient", display_name="E2E Příjemce"
    )
    EmailCredential.objects.create(
        account=recipient,
        email=f"second-{os.environ['NA_PIVO_E2E_EMAIL']}",
        password=make_password(os.environ["NA_PIVO_E2E_PASSWORD"]),
        email_verified=True,
    )


def observe():
    account = Account.objects.get(nickname="E2EPivar")
    return {
        "drinks": list(
            DrinkLog.objects.filter(account=account)
            .order_by("drank_at", "client_id")
            .values(
                "client_id",
                "beer_name",
                "price_czk",
                "volume_ml",
                "place_context",
                "drink_type",
                "drank_at",
                "name",
                "external_id",
            )
        ),
        "visits": list(
            PubVisit.objects.filter(account=account)
            .order_by("started_at")
            .values("client_id", "name", "started_at", "ended_at", "closed_at")
        ),
        "checkins": list(
            BeerCheckIn.objects.filter(account=account)
            .order_by("checked_in_at")
            .values(
                "client_id",
                "beer_name",
                "brewery_name",
                "rating",
                "tags",
                "pub_name",
                "visit_client_id",
                "visibility",
                "checked_in_at",
            )
        ),
        "nights": list(
            PublishedNight.objects.filter(account=account)
            .order_by("drinking_day")
            .values("client_id", "beer_count", "pub_names", "visibility", "is_removed")
        ),
        "stats": {
            key: value
            for key, value in compute_my_stats(account, timezone_name="Europe/Prague").items()
            if key in ("total_beers", "total_evenings", "distinct_pubs", "total_spent_czk")
        },
        "plans": [
            {
                "id": str(plan.pk),
                "title": plan.title,
                "owner": plan.owner.nickname,
                "scheduledDate": plan.scheduled_date,
                "scheduledTime": plan.scheduled_time,
                "stops": list(
                    plan.stops.order_by("position").values("client_id", "name", "position")
                ),
            }
            for plan in TourPlan.objects.select_related("owner").order_by("created_at")
        ],
        "shares": list(TourShare.objects.order_by("created_at").values("plan_id", "revoked_at")),
        "publications": [
            {
                "planId": str(publication.plan_id),
                "status": publication.status,
                "title": publication.title,
                "snapshotKeys": sorted(publication.snapshot),
                "stopNames": [stop["name"] for stop in publication.snapshot["stops"]],
            }
            for publication in TourPublication.objects.order_by("published_at")
        ],
    }

from __future__ import annotations

from zoneinfo import ZoneInfo

from django.db.models import Count, Min, Q, Sum
from django.utils import timezone

from pubs.mapper import maper_progress
from pubs.models import Account, DrinkLog, Friendship

PRAGUE_TZ = ZoneInfo("Europe/Prague")


def derive_account_profile_stats(account: Account) -> dict:
    """Aggregate durable account history for profile stats and achievements."""

    public_drinks = account.drinks.filter(is_suspect=False)
    drink_totals = public_drinks.aggregate(
        total_beers=Count("id", filter=Q(drink_type=DrinkLog.DrinkType.BEER)),
        first_beer_at=Min("drank_at", filter=Q(drink_type=DrinkLog.DrinkType.BEER)),
        total_spent_czk=Sum("price_czk"),
        outside_drinks=Count(
            "id", filter=~Q(place_context=DrinkLog.PlaceContext.PUB)
        ),
        outdoors_drinks=Count(
            "id", filter=Q(place_context=DrinkLog.PlaceContext.OUTDOORS)
        ),
        bottled_beers=Count(
            "id",
            filter=Q(
                drink_type=DrinkLog.DrinkType.BEER,
                serving_type=DrinkLog.ServingType.BOTTLE,
            ),
        ),
        canned_beers=Count(
            "id",
            filter=Q(
                drink_type=DrinkLog.DrinkType.BEER,
                serving_type=DrinkLog.ServingType.CAN,
            ),
        ),
    )
    pub_keys = set(account.pub_visits.values_list("cache_key", flat=True))
    pub_keys.update(
        public_drinks.filter(cache_key__isnull=False).values_list("cache_key", flat=True)
    )
    pub_keys.discard("")
    max_visit_row = (
        account.pub_visits.values("cache_key")
        .annotate(n=Count("id"))
        .order_by("-n")
        .first()
    )

    usage = getattr(account, "usage_stats", None)
    beer_identities: set[str] = set()
    night_owl = False
    for drink in public_drinks.only(
        "drank_at",
        "beer_product_key",
        "beer_brand_key",
        "beer_name",
    ):
        local_hour = timezone.localtime(drink.drank_at, PRAGUE_TZ).hour
        if 0 <= local_hour <= 3:
            night_owl = True
        identity = (
            (drink.beer_product_key or "").strip()
            or (drink.beer_brand_key or "").strip()
            or (drink.beer_name or "").strip().lower()
        )
        if identity:
            beer_identities.add(identity)

    accepted_friend_count = Friendship.objects.filter(
        Q(requester=account) | Q(recipient=account),
        status=Friendship.Status.ACCEPTED,
    ).count()

    return {
        "total_beers": int(drink_totals["total_beers"] or 0),
        "first_beer_at": drink_totals["first_beer_at"],
        "distinct_pubs": len(pub_keys),
        "ratings_count": account.pub_ratings.count(),
        "total_spent_czk": int(drink_totals["total_spent_czk"] or 0),
        "max_visits_to_one_pub": int(max_visit_row["n"]) if max_visit_row else 0,
        "mapper_xp": int(getattr(usage, "mapper_xp", 0) or 0),
        "pivar_xp": int(getattr(usage, "pivar_xp", 0) or 0),
        "mapped_pubs_count": int(getattr(usage, "mapped_pubs_count", 0) or 0),
        "first_mapper_count": int(getattr(usage, "first_mapper_count", 0) or 0),
        "amenity_votes_count": int(getattr(usage, "amenity_votes_count", 0) or 0),
        "completed_pubs_count": int(getattr(usage, "completed_pubs_count", 0) or 0),
        # FotoPivař stored counter (feeds the foto_pivar achievement only).
        "photo_contest_wins_count": int(getattr(usage, "photo_contest_wins_count", 0) or 0),
        "night_owl": night_owl,
        "distinct_beer_identities": len(beer_identities),
        "accepted_friend_count": accepted_friend_count,
        "outside_drinks": int(drink_totals["outside_drinks"] or 0),
        "outdoors_drinks": int(drink_totals["outdoors_drinks"] or 0),
        "bottled_beers": int(drink_totals["bottled_beers"] or 0),
        "canned_beers": int(drink_totals["canned_beers"] or 0),
    }


def derive_account_achievements(account: Account, stats: dict | None = None) -> dict:
    """Return the shared achievements block used by /account/me and profiles."""

    stats = stats or derive_account_profile_stats(account)
    return {
        "first_ten": stats["total_beers"] >= 10,
        "regular": stats["max_visits_to_one_pub"] >= 5,
        "reviewer": stats["ratings_count"] >= 10,
        "first_map": stats["first_mapper_count"] >= 1,
        "explorer": stats["mapped_pubs_count"] >= 10,
        "cartographer": stats["mapped_pubs_count"] >= 25,
        "completionist": stats["completed_pubs_count"] >= 1,
        "fact_machine": stats["amenity_votes_count"] >= 100,
        # FotoPivař: derived from the stored, monotonic wins counter.
        "foto_pivar": stats["photo_contest_wins_count"] >= 1,
        "first_beer": stats["total_beers"] >= 1,
        "century": stats["total_beers"] >= 100,
        "pilgrim": stats["distinct_pubs"] >= 25,
        "stamgast": stats["max_visits_to_one_pub"] >= 10,
        "night_owl": bool(stats["night_owl"]),
        "taster": stats["distinct_beer_identities"] >= 10,
        "party_animal": stats["accepted_friend_count"] >= 5,
        "chatar": stats["outside_drinks"] >= 1,
        "pod_sirakem": stats["outdoors_drinks"] >= 1,
        "lahvacovy_filozof": stats["bottled_beers"] >= 25,
        "plechovkac": stats["canned_beers"] >= 25,
    }


def derive_account_public_stats(account: Account, stats: dict | None = None) -> dict:
    """Public, non-sensitive stats exposed on friend/public profile detail."""

    stats = stats or derive_account_profile_stats(account)
    progress = maper_progress(stats["mapper_xp"])
    return {
        "total_beers": stats["total_beers"],
        "distinct_pubs": stats["distinct_pubs"],
        "mapper_level": progress["level"],
        "mapper_title": progress["title"],
        "mapper_xp": stats["mapper_xp"],
    }

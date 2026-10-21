from __future__ import annotations

from datetime import date, timedelta
from zoneinfo import ZoneInfo

from django.db.models import BooleanField, Count, ExpressionWrapper, Min, Q, Sum, TextField, Value
from django.db.models.functions import Coalesce, ExtractHour, Lower, NullIf, Trim, TruncDate

from pubs.mapper import maper_progress
from pubs.models import Account, DrinkLog, Friendship, PublishedNight

PRAGUE_TZ = ZoneInfo("Europe/Prague")
# Ochutnávač: this many different beers.
TASTER_MIN_BEERS = 10
# Same 04:00 rollover as stats.drinking_day: a beer at 1 a.m. belongs to the
# evening before, so it still counts for Silvestr or a Friday.
DRINKING_DAY_CUTOFF_HOUR = 4


def derive_account_profile_stats(account: Account) -> dict:
    """Aggregate durable account history for profile stats and achievements."""

    public_drinks = account.drinks.filter(is_suspect=False)
    is_beer = Q(drink_type=DrinkLog.DrinkType.BEER)
    drink_totals = public_drinks.annotate(
        local_hour=ExtractHour("drank_at", tzinfo=PRAGUE_TZ),
    ).aggregate(
        total_beers=Count("id", filter=is_beer),
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
        soft_drinks=Count("id", filter=Q(drink_type=DrinkLog.DrinkType.SOFT_DRINK)),
        after_midnight_drinks=Count("id", filter=Q(local_hour__lte=3)),
        lunch_beers=Count("id", filter=is_beer & Q(local_hour__gte=11, local_hour__lte=13)),
    )
    # order_by() first: the models' default ordering would otherwise leak the
    # ordering column into SELECT DISTINCT and defeat the dedup.
    pub_keys = set(
        account.pub_visits.order_by().values_list("cache_key", flat=True).distinct()
    )
    pub_keys.update(
        public_drinks.filter(cache_key__isnull=False)
        .order_by()
        .values_list("cache_key", flat=True)
        .distinct()
    )
    pub_keys.discard("")
    max_visit_row = (
        account.pub_visits.values("cache_key")
        .annotate(n=Count("id"))
        .order_by("-n")
        .first()
    )

    usage = getattr(account, "usage_stats", None)
    beer_identity = Coalesce(
        NullIf(Trim("beer_product_key"), Value("")),
        NullIf(Trim("beer_brand_key"), Value("")),
        NullIf(Lower(Trim("beer_name")), Value("")),
        output_field=TextField(),
    )
    distinct_beer_identities = (
        public_drinks.annotate(identity=beer_identity)
        .filter(identity__isnull=False)
        .values("identity")
        .distinct()
        .count()
    )

    distinct_cities = (
        public_drinks.filter(is_beer)
        .annotate(city_key=Lower(Trim("city")))
        .exclude(city_key="")
        .order_by()
        .values("city_key")
        .distinct()
        .count()
    )
    # Same wall-clock rule as stats.drinking_day(): before 04:00 local time still
    # counts as the day before, also on the nights the clocks change.
    beer_drinking_days = {
        local_date - timedelta(days=1) if early else local_date
        for local_date, early in public_drinks.filter(is_beer)
        .annotate(local_hour=ExtractHour("drank_at", tzinfo=PRAGUE_TZ))
        .annotate(
            local_date=TruncDate("drank_at", tzinfo=PRAGUE_TZ),
            early=ExpressionWrapper(
                Q(local_hour__lt=DRINKING_DAY_CUTOFF_HOUR), output_field=BooleanField()
            ),
        )
        .order_by()
        .values_list("local_date", "early")
        .distinct()
    }

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
        "photo_contest_wins_count": int(getattr(usage, "photo_contest_wins_count", 0) or 0),
        "night_owl": drink_totals["after_midnight_drinks"] > 0,
        "distinct_beer_identities": distinct_beer_identities,
        "accepted_friend_count": accepted_friend_count,
        "outside_drinks": int(drink_totals["outside_drinks"] or 0),
        "outdoors_drinks": int(drink_totals["outdoors_drinks"] or 0),
        "bottled_beers": int(drink_totals["bottled_beers"] or 0),
        "canned_beers": int(drink_totals["canned_beers"] or 0),
        "soft_drinks": int(drink_totals["soft_drinks"] or 0),
        "after_midnight_drinks": int(drink_totals["after_midnight_drinks"] or 0),
        "lunch_beers": int(drink_totals["lunch_beers"] or 0),
        "distinct_cities": distinct_cities,
        "beer_drinking_days": beer_drinking_days,
        "photos_count": account.beer_photos.count(),
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
        "taster": stats["distinct_beer_identities"] >= TASTER_MIN_BEERS,
        "party_animal": stats["accepted_friend_count"] >= 5,
        "chatar": stats["outside_drinks"] >= 1,
        "pod_sirakem": stats["outdoors_drinks"] >= 1,
        "lahvacovy_filozof": stats["bottled_beers"] >= 25,
        "plechovkac": stats["canned_beers"] >= 25,
    }


def _best_week_streak(days: set[date]) -> int:
    best = run = 0
    previous: date | None = None
    for monday in sorted({day - timedelta(days=day.weekday()) for day in days}):
        run = run + 1 if previous is not None and monday == previous + timedelta(weeks=1) else 1
        best = max(best, run)
        previous = monday
    return best


def derive_account_badge_progress(stats: dict) -> dict:
    """Raw values behind the badge collection; the app owns the tier thresholds.

    Weekdays are 0 = Monday … 6 = Sunday, months 1 … 12, both by drinking day.
    """

    days = stats["beer_drinking_days"]
    return {
        "beers": stats["total_beers"],
        "distinct_pubs": stats["distinct_pubs"],
        "max_pub_visits": stats["max_visits_to_one_pub"],
        "distinct_beers": stats["distinct_beer_identities"],
        "distinct_cities": stats["distinct_cities"],
        "best_week_streak": _best_week_streak(days),
        "ratings": stats["ratings_count"],
        "friends": stats["accepted_friend_count"],
        "mapped_pubs": stats["mapped_pubs_count"],
        "first_mapped_pubs": stats["first_mapper_count"],
        "completed_pubs": stats["completed_pubs_count"],
        "facts": stats["amenity_votes_count"],
        "photos": stats["photos_count"],
        "contest_wins": stats["photo_contest_wins_count"],
        "soft_drinks": stats["soft_drinks"],
        "beer_weekdays": sorted({day.weekday() for day in days}),
        "beer_months": sorted({day.month for day in days}),
        "outside_pub_drinks": stats["outside_drinks"],
        "outdoors_drinks": stats["outdoors_drinks"],
        "bottled_beers": stats["bottled_beers"],
        "canned_beers": stats["canned_beers"],
        "after_midnight_drinks": stats["after_midnight_drinks"],
        "lunch_beers": stats["lunch_beers"],
        "christmas_eves": sum(1 for day in days if (day.month, day.day) == (12, 24)),
        "new_years_eves": sum(1 for day in days if (day.month, day.day) == (12, 31)),
        # International Beer Day: the first Friday of August.
        "beer_day_fridays": sum(
            1 for day in days if day.month == 8 and day.weekday() == 4 and day.day <= 7
        ),
    }


def derive_account_public_stats(account: Account, *, is_friend: bool) -> dict:
    """Stats derived only from nights this viewer may already see.

    A public nickname is not consent to publish the private diary. In
    particular, never build these counters from ``DrinkLog`` or ``PubVisit``:
    strangers could otherwise infer alcohol history merely by opening a public
    profile. Published nights are the explicit, item-level sharing boundary.
    """

    nights = account.published_nights.filter(is_removed=False)
    if not is_friend or account.ghost_mode:
        nights = nights.filter(visibility=PublishedNight.Visibility.PUBLIC)

    total_beers = 0
    pub_names: set[str] = set()
    for night in nights.only("beer_count", "pub_names"):
        total_beers += int(night.beer_count)
        pub_names.update(
            name.strip().casefold()
            for name in night.pub_names
            if isinstance(name, str) and name.strip()
        )

    usage = getattr(account, "usage_stats", None)
    mapper_xp = int(getattr(usage, "mapper_xp", 0) or 0)
    progress = maper_progress(mapper_xp)
    return {
        "total_beers": total_beers,
        "distinct_pubs": len(pub_names),
        "mapper_level": progress["level"],
        "mapper_title": progress["title"],
        "mapper_xp": mapper_xp,
    }


def derive_account_public_achievements(account: Account, public_stats: dict) -> dict:
    """Achievement shape safe for another account to inspect.

    Diary-only achievements stay locked. Publishing a night can unlock the four
    badges whose complete inputs are already visible in published summaries;
    public community-contribution counters are safe to expose as badges too.
    """

    usage = getattr(account, "usage_stats", None)
    total_beers = int(public_stats["total_beers"])
    distinct_pubs = int(public_stats["distinct_pubs"])
    return {
        "first_ten": total_beers >= 10,
        "regular": False,
        "reviewer": False,
        "first_map": int(getattr(usage, "first_mapper_count", 0) or 0) >= 1,
        "explorer": int(getattr(usage, "mapped_pubs_count", 0) or 0) >= 10,
        "cartographer": int(getattr(usage, "mapped_pubs_count", 0) or 0) >= 25,
        "completionist": int(getattr(usage, "completed_pubs_count", 0) or 0) >= 1,
        "fact_machine": int(getattr(usage, "amenity_votes_count", 0) or 0) >= 100,
        "foto_pivar": int(getattr(usage, "photo_contest_wins_count", 0) or 0) >= 1,
        "first_beer": total_beers >= 1,
        "century": total_beers >= 100,
        "pilgrim": distinct_pubs >= 25,
        "stamgast": False,
        "night_owl": False,
        "taster": False,
        "party_animal": False,
        "chatar": False,
        "pod_sirakem": False,
        "lahvacovy_filozof": False,
        "plechovkac": False,
    }


def derive_account_public_badge_progress(account: Account, public_stats: dict) -> dict:
    """Only the badge values another account may see, same boundary as above."""

    usage = getattr(account, "usage_stats", None)
    return {
        "beers": int(public_stats["total_beers"]),
        "distinct_pubs": int(public_stats["distinct_pubs"]),
        "mapped_pubs": int(getattr(usage, "mapped_pubs_count", 0) or 0),
        "first_mapped_pubs": int(getattr(usage, "first_mapper_count", 0) or 0),
        "completed_pubs": int(getattr(usage, "completed_pubs_count", 0) or 0),
        "facts": int(getattr(usage, "amenity_votes_count", 0) or 0),
        "contest_wins": int(getattr(usage, "photo_contest_wins_count", 0) or 0),
    }

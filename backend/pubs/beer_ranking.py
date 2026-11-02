"""National beer ranking and the global numbers of a beer page.

``refresh_beer_ranking`` rebuilds one ``BeerRanking`` row per catalogue beer
from ratings and drinks. The worker calls it every tick and it does the work at
most once an hour, so reading the ranking never aggregates anything.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from datetime import date, datetime, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from pubs.models import (
    BEER_CHECKIN_TAGS,
    Account,
    BeerCheckIn,
    BeerProduct,
    BeerRanking,
    BeerRegionRanking,
    BeerStyleVote,
    DrinkLog,
    PubBeerProduct,
)
from pubs.regions import region_of_cell

# A beer enters the ranking with this many people who rated it.
RANKING_MIN_RATERS = 10
# Until this many beers reach that, the ranking is "early" and takes beers with fewer raters.
EARLY_UNTIL_BEERS = 10
EARLY_MIN_RATERS = 3
REFRESH_EVERY = timedelta(hours=1)
# A pub counts as pouring a beer when someone confirmed it within this window.
POURING_FRESH_DAYS = 90
STYLES = ("lager", "ten", "craft", "dark")

_DARK = re.compile(r"tmav|cern|dark|porter|stout|schwarz|bock")
_CRAFT = re.compile(r"\b(craft|ipa|apa|neipa|ale|sour|weizen|psenic\w*|wheat|saison|gose)\b")
_TEN = re.compile(r"\b10\b|desitk|vycepni")
_LAGER = re.compile(r"lezak|lager|pils|\b1[1-3]\b|premium")


def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def classify_styles(name: str, style_texts: list[str]) -> list[str]:
    """Rough style buckets for the ranking filter, from the product name and what people typed as style."""

    text = " ".join([_fold(name), *(_fold(style) for style in style_texts)])
    styles: list[str] = []
    dark = bool(_DARK.search(text))
    craft = bool(_CRAFT.search(text))
    if _TEN.search(text):
        styles.append("ten")
    if not dark and not craft and _LAGER.search(text):
        styles.append("lager")
    if craft:
        styles.append("craft")
    if dark:
        styles.append("dark")
    return [style for style in STYLES if style in styles]


# A people-chosen style replaces the name guess once this many agree and it has the most votes.
STYLE_MIN_VOTES = 3


def settled_style(votes: Counter) -> tuple[bool, list[str]]:
    """(settled, styles) from people's answers: the majority wins with enough agreement."""
    ranked = votes.most_common(2)
    if not ranked or ranked[0][1] < STYLE_MIN_VOTES:
        return False, []
    if len(ranked) > 1 and ranked[1][1] == ranked[0][1]:
        return False, []
    winner = ranked[0][0]
    return True, [winner] if winner in STYLES else []


def _vote_of_text(text: str) -> str | None:
    """The style bucket a typed style names, for check-ins that carry one."""
    found = classify_styles("", [text])
    return found[0] if len(found) == 1 else None


def _star(rating) -> int:
    return max(1, min(5, int(math.floor(float(rating) + 0.5))))


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def is_early() -> bool:
    return (
        BeerRanking.objects.filter(rating_count__gte=RANKING_MIN_RATERS).count() < EARLY_UNTIL_BEERS
    )


def refresh_beer_ranking(now: datetime | None = None, *, force: bool = False) -> int | None:
    """Rebuild the ranking rows. Returns how many beers it ranked, or None when it was fresh."""

    now = now or timezone.now()
    latest = (
        BeerRanking.objects.order_by("-computed_at").values_list("computed_at", flat=True).first()
    )
    if not force and latest is not None and latest > now - REFRESH_EVERY:
        return None

    ratings: dict[tuple[int, int], float] = {}
    tags: dict[tuple[int, int], list[str]] = {}
    # (account, product) -> style the account named, an explicit answer beating a typed one.
    style_votes: dict[tuple[int, int], str] = {}
    checkins = (
        BeerCheckIn.objects.filter(
            beer_product__isnull=False, account__status=Account.Status.ACTIVE
        )
        .order_by("checked_in_at", "id")
        .values_list(
            "account_id", "beer_product_id", "rating", "tags", "beer_style", "pub_cache_key"
        )
    )
    # (region, account, product) -> latest rating given at a pub in that region.
    region_ratings: dict[tuple[str, int, int], float] = {}
    for account_id, product_id, rating, row_tags, style, cell in checkins.iterator(chunk_size=2000):
        key = (account_id, product_id)
        if rating is not None:
            ratings[key] = float(rating)
            region = region_of_cell(cell)
            if region:
                region_ratings[(region, account_id, product_id)] = float(rating)
        clean = [
            tag
            for tag in (row_tags if isinstance(row_tags, list) else [])
            if tag in BEER_CHECKIN_TAGS
        ]
        if clean:
            tags[key] = clean
        vote = _vote_of_text(style) if style else None
        if vote:
            style_votes[key] = vote

    for account_id, product_id, style in BeerStyleVote.objects.filter(
        account__status=Account.Status.ACTIVE
    ).values_list("account_id", "product_id", "style"):
        if style == BeerStyleVote.Style.UNKNOWN:
            continue
        style_votes[(account_id, product_id)] = style
    votes_per_product: dict[int, Counter] = {}
    for (_, product_id), style in style_votes.items():
        votes_per_product.setdefault(product_id, Counter())[style] += 1

    per_product: dict[int, dict] = {}

    def entry(product_id: int) -> dict:
        return per_product.setdefault(
            product_id,
            {"ratings": [], "stars": [0, 0, 0, 0, 0], "tags": Counter(), "tagged": 0},
        )

    for (_, product_id), rating in ratings.items():
        row = entry(product_id)
        row["ratings"].append(rating)
        row["stars"][5 - _star(rating)] += 1
    for (_, product_id), row_tags in tags.items():
        row = entry(product_id)
        row["tagged"] += 1
        row["tags"].update(row_tags)

    week_ago = now - timedelta(days=7)
    drinks = (
        DrinkLog.objects.filter(
            drink_type=DrinkLog.DrinkType.BEER,
            is_suspect=False,
            beer_product__isnull=False,
            account__status=Account.Status.ACTIVE,
        )
        .order_by()
        .values("beer_product_id")
        .annotate(
            total=Count("id"),
            people=Count("account_id", distinct=True),
            week=Count("id", filter=Q(drank_at__gte=week_ago)),
        )
    )
    drink_stats = {row["beer_product_id"]: row for row in drinks}

    product_ids = set(per_product) | set(drink_stats)
    products = {
        product.pk: product
        for product in BeerProduct.objects.filter(pk__in=product_ids, active=True)
    }

    rated = [
        (product_id, sum(row["ratings"]) / len(row["ratings"]), len(row["ratings"]))
        for product_id, row in per_product.items()
        if row["ratings"] and product_id in products
    ]
    min_raters = RANKING_MIN_RATERS
    if sum(1 for _, _, count in rated if count >= RANKING_MIN_RATERS) < EARLY_UNTIL_BEERS:
        min_raters = EARLY_MIN_RATERS
    qualified = sorted(
        (item for item in rated if item[2] >= min_raters),
        key=lambda item: (-item[1], -item[2], products[item[0]].name),
    )
    ranks = {product_id: index + 1 for index, (product_id, _, _) in enumerate(qualified)}

    monday = _monday(timezone.localdate(now))
    existing = {row.product_id: row for row in BeerRanking.objects.filter(product_id__in=products)}
    to_create: list[BeerRanking] = []
    to_update: list[BeerRanking] = []
    for product_id, product in products.items():
        stats = per_product.get(
            product_id, {"ratings": [], "stars": [0] * 5, "tags": Counter(), "tagged": 0}
        )
        drunk = drink_stats.get(product_id, {})
        row = existing.get(product_id)
        if row is None:
            row = BeerRanking(product_id=product_id, computed_at=now)
            to_create.append(row)
        else:
            to_update.append(row)
        if row.week_start != monday:
            row.last_week_rank = row.rank if row.week_start == monday - timedelta(days=7) else None
            row.week_start = monday
        row.rank = ranks.get(product_id)
        row.rating_count = len(stats["ratings"])
        row.rating_avg = sum(stats["ratings"]) / row.rating_count if row.rating_count else None
        row.stars = stats["stars"]
        row.tag_counts = dict(stats["tags"])
        row.tagged_count = stats["tagged"]
        settled, chosen = settled_style(votes_per_product.get(product_id, Counter()))
        row.style_settled = settled
        row.styles = chosen if settled else classify_styles(product.name, [])
        row.drunk_total = drunk.get("total", 0)
        row.drinkers = drunk.get("people", 0)
        row.drunk_week = drunk.get("week", 0)
        row.computed_at = now

    with transaction.atomic():
        BeerRanking.objects.exclude(product_id__in=products).delete()
        BeerRanking.objects.bulk_create(to_create, batch_size=500)
        BeerRanking.objects.bulk_update(
            to_update,
            [
                "rank",
                "last_week_rank",
                "week_start",
                "rating_count",
                "rating_avg",
                "stars",
                "tag_counts",
                "tagged_count",
                "styles",
                "style_settled",
                "drunk_total",
                "drinkers",
                "drunk_week",
                "computed_at",
            ],
            batch_size=500,
        )
    _refresh_region_rankings(
        now, region_ratings, set(products), {pid: p.name for pid, p in products.items()}
    )
    return len(ranks)


def _refresh_region_rankings(
    now: datetime,
    region_ratings: dict[tuple[str, int, int], float],
    product_ids: set[int],
    names: dict[int, str],
) -> None:
    """Rebuild ``BeerRegionRanking`` from ratings and drinks at pubs in each region."""

    per: dict[tuple[str, int], dict] = {}

    def entry(region: str, product_id: int) -> dict:
        return per.setdefault((region, product_id), {"ratings": [], "stars": [0] * 5, "drunk": 0})

    for (region, _, product_id), rating in region_ratings.items():
        if product_id in product_ids:
            row = entry(region, product_id)
            row["ratings"].append(rating)
            row["stars"][5 - _star(rating)] += 1
    drinks = (
        DrinkLog.objects.filter(
            drink_type=DrinkLog.DrinkType.BEER,
            is_suspect=False,
            beer_product__isnull=False,
            account__status=Account.Status.ACTIVE,
            cache_key__isnull=False,
        )
        .order_by()
        .values("beer_product_id", "cache_key")
        .annotate(total=Count("id"))
    )
    for row in drinks.iterator(chunk_size=2000):
        region = region_of_cell(row["cache_key"])
        if region and row["beer_product_id"] in product_ids:
            entry(region, row["beer_product_id"])["drunk"] += row["total"]

    by_region: dict[str, list[tuple[int, float, int]]] = {}
    for (region, product_id), row in per.items():
        if row["ratings"]:
            by_region.setdefault(region, []).append(
                (product_id, sum(row["ratings"]) / len(row["ratings"]), len(row["ratings"]))
            )
    ranks: dict[tuple[str, int], int] = {}
    for region, rated in by_region.items():
        # Same rule as the national ranking: a stricter bar once enough beers clear it.
        min_raters = RANKING_MIN_RATERS
        if sum(1 for _, _, count in rated if count >= RANKING_MIN_RATERS) < EARLY_UNTIL_BEERS:
            min_raters = EARLY_MIN_RATERS
        qualified = sorted(
            (item for item in rated if item[2] >= min_raters),
            key=lambda item: (-item[1], -item[2], names.get(item[0], "")),
        )
        for index, (product_id, _, _) in enumerate(qualified):
            ranks[(region, product_id)] = index + 1

    rows = [
        BeerRegionRanking(
            product_id=product_id,
            region=region,
            rating_avg=sum(row["ratings"]) / len(row["ratings"]) if row["ratings"] else None,
            rating_count=len(row["ratings"]),
            stars=row["stars"],
            rank=ranks.get((region, product_id)),
            drunk_total=row["drunk"],
            computed_at=now,
        )
        for (region, product_id), row in per.items()
    ]
    with transaction.atomic():
        BeerRegionRanking.objects.all().delete()
        BeerRegionRanking.objects.bulk_create(rows, batch_size=500)


def star_shares(row: BeerRanking | BeerRegionRanking | None) -> list[float]:
    stars = (
        list(row.stars)
        if row is not None and isinstance(row.stars, list) and len(row.stars) == 5
        else [0] * 5
    )
    total = sum(stars)
    return [round(count / total, 3) if total else 0.0 for count in stars]


def tag_shares(row: BeerRanking | None) -> dict[str, int]:
    if row is None or not row.tagged_count:
        return {}
    counts = row.tag_counts if isinstance(row.tag_counts, dict) else {}
    return {
        tag: round(100 * counts[tag] / row.tagged_count)
        for tag in sorted(counts, key=lambda tag: (-counts[tag], BEER_CHECKIN_TAGS.index(tag)))
        if tag in BEER_CHECKIN_TAGS and counts[tag]
    }


def top_tag(row: BeerRanking | None) -> str | None:
    return next(iter(tag_shares(row)), None)


def move(row: BeerRanking) -> int | None:
    if row.rank is None or row.last_week_rank is None:
        return None
    return row.last_week_rank - row.rank


def ranking_item(row: BeerRanking, position: int | None = None) -> dict:
    product = row.product
    return {
        "product_key": product.key,
        "name": product.name,
        "brand_name": product.brand_name,
        "styles": row.styles or [],
        "rating_avg": round(row.rating_avg, 2) if row.rating_avg is not None else None,
        "rating_count": row.rating_count,
        "rank": row.rank,
        "position": position,
        "move": move(row),
        "stars": star_shares(row),
        "top_tag": top_tag(row),
        "drunk_total": row.drunk_total,
    }


def regional_item(row: BeerRegionRanking, position: int | None = None) -> dict:
    """A ranking row with the region's own numbers; style and tags stay national."""
    national = getattr(row.product, "ranking", None)
    item = (
        ranking_item(national, position)
        if national is not None
        else {
            "product_key": row.product.key,
            "name": row.product.name,
            "brand_name": row.product.brand_name,
            "styles": [],
            "top_tag": None,
        }
    )
    item.update(
        {
            "rating_avg": round(row.rating_avg, 2) if row.rating_avg is not None else None,
            "rating_count": row.rating_count,
            "rank": row.rank,
            "position": position,
            "move": None,
            "stars": star_shares(row),
            "drunk_total": row.drunk_total,
        }
    )
    return item


def _distance_m(lat: float, lng: float, other_lat: float, other_lng: float) -> int:
    d_lat = math.radians(other_lat - lat)
    d_lng = math.radians(other_lng - lng)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat)) * math.cos(math.radians(other_lat)) * math.sin(d_lng / 2) ** 2
    )
    return round(2 * 6_371_000 * math.asin(math.sqrt(h)))


def pouring_pubs(
    product_ids, lat: float | None = None, lng: float | None = None
) -> dict[int, dict]:
    """Per product: how many pubs pour it now and, with a location, the nearest one."""

    from pubs.api.views import _globally_reported_pub_cache_keys

    links = list(
        PubBeerProduct.objects.filter(
            product_id__in=list(product_ids),
            active=True,
            last_seen_at__gte=timezone.now() - timedelta(days=POURING_FRESH_DAYS),
        ).values_list(
            "product_id", "cache_key", "name", "lat", "lng", "last_price_czk", "last_volume_ml"
        )
    )
    hidden = _globally_reported_pub_cache_keys({link[1] for link in links})
    result: dict[int, dict] = {}
    for product_id, cache_key, name, pub_lat, pub_lng, price, volume in links:
        if cache_key in hidden:
            continue
        row = result.setdefault(product_id, {"keys": set(), "nearest": None})
        row["keys"].add(cache_key)
        if lat is None or lng is None:
            continue
        distance = _distance_m(lat, lng, pub_lat, pub_lng)
        nearest = row["nearest"]
        if nearest is None or distance < nearest["distance_m"]:
            row["nearest"] = {
                "cache_key": cache_key,
                "name": name,
                "lat": pub_lat,
                "lng": pub_lng,
                "distance_m": distance,
                "price_czk": price,
                "volume_ml": volume,
            }
    return {
        product_id: {"count": len(row["keys"]), "nearest": row["nearest"]}
        for product_id, row in result.items()
    }

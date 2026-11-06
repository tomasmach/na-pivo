"""What the public pub pages read: the catalogue by city, one pub, and search.

Every pub here is one anybody already sees on the app's map. The pages show
community data (menu, prices, hours, garden) and aggregates of public beer
ratings. They never show who was in a pub or when, and they never read the
Firmy.cz enrichment (its hours and ratings stay inside the app).
"""

from __future__ import annotations

import re
import statistics
import unicodedata
import uuid
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.db.models import Avg, Count
from django.utils import timezone
from django.utils.text import slugify

from pubs.api.pub_beers_views import (
    _merged_aliases,
    _public_pub_directory,
    city_name,
    weekly_pub_beers,
)
from pubs.api.views import _globally_reported_pub_cache_keys, _with_pub_name_corrections
from pubs.beer_catalog import suggest_beers
from pubs.enrichment import names_match
from pubs.identity import normalize_pub_name, pub_identity_key
from pubs.models import (
    Account,
    BeerCheckIn,
    BeerPage,
    BeerProduct,
    BeerRanking,
    CanonicalPub,
    PubAmenity,
    PubBeerBrand,
    PubCommunityData,
    PubDirectory,
    PubHours,
    PubNameCorrection,
    PubPriceIndex,
    PubPriceSnapshot,
    PubReport,
    UserAddedPub,
)
from pubs.price_index import compute_reference_price
from pubs.price_map import WINDOW_DAYS, city_slug, prague_district
from pubs.pub_events import PubEvent
from pubs.web.places import municipality

PRAGUE = ZoneInfo("Europe/Prague")
CATALOGUE_TTL = 60 * 60
CITY_TTL = 10 * 60
PUB_TTL = 10 * 60
SEARCH_TTL = 5 * 60
# An average of fewer people says more about them than about the pub or beer.
MIN_RATERS = 3
DAY_KEYS = ("mo", "tu", "we", "th", "fr", "sa", "su")
_KEY = re.compile(r"^(?:([a-z0-9-]{1,80})-)?([0-9b-hjkmnp-z]{8})$")
_TIME = re.compile(r"^([01]\d|2[0-4]):([0-5]\d)$")
_CHUNK = 500
_GARDEN = "seating_garden"
# Price sources people entered in the app. Imported third-party menus stay in the app, as on /ceny.
_PRICE_SOURCES = (PubPriceIndex.Source.COMMUNITY, PubPriceIndex.Source.DRINK)


def fold(text: str) -> str:
    """Lower case without diacritics, so "plzen" finds Plzeň."""

    ascii_text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text.casefold()))


def pub_key(name: str, cache_key: str) -> str:
    """The address of a pub page: its name for people, its geohash cell for us."""

    slug = slugify(name)[:60].strip("-")
    return f"{slug}-{cache_key}" if slug else cache_key


def parse_pub_key(key: str) -> tuple[str, str] | None:
    """(slug, cache_key) of a pub address, or None when it is not one."""

    match = _KEY.match((key or "").lower())
    return (match.group(1) or "", match.group(2)) if match else None


def town_name(raw_city: str) -> str:
    """The city a pub page and its list go under: Praha for "Praha 2", Louny for the post office "Louny 1"."""

    return municipality(city_name(raw_city))


def merged_city(slug: str) -> str:
    """The town a post office address like /hospody/louny-1 now lives at, or "" when it is not one."""

    return catalogue()["merged"].get(slug, "")


def district_name(raw_city: str) -> str:
    """Praha 2, Brno-střed: the part of a city the catalogue names, if it names one."""

    city = " ".join((raw_city or "").split())
    if city_name(city) == "Praha":
        return prague_district(city)
    return city if city and city_name(city) != city else ""


def _chunks(keys, size: int = _CHUNK):
    keys = list(keys)
    for start in range(0, len(keys), size):
        yield keys[start:start + size]


# ---------- catalogue ----------


def _build_catalogue() -> dict:
    rows: dict[tuple[str, str], dict] = {}

    def add(cache_key, name, raw_city, lat, lng, address=""):
        name = " ".join((name or "").split())
        if not name or not cache_key:
            return
        rows.setdefault(
            (cache_key, normalize_pub_name(name)),
            {"k": cache_key, "n": name, "raw": raw_city or "", "lat": lat, "lng": lng, "a": address or ""},
        )

    for row in CanonicalPub.objects.filter(active=True).values_list("cache_key", "name", "city", "lat", "lng"):
        add(*row)
    for row in (
        _public_pub_directory()
        .filter(discovery_kind=PubDirectory.DiscoveryKind.PUB)
        .values_list("cache_key", "name", "city", "lat", "lng")
    ):
        add(*row)
    for row in UserAddedPub.objects.filter(active=True).values_list("cache_key", "name", "city", "lat", "lng", "address"):
        add(*row)

    # Both lists are short, so only the pubs they touch go into the per-pub checks.
    reported = set(PubReport.objects.filter(active=True).values_list("cache_key", flat=True).distinct())
    hidden = _globally_reported_pub_cache_keys({key for key, _ in rows} & reported)
    corrected = set(PubNameCorrection.objects.filter(active=True).values_list("cache_key", flat=True))
    pubs = [pub for pub in rows.values() if pub["k"] not in hidden]
    to_correct = [pub for pub in pubs if pub["k"] in corrected]
    if to_correct:
        fixed = _with_pub_name_corrections(
            [{"name": pub["n"], "position": {"lat": pub["lat"], "lon": pub["lng"]}} for pub in to_correct]
        )
        for pub, item in zip(to_correct, fixed, strict=True):
            pub["n"] = item["name"]

    spellings: dict[str, Counter] = defaultdict(Counter)
    districts: dict[str, Counter] = defaultdict(Counter)
    # The address a town would have under its post office name ("louny-1"), leading to the town.
    merged: dict[str, str] = {}
    for pub in pubs:
        city = town_name(pub["raw"])
        pub["c"] = city_slug(city) if city else ""
        if pub["c"] and (posted := city_slug(city_name(pub["raw"]))) != pub["c"]:
            merged[posted] = pub["c"]
        pub["d"] = district_name(pub["raw"])
        pub["f"] = fold(f"{pub['n']} {city} {pub['d']}")
        if pub["c"]:
            spellings[pub["c"]][city] += 1
            if pub["d"]:
                districts[pub["c"]][pub["d"]] += 1
    cities = {
        slug: {
            "slug": slug,
            "name": counter.most_common(1)[0][0],
            "pubs": sum(counter.values()),
            "districts": dict(districts[slug]),
        }
        for slug, counter in spellings.items()
    }
    return {"pubs": pubs, "cities": cities, "merged": {old: new for old, new in merged.items() if old not in cities}}


# The catalogue itself stays in this process: unpickling ~28 000 pubs from the
# cache took ~18 ms per read. The cache only holds which build is current.
_built: dict = {"stamp": None, "data": None}


def catalogue() -> dict:
    """Every public pub with its city, plus the cities. One build an hour for all pages."""

    stamp = cache.get("web:pubs:catalogue")
    if stamp is None or stamp != _built["stamp"]:
        stamp = uuid.uuid4().hex
        _built.update(stamp=stamp, data=_build_catalogue())
        cache.set("web:pubs:catalogue", stamp, CATALOGUE_TTL)
    return _built["data"]


def cities_by_size() -> list[dict]:
    return sorted(catalogue()["cities"].values(), key=lambda city: (-city["pubs"], city["name"]))


# ---------- opening hours ----------


def _minutes(value: str) -> int | None:
    match = _TIME.match(value) if isinstance(value, str) else None
    if not match:
        return None
    minutes = int(match.group(1)) * 60 + int(match.group(2))
    return minutes if minutes <= 24 * 60 else None


def valid_hours(hours_json) -> dict | None:
    """Community hours as {day: [(open, close)]} in minutes, or None when unusable.

    A closing time at or before the opening time is after midnight.
    """

    if not isinstance(hours_json, dict):
        return None
    week: dict[str, list[tuple[int, int]]] = {}
    for day in DAY_KEYS:
        spans = hours_json.get(day)
        if not isinstance(spans, list):
            return None
        week[day] = []
        for span in spans:
            if not isinstance(span, (list, tuple)) or len(span) != 2:
                return None
            start, end = _minutes(span[0]), _minutes(span[1])
            if start is None or end is None:
                return None
            week[day].append((start, end if end > start else end + 24 * 60))
    return week if any(week.values()) else None


def open_state(week: dict | None, now: datetime | None = None) -> dict | None:
    """Open until when, or when it opens next, in Prague time. None without hours."""

    if not week:
        return None
    now = timezone.localtime(now or timezone.now(), PRAGUE)
    today = now.date()
    intervals = []
    for offset in range(-1, 8):
        day = today + timedelta(days=offset)
        midnight = datetime.combine(day, time.min, tzinfo=PRAGUE)
        for start, end in week[DAY_KEYS[day.weekday()]]:
            intervals.append((midnight + timedelta(minutes=start), midnight + timedelta(minutes=end)))
    intervals.sort()
    for start, end in intervals:
        if start <= now < end:
            # Back-to-back spans (23:00–24:00 then 00:00–02:00) are one evening.
            for next_start, next_end in intervals:
                if next_start == end:
                    end = next_end
            return {"open": True, "until": end}
    upcoming = next((start for start, _ in intervals if start > now), None)
    return {"open": False, "opens": upcoming, "now": now}


# ---------- city ----------


def _community(keys) -> dict[str, dict]:
    rows = {}
    for chunk in _chunks(keys):
        for row in PubCommunityData.objects.filter(cache_key__in=chunk).values(
            "cache_key", "name", "hours_json", "beers", "beers_updated_at", "hours_updated_at"
        ):
            rows[row["cache_key"]] = row
    return rows


def _prices(keys) -> dict[str, dict]:
    since = timezone.now() - timedelta(days=WINDOW_DAYS)
    rows = {}
    for chunk in _chunks(keys):
        for row in PubPriceIndex.objects.filter(
            cache_key__in=chunk, active=True, observed_at__gte=since, source__in=_PRICE_SOURCES
        ).values("cache_key", "name", "price_czk", "volume_ml", "observed_at"):
            rows[row["cache_key"]] = row
    return rows


def _brands(keys) -> dict[str, list[tuple[str, str, str]]]:
    rows: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for chunk in _chunks(keys):
        for key, name, brand_key, brand_name in PubBeerBrand.objects.filter(
            cache_key__in=chunk, active=True
        ).values_list("cache_key", "name", "brand_key", "brand_name"):
            rows[key].append((name, brand_key, brand_name))
    return rows


def _gardens(keys) -> set[str]:
    found = set()
    for chunk in _chunks(keys):
        found.update(
            PubAmenity.objects.filter(
                cache_key__in=chunk, amenity_key=_GARDEN, status=PubAmenity.Status.YES
            ).values_list("pub_identity_key", flat=True)
        )
    return found


def _public_checkins():
    """Beer ratings people made public, from accounts the beer pages would show."""

    return BeerCheckIn.objects.filter(
        visibility=BeerCheckIn.Visibility.PUBLIC,
        rating__isnull=False,
        account__status=Account.Status.ACTIVE,
        account__ghost_mode=False,
        account__ugc_terms_accepted_at__isnull=False,
        account__nickname__isnull=False,
    ).exclude(account__nickname="").exclude(pub_cache_key="")


def _ratings(keys) -> dict[str, list[tuple[str, float, int, int]]]:
    """Average public beer rating per pub cell and the name it was given, per name."""

    rows: dict[str, list[tuple[str, float, int, int]]] = defaultdict(list)
    for chunk in _chunks(keys):
        for row in (
            _public_checkins()
            .filter(pub_cache_key__in=chunk)
            .values("pub_cache_key", "pub_name")
            .annotate(avg=Avg("rating"), raters=Count("account", distinct=True), ratings=Count("id"))
            .order_by()
        ):
            rows[row["pub_cache_key"]].append((row["pub_name"], float(row["avg"]), row["raters"], row["ratings"]))
    return rows


def _rating_for(name: str, rows) -> tuple[float, int, int] | None:
    """(average, people, ratings) of the rows that name this pub."""

    matching = [(avg, people, ratings) for pub_name, avg, people, ratings in rows if names_match(pub_name, name)]
    people = sum(row[1] for row in matching)
    ratings = sum(row[2] for row in matching)
    if people < MIN_RATERS:
        return None
    return round(sum(avg * count for avg, _, count in matching) / ratings, 1), people, ratings


def half_litre(price: int, volume: int | None) -> float:
    return price * 500 / (volume or 500)


def _menu_rows(beers) -> list[dict]:
    rows = []
    for beer in beers if isinstance(beers, list) else []:
        if not isinstance(beer, dict) or not isinstance(beer.get("name"), str) or not beer["name"].strip():
            continue
        price, volume = beer.get("price_czk"), beer.get("volume_ml")
        rows.append({
            "name": beer["name"].strip()[:120],
            "price": price if isinstance(price, int) and not isinstance(price, bool) and price > 0 else None,
            "volume": volume if isinstance(volume, int) and not isinstance(volume, bool) and volume > 0 else None,
        })
    return rows[:30]


def _menu_price(menu: dict | None) -> tuple[int, int | None] | None:
    """The cheapest beer of the menu the page shows, picked by the price index's rule.

    A beer logged with a price lands in the menu, but the index keeps an older menu
    price until the menu is edited, so the index alone can disagree with the menu.
    """

    since = timezone.now() - timedelta(days=WINDOW_DAYS)
    if not menu or not menu["beers_updated_at"] or menu["beers_updated_at"] < since:
        return None
    return compute_reference_price(
        [{"price_czk": row["price"], "volume_ml": row["volume"]} for row in _menu_rows(menu["beers"])]
    )


def _enrich(pubs: list[dict]) -> list[dict]:
    """Menu, price, brands, garden and rating of each pub, guarded by name per cell."""

    keys = {pub["k"] for pub in pubs}
    community, prices, brands = _community(keys), _prices(keys), _brands(keys)
    gardens, ratings = _gardens(keys), _ratings(keys)
    out = []
    for pub in pubs:
        key, name = pub["k"], pub["n"]
        menu = community.get(key)
        if menu and not names_match(menu["name"], name):
            menu = None
        price = prices.get(key)
        if price and not names_match(price["name"], name):
            price = None
        beers = _menu_rows(menu["beers"]) if menu else []
        cheapest = _menu_price(menu) or ((price["price_czk"], price["volume_ml"]) if price else None)
        rating = _rating_for(name, ratings.get(key, []))
        out.append({
            "key": pub_key(name, key),
            "cache_key": key,
            "name": name,
            "district": pub["d"],
            "city_slug": pub["c"],
            "address": pub["a"],
            "lat": pub["lat"],
            "lng": pub["lng"],
            "hours": valid_hours(menu["hours_json"]) if menu else None,
            "beers": [beer["name"] for beer in beers],
            "tank": any("tank" in fold(beer["name"]) for beer in beers),
            "price": cheapest[0] if cheapest else None,
            "volume": (cheapest[1] or 500) if cheapest else None,
            "brands": sorted({b_key for b_name, b_key, _ in brands.get(key, []) if names_match(b_name, name)}),
            "brand_names": {b_key: label for b_name, b_key, label in brands.get(key, []) if names_match(b_name, name)},
            "garden": pub_identity_key(key, name) in gardens,
            "rating": rating[0] if rating else None,
            "raters": rating[1] if rating else 0,
            "ratings": rating[2] if rating else 0,
            "changed_at": max(
                (at for at in (
                    menu and menu["beers_updated_at"], menu and menu["hours_updated_at"], price and price["observed_at"],
                ) if at),
                default=None,
            ),
        })
    return out


def city_pubs(slug: str) -> dict | None:
    """All pubs of one city with what the list and filters need, or None for an unknown city."""

    city = catalogue()["cities"].get(slug)
    if city is None:
        return None
    cache_key = f"web:pubs:city:{slug}"
    data = cache.get(cache_key)
    if data is None:
        pubs = _enrich([pub for pub in catalogue()["pubs"] if pub["c"] == slug])
        brand_counts: Counter = Counter()
        brand_names: dict[str, str] = {}
        for pub in pubs:
            brand_counts.update(pub["brands"])
            brand_names.update(pub.pop("brand_names"))
        priced = [half_litre(pub["price"], pub["volume"]) for pub in pubs if pub["price"]]
        data = {
            **city,
            "list": pubs,
            "typical_price": round(statistics.median(priced)) if len(priced) >= MIN_RATERS else None,
            "brands": [
                {"key": key, "name": brand_names[key], "pubs": count}
                for key, count in brand_counts.most_common(12)
            ],
        }
        cache.set(cache_key, data, CITY_TTL)
    return data


# ---------- one pub ----------


def _candidates(cache_key: str) -> list[dict]:
    """Pubs the map shows in this cell, the catalogue first, as the old /h/ page resolved them."""

    found = [pub for pub in catalogue()["pubs"] if pub["k"] == cache_key]
    if found:
        return found
    # A pub somebody filled in that the catalogue does not know yet, unless the community hid it.
    if _globally_reported_pub_cache_keys({cache_key}):
        return []
    for model in (PubCommunityData, PubHours):
        rows = model.objects.filter(cache_key=cache_key)
        if model is PubHours:
            rows = rows.exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
        row = rows.values("name", "city", "lat", "lng").first()
        if row and row["name"]:
            return [{
                "k": cache_key, "n": row["name"], "raw": row["city"] or "", "lat": row["lat"], "lng": row["lng"],
                "a": "", "c": city_slug(town_name(row["city"] or "")), "d": district_name(row["city"] or ""),
            }]
    return []


def _beer_ratings(cache_key: str, name: str) -> list[dict]:
    """Public ratings of each beer at this pub: average, how many people, the newest note.

    No names and no dates, so the page never says who was here when.
    """

    rows = list(
        _public_checkins()
        .filter(pub_cache_key=cache_key)
        .values("pub_name", "beer_key", "beer_name", "account_id", "rating", "note", "checked_in_at")
        .order_by("-checked_in_at")[:2000]
    )
    beers: dict[str, dict] = {}
    for row in rows:
        if not names_match(row["pub_name"], name):
            continue
        beer = beers.setdefault(row["beer_key"], {"name": row["beer_name"], "ratings": [], "people": set(), "note": ""})
        beer["ratings"].append(float(row["rating"]))
        beer["people"].add(row["account_id"])
        note = " ".join((row["note"] or "").split())
        if note and not beer["note"]:
            beer["note"] = note if len(note) <= 140 else note[:139].rstrip() + "…"
    rated = [
        {
            "name": beer["name"],
            "rating": round(statistics.mean(beer["ratings"]), 1),
            "count": len(beer["ratings"]),
            "note": beer["note"],
        }
        for beer in beers.values()
        if len(beer["people"]) >= MIN_RATERS
    ]
    return sorted(rated, key=lambda beer: (-beer["count"], beer["name"]))[:8]


def _neighbours(pub: dict) -> list[tuple[float, float]]:
    lat, lng = pub["lat"], pub["lng"]
    return [
        (row["lat"], row["lng"])
        for row in catalogue()["pubs"]
        if abs(row["lat"] - lat) < 0.006 and abs(row["lng"] - lng) < 0.009 and row is not pub
    ]


def find_pub(key: str) -> dict:
    """Resolve a pub address.

    Returns {"pub": ...} for a page, {"redirect": key} when the address has a
    newer form (another slug, a merged duplicate), or {} when there is no pub.
    """

    parsed = parse_pub_key(key)
    if parsed is None:
        return {}
    slug, cache_key = parsed
    candidates = _candidates(cache_key)
    if not candidates:
        target = _merged_aliases().filter(cache_key=cache_key).values("canonical_pub__cache_key", "canonical_pub__name").first()
        if target:
            return {"redirect": pub_key(target["canonical_pub__name"], target["canonical_pub__cache_key"])}
        return {}
    chosen = next((pub for pub in candidates if slugify(pub["n"])[:60].strip("-") == slug), None)
    if chosen is None:
        return {"redirect": pub_key(candidates[0]["n"], cache_key)}
    canonical = pub_key(chosen["n"], cache_key)
    if canonical != key:
        return {"redirect": canonical}
    return {"pub": pub_detail(chosen)}


def pub_key_for_hint(cache_key: str, name_hint: str) -> str | None:
    """The page of the pub an old /h/ link meant, picked by the name it carried."""

    candidates = _candidates(cache_key)
    if not candidates:
        return None
    hint = normalize_pub_name(name_hint)
    chosen = next((pub for pub in candidates if hint and normalize_pub_name(pub["n"]) == hint), candidates[0])
    return pub_key(chosen["n"], cache_key)


def pub_detail(pub: dict) -> dict:
    """Everything the pub page shows that does not change with the clock, cached."""

    cache_name = f"web:pubs:pub:{pub['k']}:{slugify(pub['n'])[:60]}"
    data = cache.get(cache_name)
    if data is None:
        base = _enrich([pub])[0]
        menu = PubCommunityData.objects.filter(cache_key=pub["k"]).values("name", "beers", "beers_updated_at").first()
        if menu and not names_match(menu["name"], pub["n"]):
            menu = None
        city = catalogue()["cities"].get(pub["c"])
        data = {
            **base,
            "city": city["name"] if city else city_name(pub["raw"]),
            "city_slug": pub["c"] if city else "",
            "menu": _menu_rows(menu["beers"]) if menu else [],
            "menu_updated_at": menu["beers_updated_at"] if menu else None,
            "beer_ratings": _beer_ratings(pub["k"], pub["n"]),
            "week_beers": weekly_pub_beers()["pubs"].get(pub["k"]),
            "neighbours": _neighbours(pub),
        }
        cache.set(cache_name, data, PUB_TTL)
    return data


def todays_event(cache_key: str, now: datetime | None = None) -> dict | None:
    """A verified community event in this pub later today, if there is one."""

    now = timezone.localtime(now or timezone.now(), PRAGUE)
    end_of_day = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=PRAGUE)
    event = (
        PubEvent.objects.filter(
            cache_key=cache_key, status=PubEvent.Status.VERIFIED, ends_at__gt=now, starts_at__lt=end_of_day
        )
        .order_by("starts_at")
        .values("title", "starts_at")
        .first()
    )
    return event


# ---------- search ----------


def _pub_hits(tokens: list[str]) -> list[dict]:
    pubs = catalogue()["pubs"]
    hits = [pub for pub in pubs if all(token in pub["f"] for token in tokens)]
    phrase = " ".join(tokens)

    def rank(pub):
        name = fold(pub["n"])
        return (0 if name.startswith(phrase) else 1 if phrase in name else 2, len(name), name)

    return sorted(hits, key=rank)


def _similar_pubs(tokens: list[str]) -> list[dict]:
    """Pubs sharing the start of a longer word, for a search that found nothing."""

    stems = [token[:4] for token in tokens if len(token) >= 4]
    if not stems:
        return []
    scored = []
    for pub in catalogue()["pubs"]:
        name = fold(pub["n"])
        score = sum(1 for stem in stems if stem in name)
        if score:
            scored.append((-score, len(name), name, pub))
    scored.sort(key=lambda item: item[:3])
    return [item[3] for item in scored[:3]]


def _beer_hits(query: str) -> list[dict]:
    """The beers /v1/beers/search would suggest, with their national rating and page."""

    suggestions = [item for item in suggest_beers(query, limit=8) if item.kind == "product"]
    keys = [item.slug for item in suggestions]
    rankings = {
        key: (avg, count)
        for key, avg, count in BeerRanking.objects.filter(product__key__in=keys).values_list(
            "product__key", "rating_avg", "rating_count"
        )
    }
    pages = {
        key: data
        for key, data in BeerPage.objects.filter(kind=BeerPage.Kind.BEER, key__in=keys).values_list("key", "data")
    }
    hits = []
    for item in suggestions:
        avg, count = rankings.get(item.slug, (None, 0))
        page = pages.get(item.slug)
        hits.append({
            "key": item.slug,
            "name": item.name,
            "brand": item.brand_name,
            "rating": round(avg, 1) if avg is not None and count >= MIN_RATERS else None,
            "ratings": count,
            "pubs": page.get("pubs") if page else None,
            "has_page": page is not None,
        })
    return hits


def _city_hits(tokens: list[str]) -> list[dict]:
    snapshot = PubPriceSnapshot.objects.only("data").first()
    medians = {city_slug(area["name"]): area["median"] for area in (snapshot.data.get("cities", []) if snapshot else [])}
    hits = []
    for city in cities_by_size():
        if all(token in fold(city["name"]) for token in tokens):
            hits.append({"name": city["name"], "slug": city["slug"], "district": "", "pubs": city["pubs"],
                         "median": medians.get(city["slug"])})
        for district, count in sorted(city["districts"].items(), key=lambda item: -item[1]):
            if all(token in fold(f"{city['name']} {district}") for token in tokens) and district != city["name"]:
                hits.append({"name": district, "slug": city["slug"], "district": district, "pubs": count, "median": None})
    return hits[:8]


def search(query: str) -> dict:
    """Pubs, beers and cities for one query, accents ignored. Cached per query."""

    tokens = fold(query).split()[:8]
    if not tokens:
        return {"pubs": [], "beers": [], "cities": [], "similar": []}
    cache_name = "web:pubs:search:" + "-".join(tokens)[:200]
    data = cache.get(cache_name)
    if data is None:
        pubs = _pub_hits(tokens)
        data = {
            "pubs_total": len(pubs),
            "pubs": _enrich(pubs[:50]),
            "beers": _beer_hits(" ".join(tokens)),
            "cities": _city_hits(tokens),
        }
        if not (pubs or data["beers"] or data["cities"]):
            data["similar"] = _enrich(_similar_pubs(tokens))
        cache.set(cache_name, data, SEARCH_TTL)
    return data


def search_counts() -> dict:
    """How much the search looked through, for the empty result."""

    data = cache.get("web:pubs:search-counts")
    if data is None:
        data = {
            "pubs": len(catalogue()["pubs"]),
            "beers": BeerProduct.objects.filter(active=True, brand__active=True).count(),
            "cities": len(catalogue()["cities"]) + sum(len(c["districts"]) for c in catalogue()["cities"].values()),
        }
        cache.set("web:pubs:search-counts", data, CATALOGUE_TTL)
    return data


# Below this a town's page lists too few pubs to stand on its own in search results.
MIN_INDEXED_CITY_PUBS = 3


def has_content(pub: dict) -> bool:
    """Whether a pub page has something to read: a menu or a price. Decides the sitemap and noindex alike."""

    return bool(pub["beers"]) or pub["price"] is not None


def city_indexed(city: dict) -> bool:
    """A town page is indexed with enough pubs and at least one with content, decides the sitemap and noindex alike."""

    return city["pubs"] >= MIN_INDEXED_CITY_PUBS and city["slug"] in _indexed()["cities"]


def indexed_pubs() -> dict[str, datetime | None]:
    """Address key of every pub page with content, and when its menu, hours or price last changed."""

    return _indexed()["pubs"]


def _indexed() -> dict:
    data = cache.get("web:pubs:indexed")
    if data is None:
        with_data = set(PubCommunityData.objects.exclude(beers=[]).values_list("cache_key", flat=True)) | set(
            PubPriceIndex.objects.filter(active=True, source__in=_PRICE_SOURCES).values_list("cache_key", flat=True)
        )
        rows = _enrich([pub for pub in catalogue()["pubs"] if pub["k"] in with_data])
        # Two spellings of one name in a cell share an address. Like find_pub, the first one is the page.
        pubs, cities, seen = {}, set(), set()
        for row in rows:
            if row["key"] in seen:
                continue
            seen.add(row["key"])
            if has_content(row):
                pubs[row["key"]] = row["changed_at"]
                cities.add(row["city_slug"])
        data = {"pubs": pubs, "cities": cities}
        cache.set("web:pubs:indexed", data, CATALOGUE_TTL)
    return data

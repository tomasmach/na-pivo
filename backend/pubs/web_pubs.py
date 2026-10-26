"""Pubs with their own page on na-pivo.cz: the search at /hospody and one page per pub.

The daily run next to the price map rebuilds the ``WebPub`` rows under the rules the
beer pages use: a beer counts only when someone confirmed it at the pub within a
year, ghost mode and missing consent keep a write out, and reported pubs stay out.
The pages show only what people wrote in Na pivo, never the Firmy.cz hours or ratings.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.text import slugify

from pubs.api.pub_beers_views import city_name
from pubs.beer_catalog import BeerCatalogMatchCache, match_beer
from pubs.beer_pages import _serving, confirmed_menus
from pubs.discovery import normalize_discovery_text
from pubs.enrichment import names_match
from pubs.models import AmenityKind, PubAmenity, PubCommunityData, PubEvent, WebPub
from pubs.price_index import compute_reference_price
from pubs.price_map import FRESH_DAYS, prague_district

# Amenity keys and the words their filters and guides use in addresses.
AMENITY_SLUGS = {
    "seating_garden": "zahradka",
    "game_darts": "sipky",
    "payment_card": "platba-kartou",
    "seating_barrier_free": "bezbarierove",
    "practical_tank_beer": "tankove-pivo",
    "game_billiards": "kulecnik",
    "game_foosball": "fotbalek",
    "atmosphere_sports_tv": "sport-v-televizi",
    "practical_wifi": "wifi",
    "practical_parking": "parkovani",
    "atmosphere_smoking": "kuracka",
}
# A guide like /hospody/brno/zahradka exists once this many listed pubs match it.
GUIDE_MIN_PUBS = 5
# "Near me" looks this far around the visitor before it widens.
NEAR_KM = (3, 10, 30)
NEAR_MIN_RESULTS = 10
PAGE_SIZE = 40
MAX_PINS = 600
SORTS = ("price", "distance", "confirmed")
EVENT_DAYS = 30


def _beer_key(name) -> str | None:
    key = " ".join(str(name or "").split()).casefold()
    return key or None


def _amenities(cache_keys: list[str], names: dict[str, list[str]]) -> dict[str, dict[str, dict]]:
    """Facts people agree on, per pub cell: the same confidence the app's map filter needs."""

    floor = min(1.0, float(settings.MAP_AMENITY_CONFIDENCE_FLOOR))
    active = set(AmenityKind.objects.filter(active=True).values_list("key", flat=True))
    found: dict[str, dict[str, dict]] = defaultdict(dict)
    for start in range(0, len(cache_keys), 500):
        rows = PubAmenity.objects.filter(
            cache_key__in=cache_keys[start:start + 500],
            status__in=[PubAmenity.Status.YES, PubAmenity.Status.NO],
            confidence__gte=floor,
        ).values_list("cache_key", "name", "amenity_key", "status", "distinct_voter_count")
        for cache_key, name, key, status, voters in rows:
            if key in active and any(names_match(name, known) for known in names.get(cache_key, [])):
                found[cache_key][key] = {"status": status, "voters": voters}
    return found


def _hours(cache_keys: list[str], names: dict[str, list[str]]) -> dict[str, dict]:
    """Opening hours people wrote in the app. Firmy.cz hours never reach the web."""

    hours: dict[str, dict] = {}
    for start in range(0, len(cache_keys), 500):
        rows = PubCommunityData.objects.filter(
            cache_key__in=cache_keys[start:start + 500], hours_json__isnull=False
        ).values_list("cache_key", "name", "hours_json")
        for cache_key, name, week in rows:
            if isinstance(week, dict) and any(names_match(name, known) for known in names.get(cache_key, [])):
                hours[cache_key] = week
    return hours


def build_web_pubs(now: datetime | None = None) -> dict[str, dict]:
    """Every pub with a beer confirmed within a year, keyed by its cell."""

    now = now or timezone.now()
    fresh_since = now - timedelta(days=FRESH_DAYS)
    match_cache = BeerCatalogMatchCache()
    menus = confirmed_menus(now, _beer_key)

    pubs: dict[str, dict] = {}
    names: dict[str, list[str]] = {}
    for cache_key, beer_key in sorted(menus.listed):
        menu = menus.menus[cache_key]
        pub_key = menus.targets.get(cache_key, cache_key)
        place = menus.places.get(pub_key)
        if cache_key in menus.excluded or pub_key in menus.excluded or place is None:
            continue
        if not any(
            names_match(name, menu.name) for name in (place["name"], *menus.alias_names.get(cache_key, []))
        ):
            continue
        raw_city = place["city"] or menu.city or ""
        city = city_name(raw_city)
        if not slugify(city):
            continue
        at = menus.confirmed[(cache_key, beer_key)]
        pub = pubs.setdefault(pub_key, {
            "name": place["name"],
            "city": city,
            "district": prague_district(raw_city) or "",
            "lat": round(place["lat"], 5),
            "lng": round(place["lng"], 5),
            "beers": {},
        })
        names.setdefault(pub_key, [place["name"]]).append(menu.name)
        known = pub["beers"].get(beer_key)
        if known and known["at"] >= at:
            continue
        served = menus.on_tap[(cache_key, beer_key)]
        price, volume = _serving(served)
        match = match_beer(str(served[0].get("name") or ""), fuzzy=False, match_cache=match_cache)
        pub["beers"][beer_key] = {
            "name": " ".join(str(served[0].get("name")).split()),
            "price_czk": price,
            "volume_ml": volume,
            "key": match.product.key if match and match.product else "",
            "at": at,
        }

    cells = sorted(pubs)
    amenities = _amenities(cells, names)
    hours = _hours(cells, names)
    for pub_key, pub in pubs.items():
        beers = sorted(pub.pop("beers").values(), key=lambda beer: (-beer["at"].timestamp(), beer["name"]))
        reference = compute_reference_price(beers)
        cheapest = next(
            (beer for beer in beers if reference and (beer["price_czk"], beer["volume_ml"]) == reference),
            None,
        )
        pub.update(
            confirmed=timezone.localdate(beers[0]["at"]) if beers else None,
            price_czk=reference[0] if reference else None,
            price_volume_ml=(reference[1] or 500) if reference else None,
            price_beer=cheapest["name"] if cheapest else "",
            beers=[
                {
                    "name": beer["name"],
                    "price_czk": beer["price_czk"],
                    "volume_ml": beer["volume_ml"],
                    "key": beer["key"],
                    "confirmed": timezone.localdate(beer["at"]).isoformat(),
                    "fresh": beer["at"] >= fresh_since,
                }
                for beer in beers
            ],
            amenities=amenities.get(pub_key, {}),
            hours=hours.get(pub_key),
        )
    return pubs


def _keys(values) -> str:
    return "".join(f"|{value}" for value in sorted(set(values))) + "|" if values else ""


def _free_slug(base: str, taken: set[str]) -> str:
    slug, number = base, 1
    while slug in taken:
        number += 1
        slug = f"{base}-{number}"
    taken.add(slug)
    return slug


_SAVED_FIELDS = (
    "name", "city", "district", "lat", "lng", "listed", "day", "confirmed", "price_czk", "price_volume_ml",
    "price_beer", "beers", "beer_keys", "amenities", "amenity_keys", "hours", "search_text",
)


def save_web_pubs(now: datetime | None = None) -> int:
    """Write today's pubs; a pub keeps the address it once got, so links keep working."""

    now = now or timezone.now()
    day = timezone.localdate(now)
    pubs = build_web_pubs(now)
    existing = {row.cache_key: row for row in WebPub.objects.all()}
    taken: dict[str, set[str]] = defaultdict(set)
    for row in existing.values():
        taken[row.city_slug].add(row.slug)

    changed: list[WebPub] = []
    created: list[WebPub] = []
    for cache_key, pub in sorted(pubs.items()):
        city_slug = slugify(pub["city"])
        fields = {
            "name": pub["name"],
            "city": pub["city"],
            "district": pub["district"],
            "lat": pub["lat"],
            "lng": pub["lng"],
            "listed": True,
            "day": day,
            "confirmed": pub["confirmed"],
            "price_czk": pub["price_czk"],
            "price_volume_ml": pub["price_volume_ml"],
            "price_beer": pub["price_beer"][:255],
            "beers": pub["beers"],
            "beer_keys": _keys(beer["key"] for beer in pub["beers"] if beer["key"]),
            "amenities": pub["amenities"],
            "amenity_keys": _keys(key for key, fact in pub["amenities"].items() if fact["status"] == "yes"),
            "hours": pub["hours"],
            "search_text": normalize_discovery_text(f"{pub['name']} {pub['city']} {pub['district']}"),
        }
        row = existing.get(cache_key)
        if row is None:
            slug = _free_slug(slugify(pub["name"])[:110] or "hospoda", taken[city_slug])
            created.append(WebPub(cache_key=cache_key, slug=slug, city_slug=city_slug, **fields))
            continue
        if row.city_slug != city_slug:
            taken[row.city_slug].discard(row.slug)
            row.slug = _free_slug(row.slug, taken[city_slug])
            row.city_slug = city_slug
        for name, value in fields.items():
            setattr(row, name, value)
        changed.append(row)

    with transaction.atomic():
        WebPub.objects.exclude(cache_key__in=list(pubs)).filter(listed=True).update(listed=False, day=day)
        if changed:
            WebPub.objects.bulk_update(changed, ["slug", "city_slug", *_SAVED_FIELDS], batch_size=500)
        WebPub.objects.bulk_create(created, batch_size=500)
    return len(pubs)


def pub_path(pub: WebPub) -> str:
    return f"/hospoda/{pub.city_slug}/{pub.slug}"


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (lat1, lng1, lat2, lng2))
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _box(lat: float, lng: float, km: float) -> Q:
    dlat = km / 111.0
    dlng = km / (111.0 * max(math.cos(math.radians(lat)), 0.01))
    return Q(lat__gte=lat - dlat, lat__lte=lat + dlat, lng__gte=lng - dlng, lng__lte=lng + dlng)


@dataclass
class Search:
    """What the visitor asked for; every field comes from the address, so a result can be shared."""

    city_slug: str = ""
    near: tuple[float, float] | None = None
    area: tuple[float, float, float, float] | None = None
    text: str = ""
    beer: str = ""
    max_price: int | None = None
    amenities: tuple[str, ...] = ()
    sort: str = "price"


@dataclass
class Results:
    pubs: list[WebPub]
    total: int
    radius_km: float | None


def search_pubs(search: Search, limit: int = MAX_PINS) -> Results:
    """Listed pubs matching every filter, the cheapest first unless asked otherwise."""

    rows = WebPub.objects.filter(listed=True)
    if search.city_slug:
        rows = rows.filter(city_slug=search.city_slug)
    if search.area:
        south, west, north, east = search.area
        rows = rows.filter(lat__gte=south, lat__lte=north, lng__gte=west, lng__lte=east)
    for word in normalize_discovery_text(search.text).split()[:6]:
        rows = rows.filter(search_text__contains=word)
    if search.beer:
        rows = rows.filter(beer_keys__contains=f"|{search.beer}|")
    if search.max_price:
        rows = rows.filter(price_czk__lte=search.max_price)
    for key in search.amenities:
        rows = rows.filter(amenity_keys__contains=f"|{key}|")

    radius = None
    if search.near and not search.area:
        lat, lng = search.near
        for radius in NEAR_KM:
            found = [
                pub for pub in rows.filter(_box(lat, lng, radius))
                if distance_km(lat, lng, pub.lat, pub.lng) <= radius
            ]
            if len(found) >= NEAR_MIN_RESULTS:
                break
        for pub in found:
            pub.distance_km = distance_km(lat, lng, pub.lat, pub.lng)
        pubs = found
    else:
        pubs = list(rows[:5000])

    def by_price(pub):
        return (pub.price_czk is None, pub.price_czk or 0, pub.name)

    if search.sort == "distance" and search.near:
        pubs.sort(key=lambda pub: pub.distance_km)
    elif search.sort == "confirmed":
        pubs.sort(key=lambda pub: (-(pub.confirmed or date.min).toordinal(), pub.name))
    else:
        pubs.sort(key=by_price)
    return Results(pubs=pubs[:limit], total=len(pubs), radius_km=radius)


def upcoming_events(cache_keys: list[str] | None = None, *, city_slug: str = "", now: datetime | None = None):
    """Verified events that have not ended and start within EVENT_DAYS, soonest first."""

    now = now or timezone.now()
    events = PubEvent.objects.filter(
        status=PubEvent.Status.VERIFIED,
        verified_at__isnull=False,
        ends_at__gt=now,
        starts_at__lte=now + timedelta(days=EVENT_DAYS),
    ).order_by("starts_at", "title")
    if cache_keys is not None:
        events = events.filter(cache_key__in=cache_keys)
    events = list(events[:500])
    pubs = {pub.cache_key: pub for pub in WebPub.objects.filter(cache_key__in={event.cache_key for event in events})}
    found = []
    for event in events:
        pub = pubs.get(event.cache_key)
        if pub is not None and not names_match(pub.name, event.name):
            pub = None
        if pub is not None and not pub.listed:
            pub = None
        event_city = pub.city if pub else city_name(event.city or "")
        if city_slug and slugify(event_city) != city_slug:
            continue
        found.append({"event": event, "pub": pub, "city": event_city})
    return found


def amenity_kinds() -> dict[str, AmenityKind]:
    """Active amenities the web can filter by, in the app's order."""

    return {
        kind.key: kind
        for kind in AmenityKind.objects.filter(active=True, key__in=AMENITY_SLUGS).order_by("rank", "key")
    }

"""Daily public beer pages behind na-pivo.cz/pivo: which pubs have a catalogue beer on tap.

Everything here runs once a day from the ``snapshot_beer_prices`` command, next to
the price map. The pages only read the stored ``BeerPage`` rows and compute nothing
themselves.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import formats, timezone, translation
from django.utils.translation import gettext

from pubs.api.pub_beers_views import _merged_aliases, _places, city_name
from pubs.api.views import _globally_reported_pub_cache_keys
from pubs.beer_catalog import (
    ALLOWED_BEER_VOLUMES_ML,
    BEER_PRICE_MAX_CZK,
    BEER_PRICE_MIN_CZK,
    BeerCatalogMatchCache,
    match_beer,
    normalize_beer_text,
    without_tank_words,
)
from pubs.enrichment import names_match
from pubs.models import (
    Account,
    BeerPage,
    BeerProduct,
    DrinkLog,
    PubCommunityData,
    PubContributionLog,
)
from pubs.price_map import (
    FRESH_DAYS,
    WINDOW_DAYS,
    _chunks,
    _in_czechia,
    _round,
    prague_district,
    public_floor,
    share_card,
    shows_price,
)
from pubs.web.places import is_private_pub
from pubs.web.words import plural

# A beer gets its page once this many pubs confirmed it within FRESH_DAYS.
MIN_PUBS = 3
PATHS = {"cs": "/pivo", "en": "/en/beer"}
BRAND_PATHS = {"cs": "/pivo/znacka", "en": "/en/beer/brand"}


def counted(number: int, one: str, few: str, many: str) -> str:
    """Czech picks the noun by count (1 hospoda, 3 hospody, 5 hospod); English only needs one and many."""

    noun = one if number == 1 else few if 2 <= number <= 4 else many
    return f"{number}\u00a0{noun}"


def page_path(kind: str, key: str, lang: str) -> str:
    if kind == BeerPage.Kind.BEER:
        return f"{PATHS[lang]}/{key}"
    if kind == BeerPage.Kind.BRAND:
        return f"{BRAND_PATHS[lang]}/{key}"
    return PATHS[lang]


def _price(beer: dict) -> int | None:
    price = beer.get("price_czk")
    if isinstance(price, bool) or not isinstance(price, int):
        return None
    return price if BEER_PRICE_MIN_CZK <= price <= BEER_PRICE_MAX_CZK else None


def _serving(beers: list[dict], floor: int) -> tuple[int | None, int | None]:
    """The price the page shows for one pub: half a litre if it has one, else the biggest glass.

    The same beer twice in one glass size (tank and keg) shows the cheaper one.
    """

    priced = [
        (price, beer.get("volume_ml")) for beer in beers
        if (price := _price(beer)) is not None and shows_price(price, beer.get("volume_ml"), floor)
    ]
    if not priced:
        return None, beers[0].get("volume_ml")
    return min(priced, key=lambda served: (served[1] != 500, -(served[1] or 0), served[0]))


def _confirmations(
    menus: dict[str, PubCommunityData],
    names: dict[str, list[str]],
    on_tap: dict[tuple[str, str], list[dict]],
    since: datetime,
    product_of,
) -> dict[tuple[str, str], datetime]:
    """When someone last wrote each beer at each pub, if since ``since``.

    A submitted menu confirms every beer on it. A drink confirms its own beer, by
    when it was drunk, since the offline queue can deliver it much later, but only
    at the price and glass size the menu shows: that is the price the page puts
    next to the date, and a drink corrected afterwards never reached the menu.
    Only drinks the app also writes onto the public menu count: not suspect,
    logged after the account agreed to share content. Drinks of accounts in ghost
    mode stay out, so the date never shows where someone hiding was. The write
    must name this pub, under its own name or one of a duplicate merged into it,
    since two businesses can share one geohash cell.
    """

    now = timezone.now()
    confirmed: dict[tuple[str, str], datetime] = {}

    def confirm(cache_key: str, name: str, beer_name, at: datetime, served=None) -> None:
        product = product_of(beer_name)
        if product is None or not any(names_match(name, known) for known in names[cache_key]):
            return
        key = (cache_key, product.key)
        if served is not None and not any(
            (_price(beer), beer.get("volume_ml")) == served for beer in on_tap.get(key, [])
        ):
            return
        at = min(at, now)
        confirmed[key] = max(at, confirmed.get(key, at))

    for chunk in _chunks(list(menus)):
        logs = PubContributionLog.objects.filter(
            kind=PubContributionLog.Kind.BEERS,
            cache_key__in=chunk,
            created_at__gte=since,
        ).values_list("cache_key", "name", "payload", "created_at")
        for cache_key, name, payload, created_at in logs:
            beers = payload.get("beers") if isinstance(payload, dict) else payload
            for beer in beers if isinstance(beers, list) else []:
                if isinstance(beer, dict):
                    confirm(cache_key, name, beer.get("name"), created_at)
        drinks = DrinkLog.objects.filter(
            cache_key__in=chunk,
            drink_type=DrinkLog.DrinkType.BEER,
            drank_at__gte=since,
            is_suspect=False,
            price_czk__isnull=False,
            volume_ml__in=ALLOWED_BEER_VOLUMES_ML,
            account__status=Account.Status.ACTIVE,
            # Consent given later does not publish what was logged before it.
            account__ugc_terms_accepted_at__lte=F("created_at"),
            account__ghost_mode=False,
        ).values_list("cache_key", "name", "beer_name", "drank_at", "price_czk", "volume_ml")
        for cache_key, name, beer_name, drank_at, price, volume in drinks:
            confirm(cache_key, name, beer_name, drank_at, served=(price, volume))
    return confirmed


def _summary(pubs: list[dict]) -> dict:
    """Pub count, half-litre median and the cheapest half litre of the fresh pubs."""

    fresh = [pub for pub in pubs if pub["fresh"]]
    half_litres = [pub for pub in fresh if pub["volume_ml"] == 500 and pub["price_czk"] is not None]
    summary: dict = {"pubs": len(fresh), "median": None, "p25": None, "p75": None, "cheapest": None}
    if len(half_litres) >= MIN_PUBS:
        p25, median, p75 = statistics.quantiles(
            [pub["price_czk"] for pub in half_litres], n=4, method="inclusive"
        )
        summary.update(median=_round(median), p25=_round(p25), p75=_round(p75))
    cheapest = min(half_litres, key=lambda pub: pub["price_czk"], default=None)
    if cheapest:
        summary["cheapest"] = {key: cheapest[key] for key in ("name", "city", "price_czk")}
    return summary


def build_beer_pages(now: datetime | None = None) -> dict:
    """Every catalogue beer with enough fresh pubs, its brand, and the list of them all.

    A pub is listed under a beer while the beer is on its current community menu
    and someone wrote it there within WINDOW_DAYS. Only pubs that confirmed it
    within FRESH_DAYS count towards MIN_PUBS; the older ones stay listed with
    their date, last.
    """

    now = now or timezone.now()
    since = now - timedelta(days=WINDOW_DAYS)
    fresh_since = now - timedelta(days=FRESH_DAYS)
    floor = public_floor()
    match_cache = BeerCatalogMatchCache()
    products: dict[str, BeerProduct] = {}

    def product_of(name) -> BeerProduct | None:
        # The exact spelling rules every menu write uses, so a page shows one beer, not a guess.
        # Poured from a tank it is still that beer, as the app's own index counts it.
        name = str(name or "")
        match = match_beer(name, fuzzy=False, match_cache=match_cache)
        if (match is None or match.product is None) and (plain := without_tank_words(name)) != normalize_beer_text(name):
            match = match_beer(plain, fuzzy=False, match_cache=match_cache)
        if match is None or match.product is None:
            return None
        products.setdefault(match.product.key, match.product)
        return match.product

    # A duplicate merged into another pub is that pub: it counts once, with its newest write.
    # Its old menu stands in only while the pub has no menu of its own, and writes under the
    # duplicate's old name still count for the pub.
    targets: dict[str, str] = {}
    alias_names: dict[str, list[str]] = defaultdict(list)
    merged_names: dict[str, list[str]] = defaultdict(list)
    for key, target, name, merged_into in _merged_aliases().values_list(
        "cache_key", "canonical_pub__cache_key", "name", "canonical_pub__name"
    ):
        targets[key] = target
        alias_names[key].append(name)
        merged_names[target] += [name, merged_into]
    with_own_menu = set(
        PubCommunityData.objects.filter(cache_key__in=set(targets.values()))
        .filter(~Q(beers=[]) | Q(beers_updated_at__isnull=False))
        .values_list("cache_key", flat=True)
    )
    menus = {
        menu.cache_key: menu
        for menu in _in_czechia(list(
            PubCommunityData.objects.exclude(beers=[]).only(
                "cache_key", "name", "lat", "lng", "city", "beers", "beer_menu_rotates"
            )
        ))
        if targets.get(menu.cache_key) not in with_own_menu
    }
    on_tap: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for menu in menus.values():
        for beer in menu.beers if isinstance(menu.beers, list) else []:
            if isinstance(beer, dict) and (product := product_of(beer.get("name"))):
                on_tap[(menu.cache_key, product.key)].append(beer)
    names = {
        key: [menu.name, *alias_names.get(key, []), *merged_names.get(key, [])] for key, menu in menus.items()
    }
    confirmed = _confirmations(menus, names, on_tap, since, product_of)

    listed = [pair for pair in on_tap if pair in confirmed]
    excluded = _globally_reported_pub_cache_keys(
        {cache_key for cache_key, _ in listed} | {targets.get(cache_key, cache_key) for cache_key, _ in listed}
    )
    places = _places(sorted({targets.get(cache_key, cache_key) for cache_key, _ in listed}))

    by_product: dict[str, dict[str, dict]] = defaultdict(dict)
    for cache_key, product_key in sorted(listed, key=lambda pair: confirmed[pair]):
        menu = menus[cache_key]
        pub_key = targets.get(cache_key, cache_key)
        place = places.get(pub_key)
        if cache_key in excluded or pub_key in excluded or place is None or is_private_pub(place["name"]):
            continue
        # The menu must be this pub's, under its own name or the name of a duplicate merged into it.
        if not any(names_match(name, menu.name) for name in (place["name"], *alias_names.get(cache_key, []))):
            continue
        at = confirmed[(cache_key, product_key)]
        price, volume = _serving(on_tap[(cache_key, product_key)], floor)
        city = place["city"] or menu.city or ""
        by_product[product_key][pub_key] = {
            "cache_key": pub_key,
            "name": place["name"],
            "city": prague_district(city) or city_name(city),
            # The pub's own place, which the app's map already shows everyone.
            "lat": round(place["lat"], 5),
            "lng": round(place["lng"], 5),
            "price_czk": price,
            "volume_ml": volume,
            "confirmed": timezone.localdate(at).isoformat(),
            "at": at,
            "fresh": at >= fresh_since,
            "rotates": menu.beer_menu_rotates,
        }

    beers: dict[str, dict] = {}
    for product_key, pubs in by_product.items():
        rows = sorted(pubs.values(), key=lambda pub: (-pub["at"].timestamp(), pub["name"]))
        summary = _summary(rows)
        if summary["pubs"] < MIN_PUBS:
            continue
        product = products[product_key]
        beers[product_key] = {
            "key": product_key,
            "name": product.name,
            "brand_key": product.brand.key,
            "brand_name": product.brand.name,
            **summary,
            "listed": [{key: value for key, value in pub.items() if key != "at"} for pub in rows],
            "fresh_pub_keys": [pub_key for pub_key, pub in pubs.items() if pub["fresh"]],
        }

    brands: dict[str, dict] = {}
    all_pub_keys: set[str] = set()
    for beer in sorted(beers.values(), key=lambda beer: (-beer["pubs"], beer["name"])):
        brand = brands.setdefault(beer["brand_key"], {
            "key": beer["brand_key"],
            "name": beer["brand_name"],
            "beers": [],
            "pub_keys": set(),
        })
        brand["beers"].append({key: beer[key] for key in ("key", "name", "pubs", "median")})
        brand["pub_keys"].update(beer["fresh_pub_keys"])
        all_pub_keys.update(beer.pop("fresh_pub_keys"))
    for brand in brands.values():
        brand["pubs"] = len(brand.pop("pub_keys"))
    # A brand with one beer would only repeat that beer's page.
    brands = {key: brand for key, brand in brands.items() if len(brand["beers"]) >= 2}
    for beer in beers.values():
        beer["brand_page"] = beer["brand_key"] in brands

    return {
        "beers": beers,
        "brands": brands,
        "list": {
            "fresh_days": FRESH_DAYS,
            "min_pubs": MIN_PUBS,
            "pubs": len(all_pub_keys),
            "beers": [
                {key: beer[key] for key in ("key", "name", "brand_key", "brand_name", "pubs", "median")}
                for beer in sorted(beers.values(), key=lambda beer: (-beer["pubs"], beer["name"]))
            ],
            "brands": sorted(
                ({key: brand[key] for key in ("key", "name", "pubs")} | {"beers": len(brand["beers"])}
                 for brand in brands.values()),
                key=lambda brand: brand["name"],
            ),
        },
    }


def save_beer_pages(now: datetime | None = None) -> dict:
    """Replace every page with today's, in one go, so no visitor sees half of each."""

    now = now or timezone.now()
    day = timezone.localdate(now)
    pages = build_beer_pages(now)
    rows = [BeerPage(kind=BeerPage.Kind.LIST, key="", day=day, data=pages["list"])]
    rows += [BeerPage(kind=BeerPage.Kind.BEER, key=key, day=day, data=data) for key, data in pages["beers"].items()]
    rows += [BeerPage(kind=BeerPage.Kind.BRAND, key=key, day=day, data=data) for key, data in pages["brands"].items()]
    with transaction.atomic():
        BeerPage.objects.all().delete()
        BeerPage.objects.bulk_create(rows)
    return pages["list"]


def render_og_image(page: BeerPage, lang: str, ranking: dict | None = None) -> bytes:
    """Share image of a beer, a brand or the list: the rating once people rated it, else what it costs."""

    data = page.data
    with translation.override(lang):
        unit = gettext("Kč")
        address = settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + page_path(page.kind, page.key, lang)
        if page.kind == BeerPage.Kind.LIST:
            return share_card(
                eyebrow=gettext("Potvrzeno za poslední 3 měsíce"),
                title=gettext("Kde se čepuje které pivo"),
                number=str(len(data["beers"])),
                number_label=plural(len(data["beers"]), gettext("pivo s vlastní stránkou"),
                                    gettext("piva s vlastní stránkou"), gettext("piv s vlastní stránkou")),
                figures=[(str(data["pubs"]), plural(data["pubs"], gettext("hospoda"), gettext("hospody"), gettext("hospod")))],
                address=address,
            )
        if page.kind == BeerPage.Kind.BRAND:
            return share_card(
                eyebrow=gettext("Značka"),
                title=data["name"],
                number=str(data["pubs"]),
                number_label=plural(data["pubs"], gettext("hospoda je čepuje"), gettext("hospody je čepují"),
                                    gettext("hospod je čepuje")),
                figures=[(str(len(data["beers"])), plural(len(data["beers"]), gettext("pivo na stránce"),
                                                          gettext("piva na stránce"), gettext("piv na stránce")))],
                address=address,
            )
        figures = []
        served = plural(data["pubs"], gettext("hospoda ho čepuje"), gettext("hospody ho čepují"), gettext("hospod ho čepuje"))
        rated = ranking is not None and ranking["avg"] is not None
        if rated:
            number = formats.number_format(round(ranking["avg"], 1), 1)
            number_label = gettext("z %(count)s hodnocení") % {"count": ranking["count"]}
            if data["median"] is not None:
                figures.append((f"{data['median']}\u00a0{unit}", gettext("obvykle za 0,5 l")))
        elif data["median"] is not None:
            number, number_label = f"{data['median']}\u00a0{unit}", gettext("obvykle za 0,5 l")
        else:
            number, number_label = str(data["pubs"]), served
        if rated or data["median"] is not None:
            figures.append((str(data["pubs"]), served))
        if data["cheapest"]:
            figures.append((f"{data['cheapest']['price_czk']}\u00a0{unit}", gettext("nejlevněji za 0,5 l")))
        if rated and ranking["rank"]:
            figures.append((f"{ranking['rank']}.", gettext("v žebříčku piv")))
        return share_card(
            eyebrow=data["brand_name"] if data["brand_name"] not in data["name"] else "",
            title=data["name"],
            number=number,
            number_label=number_label,
            figures=figures,
            address=address,
        )

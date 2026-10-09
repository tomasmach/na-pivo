"""Daily public beer pages behind na-pivo.cz/pivo: which pubs have a catalogue beer on tap.

Everything here runs once a day from the ``snapshot_beer_prices`` command, next to
the price map. The pages only read the stored ``BeerPage`` rows and compute nothing
themselves.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from io import BytesIO

from django.conf import settings
from django.db import transaction
from django.utils import formats, timezone, translation
from django.utils.translation import gettext
from PIL import Image, ImageDraw

from pubs.api.pub_beers_views import _merged_aliases, _places, city_name
from pubs.api.views import _globally_reported_pub_cache_keys
from pubs.beer_catalog import (
    BEER_PRICE_MAX_CZK,
    BEER_PRICE_MIN_CZK,
    BeerCatalogMatchCache,
    match_beer,
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
    _FOAM,
    _FOAM_MUTED,
    _GROUND,
    _HAIR,
    _MUTED,
    CHEAPEST_MIN_CZK,
    FRESH_DAYS,
    WINDOW_DAYS,
    _chunks,
    _fitted,
    _font,
    _in_czechia,
    _round,
    prague_district,
)

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


def _serving(beers: list[dict]) -> tuple[int | None, int | None]:
    """The price the page shows for one pub: half a litre if it has one, else the biggest glass.

    The same beer twice in one glass size (tank and keg) shows the cheaper one.
    """

    priced = [(price, beer.get("volume_ml")) for beer in beers if (price := _price(beer)) is not None]
    if not priced:
        return None, beers[0].get("volume_ml")
    return min(priced, key=lambda served: (served[1] != 500, -(served[1] or 0), served[0]))


def _confirmations(
    menus: dict[str, PubCommunityData], since: datetime, product_of
) -> dict[tuple[str, str], datetime]:
    """When someone last wrote each beer at each pub, if since ``since``.

    A submitted menu confirms every beer on it. A drink confirms its own beer, by
    when it was drunk, since the offline queue can deliver it much later. Only the
    drinks that also update the public menu count: beers with a price, not
    suspect, of accounts that agreed to share content. Drinks of accounts in ghost
    mode stay out, so the date never shows where someone hiding was. The write
    must name the same pub, since two businesses can share one geohash cell.
    """

    now = timezone.now()
    confirmed: dict[tuple[str, str], datetime] = {}

    def confirm(cache_key: str, beer_name, at: datetime) -> None:
        product = product_of(beer_name)
        if product is None:
            return
        key = (cache_key, product.key)
        at = min(at, now)
        confirmed[key] = max(at, confirmed.get(key, at))

    for chunk in _chunks(list(menus)):
        logs = PubContributionLog.objects.filter(
            kind=PubContributionLog.Kind.BEERS,
            cache_key__in=chunk,
            created_at__gte=since,
        ).values_list("cache_key", "name", "payload", "created_at")
        for cache_key, name, payload, created_at in logs:
            if not names_match(name, menus[cache_key].name):
                continue
            beers = payload.get("beers") if isinstance(payload, dict) else payload
            for beer in beers if isinstance(beers, list) else []:
                if isinstance(beer, dict):
                    confirm(cache_key, beer.get("name"), created_at)
        drinks = DrinkLog.objects.filter(
            cache_key__in=chunk,
            drink_type=DrinkLog.DrinkType.BEER,
            drank_at__gte=since,
            is_suspect=False,
            price_czk__isnull=False,
            account__status=Account.Status.ACTIVE,
            account__ugc_terms_accepted_at__isnull=False,
            account__ghost_mode=False,
        ).values_list("cache_key", "name", "beer_name", "drank_at")
        for cache_key, name, beer_name, drank_at in drinks:
            if names_match(name, menus[cache_key].name):
                confirm(cache_key, beer_name, drank_at)
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
    cheapest = min(
        (pub for pub in half_litres if pub["price_czk"] >= CHEAPEST_MIN_CZK),
        key=lambda pub: pub["price_czk"],
        default=None,
    )
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
    match_cache = BeerCatalogMatchCache()
    products: dict[str, BeerProduct] = {}

    def product_of(name) -> BeerProduct | None:
        # The exact spelling rules every menu write uses, so a page shows one beer, not a guess.
        match = match_beer(str(name or ""), fuzzy=False, match_cache=match_cache)
        if match is None or match.product is None:
            return None
        products.setdefault(match.product.key, match.product)
        return match.product

    menus = {
        menu.cache_key: menu
        for menu in _in_czechia(list(
            PubCommunityData.objects.exclude(beers=[]).only(
                "cache_key", "name", "lat", "lng", "city", "beers", "beer_menu_rotates"
            )
        ))
    }
    on_tap: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for menu in menus.values():
        for beer in menu.beers if isinstance(menu.beers, list) else []:
            if isinstance(beer, dict) and (product := product_of(beer.get("name"))):
                on_tap[(menu.cache_key, product.key)].append(beer)
    confirmed = _confirmations(menus, since, product_of)

    # A duplicate merged into another pub is that pub: it counts once, with its newest write.
    targets: dict[str, str] = {}
    alias_names: dict[str, list[str]] = defaultdict(list)
    for key, target, name in _merged_aliases().values_list("cache_key", "canonical_pub__cache_key", "name"):
        targets[key] = target
        alias_names[key].append(name)
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
        if cache_key in excluded or pub_key in excluded or place is None:
            continue
        # The menu must be this pub's, under its own name or the name of a duplicate merged into it.
        if not any(names_match(name, menu.name) for name in (place["name"], *alias_names.get(cache_key, []))):
            continue
        at = confirmed[(cache_key, product_key)]
        price, volume = _serving(on_tap[(cache_key, product_key)])
        city = place["city"] or menu.city or ""
        by_product[product_key][pub_key] = {
            "name": place["name"],
            "city": prague_district(city) or city_name(city),
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
    for beer in sorted(beers.values(), key=lambda beer: (-beer["pubs"], beer["name"])):
        brand = brands.setdefault(beer["brand_key"], {
            "key": beer["brand_key"],
            "name": beer["brand_name"],
            "beers": [],
            "pub_keys": set(),
        })
        brand["beers"].append({key: beer[key] for key in ("key", "name", "pubs", "median")})
        brand["pub_keys"].update(beer.pop("fresh_pub_keys"))
    for brand in brands.values():
        brand["pubs"] = len(brand.pop("pub_keys"))

    return {
        "beers": beers,
        "brands": brands,
        "list": {
            "fresh_days": FRESH_DAYS,
            "min_pubs": MIN_PUBS,
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


def render_og_image(page: BeerPage, lang: str) -> bytes:
    """A flat 1200 × 630 share image: the beer, how many pubs have it and what it costs."""

    data = page.data
    image = Image.new("RGB", (1200, 630), _GROUND)
    draw = ImageDraw.Draw(image)
    with translation.override(lang):
        if page.kind == BeerPage.Kind.LIST:
            title = gettext("Kde se čepuje které pivo")
            figures = [(gettext("Piva"), len(data["beers"]), ""), (gettext("Značky"), len(data["brands"]), "")]
        elif page.kind == BeerPage.Kind.BRAND:
            title = data["name"]
            figures = [(gettext("Piva"), len(data["beers"]), ""), (gettext("Hospody"), data["pubs"], "")]
        else:
            title = data["name"]
            figures = [(gettext("Hospody"), data["pubs"], "")]
            if data["median"] is not None:
                figures.append((gettext("Obvykle za 0,5 l"), data["median"], gettext("Kč")))
            if data["cheapest"]:
                figures.append((gettext("Nejlevněji za 0,5 l"), data["cheapest"]["price_czk"], gettext("Kč")))

        draw.text((80, 92), "Na pivo", font=_font("ExtraBold", 40), fill=_FOAM, anchor="ls")
        draw.text((80, 196), title, font=_fitted(draw, title, "ExtraBold", 72, 1040), fill=_FOAM, anchor="ls")
        draw.line((80, 252, 1120, 252), fill=_HAIR, width=2)
        number_font = _font("ExtraBold", 132)
        unit_font = _font("ExtraBold", 44)
        for index, (label, number, unit) in enumerate(figures):
            x = 80 + index * 360
            value = str(number)
            draw.text((x, 318), label, font=_fitted(draw, label, "SemiBold", 36, 330), fill=_FOAM_MUTED, anchor="ls")
            draw.text((x, 462), value, font=number_font, fill=_FOAM, anchor="ls")
            if unit:
                unit_x = x + draw.textlength(value, font=number_font) + 14
                draw.text((unit_x, 462), unit, font=unit_font, fill=_FOAM_MUTED, anchor="ls")

        draw.line((80, 524, 1120, 524), fill=_HAIR, width=2)
        footer = gettext("Potvrzeno za poslední 3 měsíce, stav k %(date)s") % {
            "date": formats.date_format(page.day, "DATE_FORMAT"),
        }
        draw.text((80, 576), footer, font=_fitted(draw, footer, "SemiBold", 30, 640), fill=_MUTED, anchor="ls")
        address = settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + page_path(page.kind, page.key, lang)
        draw.text(
            (1120, 576), address, font=_fitted(draw, address, "SemiBold", 30, 420), fill=_FOAM_MUTED, anchor="rs"
        )

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()

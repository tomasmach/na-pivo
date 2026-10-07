"""Daily public beer price map behind na-pivo.cz/ceny.

Everything here runs once a day from the ``snapshot_beer_prices`` command. The
page only reads the newest ``PubPriceSnapshot`` and computes nothing itself.
"""

from __future__ import annotations

import math
import re
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.utils import formats, timezone, translation
from django.utils.text import slugify
from django.utils.translation import gettext
from PIL import Image, ImageDraw, ImageFont

from pubs.api.pub_beers_views import CITY_ALIASES, _merged_aliases, _places, city_name
from pubs.api.views import _globally_reported_pub_cache_keys
from pubs.enrichment import names_match
from pubs.enrichment.coverage import coverage_country
from pubs.models import (
    Account,
    CanonicalPub,
    DrinkLog,
    PubContributionLog,
    PubDirectory,
    PubPriceIndex,
    PubPriceSnapshot,
)

# A year is how long the app itself shows a pub's price; older ones count as gone.
WINDOW_DAYS = 365
# Prices last written longer ago than this still count, but the page flags them.
FRESH_DAYS = 90
# A city or district with fewer priced pubs says more about one pub than the city.
MIN_PUBS = 5
CHEAPEST_PUBS = 10
# A cheapest beer under this is a typo or a joke, not a pub's price.
CHEAPEST_MIN_CZK = 20
# Prices people entered in the app. Imported third-party menus stay in the app only.
_SOURCES = (PubPriceIndex.Source.COMMUNITY, PubPriceIndex.Source.DRINK)
PATHS = {"cs": "/ceny", "en": "/en/prices"}
_PRAGUE_NUMBERED = re.compile(r"Praha\s*[-–]?\s*(\d{1,2})\b")

_FONTS = Path(__file__).resolve().parent / "fonts"
_GROUND = (35, 20, 7)
_FOAM = (251, 243, 224)
_FOAM_MUTED = (232, 220, 192)
_MUTED = (168, 137, 106)
# Foam at 12 % over the ground, the hairline the web pages use.
_HAIR = tuple(round(g + (f - g) * 0.12) for g, f in zip(_GROUND, _FOAM, strict=True))


def _chunks(keys: list[str], size: int = 500):
    for start in range(0, len(keys), size):
        yield keys[start:start + size]


def _in_czechia(rows: list[PubPriceIndex]) -> list[PubPriceIndex]:
    """The catalogue's country first; the coarse coverage polygon only for pubs it lacks."""

    countries: dict[str, str] = {}
    for chunk in _chunks([row.cache_key for row in rows]):
        for model in (CanonicalPub, PubDirectory):
            for key, country in (
                model.objects.filter(cache_key__in=chunk).exclude(country="").values_list("cache_key", "country")
            ):
                countries.setdefault(key, country)
    return [
        row
        for row in rows
        if countries.get(row.cache_key, coverage_country(row.lat, row.lng)) == "cz"
    ]


def _confirmed_since(rows: list[PubPriceIndex], since: datetime) -> dict[str, datetime]:
    """When each pub's selected price itself was last written, if since ``since``.

    A drink of another beer keeps the old menu prices but still moves the
    index's observed_at, so only a drink or a submitted menu with this exact
    price and volume counts. A drink counts by when it was drunk, since the
    offline queue can deliver it much later. Only beers count, and suspect
    drinks and drinks of accounts that never agreed to share content stay out
    of public numbers. The write must name the same pub, since two businesses
    can share one geohash cell.
    """

    selected = {row.cache_key: (row.price_czk, row.volume_ml) for row in rows}
    names = {row.cache_key: row.name for row in rows}
    confirmed: dict[str, datetime] = {}

    def confirm(key: str, at: datetime) -> None:
        confirmed[key] = max(at, confirmed.get(key, at))

    for chunk in _chunks(list(selected)):
        drinks = DrinkLog.objects.filter(
            cache_key__in=chunk,
            drink_type=DrinkLog.DrinkType.BEER,
            drank_at__gte=since,
            is_suspect=False,
            price_czk__isnull=False,
            account__status=Account.Status.ACTIVE,
            account__ugc_terms_accepted_at__isnull=False,
        ).values_list("cache_key", "name", "price_czk", "volume_ml", "drank_at")
        for key, name, price, volume, drank_at in drinks:
            if selected[key] == (price, volume) and names_match(name, names[key]):
                confirm(key, drank_at)
        menus = PubContributionLog.objects.filter(
            kind=PubContributionLog.Kind.BEERS,
            cache_key__in=chunk,
            created_at__gte=since,
        ).values_list("cache_key", "name", "payload", "created_at")
        for key, name, payload, created_at in menus:
            beers = payload.get("beers") if isinstance(payload, dict) else payload
            if names_match(name, names[key]) and any(
                isinstance(beer, dict) and (beer.get("price_czk"), beer.get("volume_ml")) == selected[key]
                for beer in beers or []
            ):
                confirm(key, created_at)
    return confirmed


def prague_district(raw: str) -> str:
    """"Praha 2 - Vinohrady" is Praha 2, "Praha-Libuš" stays itself, plain "Praha" has none."""

    city = " ".join((raw or "").split())
    if city == "Praha" or city in CITY_ALIASES or city_name(city) != "Praha":
        return ""
    numbered = _PRAGUE_NUMBERED.match(city)
    return f"Praha {numbered.group(1)}" if numbered else city


def city_slug(name: str) -> str:
    """The city's address under /ceny: České Budějovice is ceske-budejovice."""

    return slugify(name)


def _round(value: float) -> int:
    return math.floor(value + 0.5)


def _stats(rows: list[PubPriceIndex]) -> dict:
    p25, median, p75 = statistics.quantiles([row.price_czk for row in rows], n=4, method="inclusive")
    return {
        "median": _round(median),
        "p25": _round(p25),
        "p75": _round(p75),
        "pubs": len(rows),
        "mostly_stale": sum(row.stale for row in rows) * 2 > len(rows),
    }


def _areas(groups: dict[str, list[PubPriceIndex]]) -> list[dict]:
    """Areas with enough priced pubs, the biggest first."""

    return sorted(
        ({"name": name, **_stats(rows)} for name, rows in groups.items() if len(rows) >= MIN_PUBS),
        key=lambda area: (-area["pubs"], area["name"]),
    )


def _district_order(area: dict) -> tuple:
    """Praha 1, 2 … 22 by number, then the named districts."""

    numbered = _PRAGUE_NUMBERED.fullmatch(area["name"])
    return (0, int(numbered.group(1)), "") if numbered else (1, 0, area["name"])


def _half_litre_price(row: PubPriceIndex) -> float:
    return row.price_czk * 500 / (row.volume_ml or 500)


def _cheapest(rows: list[PubPriceIndex]) -> list[dict]:
    """The cheapest pubs the public map knows, under the name the map shows."""

    # 41 Kč for 0,4 l is dearer than 45 Kč for 0,5 l.
    candidates = sorted(
        (row for row in rows if row.price_czk >= CHEAPEST_MIN_CZK),
        key=lambda row: (_half_litre_price(row), row.cache_key),
    )
    picked: list[dict] = []
    for start in range(0, len(candidates), 100):
        batch = candidates[start:start + 100]
        places = _places([row.pub_key for row in batch])
        for row in batch:
            place = places.get(row.pub_key)
            # Two businesses can share one geohash cell: the price must be this pub's,
            # under its own name or the name of a duplicate merged into it.
            if place is None or not any(
                names_match(name, row.name) for name in (place["name"], *row.alias_names)
            ):
                continue
            city = place["city"] or row.city
            picked.append({
                "name": place["name"],
                # The same city names the tables use.
                "city": prague_district(city) or city_name(city),
                "price_czk": row.price_czk,
                "volume_ml": row.volume_ml or 500,
                "stale": row.stale,
            })
            if len(picked) == CHEAPEST_PUBS:
                return picked
    return picked


def build_price_map(now: datetime | None = None) -> dict:
    """Median, quartiles and pub count per city and Prague district, plus the cheapest pubs.

    The cheapest pubs are listed for the whole country and for each city.
    """

    now = now or timezone.now()
    since = now - timedelta(days=WINDOW_DAYS)
    fresh_since = now - timedelta(days=FRESH_DAYS)
    rows = _in_czechia(list(
        PubPriceIndex.objects.filter(
            active=True,
            observed_at__gte=since,
            source__in=_SOURCES,
        ).only("cache_key", "name", "lat", "lng", "city", "price_czk", "volume_ml", "observed_at")
    ))
    confirmed = _confirmed_since(rows, since)
    # A duplicate merged into another pub is that pub: it counts once, with the newest price.
    targets: dict[str, str] = {}
    alias_names: dict[str, list[str]] = defaultdict(list)
    for key, target, name in _merged_aliases().values_list("cache_key", "canonical_pub__cache_key", "name"):
        targets[key] = target
        alias_names[key].append(name)
    pubs: dict[str, PubPriceIndex] = {}
    for row in sorted(
        (row for row in rows if row.cache_key in confirmed), key=lambda row: confirmed[row.cache_key]
    ):
        row.pub_key = targets.get(row.cache_key, row.cache_key)
        row.alias_names = alias_names.get(row.cache_key, [])
        row.stale = confirmed[row.cache_key] < fresh_since
        pubs[row.pub_key] = row
    excluded = _globally_reported_pub_cache_keys(
        {row.cache_key for row in pubs.values()} | set(pubs)
    )
    rows = [
        row for row in pubs.values() if row.cache_key not in excluded and row.pub_key not in excluded
    ]

    cities: dict[str, list[PubPriceIndex]] = defaultdict(list)
    districts: dict[str, list[PubPriceIndex]] = defaultdict(list)
    for row in rows:
        if city := city_name(row.city):
            cities[city].append(row)
        if district := prague_district(row.city):
            districts[district].append(row)
    return {
        "window_days": WINDOW_DAYS,
        "fresh_days": FRESH_DAYS,
        "min_pubs": MIN_PUBS,
        "country": _stats(rows) if len(rows) >= MIN_PUBS else None,
        # Each city keeps its own cheapest pubs for its page.
        "cities": [{**area, "cheapest": _cheapest(cities[area["name"]])} for area in _areas(cities)],
        "prague_districts": sorted(_areas(districts), key=_district_order),
        "cheapest": _cheapest(rows),
    }


def headline_prices(data: dict) -> list[tuple[str, dict | None]]:
    """The three numbers on the page top and the share image: Czechia, Praha, Brno."""

    cities = {area["name"]: area for area in data.get("cities", [])}
    return [
        (gettext("Celá ČR"), data.get("country")),
        ("Praha", cities.get("Praha")),
        ("Brno", cities.get("Brno")),
    ]


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_FONTS / f"Baloo2-{name}.ttf"), size)


def _fitted(draw: ImageDraw.ImageDraw, text: str, name: str, size: int, width: int):
    font = _font(name, size)
    while draw.textlength(text, font=font) > width and size > 24:
        size -= 2
        font = _font(name, size)
    return font


def render_og_image(data: dict, day, lang: str) -> bytes:
    """A flat 1200 × 630 share image with the three headline medians."""

    image = Image.new("RGB", (1200, 630), _GROUND)
    draw = ImageDraw.Draw(image)
    with translation.override(lang):
        draw.text((80, 92), "Na pivo", font=_font("ExtraBold", 40), fill=_FOAM, anchor="ls")
        title = gettext("Kolik stojí pivo v hospodě")
        draw.text((80, 196), title, font=_fitted(draw, title, "ExtraBold", 72, 1040), fill=_FOAM, anchor="ls")
        draw.line((80, 252, 1120, 252), fill=_HAIR, width=2)

        number_font = _font("ExtraBold", 132)
        unit_font = _font("ExtraBold", 44)
        label_font = _font("SemiBold", 36)
        unit = gettext("Kč")
        for index, (label, stats) in enumerate(headline_prices(data)):
            x = 80 + index * 360
            draw.text((x, 318), label, font=label_font, fill=_FOAM_MUTED, anchor="ls")
            value = str(stats["median"]) if stats else "–"
            draw.text((x, 462), value, font=number_font, fill=_FOAM, anchor="ls")
            if stats:
                unit_x = x + draw.textlength(value, font=number_font) + 14
                draw.text((unit_x, 462), unit, font=unit_font, fill=_FOAM_MUTED, anchor="ls")

        draw.line((80, 524, 1120, 524), fill=_HAIR, width=2)
        footer_font = _font("SemiBold", 30)
        footer = gettext("Medián nejlevnějšího piva od 0,4 l, stav k %(date)s") % {
            "date": formats.date_format(day, "DATE_FORMAT"),
        }
        draw.text((80, 576), footer, font=_fitted(draw, footer, "SemiBold", 30, 760), fill=_MUTED, anchor="ls")
        address = settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + PATHS[lang]
        draw.text((1120, 576), address, font=footer_font, fill=_FOAM_MUTED, anchor="rs")

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def save_price_snapshot(now: datetime | None = None) -> PubPriceSnapshot:
    """Compute today's map and both share images, replacing a same-day snapshot."""

    now = now or timezone.now()
    day = timezone.localdate(now)
    data = build_price_map(now)
    snapshot, _ = PubPriceSnapshot.objects.update_or_create(
        day=day,
        defaults={
            "computed_at": now,
            "data": data,
            "og_image_cs": render_og_image(data, day, "cs"),
            "og_image_en": render_og_image(data, day, "en"),
        },
    )
    return snapshot

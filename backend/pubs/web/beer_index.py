"""/pivni-index: what beer costs in Czech pubs, by kraj and city, with history and a CSV.

Everything comes from the daily price snapshot behind /ceny. The kraje are added
to that snapshot the first time this page reads it, so the work runs once a day.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.utils import formats, translation
from django.utils.translation import gettext

from pubs.api.pub_beers_views import _merged_aliases, city_name
from pubs.api.views import _globally_reported_pub_cache_keys
from pubs.home_views import AUTHOR, DATA_LICENSE_PATH, HOME_OG_PATH, canonical_host
from pubs.models import BeerPage, PubPriceIndex, PubPriceSnapshot
from pubs.price_map import _SOURCES, MIN_PUBS, WINDOW_DAYS, _confirmed_since, _in_czechia, _stats
from pubs.regions import REGION_CODES, region_of
from pubs.web.pages import render_page, web_page
from pubs.web.public_common import (
    breadcrumbs,
    og_image,
    public_cache,
    region_names,
    structured,
    thousands,
    throttle_wait,
    too_many,
)
from pubs.web.routes import web_reverse
from pubs.web.words import plural

QUARTERS = 8
CHART_CITIES = 5
# Where each kraj sits in the tile map: column, row.
_TILES = {
    "CZ041": (1, 1), "CZ042": (2, 1), "CZ051": (3, 1), "CZ052": (4, 1),
    "CZ032": (1, 2), "CZ020": (2, 2), "CZ010": (3, 2), "CZ053": (4, 2), "CZ071": (5, 2), "CZ080": (6, 2),
    "CZ031": (2, 3), "CZ063": (3, 3), "CZ064": (4, 3), "CZ072": (5, 3),
}


def _regional(snapshot: PubPriceSnapshot) -> dict:
    """Kraje and the kraj of each city for one snapshot, by the same pubs and rules as /ceny."""

    stored = snapshot.data.get("web_regions")
    if stored is not None:
        return stored
    now = snapshot.computed_at
    rows = _in_czechia(list(
        PubPriceIndex.objects.filter(
            active=True, observed_at__gte=now - timedelta(days=WINDOW_DAYS), source__in=_SOURCES
        ).only("cache_key", "name", "lat", "lng", "city", "price_czk", "volume_ml", "observed_at")
    ))
    confirmed = _confirmed_since(rows, now - timedelta(days=WINDOW_DAYS))
    targets = dict(_merged_aliases().values_list("cache_key", "canonical_pub__cache_key"))
    pubs: dict[str, PubPriceIndex] = {}
    for row in sorted((row for row in rows if row.cache_key in confirmed), key=lambda row: confirmed[row.cache_key]):
        row.stale = False
        pubs[targets.get(row.cache_key, row.cache_key)] = row
    hidden = _globally_reported_pub_cache_keys({row.cache_key for row in pubs.values()} | set(pubs))
    groups: dict[str, list[PubPriceIndex]] = defaultdict(list)
    city_votes: dict[str, Counter] = defaultdict(Counter)
    for key, row in pubs.items():
        if row.cache_key in hidden or key in hidden:
            continue
        if code := region_of(row.lat, row.lng):
            groups[code].append(row)
            if city := city_name(row.city):
                city_votes[city][code] += 1
    result = {
        "regions": {
            code: {key: value for key, value in _stats(rows).items() if key != "mostly_stale"}
            for code, rows in groups.items()
            if len(rows) >= MIN_PUBS
        },
        "city_regions": {city: votes.most_common(1)[0][0] for city, votes in city_votes.items()},
    }
    # A cache in the snapshot itself: one computation per day for every worker.
    PubPriceSnapshot.objects.filter(pk=snapshot.pk, computed_at=snapshot.computed_at).update(
        data={**snapshot.data, "web_regions": result}
    )
    return result


def _index() -> dict | None:
    """Everything the page, the CSV and the share image show, for the newest snapshot."""

    snapshot = PubPriceSnapshot.objects.defer("og_image_cs", "og_image_en").first()
    if snapshot is None:
        return None

    def build() -> dict:
        regional = _regional(snapshot)
        days = list(PubPriceSnapshot.objects.values_list("day", flat=True))
        last_of_quarter: dict[tuple[int, int], date] = {}
        for day in days:
            quarter = (day.year, (day.month - 1) // 3 + 1)
            last_of_quarter[quarter] = max(day, last_of_quarter.get(quarter, day))
        wanted = sorted(last_of_quarter.items())[-QUARTERS:]
        target = snapshot.day - timedelta(days=365)
        year_ago_day = min((day for day in days if abs((day - target).days) <= 31),
                           key=lambda day: abs((day - target).days), default=None)
        old = {
            row.day: row.data
            for row in PubPriceSnapshot.objects.filter(
                day__in=[day for _, day in wanted] + ([year_ago_day] if year_ago_day else [])
            ).only("day", "data")
        }
        history = [
            {"year": year, "quarter": quarter, "median": (old[day].get("country") or {}).get("median")}
            for (year, quarter), day in wanted
        ]
        year_ago = old.get(year_ago_day) if year_ago_day else None
        beers = BeerPage.objects.filter(kind=BeerPage.Kind.LIST, key="").values_list("data", flat=True).first() or {}
        return {
            "day": snapshot.day.isoformat(),
            "country": snapshot.data.get("country"),
            "cities": snapshot.data.get("cities", []),
            "regions": regional["regions"],
            "city_regions": regional["city_regions"],
            "history": [row for row in history if row["median"] is not None],
            "year_ago": {
                "country": (year_ago.get("country") or {}).get("median"),
                "cities": {area["name"]: area["median"] for area in year_ago.get("cities", [])},
            } if year_ago else None,
            "beers": [beer for beer in beers.get("beers", []) if beer.get("median") is not None][:7],
        }

    return cache.get_or_set(f"web:beer-index:{snapshot.day}:{snapshot.computed_at.timestamp()}", build, 3600)


def _quarter(year: int, quarter: int) -> str:
    return gettext("%(q)s. čtvrtletí %(year)s") % {"q": quarter, "year": year}


def _signed(value: int) -> str:
    return f"+{value}" if value > 0 else f"−{-value}" if value < 0 else "0"


def _kc(value: int | None) -> str:
    return "–" if value is None else f"{value} {gettext('Kč')}"


def _bars(rows: list[dict], key: str = "median") -> list[dict]:
    """Bar widths on one axis, so a longer bar is always the dearer half litre."""

    if not rows:
        return []
    low = min(row[key] for row in rows)
    high = max(row[key] for row in rows)
    span = max(high - low, 1)
    return [{**row, "width": round(35 + 65 * (row[key] - low) / span)} for row in rows]


@web_page
def beer_index(request: HttpRequest) -> HttpResponse:
    wait = throttle_wait(request, "web_pages")
    if wait:
        return too_many(request, wait, "prices")

    lang = request.web_lang
    data = _index()
    names = region_names()
    base = web_reverse("web-beer-index")
    crumbs, crumb_graph = breadcrumbs([
        ("Na pivo", web_reverse("home")), (gettext("Ceny piva"), web_reverse("beer-prices")), (gettext("Pivní index"), base),
    ])
    context: dict = {"crumbs": crumbs, "data": None}
    graph = [crumb_graph]
    description = gettext(
        "Kolik stojí pivo v českých hospodách: střední cena v Česku, po krajích a městech a jak se měnila."
    )
    country = data["country"] if data else None
    if data and country:
        day = date.fromisoformat(data["day"])
        when = formats.date_format(day, "j. n. Y" if lang == "cs" else "N j, Y")
        country_median = country["median"]
        year_ago = data["year_ago"] or {}
        change = country_median - year_ago["country"] if year_ago.get("country") else None
        regions = [
            {"code": code, "short": names[code][0], "name": names[code][1], **data["regions"][code]}
            for code in REGION_CODES
            if code in data["regions"]
        ]
        by_price = sorted(regions, key=lambda region: region["median"])

        def bucket(median: int) -> int:
            return sum(median >= limit for limit in (country_median - 3, country_median, country_median + 2, country_median + 5))

        tiles = [
            {
                "code": code, "short": names[code][0], "col": col, "row": row,
                "median": data["regions"][code]["median"] if code in data["regions"] else None,
                "level": bucket(data["regions"][code]["median"]) if code in data["regions"] else None,
            }
            for code, (col, row) in _TILES.items()
        ]
        legend = [
            gettext("do %(n)s Kč") % {"n": country_median - 4},
            f"{country_median - 3}–{country_median - 1} {gettext('Kč')}",
            f"{country_median}–{country_median + 1} {gettext('Kč')}",
            f"{country_median + 2}–{country_median + 4} {gettext('Kč')}",
            gettext("%(n)s Kč a víc") % {"n": country_median + 5},
        ]
        cities = sorted(data["cities"], key=lambda area: (-area["median"], area["name"]))
        half = min(CHART_CITIES, len(cities) // 2)
        city_region = data["city_regions"]

        def city_row(area: dict) -> dict:
            code = city_region.get(area["name"])
            return {**area, "region": names[code][1] if code and area["name"] != "Praha" else gettext("hlavní město") if area["name"] == "Praha" else ""}

        big = sorted(data["cities"], key=lambda area: -area["pubs"])[:5]
        history = data["history"]
        top = max((row["median"] for row in history), default=1)
        bottom = min((row["median"] for row in history), default=0)
        history_rows = [
            {"label": _quarter(row["year"], row["quarter"]), "median": row["median"],
             "height": (height := round(30 + 70 * (row["median"] - bottom) / max(top - bottom, 1))),
             "y": 100 - height,
             "last": index == len(history) - 1}
            for index, row in enumerate(history)
        ]
        risers = []
        if year_ago.get("cities"):
            for area in data["cities"]:
                before = year_ago["cities"].get(area["name"])
                if before is not None:
                    change_now = area["median"] - before
                    risers.append({
                        "name": area["name"], "before": before, "now": area["median"], "change": change_now,
                        "change_label": f"{_signed(change_now)} {gettext('Kč')}",
                    })
            risers.sort(key=lambda row: (-row["change"], row["name"]))
        expensive, cheap = (by_price[-1], by_price[0]) if len(by_price) >= 2 else (None, None)
        quote = gettext(
            "„Nejlevnější pivo v české hospodě stálo k %(when)s střední cenou %(price)s Kč.%(regions)s“"
        ) % {
            "when": when,
            "price": country_median,
            "regions": (
                " " + gettext("Nejdráž je %(dear)s (%(dear_price)s Kč), nejlevněji %(cheap)s (%(cheap_price)s Kč).") % {
                    "dear": expensive["name"], "dear_price": expensive["median"],
                    "cheap": cheap["name"], "cheap_price": cheap["median"],
                }
                if expensive else ""
            ),
        }
        context.update({
            "data": data,
            "median": country_median,
            "when": when,
            "pubs_label": plural(
                country["pubs"],
                gettext("%(n)s hospoda s cenou za poslední rok"),
                gettext("%(n)s hospody s cenou za poslední rok"),
                gettext("%(n)s hospod s cenou za poslední rok"),
            ) % {"n": thousands(country["pubs"])},
            "change": change,
            "change_label": (
                gettext("o %(n)s Kč víc než loni") % {"n": change} if change and change > 0
                else gettext("o %(n)s Kč míň než loni") % {"n": -change} if change and change < 0
                else gettext("stejně jako loni") if change == 0 else ""
            ),
            "big_cities": [{**area, "diff": _signed(area["median"] - country_median)} for area in big],
            "tiles": tiles,
            "legend": legend,
            "regions_count": len(regions),
            "expensive": expensive,
            "cheap": cheap,
            "spread": expensive["median"] - cheap["median"] if expensive else None,
            "dear_cities": _bars([city_row(area) for area in cities[:half]]),
            "cheap_cities": _bars([city_row(area) for area in reversed(cities[-half:])]) if half else [],
            "history": history_rows,
            "beers": _bars([
                {**beer, "pubs_label": plural(
                    beer["pubs"], gettext("čepuje %(n)s hospoda"), gettext("čepují %(n)s hospody"), gettext("čepuje %(n)s hospod")
                ) % {"n": thousands(beer["pubs"])}}
                for beer in data["beers"]
            ]),
            "risers": [row for row in risers if row["change"] > 0][:6],
            "quote": quote,
            "og_url": f"{web_reverse('beer-index-og')}?v={data['day']}",
            "min_pubs": MIN_PUBS,
        })
        description = gettext(
            "Nejlevnější pivo v české hospodě stojí střední cenou %(price)s Kč. Ceny po krajích a městech a vývoj po čtvrtletích."
        ) % {"price": country_median}
        graph.append({
            "@type": "Dataset",
            "name": gettext("Pivní index Česka"),
            "description": description,
            "url": f"{settings.PUBLIC_WEB_ORIGIN}{base}",
            "creator": AUTHOR,
            "dateModified": data["day"],
            "spatialCoverage": {"@type": "Place", "name": gettext("Česko")},
            "inLanguage": lang,
            "copyrightHolder": AUTHOR,
            "license": f"{settings.PUBLIC_WEB_ORIGIN}{DATA_LICENSE_PATH}",
        })
    origin = settings.PUBLIC_WEB_ORIGIN
    context["og_image"] = (
        f"{origin}{web_reverse('beer-index-og')}?v={data['day']}" if data and country else None
    )
    context["structured_data"] = structured(*graph)
    response = render_page(
        request,
        "web/public/beer_index.html",
        context,
        title=gettext("Pivní index Na pivo: cena piva po krajích a v čase"),
        description=description,
        section="prices",
    )
    return public_cache(response)


def _og(data: dict, lang: str) -> bytes:
    with translation.override(lang):
        day = date.fromisoformat(data["day"])
        cities = {area["name"]: area["median"] for area in data["cities"]}
        figures = [(_kc(cities[name]), name) for name in ("Praha", "Brno", "Ostrava", "Plzeň") if name in cities][:3]
        if not figures:
            figures = [(thousands(data["country"]["pubs"]), gettext("hospod s cenou"))]
        return og_image(
            kicker=f"{gettext('Pivní index Česka')} · {formats.date_format(day, 'F Y')}",
            title=gettext("Pivo v hospodě stojí"),
            hero=_kc(data["country"]["median"]),
            hero_label=gettext("střední cena"),
            figures=figures,
            address=settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + web_reverse("web-beer-index", lang),
        )


@canonical_host
def beer_index_og(request: HttpRequest, lang: str = "cs") -> HttpResponse:
    wait = throttle_wait(request, "web_og")
    if wait:
        response = HttpResponse(status=429)
        response["Retry-After"] = str(wait)
        return response
    data = _index()
    if not data or not data["country"]:
        # Without an index yet, a link shared earlier still shows the general picture.
        return HttpResponseRedirect(HOME_OG_PATH)
    image = cache.get_or_set(f"web:beer-index:og:{data['day']}:{lang}", lambda: _og(data, lang), 86400)
    response = HttpResponse(image, content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def sitemap_paths() -> list[str]:
    return [web_reverse("web-beer-index", "cs")]

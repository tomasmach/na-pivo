"""/zebricky: the best beers in Czechia or one kraj, read from the hourly ranking."""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Sum
from django.http import Http404, HttpRequest, HttpResponse
from django.utils import formats, timezone, translation
from django.utils.translation import gettext, ngettext, npgettext

from pubs.beer_pages import page_path
from pubs.beer_ranking import STYLES
from pubs.models import (
    BeerPage,
    BeerRanking,
    BeerRegionRanking,
    PubPriceSnapshot,
    UserAddedPub,
)
from pubs.price_map import half_litre_czk
from pubs.web.dates import time_tag, with_times
from pubs.web.pages import render_page, web_page
from pubs.web.places import pub_name
from pubs.web.public_common import (
    PAGE_CACHE_SECONDS,
    REGION_BY_SLUG,
    breadcrumbs,
    decimal,
    home_og_image,
    og_png,
    og_version,
    public_cache,
    region_names,
    region_slug,
    structured,
    thousands,
    throttle_wait,
    too_many,
)
from pubs.web.routes import web_reverse
from pubs.web.words import plural

# A beer joins the public ranking once this many people rated it.
MIN_RATINGS = 50
# A kraj's page is worth finding once it ranks a few beers, like a town with three pubs or a beer in three.
MIN_INDEXED_REGION_BEERS = 3
FIRST_ROWS = 10
MORE_ROWS = 30
MAX_ROWS = 100
# The kraje next to "Celé Česko"; the rest fold under "Další kraje".
_FRONT_REGIONS = ("CZ010", "CZ020", "CZ064", "CZ032", "CZ080")


def _style_labels() -> dict[str, str]:
    return {
        "pale": gettext("Světlé"),
        "amber": gettext("Polotmavé"),
        "dark": gettext("Tmavé"),
        "craft": gettext("Craft"),
    }


def _ranking(region: str, style: str) -> dict:
    """Ranked beers over the threshold, the pubs pouring them and the ranking's totals."""

    def build() -> dict:
        if region:
            rows = (
                BeerRegionRanking.objects.filter(region=region, rank__isnull=False, rating_count__gte=MIN_RATINGS)
                .select_related("product", "product__ranking")
                .order_by("rank")
            )
            totals = BeerRegionRanking.objects.filter(region=region).aggregate(n=Sum("rating_count"))
            stamp = BeerRegionRanking.objects.filter(region=region).order_by("-computed_at").values_list(
                "computed_at", flat=True
            ).first()
        else:
            rows = (
                BeerRanking.objects.filter(rank__isnull=False, rating_count__gte=MIN_RATINGS)
                .select_related("product")
                .order_by("rank")
            )
            totals = BeerRanking.objects.aggregate(n=Sum("rating_count"))
            stamp = BeerRanking.objects.order_by("-computed_at").values_list("computed_at", flat=True).first()
        if stamp is None:
            stamp = BeerRanking.objects.order_by("-computed_at").values_list("computed_at", flat=True).first()
        picked = []
        for row in rows:
            national = row if not region else getattr(row.product, "ranking", None)
            styles = (national.styles if national else None) or []
            if style and style not in styles:
                continue
            picked.append(row)
            if len(picked) == MAX_ROWS:
                break
        # The same pubs /pivo counts: confirmed lately, one per pub, in the public catalogue.
        pages = {
            key: {"pubs": pubs or 0, "pub_name": name or ""}
            for key, pubs, name in BeerPage.objects.filter(
                kind=BeerPage.Kind.BEER, key__in=[row.product.key for row in picked]
            ).values_list("key", "data__pubs", "data__listed__0__name")
        }
        return {
            "ratings": totals["n"] or 0,
            "computed_at": stamp,
            "rows": [
                {
                    "key": row.product.key,
                    "name": row.product.name,
                    "brand": row.product.brand_name,
                    "avg": row.rating_avg,
                    "count": row.rating_count,
                    "has_page": row.product.key in pages,
                    **pages.get(row.product.key, {"pubs": 0, "pub_name": ""}),
                }
                for row in picked
            ],
        }

    return cache.get_or_set(f"web:rankings:{region}:{style}", build, PAGE_CACHE_SECONDS)


def _side_numbers() -> dict:
    def build() -> dict:
        snapshot = PubPriceSnapshot.objects.only("data").first()
        cheapest = (snapshot.data.get("cheapest") or [None])[0] if snapshot else None
        added = UserAddedPub.objects.filter(
            active=True, created_at__gte=timezone.now() - timedelta(days=30)
        ).count()
        return {"cheapest": half_litre_czk(cheapest) if cheapest else None, "new_pubs": added}

    return cache.get_or_set("web:rankings:side", build, PAGE_CACHE_SECONDS)


def _share_card(region: str = "") -> dict | None:
    """The list's share image, national or one kraj's: the best beer big, the next two beside it."""

    data = _ranking(region, "")
    rows = data["rows"][:3]
    if not rows:
        return None
    title = (
        gettext("Nejlepší piva: %(place)s") % {"place": region_names()[region][1]} if region
        else gettext("Nejlepší piva v Česku")
    )
    return {
        "kicker": _ratings_label(data["ratings"]),
        "title": title,
        "hero": decimal(rows[0]["avg"]),
        "hero_label": rows[0]["name"],
        "figures": [(decimal(row["avg"]), row["name"]) for row in rows[1:]],
        "address": settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + _path(region),
    }


def _ratings_label(ratings: int) -> str:
    if not ratings:
        return ""
    return ngettext(
        "Z %(n)s hodnocení z appky Na pivo", "Z %(n)s hodnocení z appky Na pivo", ratings
    ) % {"n": thousands(ratings)}


@web_page
def rankings_og(request: HttpRequest, kraj: str = "") -> HttpResponse:
    region = REGION_BY_SLUG.get(kraj, "")
    if kraj and not region:
        raise Http404
    with translation.override(getattr(request, "web_lang", "cs")):
        payload = _share_card(region)
    return og_png(request, payload)


def _pubs_line(row: dict) -> str:
    if not row["pubs"]:
        return ""
    others = row["pubs"] - 1
    if not others:
        return pub_name(row["pub_name"])
    return plural(
        others,
        gettext("%(pub)s a %(n)s další hospoda"),
        gettext("%(pub)s a %(n)s další hospody"),
        gettext("%(pub)s a dalších %(n)s hospod"),
    ) % {"pub": pub_name(row["pub_name"]), "n": thousands(others)}


def _region_description(place: str, data: dict) -> str:
    """What this kraj's ranking says: how many ratings and which beers lead, so no two kraje read the same."""

    if not data["rows"]:
        return gettext(
            "%(place)s: žebříček se teprve plní. Pivo se do něj dostane s aspoň %(n)s hodnoceními."
        ) % {"place": place, "n": MIN_RATINGS}
    text = ngettext(
        "%(place)s: nejlíp hodnocená piva z %(n)s hodnocení v appce Na pivo.",
        "%(place)s: nejlíp hodnocená piva z %(n)s hodnocení v appce Na pivo.",
        data["ratings"],
    ) % {"place": place, "n": thousands(data["ratings"])}
    leaders = [f"{row['name']} ({decimal(row['avg'])})" for row in data["rows"][:3]]
    if len(leaders) == 1:
        return f"{text} " + gettext("Vede %(beer)s.") % {"beer": leaders[0]}
    return f"{text} " + gettext("Vede %(beer)s, pak %(others)s.") % {"beer": leaders[0], "others": ", ".join(leaders[1:])}


def _path(region: str, lang: str | None = None) -> str:
    if region:
        return web_reverse("web-rankings-region", lang, kraj=region_slug(region))
    return web_reverse("web-rankings", lang)


def _og_path(region: str) -> str:
    if region:
        return web_reverse("rankings-region-og", kraj=region_slug(region))
    return web_reverse("rankings-og")


def region_path(kraj: str, lang: str) -> str:
    """Where the old /zebricky?kraj=<slug> lives now; an unknown kraj is the whole of Czechia."""

    return _path(REGION_BY_SLUG.get(kraj, ""), lang)


@web_page
def rankings(request: HttpRequest, kraj: str = "") -> HttpResponse:
    region = REGION_BY_SLUG.get(kraj, "")
    if kraj and not region:
        raise Http404
    wait = throttle_wait(request, "web_pages")
    if wait:
        return too_many(request, wait, "rankings")

    style = request.GET.get("styl", "")
    style = style if style in STYLES else ""
    try:
        shown = max(FIRST_ROWS, min(MAX_ROWS, int(request.GET.get("n", FIRST_ROWS))))
    except ValueError:
        shown = FIRST_ROWS
    data = _ranking(region, style)
    names = region_names()
    styles = _style_labels()
    base = web_reverse("web-rankings")

    def url(kraj: str | None = None, **params) -> str:
        path = _path(region if kraj is None else REGION_BY_SLUG.get(kraj, ""))
        values = {"styl": style, **params}
        query = "&".join(f"{key}={value}" for key, value in values.items() if value)
        return f"{path}?{query}" if query else path

    style_chips = [{"label": gettext("Všechna piva"), "url": url(styl=""), "current": not style}] + [
        {"label": label, "url": url(styl=key), "current": style == key} for key, label in styles.items()
    ]
    region_chips = [{"label": gettext("Celé Česko"), "url": url(kraj=""), "current": not region}] + [
        {"label": names[code][0], "url": url(kraj=region_slug(code)), "current": region == code}
        for code in _FRONT_REGIONS
    ]
    more_regions = [
        {"label": names[code][1], "url": url(kraj=region_slug(code)), "current": region == code}
        for code in names
        if code not in _FRONT_REGIONS
    ]

    all_regions = [region_chips[0]] + [
        {"label": names[code][1], "url": url(kraj=region_slug(code)), "current": region == code} for code in names
    ]
    rows = [
        {
            **row,
            "position": index,
            "avg_label": decimal(row["avg"]),
            "count_label": npgettext("rankings row", "%(n)s hodnocení", "%(n)s hodnocení", row["count"]) % {"n": thousands(row["count"])},
            "count_short": thousands(row["count"]),
            "pubs_line": _pubs_line(row),
            "url": page_path(BeerPage.Kind.BEER, row["key"], request.web_lang) if row["has_page"] else "",
        }
        for index, row in enumerate(data["rows"][:shown], start=1)
    ]
    more = len(data["rows"]) - shown
    place = names[region][1] if region else gettext("Česko")
    title = (
        gettext("Nejlepší piva: %(place)s") % {"place": place} if region else gettext("Nejlepší piva v Česku")
    )
    where = names[region][1] if region else gettext("celé Česko")
    heading = f"{styles[style]}, {where}" if style else (names[region][1] if region else gettext("Celé Česko"))
    computed = data["computed_at"]
    updated = ""
    if computed:
        local = timezone.localtime(computed)
        when = (
            gettext("dnes v %(time)s") % {"time": formats.time_format(local, "G:i")}
            if local.date() == timezone.localdate()
            else formats.date_format(local, "j. n. Y" if request.web_lang == "cs" else "N j, Y")
        )
        updated = with_times(gettext("přepočítáno %(when)s"), when=time_tag(computed, when))

    last_crumb = (names[region][1], _path(region)) if region else (gettext("Piva"), url())
    crumbs, crumb_graph = breadcrumbs([("Na pivo", web_reverse("home")), (gettext("Žebříčky"), base), last_crumb])
    graph = [crumb_graph]
    if rows:
        graph.append({
            "@type": "ItemList",
            "name": title,
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": row["position"],
                    "name": row["name"],
                    **({"url": f"{settings.PUBLIC_WEB_ORIGIN}{row['url']}"} if row["url"] else {}),
                }
                for row in rows
            ],
        })
    side = _side_numbers()
    response = render_page(
        request,
        "web/public/rankings.html",
        {
            "crumbs": crumbs,
            "h1": title,
            "ratings_label": _ratings_label(data["ratings"]),
            "updated": updated,
            "style_chips": style_chips,
            "region_chips": region_chips,
            "more_regions": more_regions,
            "more_current": next((item["label"] for item in more_regions if item["current"]), ""),
            "all_regions": all_regions,
            "region_label": names[region][1] if region else gettext("Celé Česko"),
            "list_heading": heading,
            "min_ratings": MIN_RATINGS,
            "rows": rows,
            "more_url": url(n=min(MAX_ROWS, shown + MORE_ROWS)) + "#zebricek" if more > 0 else "",
            "more_label": plural(min(more, MORE_ROWS), gettext("Ukázat další %(n)s pivo"), gettext("Ukázat další %(n)s piva"),
                                 gettext("Ukázat dalších %(n)s piv"))
            % {"n": min(more, MORE_ROWS)},
            "cheapest": side["cheapest"],
            "new_pubs_label": plural(side["new_pubs"], gettext("%(n)s hospoda za poslední měsíc"),
                                     gettext("%(n)s hospody za poslední měsíc"),
                                     gettext("%(n)s hospod za poslední měsíc")) % {"n": side["new_pubs"]},
            "new_pubs": side["new_pubs"],
            "structured_data": structured(*graph),
            "og_image": (
                f"{settings.PUBLIC_WEB_ORIGIN}{_og_path(region)}?v={og_version(card)}"
                if (card := _share_card(region)) else home_og_image()
            ),
            "og_image_alt": title if card else "",
        },
        title=title,
        description=_region_description(names[region][1], data) if region else gettext(
            "Která piva lidi v appce Na pivo hodnotí nejlíp. Do žebříčku se dostane pivo s aspoň %(n)s hodnoceními, každý mu dává jednu známku."
        ) % {"n": MIN_RATINGS},
        section="rankings",
        # A kraj is a page of its own once it has beers; a style or a longer list is the same page.
        indexable=not request.GET and (not region or len(data["rows"]) >= MIN_INDEXED_REGION_BEERS),
        follow=True,
    )
    return public_cache(response)


def sitemap_paths() -> list[str]:
    ranked = (
        BeerRegionRanking.objects.filter(rank__isnull=False, rating_count__gte=MIN_RATINGS)
        .values("region")
        .annotate(beers=Count("id"))
        .filter(beers__gte=MIN_INDEXED_REGION_BEERS)
        .values_list("region", flat=True)
    )
    regions = set(ranked) & set(REGION_BY_SLUG.values())
    return [web_reverse("web-rankings", "cs")] + [
        web_reverse("web-rankings-region", "cs", kraj=region_slug(code)) for code in sorted(regions)
    ]

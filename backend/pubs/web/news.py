"""/novinky: what changed in pubs lately, by pub and day, never by who or at what time.

Who wrote a change and when exactly would tell where that person was, so the
page only says the day and the pub.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta

from django.core.cache import cache
from django.http import HttpRequest, HttpResponse
from django.utils import formats, timezone
from django.utils.text import slugify
from django.utils.translation import gettext

from pubs.api.pub_beers_views import _places, city_name
from pubs.beer_catalog import beer_menu_identity
from pubs.enrichment import names_match
from pubs.models import (
    BeerTapEvent,
    PubBeerProduct,
    PubCommunityData,
    PubContributionLog,
    UserAddedPub,
)
from pubs.price_map import PUBLIC_MIN_CZK
from pubs.pub_events import PubEvent
from pubs.web.pages import render_page, web_page
from pubs.web.public_common import (
    PAGE_CACHE_SECONDS,
    breadcrumbs,
    home_og_image,
    money,
    pub_url,
    public_cache,
    structured,
    thousands,
    throttle_wait,
    too_many,
)
from pubs.web.routes import web_reverse
from pubs.web.words import plural

WEEK = timedelta(days=7)
MAX_WEEKS_BACK = 4
MAX_ITEMS = 150
KINDS = ("tap", "pub", "price", "gone", "event")
_KIND_SLUGS = {"tap": "na-cepu", "pub": "hospody", "price": "ceny", "gone": "uz-necepuji", "event": "akce"}
_KIND_BY_SLUG = {slug: kind for kind, slug in _KIND_SLUGS.items()}
_ICONS = {"tap": "beer", "pub": "map-pin-plus", "price": "tag", "gone": "circle-off", "event": "calendar"}


def _beers(payload) -> list[dict]:
    beers = payload.get("beers") if isinstance(payload, dict) else payload
    return [beer for beer in beers or [] if isinstance(beer, dict) and beer.get("name")]


def _menu_changes(start: datetime, end: datetime) -> list[dict]:
    """Price changes and beers gone from tap, from each menu write against the one before it."""

    writes = list(
        PubContributionLog.objects.filter(
            kind=PubContributionLog.Kind.BEERS, created_at__gte=start, created_at__lt=end
        )
        .order_by("created_at", "id")
        .values_list("cache_key", "name", "payload", "created_at")[:2000]
    )
    keys = {write[0] for write in writes}
    previous: dict[str, tuple[str, list[dict]]] = {}
    for key, name, payload in (
        PubContributionLog.objects.filter(
            kind=PubContributionLog.Kind.BEERS,
            cache_key__in=keys,
            created_at__lt=start,
            created_at__gte=start - timedelta(days=365),
        )
        .order_by("created_at", "id")
        .values_list("cache_key", "name", "payload")
    ):
        previous[key] = (name, _beers(payload))
    changes: list[dict] = []
    for key, name, payload, at in writes:
        beers = _beers(payload)
        before = previous.get(key)
        previous[key] = (name, beers)
        # Two businesses can share one cell; only compare a pub's menu with its own.
        if before is None or not names_match(before[0], name):
            continue
        now_on = {beer_menu_identity(beer): beer for beer in beers}
        for beer in before[1]:
            identity = beer_menu_identity(beer)
            if not identity[0]:
                continue
            current = now_on.get(identity)
            if current is None:
                changes.append({"kind": "gone", "key": key, "name": name, "at": at, "beer": beer["name"]})
            elif (
                isinstance(beer.get("price_czk"), int)
                and isinstance(current.get("price_czk"), int)
                and min(beer["price_czk"], current["price_czk"]) >= PUBLIC_MIN_CZK
                and beer["price_czk"] != current["price_czk"]
            ):
                changes.append({
                    "kind": "price", "key": key, "name": name, "at": at, "beer": current["name"],
                    "old": beer["price_czk"], "new": current["price_czk"],
                })
    return changes


def _feed(week: int) -> dict:
    """Every change of one week, newest first, with the pub's public name and city."""

    def build() -> dict:
        from pubs.api.views import _globally_reported_pub_cache_keys

        end = timezone.now() - week * WEEK
        start = end - WEEK
        items: list[dict] = []
        taps = list(
            BeerTapEvent.objects.filter(observed_at__gte=start, observed_at__lt=end)
            .select_related("product")
            .order_by("-observed_at")[:500]
        )
        prices = {
            (key, product): (price, volume)
            for key, product, price, volume in PubBeerProduct.objects.filter(
                cache_key__in={tap.cache_key for tap in taps}, product__in=[tap.product_id for tap in taps]
            ).values_list("cache_key", "product_id", "last_price_czk", "last_volume_ml")
        }
        for tap in taps:
            price, volume = prices.get((tap.cache_key, tap.product_id), (None, None))
            items.append({
                "kind": "tap", "key": tap.cache_key, "name": tap.pub_name, "at": tap.observed_at,
                "beer": tap.product.name,
                "price": price if (volume or 500) == 500 and (price or 0) >= PUBLIC_MIN_CZK else None,
            })
        items += _menu_changes(start, end)
        for pub in UserAddedPub.objects.filter(active=True, created_at__gte=start, created_at__lt=end).order_by(
            "-created_at"
        )[:200]:
            items.append({"kind": "pub", "key": pub.cache_key, "name": pub.name, "at": pub.created_at, "city": pub.city})
        for event in PubEvent.objects.filter(
            status=PubEvent.Status.VERIFIED, verified_at__gte=start, verified_at__lt=end, ends_at__gt=timezone.now()
        ).order_by("-verified_at")[:100]:
            items.append({
                "kind": "event", "key": event.cache_key, "name": event.name, "at": event.verified_at,
                "city": event.city, "title": event.title, "starts": timezone.localdate(event.starts_at).isoformat(),
            })

        keys = {item["key"] for item in items}
        hidden = _globally_reported_pub_cache_keys(keys)
        places = _places(sorted(keys))
        menu_cities = dict(
            PubCommunityData.objects.filter(cache_key__in=keys).exclude(city="").values_list("cache_key", "city")
        )
        shown = []
        for item in sorted(items, key=lambda item: item["at"], reverse=True):
            if item["key"] in hidden:
                continue
            place = places.get(item["key"])
            raw_city = item.get("city") or (place or {}).get("city") or menu_cities.get(item["key"]) or ""
            item["city"] = city_name(raw_city)
            item["district"] = raw_city if raw_city != item["city"] else ""
            if place and names_match(place["name"], item["name"]):
                item["name"] = place["name"]
            item["day"] = timezone.localdate(item.pop("at")).isoformat()
            shown.append(item)
            if len(shown) == MAX_ITEMS:
                break
        return {"items": shown}

    return cache.get_or_set(f"web:news:{week}", build, PAGE_CACHE_SECONDS)


def _new_pubs() -> list[dict]:
    def build() -> list[dict]:
        rows = UserAddedPub.objects.filter(
            active=True, created_at__gte=timezone.now() - timedelta(days=30)
        ).order_by("-created_at")[:20]
        return [
            {"key": pub.cache_key, "name": pub.name, "city": city_name(pub.city), "district": pub.city,
             "day": timezone.localdate(pub.created_at).isoformat()}
            for pub in rows
        ]

    return cache.get_or_set("web:news:new-pubs", build, PAGE_CACHE_SECONDS)


def _day_label(day: date, today: date, lang: str) -> str:
    if day == today:
        return gettext("Dnes")
    if day == today - timedelta(days=1):
        return gettext("Včera")
    label = formats.date_format(day, "l j. n." if lang == "cs" else "l, N j")
    return label[:1].upper() + label[1:]


def _short_day(day: date, today: date, lang: str) -> str:
    if day == today:
        return gettext("dnes")
    if day == today - timedelta(days=1):
        return gettext("včera")
    return formats.date_format(day, "j. n." if lang == "cs" else "N j")


def _row(item: dict, lang: str) -> dict:
    values = {"pub": item["name"], "beer": item.get("beer", ""), "title": item.get("title", "")}
    kind = item["kind"]
    if kind == "tap":
        title = gettext("%(pub)s nově čepuje %(beer)s") % values
        label, value = gettext("Nově na čepu"), money(item.get("price"))
    elif kind == "price":
        rose = item["new"] > item["old"]
        title = (gettext("%(pub)s má dražší %(beer)s") if rose else gettext("%(pub)s má levnější %(beer)s")) % values
        label, value = gettext("Cena"), f"{item['old']} → {item['new']} {gettext('Kč')}"
    elif kind == "gone":
        title = gettext("%(pub)s už nečepuje %(beer)s") % values
        label, value = gettext("Už nečepují"), ""
    elif kind == "pub":
        title = gettext("Nová hospoda: %(pub)s") % values
        label, value = "", ""
    else:
        title = gettext("%(pub)s: %(title)s") % values
        label = gettext("Akce")
        value = formats.date_format(date.fromisoformat(item["starts"]), "D j. n." if lang == "cs" else "D, N j")
    place = item.get("district") or item.get("city")
    return {
        "title": title,
        "meta": " · ".join(part for part in (label, place) if part),
        "value": value,
        "icon": _ICONS[kind],
        "url": pub_url(item["name"], item["key"]),
    }


@web_page
def news(request: HttpRequest) -> HttpResponse:
    wait = throttle_wait(request, "web_pages")
    if wait:
        return too_many(request, wait, "news")

    lang = request.web_lang
    try:
        week = max(0, min(MAX_WEEKS_BACK, int(request.GET.get("tyden", 0))))
    except ValueError:
        week = 0
    kind = _KIND_BY_SLUG.get(request.GET.get("typ", ""), "")
    city_slug = slugify(request.GET.get("mesto", ""))
    items = _feed(week)["items"]
    city_counts = Counter(item["city"] for item in items if item["city"])
    cities = {slugify(name): name for name, _ in city_counts.most_common()}
    city = cities.get(city_slug, "")
    in_city = [item for item in items if not city or item["city"] == city]
    shown = [item for item in in_city if not kind or item["kind"] == kind]
    base = web_reverse("web-news")

    def url(**params) -> str:
        values = {"typ": _KIND_SLUGS.get(kind, ""), "mesto": city_slug if city else "", "tyden": week or "", **params}
        query = "&".join(f"{key}={value}" for key, value in values.items() if value)
        return f"{base}?{query}" if query else base

    labels = {
        "": gettext("Všechno"), "tap": gettext("Nově na čepu"), "pub": gettext("Nové hospody"),
        "price": gettext("Ceny"), "gone": gettext("Už nečepují"), "event": gettext("Akce"),
    }
    # Pub events are a real source, but the chip only shows once there is one to filter for.
    available = {"", "tap", "pub", "price", "gone"} | ({"event"} if any(i["kind"] == "event" for i in items) else set())
    kind_chips = [
        {"label": labels[key], "url": url(typ=_KIND_SLUGS.get(key, "")), "current": kind == key}
        for key in ("", *KINDS)
        if key in available
    ]
    city_links = [{"label": gettext("Všechna města"), "url": url(mesto=""), "current": not city}] + [
        {"label": name, "url": url(mesto=slug), "current": name == city} for slug, name in cities.items()
    ]

    today = timezone.localdate()
    days: list[dict] = []
    for item in shown:
        day = date.fromisoformat(item["day"])
        if not days or days[-1]["day"] != day:
            days.append({"day": day, "label": _day_label(day, today, lang), "rows": []})
        days[-1]["rows"].append(_row(item, lang))

    counts = Counter(item["kind"] for item in in_city)
    taps, pubs, prices = counts["tap"], counts["pub"], counts["price"]
    summary = gettext("%(taps)s, %(pubs)s a %(prices)s. Zapisují to lidi z Na pivo.") % {
        "taps": plural(taps, gettext("%(n)s pivo nově na čepu"), gettext("%(n)s piva nově na čepu"),
                       gettext("%(n)s piv nově na čepu")) % {"n": thousands(taps)},
        "pubs": plural(pubs, gettext("%(n)s nová hospoda"), gettext("%(n)s nové hospody"),
                       gettext("%(n)s nových hospod")) % {"n": thousands(pubs)},
        "prices": plural(prices, gettext("%(n)s změna ceny"), gettext("%(n)s změny cen"),
                         gettext("%(n)s změn cen")) % {"n": thousands(prices)},
    }
    period = (
        gettext("Za posledních 7 dní")
        if week == 0
        else gettext("Od %(from)s do %(to)s") % {
            "from": _short_day(today - timedelta(days=7 * (week + 1)), today, lang),
            "to": _short_day(today - timedelta(days=7 * week), today, lang),
        }
    )
    new_pubs = [
        {
            **pub,
            "url": pub_url(pub["name"], pub["key"]),
            "meta": " · ".join(
                part for part in (pub["district"] or pub["city"], _short_day(date.fromisoformat(pub["day"]), today, lang))
                if part
            ),
        }
        for pub in _new_pubs()
        if not city or pub["city"] == city
    ][:3]

    title = (
        gettext("Co je nového v hospodách: %(city)s") % {"city": city} if city else gettext("Co je nového v hospodách")
    )
    crumb_items = [("Na pivo", web_reverse("home")), (gettext("Novinky"), base)]
    if city:
        crumb_items.append((city, url(typ="", tyden="")))
    crumbs, crumb_graph = breadcrumbs(crumb_items)
    if week:
        stats_title = period
    elif city:
        stats_title = gettext("Tento týden: %(city)s") % {"city": city}
    else:
        stats_title = gettext("Tento týden")
    response = render_page(
        request,
        "web/public/news.html",
        {
            "crumbs": crumbs,
            "h1": title,
            "summary": f"{period}: {summary}",
            "kind_chips": kind_chips,
            "city_links": city_links,
            "city": city,
            "days": days,
            "stats": [
                {"value": thousands(taps), "label": gettext("nově na čepu")},
                {"value": thousands(pubs), "label": plural(pubs, gettext("nová hospoda"), gettext("nové hospody"), gettext("nových hospod"))},
                {"value": thousands(prices), "label": plural(prices, gettext("změna ceny"), gettext("změny cen"), gettext("změn cen"))},
            ],
            "stats_title": stats_title,
            "new_pubs": new_pubs,
            "new_pubs_url": url(typ="hospody"),
            "older_url": url(tyden=week + 1) if week < MAX_WEEKS_BACK else "",
            "newer_url": url(tyden=week - 1) if week else "",
            "filtered": bool(kind or city),
            "all_url": base,
            "structured_data": structured(crumb_graph),
            "og_image": home_og_image(),
        },
        title=title,
        description=gettext(
            "Co nově čepují, kde zdražili a které hospody přibyly. Každý den podle toho, co lidi zapsali v appce Na pivo."
        ),
        section="news",
        indexable=not request.GET,
    )
    return public_cache(response)


def sitemap_paths() -> list[str]:
    return [web_reverse("web-news", "cs")]

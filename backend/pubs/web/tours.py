"""/trasy: public tours people published from the app, and one tour with its stops.

A tour shows only what its author published: name, pubs, challenges and nickname.
Prices come from the pubs, not from the author.
"""

from __future__ import annotations

import math
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.http import Http404, HttpRequest, HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from django.utils.translation import gettext

from pubs.api.pub_beers_views import city_name
from pubs.home_views import canonical_host
from pubs.models import FriendBlock, PubPriceIndex, TourPublication
from pubs.price_map import _SOURCES, WINDOW_DAYS
from pubs.tours import fresh_people_count, readable_publications
from pubs.web.pages import render_page, web_page
from pubs.web.pub_map import live_map
from pubs.web.public_common import (
    PAGE_CACHE_SECONDS,
    breadcrumbs,
    decimal,
    og_image,
    pub_url,
    public_cache,
    structured,
    thousands,
    throttle_wait,
    too_many,
)
from pubs.web.routes import web_reverse
from pubs.web.words import plural

PAGE = 9
# The app's walking guess: air distance with a quarter added for streets, 80 m a minute.
DETOUR = 1.25
METERS_PER_MINUTE = 80
STOP_BUCKETS = {"2-3": (2, 3), "4-5": (4, 5), "6-8": (6, 8)}


def _air(a: dict, b: dict) -> float:
    d_lat, d_lon = math.radians(b["lat"] - a["lat"]), math.radians(b["lon"] - a["lon"])
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(d_lon / 2) ** 2
    return 2 * 6371000 * math.asin(min(1, math.sqrt(h)))


def _leg(a: dict, b: dict) -> tuple[int, int]:
    meters = _air(a, b) * DETOUR
    return round(meters), max(1, round(meters / METERS_PER_MINUTE))


def _km(meters: int) -> str:
    if meters < 1000:
        return f"{max(10, round(meters / 10) * 10)} m"
    return f"{decimal(meters / 1000)} km"


def _prices(cache_keys: set[str]) -> dict[str, int]:
    """The reference half litre each pub's price index knows from the last year."""

    rows = PubPriceIndex.objects.filter(
        cache_key__in=cache_keys, active=True, source__in=_SOURCES,
        observed_at__gte=timezone.now() - timedelta(days=WINDOW_DAYS),
    ).values_list("cache_key", "price_czk", "volume_ml")
    return {key: round(price * 500 / (volume or 500)) for key, price, volume in rows}


def _route_svg(stops: list[dict], width: int, height: int, pad: int) -> dict:
    """Stop positions on a flat drawing of the route, north up, keeping the real proportions."""

    lat0 = sum(stop["lat"] for stop in stops) / len(stops)
    xs = [stop["lon"] * math.cos(math.radians(lat0)) for stop in stops]
    ys = [-stop["lat"] for stop in stops]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
    scale = min((width - 2 * pad) / max(max(xs) - min(xs), span * 0.2), (height - 2 * pad) / max(max(ys) - min(ys), span * 0.2))
    off_x = (width - (max(xs) - min(xs)) * scale) / 2
    off_y = (height - (max(ys) - min(ys)) * scale) / 2
    points = [
        {"x": round(off_x + (x - min(xs)) * scale), "y": round(off_y + (y - min(ys)) * scale), "n": index + 1,
         "name": stops[index]["name"], "right": (off_x + (x - min(xs)) * scale) < width * 0.62}
        for index, (x, y) in enumerate(zip(xs, ys, strict=True))
    ]
    return {"w": width, "h": height, "points": points, "path": " ".join(f"{p['x']},{p['y']}" for p in points)}


def _card(publication: TourPublication, prices: dict[str, int]) -> dict:
    stops = publication.snapshot["stops"]
    known = [prices[stop["cache_key"]] for stop in stops if stop.get("cache_key") in prices]
    return {
        "token": publication.token,
        "title": publication.title,
        "city": city_name(publication.city) or publication.city,
        "area": publication.city,
        "stops": publication.stop_count,
        "walk_m": publication.walk_m,
        "avg": round(sum(known) / len(known)) if known else None,
        "people": publication.people_count,
        "author": publication.plan.owner.nickname,
        "owner_id": publication.plan.owner_id,
        "map": _route_svg(stops, 360, 150, 22),
        "map_big": _route_svg(stops, 640, 400, 80),
        "names": " · ".join(stop["name"] for stop in stops[:3]) + (" …" if len(stops) > 3 else ""),
    }


def _pubs_word(number: int) -> str:
    return plural(number, gettext("hospoda"), gettext("hospody"), gettext("hospod"))


def _card_view(card: dict) -> dict:
    return {
        **card,
        "url": web_reverse("web-tour", tour_id=card["token"]),
        "km": _km(card["walk_m"]),
        "avg_label": f"{card['avg']} {gettext('Kč')}" if card["avg"] else "",
        "people_label": thousands(card["people"]),
        "stops_label": _pubs_word(card["stops"]),
    }


def _hidden_authors(account) -> set[int]:
    if account is None:
        return set()
    pairs = FriendBlock.objects.filter(Q(blocker=account) | Q(blocked=account)).values_list("blocker_id", "blocked_id")
    return {person for pair in pairs for person in pair} - {account.pk}


def _listing(city: str, stops: str) -> dict:
    """Every public tour matching the filters, most walked first, and the cities that have one."""

    def build() -> dict:
        from pubs.api.tour_search_views import _most_walked

        rows = readable_publications()
        cities: dict[str, str] = {}
        for raw in rows.values_list("city", flat=True):
            if name := city_name(raw):
                cities.setdefault(slugify(name), name)
        if stops in STOP_BUCKETS:
            low, high = STOP_BUCKETS[stops]
            rows = rows.filter(stop_count__gte=low, stop_count__lte=high)
        publications = list(_most_walked(rows)[:200])
        if city:
            publications = [p for p in publications if slugify(city_name(p.city)) == city]
        prices = _prices({stop.get("cache_key") for p in publications for stop in p.snapshot["stops"]} - {None, ""})
        return {
            "cards": [_card(p, prices) for p in publications],
            "cities": dict(sorted(cities.items(), key=lambda item: item[1])),
        }

    return cache.get_or_set(f"web:tours:{city}:{stops}", build, PAGE_CACHE_SECONDS // 2)


@web_page
def tours(request: HttpRequest) -> HttpResponse:
    wait = throttle_wait(request, "tour_public")
    if wait:
        return too_many(request, wait, "tours")

    city = slugify(request.GET.get("mesto", ""))
    stops = request.GET.get("hospod", "")
    stops = stops if stops in STOP_BUCKETS else ""
    try:
        page = max(1, min(20, int(request.GET.get("strana", 1))))
    except ValueError:
        page = 1
    data = _listing(city, stops)
    city_label = data["cities"].get(city, "")
    city = city if city_label else ""
    hidden = _hidden_authors(request.web_account)
    cards = [_card_view(card) for card in data["cards"] if card["owner_id"] not in hidden]
    shown = cards[: 1 + PAGE * page]
    base = web_reverse("web-tours")

    def url(**params) -> str:
        values = {"mesto": city, "hospod": stops, **params}
        query = "&".join(f"{key}={value}" for key, value in values.items() if value)
        return f"{base}?{query}" if query else base

    stop_chips = [{"label": gettext("Hospod: všechny"), "url": url(hospod=""), "current": not stops}] + [
        {"label": gettext("Hospod: %(range)s") % {"range": key.replace("-", " až ") if request.web_lang == "cs" else key.replace("-", " to ")},
         "url": url(hospod=key), "current": stops == key}
        for key in STOP_BUCKETS
    ]
    city_links = [{"label": gettext("Všechna města"), "url": url(mesto=""), "current": not city}] + [
        {"label": name, "url": url(mesto=slug), "current": slug == city} for slug, name in data["cities"].items()
    ]
    crumbs, crumb_graph = breadcrumbs([("Na pivo", web_reverse("home")), (gettext("Trasy"), base)])
    graph = [crumb_graph]
    if shown:
        origin = settings.PUBLIC_WEB_ORIGIN
        graph.append({
            "@type": "ItemList",
            "itemListElement": [
                {"@type": "ListItem", "position": index, "name": card["title"], "url": f"{origin}{card['url']}"}
                for index, card in enumerate(shown, start=1)
            ],
        })
    total = len(cards)
    response = render_page(
        request,
        "web/public/tours.html",
        {
            "crumbs": crumbs,
            "lead": plural(
                total,
                gettext("%(n)s trasa po hospodách, kterou lidi z appky sestavili a zveřejnili."),
                gettext("%(n)s trasy po hospodách, které lidi z appky sestavili a zveřejnili."),
                gettext("%(n)s tras po hospodách, které lidi z appky sestavili a zveřejnili."),
            ) % {"n": thousands(total)},
            "featured": shown[0] if shown else None,
            "cards": shown[1:],
            "stop_chips": stop_chips,
            "city_links": city_links,
            "city_label": city_label,
            "filtered": bool(city or stops),
            "all_url": base,
            "more_url": url(strana=page + 1) if len(cards) > len(shown) else "",
            "count_label": gettext("Ukazuju %(shown)s z %(total)s tras") % {"shown": len(shown), "total": total},
            "structured_data": structured(*graph),
            "og_image": f"{settings.PUBLIC_WEB_ORIGIN}{_home_og()}",
        },
        title=gettext("Pivní trasy: %(city)s") % {"city": city_label} if city_label else gettext("Pivní trasy po hospodách"),
        description=gettext(
            "Trasy po hospodách, které sestavili lidi z appky Na pivo. U každé hospody cena piva a kolik se jde pěšky."
        ),
        section="tours",
        indexable=not request.GET,
    )
    return public_cache(response, 300)


def _home_og() -> str:
    from pubs.home_views import HOME_OG_PATH

    return HOME_OG_PATH


def _publication(token: str) -> TourPublication:
    publication = readable_publications().filter(token=token).first()
    if publication is None:
        raise Http404
    return publication


def _detail(publication: TourPublication) -> dict:
    stops = publication.snapshot["stops"]
    prices = _prices({stop.get("cache_key") for stop in stops} - {None, ""})
    rows = []
    walk_minutes = 0
    for index, stop in enumerate(stops):
        leg = _leg(stops[index - 1], stop) if index else None
        if leg:
            walk_minutes += leg[1]
        rows.append({
            "n": index + 1,
            "name": stop["name"],
            "area": stop.get("address") or "",
            "challenge": stop.get("challenge") or "",
            "price": prices.get(stop.get("cache_key") or ""),
            "url": pub_url(stop["name"], stop["cache_key"]) if stop.get("cache_key") else "",
            "leg": {"distance": _km(leg[0]), "minutes": leg[1]} if leg else None,
        })
    known = [row["price"] for row in rows if row["price"]]
    return {
        "rows": rows,
        "walk_minutes": walk_minutes,
        "avg": round(sum(known) / len(known)) if known else None,
        # Two beers in every pub, only when every pub has a price.
        "two_each": 2 * sum(known) if len(known) == len(rows) else None,
    }


@web_page
def tour(request: HttpRequest, tour_id: str) -> HttpResponse:
    wait = throttle_wait(request, "tour_public")
    if wait:
        return too_many(request, wait, "tours")
    publication = readable_publications().filter(token=tour_id).first()
    if publication is None or publication.plan.owner_id in _hidden_authors(request.web_account):
        response = render_page(
            request, "web/public/tour.html", {"missing": True}, title=gettext("Tahle trasa už není veřejná"),
            section="tours", status=404,
        )
        return response
    detail = _detail(publication)
    people = fresh_people_count(publication)
    stops = publication.snapshot["stops"]
    city = city_name(publication.city) or publication.city
    base = web_reverse("web-tours")
    city_url = f"{base}?mesto={slugify(city)}" if city else base
    crumb_items = [("Na pivo", web_reverse("home")), (gettext("Trasy"), base)]
    if city:
        crumb_items.append((city, city_url))
    crumb_items.append((publication.title, web_reverse("web-tour", tour_id=publication.token)))
    crumbs, crumb_graph = breadcrumbs(crumb_items)
    origin = settings.PUBLIC_WEB_ORIGIN
    page_url = f"{origin}{web_reverse('web-tour', tour_id=publication.token)}"
    trip = {
        "@type": "TouristTrip",
        "name": publication.title,
        "url": page_url,
        "itinerary": {
            "@type": "ItemList",
            "itemListElement": [
                {"@type": "ListItem", "position": row["n"], "item": {"@type": "BarOrPub", "name": row["name"], "address": row["area"]}}
                for row in detail["rows"]
            ],
        },
    }
    nearby_rows = list(
        readable_publications().filter(city=publication.city).exclude(pk=publication.pk).order_by("-people_count", "-published_at")[:3]
    )
    nearby_prices = _prices({stop.get("cache_key") for p in nearby_rows for stop in p.snapshot["stops"]} - {None, ""})
    hidden = _hidden_authors(request.web_account)
    nearby = [_card_view(_card(p, nearby_prices)) for p in nearby_rows if p.plan.owner_id not in hidden]
    waypoints = "|".join(f"{stop['lat']},{stop['lon']}" for stop in stops[1:-1])
    maps_url = (
        "https://www.google.com/maps/dir/?api=1&travelmode=walking"
        f"&origin={stops[0]['lat']},{stops[0]['lon']}&destination={stops[-1]['lat']},{stops[-1]['lon']}"
        + (f"&waypoints={quote(waypoints, safe=',')}" if waypoints else "")
    )
    meta = [city or publication.city, gettext("sestavil @%(nick)s") % {"nick": publication.plan.owner.nickname}]
    if people:
        meta.append(plural(people, gettext("prošel ji %(n)s člověk"), gettext("prošli ji %(n)s lidé"),
                           gettext("prošlo ji %(n)s lidí")) % {"n": thousands(people)})
    stats = [{"value": _km(publication.walk_m), "label": gettext("celkem pěšky")},
             {"value": f"{detail['walk_minutes']} min", "label": gettext("čisté chůze mezi hospodami")}]
    if detail["two_each"]:
        stats.append({"value": f"~ {thousands(detail['two_each'])} {gettext('Kč')}", "label": gettext("když dáš dvě v každé hospodě")})
    elif detail["avg"]:
        stats.append({"value": f"{detail['avg']} {gettext('Kč')}", "label": gettext("průměr za pivo")})
    stats.append({"value": str(len(stops)), "label": _pubs_word(len(stops))})
    response = render_page(
        request,
        "web/public/tour.html",
        {
            "crumbs": crumbs,
            "tour": publication,
            "meta": " · ".join(part for part in meta if part),
            "stats": stats,
            "rows": detail["rows"],
            "stops_title": plural(len(stops), gettext("%(n)s zastávka"), gettext("%(n)s zastávky"),
                                  gettext("%(n)s zastávek")) % {"n": len(stops)},
            "map": _route_svg(stops, 600, 560, 70),
            "map_phone": _route_svg(stops, 390, 240, 34),
            "live_map": live_map(
                [
                    {"lat": stop["lat"], "lng": stop["lon"], "label": stop["name"], "name": stop["name"], "url": row["url"]}
                    for stop, row in zip(stops, detail["rows"], strict=True)
                ],
                kind="route",
            ),
            "maps_url": maps_url,
            "app_url": f"/t/{quote(publication.token, safe='')}",
            "share_url": page_url,
            "nearby": nearby,
            "city": city,
            "city_url": city_url,
            "structured_data": structured(crumb_graph, trip),
            "og_image": f"{origin}{web_reverse('tour-og', tour_id=publication.token)}?v={publication.revision}",
        },
        title=gettext("%(title)s: pivní trasa") % {"title": publication.title},
        description=gettext("%(title)s: %(count)s %(pubs)s, %(km)s pěšky. Trasu sestavil @%(nick)s v appce Na pivo.") % {
            "title": publication.title, "count": len(stops), "pubs": _pubs_word(len(stops)),
            "km": _km(publication.walk_m), "nick": publication.plan.owner.nickname,
        },
        section="tours",
        with_map=True,
    )
    return public_cache(response, 300)


@canonical_host
def tour_og(request: HttpRequest, tour_id: str, lang: str = "cs") -> HttpResponse:
    from django.utils import translation

    wait = throttle_wait(request, "tour_public")
    if wait:
        response = HttpResponse(status=429)
        response["Retry-After"] = str(wait)
        return response
    publication = _publication(tour_id)

    def draw() -> bytes:
        detail = _detail(publication)
        with translation.override(lang):
            figures = [(_km(publication.walk_m), gettext("celkem")),
                       (f"{detail['walk_minutes']} min", gettext("chůze mezi hospodami"))]
            if detail["avg"]:
                figures.append((f"{detail['avg']} {gettext('Kč')}", gettext("průměrný půllitr")))
            return og_image(
                kicker=" · ".join(part for part in (publication.city, f"@{publication.plan.owner.nickname}") if part),
                title=publication.title,
                hero=str(publication.stop_count),
                hero_label=_pubs_word(publication.stop_count),
                figures=figures,
                address=settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + web_reverse("web-tours", lang),
            )

    image = cache.get_or_set(f"web:tour-og:{publication.token}:{publication.revision}:{lang}", draw, 86400)
    response = HttpResponse(image, content_type="image/png")
    response["Cache-Control"] = "public, max-age=3600"
    return response


def sitemap_paths() -> list[str]:
    paths = [web_reverse("web-tours", "cs")]
    for token in readable_publications().order_by("-people_count").values_list("token", flat=True)[:500]:
        paths.append(web_reverse("web-tour", "cs", tour_id=token))
    return paths

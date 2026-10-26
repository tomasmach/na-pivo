"""The guide part of na-pivo.cz: pub search, a page per pub, events and public routes.

The pages read the rows the daily run in ``web_pubs`` writes, plus live verified
events. They show only what people wrote in Na pivo.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timedelta
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import segno
from django.conf import settings
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.utils import formats, timezone, translation
from django.utils.safestring import mark_safe
from django.utils.text import slugify
from django.utils.translation import gettext

from pubs.api.pub_beers_views import city_name
from pubs.beer_pages import PATHS as BEER_PATHS
from pubs.beer_pages import counted
from pubs.enrichment import names_match
from pubs.enrichment.matcher import geohash8
from pubs.home_views import _LANDING_URLS, _LEGAL_ROOT, app_store_url, ld_json, play_store_url
from pubs.models import BeerProduct, PubPriceSnapshot, WebPub
from pubs.price_map import PATHS as PRICE_PATHS
from pubs.tours import readable_publications, walking_meters
from pubs.web_paths import EVENTS_PATHS, PUB_PATHS, PUBS_PATHS, TOURS_PATHS, nav_paths
from pubs.web_pubs import (
    AMENITY_SLUGS,
    GUIDE_MIN_PUBS,
    Search,
    amenity_kinds,
    search_pubs,
    upcoming_events,
)

PRAGUE = ZoneInfo("Europe/Prague")
TOURS_CITY = {"cs": "mesto", "en": "city"}
_OG_LOCALES = {"cs": "cs_CZ", "en": "en_US"}
_DAYS = ("mo", "tu", "we", "th", "fr", "sa", "su")
# Shown on desktop next to every pub; most visitors meet a pub on a phone.
_QR_SCALE = 5


def pub_url(pub: WebPub, lang: str = "cs") -> str:
    return f"{PUB_PATHS[lang]}/{pub.city_slug}/{pub.slug}"


def pub_urls(keys, lang: str = "cs") -> dict[str, str]:
    """Pages of the listed pubs among these cells, for lists that used to point at a map."""

    keys = {key for key in keys if key}
    return {pub.cache_key: pub_url(pub, lang) for pub in WebPub.objects.filter(cache_key__in=keys, listed=True)}


def _context(lang: str, section: str, campaign: str, **extra) -> dict:
    """What every guide page's header and footer need."""

    return {
        "LANGUAGE_CODE": lang,
        "og_locale": _OG_LOCALES[lang],
        "section": section,
        "asset": _LANDING_URLS,
        "nav": nav_paths(lang),
        "app_store_url": app_store_url(campaign),
        "play_store_url": play_store_url(campaign),
        "privacy_url": f"{_LEGAL_ROOT}{'' if lang == 'cs' else '/en'}/privacy.html",
        "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}{_LANDING_URLS['og_home_png']}",
        "indexable": True,
        **extra,
    }


def _respond(request: HttpRequest, template: str, context: dict, status: int = 200) -> HttpResponse:
    with translation.override(context["LANGUAGE_CODE"]):
        response = render(request, template, context, status=status)
    response["Content-Language"] = context["LANGUAGE_CODE"]
    response["Cache-Control"] = "public, max-age=600"
    response["Content-Security-Policy"] = (
        "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
        "script-src 'self'; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    response["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


def _short(day: date) -> str:
    """26. 10. in Czech, 26 Oct in English."""

    return formats.date_format(day, "j M" if translation.get_language() == "en" else "j. n.")


def _day_label(day: date, today: date) -> str:
    if day == today:
        return gettext("Dnes")
    if day == today + timedelta(days=1):
        return gettext("Zítra")
    return formats.date_format(day, "l j. n.").capitalize()


def _hours_rows(week: dict | None) -> list[dict]:
    """Days with the same hours in one row: Po–Čt 15:00–23:00."""

    if not isinstance(week, dict) or not all(isinstance(week.get(day), list) for day in _DAYS):
        return []
    names = [formats.date_format(date(2024, 1, 1) + timedelta(days=index), "D").capitalize() for index in range(7)]
    rows: list[dict] = []
    for index, day in enumerate(_DAYS):
        spans = ", ".join(f"{span[0]}–{span[1]}" for span in week[day] if len(span) == 2) or gettext("zavřeno")
        if rows and rows[-1]["spans"] == spans:
            rows[-1]["last"] = names[index]
        else:
            rows.append({"first": names[index], "last": "", "spans": spans})
    return [{"days": f"{row['first']}–{row['last']}" if row["last"] else row["first"], "spans": row["spans"]} for row in rows]


def _minutes(value: str) -> int | None:
    try:
        hours, minutes = value.split(":")
        return int(hours) * 60 + int(minutes)
    except (AttributeError, ValueError):
        return None


def _open_status(week: dict | None, now: datetime) -> str:
    """"Otevřeno do 23:00", "Otevírá v 15:00" or "Dnes zavřeno" from the hours people wrote."""

    if not isinstance(week, dict):
        return ""
    local = timezone.localtime(now, PRAGUE)
    minute = local.hour * 60 + local.minute
    today, yesterday = _DAYS[local.weekday()], _DAYS[(local.weekday() - 1) % 7]
    for span in week.get(yesterday) or []:
        start, end = (_minutes(span[0]), _minutes(span[1])) if len(span) == 2 else (None, None)
        if start is not None and end is not None and end <= start and minute < end:
            return gettext("Otevřeno do %(time)s") % {"time": span[1]}
    later = None
    for span in week.get(today) or []:
        start, end = (_minutes(span[0]), _minutes(span[1])) if len(span) == 2 else (None, None)
        if start is None or end is None:
            continue
        if start <= minute and (minute < end or end <= start):
            return gettext("Otevřeno do %(time)s") % {"time": span[1]}
        if minute < start and (later is None or start < _minutes(later)):
            later = span[0]
    if later:
        return gettext("Otevírá v %(time)s") % {"time": later}
    return gettext("Dnes zavřeno") if today in week else ""


def _litres(volume_ml: int | None) -> str:
    return formats.number_format((volume_ml or 500) / 1000, decimal_pos=None) + " l"


def _city_median(city: str) -> int | None:
    snapshot = PubPriceSnapshot.objects.only("data").first()
    for area in snapshot.data.get("cities", []) if snapshot else []:
        if area["name"] == city:
            return area["median"]
    return None


def _qr(url: str) -> str:
    code = segno.make(url, error="m")
    svg = code.svg_inline(scale=_QR_SCALE, border=0, dark="#FBF3E0", light=None, omitsize=False)
    return mark_safe(svg.replace("<svg ", f'<svg role="img" aria-label="{gettext("QR kód s odkazem na tuto stránku")}" ', 1))


def _app_link(pub: WebPub) -> str:
    """The app's own pub screen; released builds read these four values."""

    query = urlencode({"key": pub.cache_key, "name": pub.name, "lat": pub.lat, "lng": pub.lng}, quote_via=quote)
    return f"napivo://pub?{query}"


def pub_page(request: HttpRequest, city: str, slug: str, lang: str = "cs") -> HttpResponse:
    """One pub: what it pours and for how much, its events, hours and amenities."""

    pub = WebPub.objects.filter(city_slug=city, slug=slug, listed=True).first()
    if pub is None:
        raise Http404
    origin = settings.PUBLIC_WEB_ORIGIN
    now = timezone.now()
    with translation.override(lang):
        today = timezone.localdate(now)
        beers = []
        for beer in pub.beers:
            confirmed = date.fromisoformat(beer["confirmed"])
            beers.append({
                **beer,
                "litres": _litres(beer["volume_ml"]),
                "confirmed_label": (
                    gettext("zapsáno %(date)s") % {"date": _short(confirmed)}
                    if beer["fresh"]
                    else gettext("zapsáno %(date)s, možná už nečepují") % {"date": _short(confirmed)}
                ),
                "url": f"{BEER_PATHS[lang]}/{beer['key']}" if beer["key"] else "",
            })
        events = [
            {
                "day": _day_label(timezone.localdate(item["event"].starts_at), today),
                "time": timezone.localtime(item["event"].starts_at, PRAGUE).strftime("%H:%M"),
                "title": item["event"].title,
                "details": item["event"].details,
            }
            for item in upcoming_events([pub.cache_key], now=now)
            if item["pub"] is not None and item["pub"].pk == pub.pk
        ]
        kinds = amenity_kinds()
        facts = [
            {
                "label": kind.label if lang == "cs" else kind.label_en or kind.label,
                "yes": pub.amenities[key]["status"] == "yes",
                "voters": pub.amenities[key]["voters"],
            }
            for key, kind in kinds.items()
            if key in pub.amenities
        ]
        median = _city_median(pub.city)
        reasons = []
        if pub.price_czk:
            cheaper = median - pub.price_czk if median else 0
            reasons.append({
                "icon": "tag",
                "title": gettext("%(beer)s za %(price)s Kč") % {"beer": pub.price_beer, "price": pub.price_czk},
                "detail": (
                    gettext("o %(count)s Kč levněji, než je ve městě obvyklé") % {"count": cheaper}
                    if cheaper >= 3
                    else gettext("nejlevnější pivo na lístku, %(litres)s") % {"litres": _litres(pub.price_volume_ml)}
                ),
            })
        if events:
            reasons.append({
                "icon": "calendar",
                "title": f"{events[0]['day']}: {events[0]['title']}",
                "detail": gettext("od %(time)s") % {"time": events[0]["time"]},
            })
        best = max((fact for fact in facts if fact["yes"]), key=lambda fact: fact["voters"], default=None)
        if best:
            reasons.append({
                "icon": "check",
                "title": best["label"],
                "detail": gettext("ano podle %(people)s") % {
                    "people": counted(best["voters"], gettext("člověka"), gettext("lidí"), gettext("lidí"))
                },
            })
        path = pub_url(pub, lang)
        canonical = f"{origin}{path}"
        place = pub.district or pub.city
        title = gettext("%(pub)s, %(city)s: co čepují a za kolik") % {"pub": pub.name, "city": place}
        beer_names = ", ".join(beer["name"] for beer in pub.beers[:3])
        description = gettext("Na čepu: %(beers)s. Ceny, akce a vybavení podle lidí z Na pivo.") % {"beers": beer_names}
        context = _context(
            lang,
            "pubs",
            "pub",
            page_title=f"{title} | Na pivo",
            og_title=pub.name,
            description=description,
            canonical_url=canonical,
            switch_url=pub_url(pub, "en" if lang == "cs" else "cs"),
            app_argument=_app_link(pub),
            pub=pub,
            place=place,
            city_url=f"{PUBS_PATHS[lang]}/{pub.city_slug}",
            status=_open_status(pub.hours, now),
            confirmed=_short(pub.confirmed) if pub.confirmed else "",
            all_old=bool(beers) and not any(beer["fresh"] for beer in beers),
            beers=beers,
            events=events,
            hours=_hours_rows(pub.hours),
            facts=facts,
            unknown_facts=len(kinds) - len(facts),
            median=median,
            reasons=reasons[:3],
            navigate_url=f"https://www.google.com/maps/dir/?api=1&destination={pub.lat},{pub.lng}",
            qr=_qr(canonical),
            map_pins_json=json.dumps([{"lat": pub.lat, "lng": pub.lng, "label": str(pub.price_czk or ""), "on": True}]),
            structured_data=ld_json({
                "@type": "BarOrPub",
                "name": pub.name,
                "url": canonical,
                "address": {"@type": "PostalAddress", "addressLocality": pub.city, "addressCountry": "CZ"},
                "geo": {"@type": "GeoCoordinates", "latitude": pub.lat, "longitude": pub.lng},
            }),
        )
    return _respond(request, "pubs/web/pub.html", context)


def events_page(request: HttpRequest, city: str = "", lang: str = "cs") -> HttpResponse:
    """Verified events in pubs for the next weeks, by day; optionally one city."""

    now = timezone.now()
    with translation.override(lang):
        today = timezone.localdate(now)
        found = upcoming_events(city_slug=city, now=now)
        cities = sorted({(item["city"], item["pub"].city_slug if item["pub"] else "") for item in upcoming_events(now=now)})
        city_name = next((name for name, slug in cities if slug == city), "")
        if city and not city_name:
            raise Http404
        days: list[dict] = []
        for item in found:
            event = item["event"]
            day = timezone.localdate(event.starts_at)
            if not days or days[-1]["date"] != day:
                days.append({"date": day, "label": _day_label(day, today), "events": []})
            pub = item["pub"]
            days[-1]["events"].append({
                "time": timezone.localtime(event.starts_at, PRAGUE).strftime("%H:%M"),
                "until": timezone.localtime(event.ends_at, PRAGUE).strftime("%H:%M"),
                "title": event.title,
                "details": event.details,
                "pub_name": pub.name if pub else event.name,
                "pub_url": pub_url(pub, lang) if pub else "",
                "city": item["city"],
            })
        path = f"{EVENTS_PATHS[lang]}/{city}" if city else EVENTS_PATHS[lang]
        title = (
            gettext("Akce v hospodách: %(city)s") % {"city": city_name} if city_name else gettext("Akce v hospodách")
        )
        context = _context(
            lang,
            "events",
            "events",
            page_title=f"{title} | Na pivo",
            description=gettext("Kvízy, sudy, degustace a muzika v hospodách na příštích 30 dní."),
            canonical_url=f"{settings.PUBLIC_WEB_ORIGIN}{path}",
            switch_url=(f"{EVENTS_PATHS['en' if lang == 'cs' else 'cs']}/{city}" if city else EVENTS_PATHS["en" if lang == "cs" else "cs"]),
            h1=title,
            days=days,
            city=city,
            cities=[{"name": name, "slug": slug, "url": f"{EVENTS_PATHS[lang]}/{slug}"} for name, slug in cities if slug],
            all_url=EVENTS_PATHS[lang],
            indexable=bool(days),
        )
    return _respond(request, "pubs/web/events.html", context)


def _tour_city(publication) -> str:
    return city_name(publication.city or "")


def tours_page(request: HttpRequest, city: str = "", lang: str = "cs") -> HttpResponse:
    """Routes people published from the app, the most walked first."""

    with translation.override(lang):
        publications = list(readable_publications().order_by("-people_count", "-published_at")[:500])
        cities = sorted({(_tour_city(item), slugify(_tour_city(item))) for item in publications if _tour_city(item)})
        city_label = next((name for name, slug in cities if slug == city), "")
        if city and not city_label:
            raise Http404
        tours = [
            {
                "title": item.title,
                "city": _tour_city(item),
                "stops": counted(item.stop_count, gettext("hospoda"), gettext("hospody"), gettext("hospod")),
                "walk": _walk(item.walk_m),
                "people": _walked(item.people_count, short=True),
                "url": f"{TOURS_PATHS[lang]}/{item.public_id}",
            }
            for item in publications
            if not city or slugify(_tour_city(item)) == city
        ][:100]
        title = gettext("Pivní trasy: %(city)s") % {"city": city_label} if city_label else gettext("Pivní trasy")
        path = f"{TOURS_PATHS[lang]}/{TOURS_CITY[lang]}/{city}" if city else TOURS_PATHS[lang]
        context = _context(
            lang,
            "tours",
            "tours",
            page_title=f"{title} | Na pivo",
            description=gettext("Trasy po hospodách, které lidi sestavili v Na pivo. Projdeš je s aplikací v ruce."),
            canonical_url=f"{settings.PUBLIC_WEB_ORIGIN}{path}",
            h1=title,
            tours=tours,
            city=city,
            cities=[{"name": name, "slug": slug, "url": f"{TOURS_PATHS[lang]}/{TOURS_CITY[lang]}/{slug}"} for name, slug in cities],
            all_url=TOURS_PATHS[lang],
            indexable=bool(tours),
        )
    return _respond(request, "pubs/web/tours.html", context)


def _walked(people: int, short: bool = False) -> str:
    """Czech agrees verb and noun with the count: prošel 1 člověk, prošli 3 lidé, prošlo 5 lidí."""

    if not people:
        return ""
    if short:
        form = (gettext("prošel %(count)s člověk") if people == 1 else gettext("prošli %(count)s lidé")
                if 2 <= people <= 4 else gettext("prošlo %(count)s lidí"))
    else:
        form = (gettext("prošel ji %(count)s člověk") if people == 1 else gettext("prošli ji %(count)s lidé")
                if 2 <= people <= 4 else gettext("prošlo ji %(count)s lidí"))
    return form % {"count": people}


def _distance(meters: float) -> str:
    if meters < 1000:
        return f"{round(meters, -1):.0f} m"
    return f"{formats.number_format(meters / 1000, decimal_pos=1)} km"


def _walk(meters: int) -> str:
    if meters < 1000:
        return gettext("%(meters)s m pěšky") % {"meters": round(meters, -1)}
    return gettext("%(km)s km pěšky") % {"km": formats.number_format(meters / 1000, decimal_pos=1)}


def tour_page(request: HttpRequest, public_id, lang: str = "cs") -> HttpResponse:
    """One public route: its pubs in order, on a map, and the way to walk it in the app."""

    publication = readable_publications().filter(public_id=public_id).first()
    if publication is None:
        raise Http404
    stops = publication.snapshot["stops"]
    cells = {geohash8(stop["lat"], stop["lon"]) for stop in stops}
    pages = {pub.cache_key: pub for pub in WebPub.objects.filter(cache_key__in=cells, listed=True)}
    with translation.override(lang):
        rows = []
        for index, stop in enumerate(stops):
            pub = pages.get(geohash8(stop["lat"], stop["lon"]))
            step = walking_meters([stops[index - 1], stop]) if index else 0
            rows.append({
                "name": stop["name"],
                "city": city_name(stop.get("address") or ""),
                "url": pub_url(pub, lang) if pub and names_match(pub.name, stop["name"]) else "",
                "price": pub.price_czk if pub and names_match(pub.name, stop["name"]) else None,
                "step": gettext("o %(distance)s dál") % {"distance": _distance(step)} if index else gettext("začátek"),
            })
        city = _tour_city(publication)
        title = publication.title
        context = _context(
            lang,
            "tours",
            "tour",
            page_title=gettext("%(title)s: pivní trasa, %(city)s | Na pivo") % {"title": title, "city": city},
            og_title=title,
            description=gettext("%(stops)s, %(walk)s. Trasu sestavil člověk z Na pivo.") % {
                "stops": counted(len(stops), gettext("hospoda"), gettext("hospody"), gettext("hospod")),
                "walk": _walk(publication.walk_m),
            },
            canonical_url=f"{settings.PUBLIC_WEB_ORIGIN}{TOURS_PATHS[lang]}/{publication.public_id}",
            app_argument=f"napivo://t/{publication.token}",
            h1=title,
            city=city,
            city_url=f"{TOURS_PATHS[lang]}/{TOURS_CITY[lang]}/{slugify(city)}" if city else TOURS_PATHS[lang],
            summary=f"{counted(len(stops), gettext('hospoda'), gettext('hospody'), gettext('hospod'))} · {_walk(publication.walk_m)}",
            stops=rows,
            people=_walked(publication.people_count),
            walk_url=f"/t/{publication.token}",
            map_pins_json=json.dumps(
                [{"lat": stop["lat"], "lng": stop["lon"], "label": str(index + 1)} for index, stop in enumerate(stops)]
            ),
        )
    return _respond(request, "pubs/web/tour.html", context)


def guide_title(key: str) -> str:
    """How a guide names its pubs; Czech needs the whole phrase, not a label."""

    return {
        "seating_garden": gettext("hospody se zahrádkou"),
        "game_darts": gettext("hospody se šipkami"),
        "payment_card": gettext("hospody, kde zaplatíš kartou"),
        "seating_barrier_free": gettext("bezbariérové hospody"),
        "practical_tank_beer": gettext("hospody s tankovým pivem"),
        "game_billiards": gettext("hospody s kulečníkem"),
        "game_foosball": gettext("hospody se stolním fotbalem"),
        "atmosphere_sports_tv": gettext("hospody, kde běží sport"),
        "practical_wifi": gettext("hospody s Wi-Fi"),
        "practical_parking": gettext("hospody s parkováním"),
        "atmosphere_smoking": gettext("kuřácké hospody"),
    }[key]


def _center(pubs, search: Search) -> str:
    """Where the map looks when there are no pins: the city, the visitor or the searched area."""

    if search.area:
        south, west, north, east = search.area
        return json.dumps([(west + east) / 2, (south + north) / 2])
    if search.near:
        return json.dumps([search.near[1], search.near[0]])
    if pubs is not None:
        points = list(pubs.values_list("lat", "lng")[:2000])
        if points:
            return json.dumps([sum(p[1] for p in points) / len(points), sum(p[0] for p in points) / len(points)])
    return ""


def slugs_to_keys() -> dict[str, str]:
    return {slug: key for key, slug in AMENITY_SLUGS.items()}


SORT_PARAMS = {"cena": "price", "vzdalenost": "distance", "potvrzeno": "confirmed"}
PRICE_STEPS = (45, 50, 55, 60, 70)
# Filters shown right away; the rest wait behind "Další".
PRIMARY_FILTERS = ("seating_garden", "game_darts", "payment_card", "practical_tank_beer")
PAGE_ROWS = 60


def _beer_choices(city: str) -> list[tuple[str, str]]:
    """Catalogue beers some listed pub pours, in the city when there is one, the most poured first."""

    pubs = WebPub.objects.filter(listed=True).exclude(beer_keys="")
    if city:
        pubs = pubs.filter(city_slug=city)
    counts: dict[str, int] = {}
    for keys in pubs.values_list("beer_keys", flat=True):
        for key in keys.strip("|").split("|"):
            counts[key] = counts.get(key, 0) + 1
    names = dict(BeerProduct.objects.filter(key__in=counts).values_list("key", "name"))
    return sorted(((key, names[key]) for key in counts if key in names), key=lambda item: (-counts[item[0]], item[1]))


def _float(value: str, low: float, high: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def _parse_search(request: HttpRequest, city: str, guide: str) -> tuple[Search, dict]:
    """The search as the address states it; anything malformed is ignored, never an error."""

    slugs = {slug: key for key, slug in AMENITY_SLUGS.items()}
    kinds = amenity_kinds()
    chosen = [slugs[slug] for slug in request.GET.getlist("vybaveni") if slugs.get(slug) in kinds]
    if guide:
        chosen = [slugs[guide], *[key for key in chosen if key != slugs[guide]]]
    lat = _float(request.GET.get("lat"), 48.5, 51.1)
    lng = _float(request.GET.get("lng"), 12.0, 18.9)
    area = None
    if request.GET.get("oblast"):
        parts = [_float(part, -180, 180) for part in request.GET["oblast"].split(",")]
        if len(parts) == 4 and None not in parts and parts[0] < parts[2] and parts[1] < parts[3]:
            area = tuple(parts)
    beers = dict(_beer_choices(city))
    beer = request.GET.get("pivo", "")
    max_price = request.GET.get("do", "")
    near = (round(lat, 3), round(lng, 3)) if lat is not None and lng is not None else None
    sort = SORT_PARAMS.get(request.GET.get("razeni", ""), "distance" if near and not area else "price")
    if sort == "distance" and not near:
        sort = "price"
    search = Search(
        city_slug=city,
        near=near,
        area=area,
        text=" ".join(request.GET.get("q", "").split())[:80],
        beer=beer if beer in beers else "",
        max_price=int(max_price) if max_price.isdigit() and int(max_price) in PRICE_STEPS else None,
        amenities=tuple(dict.fromkeys(chosen))[:5],
        sort=sort,
    )
    return search, {"beers": beers, "kinds": kinds}


def _default_sort(search: Search) -> str:
    return "distance" if search.near and not search.area else "price"


def _query(search: Search, **change) -> str:
    """The address of this search with some filters changed, for links that add or drop one."""

    values = {
        "q": search.text,
        "pivo": search.beer,
        "do": search.max_price or "",
        "vybaveni": [AMENITY_SLUGS[key] for key in search.amenities],
        "lat": search.near[0] if search.near else "",
        "lng": search.near[1] if search.near else "",
        "oblast": ",".join(str(round(value, 4)) for value in search.area) if search.area else "",
        "razeni": next(
            (param for param, sort in SORT_PARAMS.items() if sort == search.sort and sort != _default_sort(search)), ""
        ),
    } | change
    pairs = []
    for key, value in values.items():
        for item in value if isinstance(value, list) else [value]:
            if item not in ("", None):
                pairs.append((key, item))
    return f"?{urlencode(pairs)}" if pairs else ""


def _row(pub: WebPub, lang: str, today: date, events: dict, show_city: bool) -> dict:
    taps = [beer["name"] for beer in pub.beers if beer["fresh"]][:3] or [beer["name"] for beer in pub.beers][:3]
    meta = []
    if show_city:
        meta.append(pub.district or pub.city)
    elif pub.district:
        meta.append(pub.district)
    distance = getattr(pub, "distance_km", None)
    if distance is not None:
        meta.append(_distance(distance * 1000))
    if pub.confirmed:
        meta.append(gettext("zapsáno %(date)s") % {"date": _short(pub.confirmed)})
    event = events.get(pub.cache_key)
    return {
        "name": pub.name,
        "url": pub_url(pub, lang),
        "cache_key": pub.cache_key,
        "meta": " · ".join(meta),
        "taps": ", ".join(taps),
        "event": f"{_day_label(timezone.localdate(event.starts_at), today)}: {event.title}" if event else "",
        "price": pub.price_czk,
        "price_note": _litres(pub.price_volume_ml) if pub.price_czk else "",
    }


def pubs_page(request: HttpRequest, city: str = "", guide: str = "", lang: str = "cs") -> HttpResponse:
    """Search for pubs by city, place or name, with filters, a list and a map."""

    if guide and guide not in AMENITY_SLUGS.values():
        raise Http404
    search, choices = _parse_search(request, city, guide)
    now = timezone.now()
    city_pubs = WebPub.objects.filter(listed=True, city_slug=city) if city else None
    city_label = city_pubs.values_list("city", flat=True).first() if city else ""
    if city and not city_label:
        raise Http404
    searching = bool(city or search.near or search.area or search.text)
    with translation.override(lang):
        today = timezone.localdate(now)
        if search.text and not city and not search.near:
            # A city typed into the search box opens that city.
            match = WebPub.objects.filter(listed=True, city_slug=slugify(search.text)).values_list("city_slug", flat=True).first()
            if match:
                return redirect(f"{PUBS_PATHS[lang]}/{match}{_query(replace(search, text=''))}".rstrip("?"))
        results = search_pubs(search) if searching else None
        rows, pins, total = [], [], 0
        if results:
            total = results.total
            soon = {
                item["event"].cache_key: item["event"]
                for item in reversed(upcoming_events([pub.cache_key for pub in results.pubs], now=now))
                if item["pub"] is not None and timezone.localdate(item["event"].starts_at) <= today + timedelta(days=7)
            }
            page = max(1, int(request.GET.get("strana", "1")) if request.GET.get("strana", "1").isdigit() else 1)
            shown = results.pubs[: page * PAGE_ROWS]
            rows = [_row(pub, lang, today, soon, show_city=not city) for pub in shown]
            pins = [
                {"lat": pub.lat, "lng": pub.lng, "label": str(pub.price_czk or ""), "url": pub_url(pub, lang),
                 "name": pub.name, "key": pub.cache_key}
                for pub in results.pubs
            ]
            more_url = _query(search, strana=page + 1) if len(results.pubs) > len(shown) else ""
        else:
            more_url = ""
        kinds = choices["kinds"]
        amenity_chips = [
            {
                "slug": AMENITY_SLUGS[key],
                "label": (kind.short_label or kind.label) if lang == "cs" else (kind.label_en or kind.label),
                "on": key in search.amenities,
                "primary": key in PRIMARY_FILTERS,
            }
            for key, kind in kinds.items()
        ]
        guide_label = next((chip["label"] for chip in amenity_chips if chip["slug"] == guide), "")
        more_on = sum(1 for chip in amenity_chips if chip["on"] and not chip["primary"] and chip["slug"] != guide)
        # With nothing found, say which single filter keeps the most pubs out.
        relax = []
        if results is not None and not total:
            for key in search.amenities:
                count = search_pubs(replace(search, amenities=tuple(k for k in search.amenities if k != key)), limit=0).total
                if count:
                    label = next(chip["label"] for chip in amenity_chips if chip["slug"] == AMENITY_SLUGS[key])
                    relax.append({"label": gettext("Bez filtru %(filter)s: %(count)s") % {"filter": label, "count": count},
                                  "url": _query(search, vybaveni=[AMENITY_SLUGS[k] for k in search.amenities if k != key])})
            if search.max_price and (count := search_pubs(replace(search, max_price=None), limit=0).total):
                relax.append({"label": gettext("Bez cenového limitu: %(count)s") % {"count": count}, "url": _query(search, do="")})
            if search.beer and (count := search_pubs(replace(search, beer=""), limit=0).total):
                relax.append({"label": gettext("S jakýmkoli pivem: %(count)s") % {"count": count}, "url": _query(search, pivo="")})
        if guide:
            h1 = guide_title(slugs_to_keys()[guide]).capitalize()
        elif city:
            h1 = city_label
        elif search.near:
            h1 = gettext("Hospody kolem tebe")
        elif search.text:
            h1 = gettext("Hospody: „%(text)s“") % {"text": search.text}
        else:
            h1 = gettext("Kam na pivo")
        base = f"{PUBS_PATHS[lang]}/{city}/{guide}" if guide else f"{PUBS_PATHS[lang]}/{city}" if city else PUBS_PATHS[lang]
        filtered = bool(search.beer or search.max_price or search.near or search.area or search.text
                        or len(search.amenities) > (1 if guide else 0) or request.GET.get("strana"))
        snapshot = PubPriceSnapshot.objects.only("data").first()
        medians = {area["name"]: area["median"] for area in (snapshot.data.get("cities", []) if snapshot else [])}
        cities = []
        if not searching:
            counts = {}
            for name, slug in WebPub.objects.filter(listed=True).values_list("city", "city_slug"):
                counts.setdefault(slug, [name, 0])[1] += 1
            cities = sorted(
                ({"name": name, "pubs": count, "median": medians.get(name), "url": f"{PUBS_PATHS[lang]}/{slug}",
                  "count": counted(count, gettext("hospoda"), gettext("hospody"), gettext("hospod"))}
                 for slug, (name, count) in counts.items() if count >= GUIDE_MIN_PUBS),
                key=lambda item: (-item["pubs"], item["name"]),
            )
        guides = []
        if city and not filtered:
            for key, kind in kinds.items():
                count = city_pubs.filter(amenity_keys__contains=f"|{key}|").count()
                if count >= GUIDE_MIN_PUBS and AMENITY_SLUGS[key] != guide:
                    guides.append({"label": guide_title(key), "count": count,
                                   "url": f"{PUBS_PATHS[lang]}/{city}/{AMENITY_SLUGS[key]}"})
        if guide and (results is None or results.total < GUIDE_MIN_PUBS) and not filtered:
            raise Http404
        context = _context(
            lang,
            "pubs",
            "pubs",
            page_title=(
                f"{h1}, {city_label} | Na pivo" if guide
                else gettext("Hospody %(city)s: ceny piva a co čepují | Na pivo") % {"city": city_label} if city
                else f"{h1} | Na pivo"
            ),
            description=(
                gettext("%(pubs)s s cenami piva, co čepují a jaké mají vybavení. Podle lidí z Na pivo.")
                % {"pubs": counted(total, gettext("hospoda"), gettext("hospody"), gettext("hospod"))} if results else gettext("Najdi hospodu podle města, piva, ceny a vybavení. Podle lidí z Na pivo.")
            ),
            canonical_url=f"{settings.PUBLIC_WEB_ORIGIN}{base}",
            indexable=not filtered,
            h1=h1,
            city=city,
            city_label=city_label,
            guide=guide,
            searching=searching,
            search=search,
            text=search.text,
            near=search.near,
            area=search.area,
            rows=rows,
            total=total,
            count_label=counted(total, gettext("hospoda"), gettext("hospody"), gettext("hospod")),
            radius=results.radius_km if results else None,
            more_url=more_url,
            pins_json=json.dumps(pins, ensure_ascii=False),
            center=_center(city_pubs if city else None, search),
            area_url=_query(search, oblast="", strana="") if search.area else "",
            has_filters=bool(search.beer or search.max_price or len(search.amenities) > (1 if guide else 0)),
            guide_chip={"label": guide_label, "url": f"{PUBS_PATHS[lang]}/{city}"} if guide else None,
            amenity_chips=amenity_chips,
            more_on=more_on,
            beers=choices["beers"].items(),
            price_steps=PRICE_STEPS,
            relax=relax,
            cities=cities,
            guides=guides,
            median=medians.get(city_label),
            action=base,
            sort_options=[
                {"value": "" if SORT_PARAMS[param] == _default_sort(search) else param, "label": label,
                 "on": SORT_PARAMS[param] == search.sort}
                for param, label in (("cena", gettext("Nejlevnější")), ("vzdalenost", gettext("Nejbližší")),
                                     ("potvrzeno", gettext("Nejčerstvější")))
                if param != "vzdalenost" or search.near
            ],
            clear_url=base,
            near_url=PUBS_PATHS[lang],
        )
    partial = request.headers.get("X-Partial") == "1"
    response = _respond(request, "pubs/web/_results.html" if partial else "pubs/web/pubs.html", context)
    response["Vary"] = "X-Partial"
    return response


def sitemap_pages(origin: str) -> list[dict]:
    """Guide pages for the sitemap: search, cities, guides, pubs, events and routes."""

    def both(cs: str, en: str, lastmod=None) -> dict:
        return {"urls": {"cs": f"{origin}{cs}", "en": f"{origin}{en}"}, "lastmod": lastmod}

    pages = [both(PUBS_PATHS["cs"], PUBS_PATHS["en"]), both(EVENTS_PATHS["cs"], EVENTS_PATHS["en"])]
    pubs = list(WebPub.objects.filter(listed=True).only("city_slug", "slug", "day", "amenity_keys"))
    by_city: dict[str, list[WebPub]] = {}
    for pub in pubs:
        by_city.setdefault(pub.city_slug, []).append(pub)
    kinds = amenity_kinds()
    for city, rows in sorted(by_city.items()):
        if len(rows) >= GUIDE_MIN_PUBS:
            pages.append(both(f"{PUBS_PATHS['cs']}/{city}", f"{PUBS_PATHS['en']}/{city}", rows[0].day))
        for key in kinds:
            if sum(f"|{key}|" in row.amenity_keys for row in rows) >= GUIDE_MIN_PUBS:
                slug = AMENITY_SLUGS[key]
                pages.append(both(f"{PUBS_PATHS['cs']}/{city}/{slug}", f"{PUBS_PATHS['en']}/{city}/{slug}", rows[0].day))
    for pub in pubs:
        pages.append(both(pub_url(pub, "cs"), pub_url(pub, "en"), pub.day))
    publications = list(readable_publications())
    if publications:
        pages.append(both(TOURS_PATHS["cs"], TOURS_PATHS["en"]))
    for item in publications:
        pages.append(both(f"{TOURS_PATHS['cs']}/{item.public_id}", f"{TOURS_PATHS['en']}/{item.public_id}"))
    return pages


def home_guide(lang: str) -> dict:
    """The top of the home page: where to look for a pub, what beer costs, what is on soon."""

    now = timezone.now()
    today = timezone.localdate(now)
    snapshot = PubPriceSnapshot.objects.only("data").first()
    with_pages = set(WebPub.objects.filter(listed=True).values_list("city_slug", flat=True).distinct())
    cities = [
        {
            "name": area["name"],
            "median": area["median"],
            "count": counted(area["pubs"], gettext("hospoda"), gettext("hospody"), gettext("hospod")),
            "url": (
                f"{PUBS_PATHS[lang]}/{slugify(area['name'])}"
                if slugify(area["name"]) in with_pages
                else f"{PRICE_PATHS[lang]}/{slugify(area['name'])}"
            ),
        }
        for area in (snapshot.data.get("cities", [])[:8] if snapshot else [])
    ]
    events = [
        {
            "title": item["event"].title,
            "when": f"{_day_label(timezone.localdate(item['event'].starts_at), today)} "
            f"{timezone.localtime(item['event'].starts_at, PRAGUE):%H:%M}",
            "where": f"{item['pub'].name if item['pub'] else item['event'].name}, {item['city']}",
            "url": pub_url(item["pub"], lang) if item["pub"] else "",
        }
        for item in upcoming_events(now=now)[:3]
    ]
    tours = [
        {
            "title": item.title,
            "where": f"{_tour_city(item)} · {_walk(item.walk_m)}",
            "url": f"{TOURS_PATHS[lang]}/{item.public_id}",
        }
        for item in readable_publications().order_by("-people_count", "-published_at")[:3]
    ]
    return {
        "cities": cities,
        "all_cities": len(snapshot.data.get("cities", [])) if snapshot else 0,
        "day": snapshot.day if snapshot else None,
        "events": events,
        "tours": tours,
        "pubs_url": PUBS_PATHS[lang],
        "events_url": EVENTS_PATHS[lang],
        "tours_url": TOURS_PATHS[lang],
    }

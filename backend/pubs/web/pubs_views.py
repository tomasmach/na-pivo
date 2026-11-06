"""Public pub pages: cities, pubs of one city, one pub, search."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime
from urllib.parse import quote, urlencode

from django.conf import settings
from django.core.cache import cache
from django.http import (
    Http404,
    HttpRequest,
    HttpResponse,
    HttpResponsePermanentRedirect,
    HttpResponseRedirect,
)
from django.utils import formats, timezone
from django.utils.text import slugify
from django.utils.translation import gettext, pgettext
from rest_framework.request import Request

from pubs.api.pub_beers_views import CITIES_WITH_DISTRICTS
from pubs.api.throttling import SharedScopedRateThrottle
from pubs.beer_pages import page_path
from pubs.home_views import HOME_OG_PATH, ld_json
from pubs.i18n import current_locale
from pubs.models import BeerPage, PubPriceSnapshot
from pubs.price_map import city_slug
from pubs.web import pubs_data
from pubs.web.pages import render_page, web_page
from pubs.web.places import has_pub_name, in_place, municipality, place_name, pub_name
from pubs.web.pub_map import live_map, pub_map
from pubs.web.pubs_og import render_pub_og
from pubs.web.routes import web_reverse
from pubs.web.words import plural
from pubs.web_views import _short_date

PAGE_SIZE = 20
MAX_PAGES = 50
# A list of fewer pubs says too little to be worth a search result; the sitemap uses the same bar.
MIN_LISTED = 3
CHEAP_CZK = 55
SORTS = ("", "price", "name")
SEARCH_TYPES = ("all", "pubs", "beers", "cities")
_FILTERS = ("open", "district", "beer", "max55", "tank", "garden", "sort")


def _wait(request: HttpRequest, scope: str) -> int | None:
    """Seconds to wait once this address spent its budget for the scope."""

    throttle = SharedScopedRateThrottle()
    policy = type("WebPubsPolicy", (), {"throttle_scope": scope})()
    if throttle.allow_request(Request(request), policy):
        return None
    return int(throttle.wait())


def _slow_down(request: HttpRequest, wait: int, section: str) -> HttpResponse:
    response = render_page(
        request, "web/pubs/slow_down.html", title=gettext("Zkus to prosím za chvíli"), section=section, status=429
    )
    response["Retry-After"] = str(wait)
    response["Cache-Control"] = "no-store"
    return response


def _public(response: HttpResponse) -> HttpResponse:
    # A signed-in visitor already got "private, no-store"; that one stays.
    response.headers.setdefault("Cache-Control", "public, max-age=300")
    return response


def num(value: int) -> str:
    return formats.number_format(value, force_grouping=True)


def dec(value: float) -> str:
    return formats.number_format(value, 1)




def counted(number: int, one: str, few: str, many: str) -> str:
    return f"{num(number)}\u00a0{plural(number, one, few, many)}"


def _pubs_count(number: int) -> str:
    return counted(number, gettext("hospoda"), gettext("hospody"), gettext("hospod"))


def _ratings_count(number: int) -> str:
    return counted(
        number, pgettext("one", "hodnocení"), pgettext("few", "hodnocení"), pgettext("many", "hodnocení")
    )


def _price_label(price: int | None) -> str:
    return f"{price}\u00a0{gettext('Kč')}" if price else ""


def _volume_label(volume: int | None) -> str:
    if not volume:
        return ""
    return f"{formats.number_format(volume / 1000, 2 if volume % 100 else 1)}\u00a0l"


def _clock(moment: datetime) -> str:
    local = timezone.localtime(moment, pubs_data.PRAGUE)
    return "24:00" if (local.hour, local.minute) == (0, 0) else local.strftime("%H:%M")


def status_line(week: dict | None, now: datetime | None = None) -> dict | None:
    """"otevřeno do 23:30" or "zavřeno, otevírá zítra v 15:00"."""

    state = pubs_data.open_state(week, now)
    if state is None:
        return None
    if state["open"]:
        return {"open": True, "text": gettext("otevřeno do %(time)s") % {"time": _clock(state["until"])}}
    opens = state["opens"]
    if opens is None:
        return {"open": False, "text": gettext("zavřeno")}
    local = timezone.localtime(opens, pubs_data.PRAGUE)
    days = (local.date() - state["now"].date()).days
    weekdays = (
        gettext("v pondělí"), gettext("v úterý"), gettext("ve středu"), gettext("ve čtvrtek"),
        gettext("v pátek"), gettext("v sobotu"), gettext("v neděli"),
    )
    values = {"time": local.strftime("%H:%M"), "day": weekdays[local.weekday()]}
    if days == 0:
        text = gettext("zavřeno, otevírá v %(time)s") % values
    elif days == 1:
        text = gettext("zavřeno, otevírá zítra v %(time)s") % values
    else:
        text = gettext("zavřeno, otevírá %(day)s v %(time)s") % values
    return {"open": False, "text": text}


def _pub_row(pub: dict, now: datetime, city: str = "") -> dict:
    return {
        **pub,
        "name": pub_name(pub["name"]),
        "url": web_reverse("web-pub", key=pub["key"]),
        "place": pub["address"] or place_name(pub["district"]) or city,
        "tap": ", ".join(pub["beers"][:3]),
        "status": status_line(pub["hours"], now),
        "price_label": _price_label(pub["price"]),
        "volume_label": _volume_label(pub["volume"]) if pub["volume"] not in (None, 500) else "",
        "rating_label": dec(pub["rating"]) if pub["rating"] else "",
    }


def _crumbs(crumbs: list[tuple[str, str]]) -> list[dict]:
    """The breadcrumb component: every crumb a link but the last."""

    return [{"label": label, "url": url} for label, url in crumbs[:-1]] + [{"label": crumbs[-1][0]}]


def _breadcrumb_data(crumbs: list[tuple[str, str]]) -> dict:
    origin = settings.PUBLIC_WEB_ORIGIN
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": index, "name": name, "item": f"{origin}{url}"}
            for index, (name, url) in enumerate(crumbs, start=1)
        ],
    }


def _city_in(name: str) -> str:
    return in_place(name) or gettext("ve městě %(city)s") % {"city": place_name(name)}


def _pubs_title(name: str) -> str:
    """"Hospody v Praze 7", or "Hospody: Žitenice" where Czech would need a declension it does not have."""

    where = in_place(name)
    if where:
        return gettext("Hospody %(in_city)s") % {"in_city": where}
    return gettext("Hospody: %(city)s") % {"city": place_name(name)}


def prices_label(name: str) -> str:
    where = in_place(name)
    if where:
        return gettext("Kolik stojí pivo %(in_city)s") % {"in_city": where}
    return gettext("Kolik stojí pivo: %(city)s") % {"city": place_name(name)}


def _names(names: list[str]) -> str:
    if len(names) < 2:
        return "".join(names)
    return gettext("%(first)s a %(last)s") % {"first": ", ".join(names[:-1]), "last": names[-1]}


def prices_page_slugs() -> set[str]:
    snapshot = PubPriceSnapshot.objects.only("data").first()
    return {city_slug(area["name"]) for area in snapshot.data.get("cities", [])} if snapshot else set()


# ---------- districts ----------


def _is_district(city: str, district: str) -> bool:
    """Praha 7, Plzeň 3 or Brno-střed; not Brno-město, which is the county of the whole city,
    nor Brno 2, which is a post office."""

    return district != city and not district.endswith("-město") and municipality(district) == district


def districts_with_pages() -> list[dict]:
    """Every district of the big cities the catalogue knows, with its city."""

    cities = pubs_data.catalogue()["cities"]
    found = []
    for city_name in CITIES_WITH_DISTRICTS:
        city = cities.get(city_slug(city_name))
        for name, pubs in (city["districts"] if city else {}).items():
            if _is_district(city["name"], name):
                found.append({"slug": slugify(name), "name": name, "pubs": pubs, "city": city})
    return found


def _district(slug: str) -> dict | None:
    return next((district for district in districts_with_pages() if district["slug"] == slug), None)


def district_url(city: str, district: str) -> str:
    """The district's own page, or the city filtered to it when the district has none."""

    if _district(slugify(district)):
        return web_reverse("web-pubs-city", city=slugify(district))
    return web_reverse("web-pubs-city", city=city) + f"?district={slugify(district)}"


def district_sitemap_paths() -> list[str]:
    return [
        web_reverse("web-pubs-city", "cs", city=district["slug"])
        for district in districts_with_pages()
        if district["pubs"] >= MIN_LISTED
    ]


def _others(limit: int = 8, skip: str = "") -> list[dict]:
    return [
        {"label": place_name(city["name"]), "url": web_reverse("web-pubs-city", city=city["slug"])}
        for city in pubs_data.cities_by_size()[: limit + 1]
        if city["slug"] != skip
    ][:limit]


# Czech alphabet: Č, Ř, Š and Ž follow their plain letter, Ch follows H; other accents sort with the plain letter.
_OWN_LETTERS = {"č": "c~", "ř": "r~", "š": "s~", "ž": "z~"}
_LETTER_LABELS = {"c~": "Č", "r~": "Ř", "s~": "Š", "z~": "Ž", "h~": "Ch"}


def _czech_letters(name: str) -> list[str]:
    lowered, letters, index = name.casefold(), [], 0
    while index < len(lowered):
        if lowered.startswith("ch", index):
            letters.append("h~")
            index += 2
            continue
        char = lowered[index]
        letters.append(_OWN_LETTERS.get(char) or unicodedata.normalize("NFD", char)[0])
        index += 1
    return letters


def _by_letter(cities: list[dict]) -> list[dict]:
    groups: list[dict] = []
    for city in sorted(cities, key=lambda city: (_czech_letters(city["label"]), city["label"])):
        first = (_czech_letters(city["label"]) or [""])[0]
        letter = _LETTER_LABELS.get(first, first.upper())
        if not groups or groups[-1]["letter"] != letter:
            groups.append({"letter": letter, "cities": []})
        groups[-1]["cities"].append(city)
    return groups


def _missing(request: HttpRequest, kind: str) -> HttpResponse:
    title = gettext("Tohle město neznám") if kind == "city" else gettext("Tuhle hospodu neznám")
    return render_page(
        request, "web/pubs/missing.html", {"kind": kind, "others": _others()}, title=title, section="pubs", status=404
    )


@web_page
def missing_pub_page(request: HttpRequest) -> HttpResponse:
    return _missing(request, "pub")


# ---------- /hospody ----------


@web_page
def pubs_index(request: HttpRequest) -> HttpResponse:
    wait = _wait(request, "web_pages")
    if wait:
        return _slow_down(request, wait, "pubs")
    cities = pubs_data.cities_by_size()
    total = sum(city["pubs"] for city in cities)
    shown = [
        {"label": place_name(city["name"]), "url": web_reverse("web-pubs-city", city=city["slug"]), "pubs": _pubs_count(city["pubs"]), "count": city["pubs"]}
        for city in cities[:120]
    ]
    crumbs = [("Na pivo", web_reverse("home")), (gettext("Hospody"), web_reverse("web-pubs"))]
    lead = ""
    if cities:
        lead = gettext("%(pubs)s v %(cities)s. Vyber město a uvidíš, kde mají otevřeno a co čepují.") % {
            "pubs": _pubs_count(total),
            "cities": counted(len(cities), gettext("městě"), gettext("městech"), gettext("městech")),
        }
    return _public(render_page(
        request,
        "web/pubs/index.html",
        {
            "big": shown[:8],
            "letters": _by_letter(shown[8:]),
            "lead": lead,
            "crumbs": _crumbs(crumbs),
            "structured_data": ld_json({"@graph": [_breadcrumb_data(crumbs)]}),
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}{HOME_OG_PATH}",
        },
        title=gettext("Hospody po městech"),
        description=gettext("Hospody v českých městech: co čepují, kolik stojí půllitr a kdo má zrovna otevřeno."),
        section="pubs",
    ))


# ---------- /hospody/<město> ----------


def _query(params: dict, **changes) -> str:
    """This page's address with some filters changed; any change starts at page one."""

    merged = {**params, **changes}
    if "page" not in changes:
        merged.pop("page", None)
    merged = {key: value for key, value in merged.items() if value}
    return f"?{urlencode(merged)}" if merged else "?"


def _filters(request: HttpRequest, data: dict) -> dict:
    get = request.GET
    districts = {slugify(name): name for name in data["districts"]}
    brands = {brand["key"]: brand["name"] for brand in data["brands"]}
    district, beer, sort = get.get("district", ""), get.get("beer", ""), get.get("sort", "")
    return {
        "open": get.get("open") == "1",
        "district": district if district in districts else "",
        "district_name": districts.get(district, ""),
        "beer": beer if beer in brands else "",
        "beer_name": brands.get(beer, ""),
        "max55": get.get("max55") == "1",
        "tank": get.get("tank") == "1",
        "garden": get.get("garden") == "1",
        "sort": sort if sort in SORTS else "",
    }


def _sorted(pubs: list[dict], sort: str) -> list[dict]:
    if sort == "price":
        return sorted(pubs, key=lambda pub: (
            pub["price"] is None,
            pubs_data.half_litre(pub["price"], pub["volume"]) if pub["price"] else 0,
            pubs_data.fold(pub["name"]),
        ))
    if sort == "name":
        return sorted(pubs, key=lambda pub: pubs_data.fold(pub["name"]))
    # Rated first, then the ones people filled in, then the rest by name.
    return sorted(pubs, key=lambda pub: (
        -(pub["rating"] or 0),
        -pub["raters"],
        not (pub["price"] or pub["beers"] or pub["hours"]),
        pubs_data.fold(pub["name"]),
    ))


def _apply(rows: list[dict], chosen: dict) -> list[dict]:
    tests = {
        "open": lambda row: row["status"] and row["status"]["open"],
        "district": lambda row: row["district"] == chosen["district_name"],
        "beer": lambda row: chosen["beer"] in row["brands"],
        "max55": lambda row: row["price"] and pubs_data.half_litre(row["price"], row["volume"]) <= CHEAP_CZK,
        "tank": lambda row: row["tank"],
        "garden": lambda row: row["garden"],
    }
    for name, test in tests.items():
        if chosen[name]:
            rows = [row for row in rows if test(row)]
    return _sorted(rows, chosen["sort"])


def _natural(text: str) -> list:
    """Praha 2 before Praha 10."""

    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", pubs_data.fold(text))]


def _menu(label: str, current: bool, items: list[dict]) -> dict:
    return {"label": label, "current": current, "items": items}


def _city_description(name: str, rows: list[dict], typical_price: int | None) -> str:
    """What the search result says: only numbers and names that stay true until the next visit."""

    total = len(rows)
    text = gettext("%(city)s: %(pubs)s") % {"city": place_name(name), "pubs": _pubs_count(total)}
    if typical_price:
        text += ", " + gettext("půllitr kolem %(price)s") % {"price": _price_label(typical_price)}
    text += "."
    with_menu = sum(1 for row in rows if row["beers"])
    if with_menu and total > 1:
        text += " " + gettext("Lístek mám u %(count)s z nich.") % {"count": num(with_menu)}
    names = [row["name"] for row in _sorted(rows, "")[:3]]
    if total <= 3:
        text += " " + plural(total, gettext("Je tu %(names)s."), gettext("Jsou tu %(names)s."),
                             gettext("Jsou tu %(names)s.")) % {"names": _names(names)}
    else:
        text += " " + gettext("Třeba %(names)s.") % {"names": _names(names)}
    return text


@web_page
def pubs_city(request: HttpRequest, city: str) -> HttpResponse:
    wait = _wait(request, "web_pages")
    if wait:
        return _slow_down(request, wait, "pubs")
    district = None
    data = pubs_data.city_pubs(city)
    if data is None:
        district = _district(city)
        if district is None:
            return _missing(request, "city")
        data = pubs_data.city_pubs(district["city"]["slug"])
    city_page = data["slug"]

    now = timezone.now()
    chosen = _filters(request, data)
    if district:
        chosen.update(district=district["slug"], district_name=district["name"])
    elif chosen["district"] and _district(chosen["district"]):
        # The filter came before the districts had pages of their own.
        rest = {key: ("1" if chosen[key] is True else chosen[key]) for key in _FILTERS if chosen[key] and key != "district"}
        target = web_reverse("web-pubs-city", city=chosen["district"])
        return HttpResponsePermanentRedirect(target + (_query(rest) if rest else ""))
    params = {
        key: ("1" if chosen[key] is True else chosen[key])
        for key in _FILTERS if chosen[key] and not (district and key == "district")
    }
    rows = [_pub_row(pub, now, place_name(data["name"])) for pub in data["list"]]
    if district:
        rows = [row for row in rows if row["district"] == district["name"]]
    known_hours = [row for row in rows if row["status"]]
    open_now = [row for row in known_hours if row["status"]["open"]]
    visible = _apply(rows, chosen)
    try:
        page = min(max(int(request.GET.get("page", "1")), 1), MAX_PAGES)
    except ValueError:
        page = 1
    shown = visible[: page * PAGE_SIZE]
    for index, row in enumerate(shown, start=1):
        row["anchor"] = f"h{index}"

    def chip(label: str, key: str) -> dict:
        active = key in params
        return {"label": label, "url": _query(params, **{key: "" if active else "1"}), "current": active}

    chips = [chip(gettext("Otevřeno teď"), "open")] if known_hours else []
    districts = sorted(
        ((name, count) for name, count in data["districts"].items() if count >= 2),
        key=lambda item: (-item[1], item[0]),
    )
    menu_district = None
    if len(districts) >= 2 and not district:
        menu_district = _menu(
            chosen["district_name"] or gettext("Všechny čtvrti"),
            bool(chosen["district"]),
            [{"label": gettext("Všechny čtvrti"), "url": _query(params, district=""), "current": not chosen["district"]}]
            + [
                {"label": place_name(name), "url": (
                    web_reverse("web-pubs-city", city=slugify(name)) if _district(slugify(name))
                    else _query(params, district=slugify(name))
                ), "current": chosen["district"] == slugify(name)}
                for name, _ in sorted(districts, key=lambda item: _natural(item[0]))
            ],
        )
    menu_beer = None
    if data["brands"]:
        menu_beer = _menu(
            gettext("Čepují: %(beer)s") % {"beer": chosen["beer_name"]} if chosen["beer"] else gettext("Čepují: cokoliv"),
            bool(chosen["beer"]),
            [{"label": gettext("Cokoliv"), "url": _query(params, beer=""), "current": not chosen["beer"]}]
            + [
                {"label": brand["name"], "url": _query(params, beer=brand["key"]), "current": chosen["beer"] == brand["key"]}
                for brand in data["brands"]
            ],
        )
    extra_chips = []
    if any(row["price"] for row in rows):
        extra_chips.append(chip(gettext("Do %(price)s Kč") % {"price": CHEAP_CZK}, "max55"))
    if any(row["tank"] for row in rows):
        extra_chips.append(chip(gettext("Tankové"), "tank"))
    if any(row["garden"] for row in rows):
        extra_chips.append(chip(gettext("Zahrádka"), "garden"))
    sort_labels = {"": gettext("nejlíp hodnocené"), "price": gettext("nejlevnější"), "name": gettext("podle názvu")}
    menu_sort = _menu(
        gettext("Řadit: %(sort)s") % {"sort": sort_labels[chosen["sort"]]},
        False,
        [{"label": label, "url": _query(params, sort=key), "current": chosen["sort"] == key} for key, label in sort_labels.items()],
    )

    name = district["name"] if district else data["name"]
    total = len(rows)
    if len(known_hours) >= 3:
        lead = gettext("%(pubs)s, právě teď má otevřeno %(open)s z těch, u kterých znám otevírací dobu.") % {
            "pubs": _pubs_count(total), "open": num(len(open_now)),
        }
    else:
        lead = f"{_pubs_count(total)}."
    typical_price = None if district else data["typical_price"]
    if typical_price:
        lead += " " + gettext("Půllitr tu stojí kolem %(price)s.") % {"price": _price_label(typical_price)}
    has_prices_page = city_page in prices_page_slugs()

    title = _pubs_title(name)
    page_url = web_reverse("web-pubs-city", city=city)
    crumbs = [("Na pivo", web_reverse("home")), (gettext("Hospody"), web_reverse("web-pubs"))]
    if district:
        crumbs.append((place_name(data["name"]), web_reverse("web-pubs-city", city=city_page)))
    crumbs.append((place_name(name), page_url))
    origin = settings.PUBLIC_WEB_ORIGIN
    top = _sorted(rows, "")[:PAGE_SIZE]
    structured = {"@graph": [
        _breadcrumb_data(crumbs),
        {
            "@type": "ItemList",
            "name": title,
            "numberOfItems": total,
            "itemListElement": [
                {"@type": "ListItem", "position": index, "url": f"{origin}{row['url']}", "name": row["name"]}
                for index, row in enumerate(top, start=1)
            ],
        },
    ]}
    map_points = [
        {"lat": row["lat"], "lng": row["lng"], "label": row["price_label"], "url": row["url"], "name": row["name"],
         "selected": index == 0}
        for index, row in enumerate(shown[:PAGE_SIZE])
    ]
    district_tiles = [
        {"label": place_name(other), "url": district_url(city_page, other)}
        for other, _ in sorted(districts[:8], key=lambda item: _natural(item[0]))
        if other != name
    ] if len(districts) >= 2 else []
    response = render_page(
        request,
        "web/pubs/city.html",
        {
            "city": data,
            "h1": title,
            "lead": lead,
            "prices_url": web_reverse("beer-prices-city", city=city_page) if has_prices_page else "",
            "prices_label": prices_label(data["name"]),
            "chips": chips,
            "extra_chips": extra_chips,
            "menu_district": menu_district,
            "menu_beer": menu_beer,
            "menu_sort": menu_sort,
            "rows": shown,
            "count_label": gettext("%(shown)s z %(total)s") % {"shown": num(len(shown)), "total": num(len(visible))},
            "more_url": (
                _query(params, page=str(page + 1)) + f"#h{len(shown) + 1}"
                if len(visible) > len(shown) and page < MAX_PAGES
                else ""
            ),
            "filtered": bool(params),
            "map": pub_map(map_points, [(row["lat"], row["lng"]) for row in rows]),
            "live_map": live_map(map_points),
            "district_tiles": district_tiles,
            "district_title": gettext("Další čtvrti") if district else gettext("Hospody podle čtvrtí"),
            "other_cities": _others(8, skip=city_page),
            "crumbs": _crumbs(crumbs),
            "structured_data": ld_json(structured),
            "og_image_url": f"{origin}{HOME_OG_PATH}",
        },
        title=title,
        description=_city_description(name, rows, typical_price),
        section="pubs",
        with_map=True,
        **({"indexable": total >= MIN_LISTED} if district else {}),
    )
    return _public(response)


# ---------- /hospoda/<klíč> ----------


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60 % 24 if minutes < 24 * 60 else 24:02d}:{minutes % 60:02d}"


def _day_rows(week: dict | None, now: datetime) -> list[dict]:
    if not week:
        return []
    labels = (gettext("Pondělí"), gettext("Úterý"), gettext("Středa"), gettext("Čtvrtek"),
              gettext("Pátek"), gettext("Sobota"), gettext("Neděle"))
    today = timezone.localtime(now, pubs_data.PRAGUE).weekday()
    rows = []
    for index, day in enumerate(pubs_data.DAY_KEYS):
        spans = [f"{_hhmm(start)}–{_hhmm(end if end <= 24 * 60 else end - 24 * 60)}" for start, end in week[day]]
        rows.append({"day": labels[index], "hours": ", ".join(spans) or gettext("Zavřeno"), "today": index == today,
                     "closed": not spans})
    return rows


def _og_payload(pub: dict, lang: str) -> dict:
    """What the share image draws. Nothing depends on the clock, so one image serves a day."""

    cheapest = next(
        (beer for beer in pub["menu"] if beer["price"] == pub["price"] and (beer["volume"] or 500) == pub["volume"]),
        None,
    )
    return {
        "name": pub_name(pub["name"]),
        "place": pub["district"] or pub["city"],
        "rating": pub["rating"],
        "price": pub["price"],
        "price_beer": cheapest["name"] if cheapest else "",
        "tank": pub["tank"],
        "beers": len(pub["menu"]),
        "week_beers": pub["week_beers"],
        "address": settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + web_reverse("web-pub", lang, key=pub["key"]),
        "lang": lang,
    }


def _og_version(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:10]


def _pub_structured(pub: dict, url: str, crumbs: list[tuple[str, str]]) -> dict:
    origin = settings.PUBLIC_WEB_ORIGIN
    place = {
        "@type": "BarOrPub",
        "name": pub_name(pub["name"]),
        "url": f"{origin}{url}",
        "geo": {"@type": "GeoCoordinates", "latitude": round(pub["lat"], 5), "longitude": round(pub["lng"], 5)},
        "address": {
            "@type": "PostalAddress",
            **({"streetAddress": pub["address"]} if pub["address"] else {}),
            "addressLocality": pub["district"] or pub["city"],
            "addressCountry": "CZ",
        },
    }
    if pub["hours"]:
        names = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
        place["openingHoursSpecification"] = [
            {
                "@type": "OpeningHoursSpecification",
                "dayOfWeek": f"https://schema.org/{names[index]}",
                "opens": _hhmm(start),
                "closes": _hhmm(end % (24 * 60)),
            }
            for index, day in enumerate(pubs_data.DAY_KEYS)
            for start, end in pub["hours"][day]
        ]
    return {"@graph": [_breadcrumb_data(crumbs), place]}


def _resolved(key: str, suffix: str = ""):
    """The pub, a redirect to its current address, or None."""

    found = pubs_data.find_pub(key)
    if "redirect" in found:
        return HttpResponsePermanentRedirect(web_reverse("web-pub", key=found["redirect"]) + suffix)
    return found.get("pub")


def _menu_updated(updated: datetime | None, now: datetime) -> str:
    if not updated:
        return ""
    days = (timezone.localdate(now, pubs_data.PRAGUE) - timezone.localdate(updated, pubs_data.PRAGUE)).days
    if days <= 0:
        return gettext("ověřeno dnes")
    if days == 1:
        return gettext("ověřeno včera")
    today = timezone.localdate(now, pubs_data.PRAGUE)
    return gettext("ověřeno %(date)s") % {"date": _short_date(timezone.localdate(updated, pubs_data.PRAGUE), today)}


def _pub_stats(pub: dict, now: datetime) -> list[dict]:
    stats = []
    if pub["week_beers"]:
        stats.append({"value": num(pub["week_beers"]), "label": plural(
            pub["week_beers"], gettext("pivo tu padlo minulý týden"), gettext("piva tu padla minulý týden"),
            gettext("piv tu padlo minulý týden"),
        )})
    if pub["rating"]:
        stats.append({
            "value": dec(pub["rating"]),
            "label": gettext("průměr z %(ratings)s piv") % {"ratings": _ratings_count(pub["ratings"])},
        })
    event = pubs_data.todays_event(pub["cache_key"], now)
    if event:
        stats.append({
            "value": timezone.localtime(event["starts_at"], pubs_data.PRAGUE).strftime("%H:%M"),
            "label": gettext("dnes: %(title)s") % {"title": event["title"]},
        })
    if len(stats) < 3 and pub["price"]:
        stats.append({
            "value": _price_label(pub["price"]),
            "label": gettext("nejlevnější pivo, %(volume)s") % {"volume": _volume_label(pub["volume"])},
        })
    if len(stats) < 3 and pub["menu"]:
        stats.append({
            "value": num(len(pub["menu"])),
            "label": plural(len(pub["menu"]), gettext("pivo na čepu"), gettext("piva na čepu"), gettext("piv na čepu")),
        })
    return stats[:3]


def _pub_description(pub: dict, where: str, has_ratings: bool, today) -> str:
    """Only what the page shows: the menu, its date, the cheapest beer, the hours if known."""

    values = {"name": pub_name(pub["name"]), "place": where, "price": pub["price"]}
    if pub["menu"]:
        values["beers"] = counted(len(pub["menu"]), gettext("pivo"), gettext("piva"), gettext("piv"))
        text = (
            gettext("Co čepují v hospodě %(name)s, %(place)s: %(beers)s") if has_pub_name(pub["name"])
            else gettext("Co čepují v hospodě bez jména, %(place)s: %(beers)s")
        ) % values
        if pub["price"]:
            text += " " + gettext("od %(price)s Kč") % values
        if pub["menu_updated_at"]:
            text += ", " + gettext("lístek z %(date)s") % {
                "date": _short_date(timezone.localdate(pub["menu_updated_at"], pubs_data.PRAGUE), today),
            }
        text += "."
    elif pub["price"]:
        text = gettext("%(name)s, %(place)s: pivo od %(price)s Kč podle zápisů v Na pivo.") % values
    else:
        text = gettext("%(name)s, %(place)s. Co tu čepují, zatím nevím. Lístek může doplnit každý, kdo tu sedí.") % values
    if has_ratings:
        text += " " + gettext("Hodnocení piv od lidí z Na pivo.")
    text += " " + (gettext("Otevírací doba a cesta na mapě.") if pub["hours"] else gettext("Cesta na mapě."))
    return text


def _distance_label(metres: int) -> str:
    if metres < 1000:
        return f"{max(round(metres, -1), 10)}\u00a0m"
    return f"{dec(metres / 1000)}\u00a0km"


@web_page
def pub_page(request: HttpRequest, key: str) -> HttpResponse:
    wait = _wait(request, "web_pages")
    if wait:
        return _slow_down(request, wait, "pubs")
    pub = _resolved(key)
    if isinstance(pub, HttpResponse):
        return pub
    if pub is None:
        return _missing(request, "pub")

    now = timezone.now()
    lang = getattr(request, "web_lang", "cs")
    url = web_reverse("web-pub", key=pub["key"])
    menu = [
        {
            "name": beer["name"],
            "meta": " · ".join(part for part in (
                gettext("Tank") if "tank" in pubs_data.fold(beer["name"]) else "",
                _volume_label(beer["volume"]),
            ) if part),
            "price": _price_label(beer["price"]),
            "url": page_path(BeerPage.Kind.BEER, beer["beer_page"], lang) if beer.get("beer_page") else "",
        }
        for beer in pub["menu"]
    ]
    city_url = web_reverse("web-pubs-city", city=pub["city_slug"]) if pub["city_slug"] else ""
    crumbs = [(gettext("Hospody"), web_reverse("web-pubs"))]
    if city_url:
        crumbs.append((place_name(pub["city"]), city_url))
        if pub["district"] and place_name(pub["district"]) != place_name(pub["city"]):
            crumbs.append((place_name(pub["district"]), district_url(pub["city_slug"], pub["district"])))
    name = pub_name(pub["name"])
    crumbs.append((name, url))

    city_place = place_name(pub["city"])
    district_place = place_name(pub["district"])
    place = pub["address"] or district_place or city_place
    # "Praha 1" already says Praha.
    city = "" if pub["district"].startswith(pub["city"]) else city_place
    place_sub = ", ".join(part for part in dict.fromkeys((district_place, city)) if part and part != place)
    og = _og_payload(pub, lang)
    where = district_place or city_place
    if has_pub_name(pub["name"]):
        title = gettext("%(name)s, %(place)s") % {"name": name, "place": where} if where else name
    else:
        title = ", ".join(part for part in (gettext("Hospoda"), pub["address"], where) if part)
    beer_ratings = [
        {**beer, "rating_label": dec(beer["rating"]), "count_label": _ratings_count(beer["count"])}
        for beer in pub["beer_ratings"]
    ]
    nearby = [
        {
            "title": pub_name(row["name"]),
            "url": web_reverse("web-pub", key=row["key"]),
            "meta": " · ".join(part for part in (_distance_label(row["metres"]), ", ".join(row["beers"][:2])) if part),
            "value": _price_label(row["price"]),
        }
        for row in pub.get("nearby", [])
    ]
    has_prices_page = bool(pub["city_slug"]) and pub["city_slug"] in prices_page_slugs()
    response = render_page(
        request,
        "web/pubs/pub.html",
        {
            "pub": pub,
            "name": name,
            "status": status_line(pub["hours"], now),
            "place": place,
            "place_sub": place_sub,
            "stats": _pub_stats(pub, now),
            "menu": menu,
            "menu_updated": _menu_updated(pub["menu_updated_at"], now),
            "beer_ratings": beer_ratings,
            "days": _day_rows(pub["hours"], now),
            "nearby": nearby,
            "prices_url": web_reverse("beer-prices-city", city=pub["city_slug"]) if has_prices_page else "",
            "prices_label": prices_label(pub["city"]) if has_prices_page else "",
            "city_url": city_url,
            "city_label": _pubs_title(pub["city"]) if city_url else "",
            "map": pub_map(
                [{"lat": pub["lat"], "lng": pub["lng"], "label": "", "url": "", "name": name}],
                pub["neighbours"],
                focus=True,
                size=(862, 340),
            ),
            "live_map": live_map([{"lat": pub["lat"], "lng": pub["lng"], "name": name}], kind="focus"),
            "deep_link": f"napivo://h/{pub['cache_key']}?{urlencode({'n': pub['name']})}",
            "navigation_url": (
                "https://www.google.com/maps/dir/?api=1&destination="
                + quote(f"{pub['lat']:.6f},{pub['lng']:.6f}", safe=",")
            ),
            "login_url": f"{web_reverse('web-login')}?next={quote(url)}",
            "crumbs": _crumbs(crumbs),
            "structured_data": ld_json(_pub_structured(pub, url, [("Na pivo", web_reverse("home")), *crumbs])),
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}{url}/og.png?v={_og_version(og)}",
        },
        title=title,
        description=_pub_description(
            pub, where, bool(beer_ratings), timezone.localdate(now, pubs_data.PRAGUE)
        ),
        section="pubs",
        with_map=True,
    )
    return _public(response)


@web_page
def pub_og_image(request: HttpRequest, key: str) -> HttpResponse:
    wait = _wait(request, "web_og")
    if wait:
        response = HttpResponse(status=429)
        response["Retry-After"] = str(wait)
        return response
    pub = _resolved(key, "/og.png")
    if isinstance(pub, HttpResponse):
        return pub
    if pub is None:
        raise Http404
    payload = _og_payload(pub, getattr(request, "web_lang", "cs"))
    cache_name = f"web:pubs:og:{_og_version(payload)}"
    image = cache.get(cache_name)
    if image is None:
        image = render_pub_og(payload)
        cache.set(cache_name, image, 24 * 60 * 60)
    response = HttpResponse(image, content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def pub_share_redirect(request: HttpRequest, key: str) -> HttpResponse | None:
    """Where an app's na-pivo.cz/h/<geohash> link leads now, or None for no pub."""

    cache_key = key.lower()
    if pubs_data.parse_pub_key(cache_key) != ("", cache_key):
        return None
    target = pubs_data.pub_key_for_hint(cache_key, request.GET.get("n", "")[:120])
    if target is None:
        return None
    return HttpResponseRedirect(web_reverse("web-pub", current_locale(), key=target))


# ---------- /hledat ----------


def _type_chips(query: str, current: str, counts: dict) -> list[dict]:
    labels = {
        "all": gettext("Vše"), "pubs": gettext("Hospody"), "beers": gettext("Piva"), "cities": gettext("Města a čtvrti"),
    }
    return [
        {
            "label": labels[kind],
            "count": num(counts[kind]),
            "url": "?" + urlencode({"q": query, **({"type": kind} if kind != "all" else {})}),
            "current": kind == current,
        }
        for kind in SEARCH_TYPES
        if kind == "all" or counts[kind]
    ]


def _beer_rows(beers: list[dict]) -> list[dict]:
    rows = []
    for beer in beers:
        served = ""
        if beer["pubs"]:
            served = gettext("čepují v %(pubs)s") % {
                "pubs": counted(beer["pubs"], gettext("hospodě"), gettext("hospodách"), gettext("hospodách"))
            }
        rows.append({
            **beer,
            "url": web_reverse("beer", key=beer["key"]) if beer["has_page"] else "",
            "meta": " · ".join(part for part in (
                "" if beer["name"].startswith(beer["brand"]) else beer["brand"], served
            ) if part),
            "rating_label": dec(beer["rating"]) if beer["rating"] else "",
            "ratings_label": _ratings_count(beer["ratings"]) if beer["rating"] else "",
        })
    return rows


def _city_rows(cities: list[dict]) -> list[dict]:
    return [
        {
            **city,
            "name": place_name(city["name"]),
            "url": district_url(city["slug"], city["district"]) if city["district"]
            else web_reverse("web-pubs-city", city=city["slug"]),
            "meta": _pubs_count(city["pubs"]),
            "median_label": _price_label(city["median"]),
        }
        for city in cities
    ]


@web_page
def search_page(request: HttpRequest) -> HttpResponse:
    query = " ".join(request.GET.get("q", "").split())[:120]
    kind = request.GET.get("type", "all")
    kind = kind if kind in SEARCH_TYPES else "all"
    if not pubs_data.fold(query):
        return render_page(
            request, "web/pubs/search.html", {"query": "", "cities": _others()},
            title=gettext("Hledání"), section="search", indexable=False,
        )
    wait = _wait(request, "web_search")
    if wait:
        return _slow_down(request, wait, "search")

    now = timezone.now()
    found = pubs_data.search(query)
    names = {city["slug"]: city["name"] for city in pubs_data.cities_by_size()}
    pubs = [_pub_row(pub, now, names.get(pub["city_slug"], "")) for pub in found["pubs"]]
    counts = {"pubs": found["pubs_total"], "beers": len(found["beers"]), "cities": len(found["cities"])}
    counts["all"] = counts["pubs"] + counts["beers"] + counts["cities"]
    shown_pubs = pubs[: 50 if kind == "pubs" else 5]
    similar = []
    for pub in found.get("similar", []):
        row = _pub_row(pub, now, names.get(pub["city_slug"], ""))
        city = names.get(pub["city_slug"], "")
        bits = [part for part in (row["district"], "" if row["district"].startswith(city) else city) if part]
        if row["beers"] and row["price"]:
            bits.append(gettext("%(beer)s za %(price)s Kč") % {"beer": row["beers"][0], "price": row["price"]})
        row["place"] = " · ".join(bits)
        similar.append(row)
    if counts["all"]:
        lead = counted(counts["all"], gettext("výsledek"), gettext("výsledky"), gettext("výsledků")) + "."
    else:
        totals = pubs_data.search_counts()
        lead = gettext("Nic. Prošel jsem %(pubs)s, %(beers)s a %(cities)s.") % {
            "pubs": counted(totals["pubs"], gettext("hospodu"), gettext("hospody"), gettext("hospod")),
            "beers": counted(totals["beers"], gettext("pivo"), gettext("piva"), gettext("piv")),
            "cities": counted(totals["cities"], gettext("město nebo čtvrť"), gettext("města a čtvrti"), gettext("měst a čtvrtí")),
        }
    map_pubs = shown_pubs[:10]
    map_points = [
        {"lat": row["lat"], "lng": row["lng"], "label": row["price_label"], "url": row["url"], "name": row["name"],
         "selected": index == 0}
        for index, row in enumerate(map_pubs)
    ]
    return render_page(
        request,
        "web/pubs/search.html",
        {
            "query": query,
            "quoted": gettext("„%(query)s“") % {"query": query},
            "kind": kind,
            "lead": lead,
            "type_chips": _type_chips(query, kind, counts) if counts["all"] else [],
            "pubs": shown_pubs if kind in ("all", "pubs") else [],
            "pubs_more_url": "?" + urlencode({"q": query, "type": "pubs"}) if kind == "all" and len(pubs) > 5 else "",
            "pubs_more_label": gettext("Ukázat všech %(pubs)s") % {"pubs": _pubs_count(counts["pubs"])},
            "beers": _beer_rows(found["beers"]) if kind in ("all", "beers") else [],
            "cities": _city_rows(found["cities"]) if kind in ("all", "cities") else [],
            "similar": similar,
            "map": pub_map(map_points, size=(364, 380)) if kind in ("all", "pubs") else None,
            "live_map": live_map(map_points),
            "map_caption": gettext("%(shown)s z %(total)s") % {"shown": num(len(map_pubs)), "total": _pubs_count(counts["pubs"])},
            "add_pub_url": web_reverse("web-my-pubs"),
            "pubs_url": web_reverse("web-pubs"),
        },
        title=gettext("Hledáš „%(query)s“") % {"query": query},
        section="search",
        indexable=False,
        with_map=True,
    )


def sitemap_paths() -> list[str]:
    paths = [web_reverse("web-pubs", "cs")]
    paths += [web_reverse("web-pubs-city", "cs", city=city["slug"]) for city in pubs_data.cities_by_size() if city["pubs"] >= 3]
    paths += district_sitemap_paths()
    paths += [web_reverse("web-pub", "cs", key=key) for key in pubs_data.sitemap_pub_keys()]
    return paths

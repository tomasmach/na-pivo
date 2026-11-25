"""Signed-in web pages: beers, my pubs, the crew, the taproom and settings.

Every page reads its data through the same ``/v1/`` view the app calls (``_api``
runs it inside this request, signed in by the web session), and every write is
a ``/v1/`` call from ``account.js``. The web therefore has no rules of its own:
visibility, blocking, limits and the account lock stay in the API.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode, urlsplit

from django.conf import settings
from django.db import transaction
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, QueryDict
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext, pgettext
from django.views.decorators.http import require_POST

from pubs import accounts
from pubs.api import piva_views, vycep_views
from pubs.api import views as api
from pubs.api.auth_views import _disable_account_push_devices
from pubs.api.pub_beers_views import city_name
from pubs.enrichment import names_match
from pubs.price_map import city_slug
from pubs.web import diary as d
from pubs.web import pubs_data, pubs_views
from pubs.web.auth_views import _over_limit
from pubs.web.pages import render_page, signed_in_page, web_page
from pubs.web.pub_map import live_map, pub_map
from pubs.web.routes import web_reverse
from pubs.web.session import end_session
from pubs.web.words import plural

TAGS = ("crisp", "great_foam", "smooth", "watery", "stale", "overpriced", "one_more", "never_again")
STYLES = ("pale", "amber", "dark", "craft")
VISIBILITIES = ("private", "friends", "public")
# Pins on the map of /moje-hospody, the most visited first.
MAP_PUBS = 40
# Fields of a check-in the app sends back when it rewrites one (``beerCheckInWire``).
_CHECKIN_WIRE = (
    "client_id", "beer_name", "brewery_name", "beer_style", "abv", "quantity", "price_czk",
    "rating", "tags", "note", "pub_cache_key", "pub_name", "pub_city", "visit_client_id",
    "visibility", "checked_in_at", "ended_at",
)


def _api(request: HttpRequest, view, query: dict | None = None, **kwargs) -> dict | list | None:
    """Body of a ``/v1/`` GET answered for this browser session, or None on any error."""

    status, data = _api_call(request, view, query, **kwargs)
    return data if status == 200 else None


def _api_call(request: HttpRequest, view, query: dict | None = None, **kwargs) -> tuple[int, dict | list | None]:
    """Status and body of a ``/v1/`` GET answered for this browser session."""

    query_string = urlencode({key: value for key, value in (query or {}).items() if value not in (None, "")})
    sub = HttpRequest()
    sub.method = "GET"
    sub.path = sub.path_info = request.path
    # Absolute upload URLs must name the API host: only it serves /media/.
    sub.META = {**request.META, "QUERY_STRING": query_string, "HTTP_HOST": urlsplit(settings.PUBLIC_API_ORIGIN).netloc}
    sub.META.pop("HTTP_AUTHORIZATION", None)
    sub.GET = QueryDict(query_string)
    sub.COOKIES = request.COOKIES
    sub.session = request.session
    response = view.as_view()(sub, **kwargs)
    return response.status_code, response.data


def _labels() -> dict:
    return {
        "tags": {
            "crisp": gettext("Má říz"),
            "great_foam": gettext("Pěna jak smetana"),
            "smooth": gettext("Jde samo"),
            "watery": gettext("Vodový"),
            "stale": gettext("Zvětralý"),
            "overpriced": gettext("Předražený"),
            "one_more": gettext("Ještě jedno"),
            "never_again": gettext("Už nikdy"),
        },
        "verdicts": ["", gettext("Nic moc"), gettext("Ujde"), gettext("Dobrý"), gettext("Moc dobrý"), gettext("Pecka")],
        "visibility": {
            "private": gettext("Uvidíš jen ty"),
            "friends": gettext("Uvidí tvoje parta"),
            "public": gettext("Uvidí všichni u piva"),
        },
        "styles": {
            "pale": gettext("Světlá"),
            "amber": gettext("Polotmavá"),
            "dark": gettext("Tmavá"),
            "craft": gettext("Craft"),
        },
    }


def _plural(n: int, one: str, few: str, many: str, **values) -> str:
    """``plural`` for forms that carry ``%(n)s``."""

    form = plural(n, one, few, many)
    return form % {"n": n, **values} if "%(" in form else form


def _when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    return parse_datetime(value) if isinstance(value, str) else None


def _ago(value) -> str:
    """"dnes", "včera", "před 3 dny", "minulý týden" or the date, like the app."""

    moment = _when(value)
    if moment is None:
        return ""
    local = timezone.localtime(moment)
    days = (timezone.localdate() - local.date()).days
    if days <= 0:
        return gettext("dnes")
    if days == 1:
        return gettext("včera")
    if days < 7:
        return _plural(days, gettext("před %(n)s dnem"), gettext("před %(n)s dny"), gettext("před %(n)s dny"))
    if days < 14:
        return gettext("minulý týden")
    return f"{local.day}. {local.month}."


def shell_context() -> dict:
    """What ``web/account/base.html`` needs: texts of ``account.js`` and the UGC policy version."""

    return {
        "js_text": {
            "offline": gettext("Jsi bez internetu. Zkus to znovu, až chytíš signál."),
            "tooMany": gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."),
            "failed": gettext("Nepovedlo se to. Zkus to prosím znovu."),
            "copied": gettext("Zkopírováno"),
            "verdicts": _labels()["verdicts"],
            "fillAll": gettext("Vyplň název, město i adresu."),
            "lookupDown": gettext("Adresu teď nedokážu dohledat. Zkus to za chvíli, vyplněné údaje ti tu nechám."),
            "notFound": gettext("Tuhle adresu jsem nenašel. Zkontroluj ulici s číslem a město."),
            "needNickname": gettext("Aby noc mohl vidět celý svět, potřebuješ přezdívku. Nastavíš ji v Nastavení za minutku."),
        },
        "ugc_version": settings.UGC_POLICY_VERSION,
    }


def _render(
    request: HttpRequest, template: str, context: dict, *, title: str, section: str = "", with_map: bool = False
) -> HttpResponse:
    return render_page(
        request,
        template,
        {**shell_context(), **context},
        title=title,
        section=section,
        indexable=False,
        with_map=with_map,
    )


def _bar(shares: list) -> list[dict]:
    """Star shares (5 stars first) as segments of a 200 wide bar."""

    parts, x = [], 0.0
    for share in shares or []:
        width = round(float(share or 0) * 192, 1)
        if width > 0:
            # Strings, so the template never localizes them into "12,5".
            parts.append({"x": f"{x:.1f}", "w": f"{max(width, 2):.1f}"})
        x = round(x + width + 2, 1)
    return parts


def _person(profile: dict | None) -> str:
    profile = profile or {}
    return profile.get("display_name") or (f"@{profile['nickname']}" if profile.get("nickname") else gettext("Pivař"))


# ---------------------------------------------------------------------------
# Piva
# ---------------------------------------------------------------------------


def _rating_entry(name: str, brewery: str, history: list[dict]) -> dict:
    """What the rating dialog starts from, the same way ``saveBeerRating`` in the app does.

    Rating again rewrites my newest check-in of the beer (same ``client_id``), so
    the diary keeps one row; the stars, tags, note and visibility start from my
    newest rated one, and a first rating is private.
    """

    rated = next((row for row in history if row.get("rating") is not None), None)
    return {
        "name": name,
        "brewery": brewery,
        "base": {key: history[0].get(key) for key in _CHECKIN_WIRE} if history else None,
        "rating": round(float(rated["rating"])) if rated else 0,
        "tags": [tag for tag in (rated or {}).get("tags") or [] if tag in TAGS],
        "note": (rated or {}).get("note") or "",
        "visibility": (rated or {}).get("visibility") or "private",
    }


def _my_beers(checkins: list[dict], unrated: list[dict]) -> list[dict]:
    """My beers newest first: rated or checked in, then the ones I drank but never rated."""

    by_beer: dict[str, list[dict]] = {}
    for row in checkins:
        key = row.get("beer_product_key") or row.get("beer_name", "").strip().lower()
        if key:
            by_beer.setdefault(key, []).append(row)
    items = []
    for key, rows in by_beer.items():
        entry = _rating_entry(rows[0]["beer_name"], rows[0].get("brewery_name") or "", rows)
        items.append({
            "id": f"mine-{len(items)}",
            "key": key,
            "product_key": rows[0].get("beer_product_key"),
            "name": rows[0]["beer_name"],
            "meta": " · ".join(part for part in (rows[0].get("pub_name"), _ago(rows[0].get("checked_in_at"))) if part),
            "stars": entry["rating"],
            "entry": entry,
        })
    for row in unrated:
        if row["product_key"] in by_beer:
            continue
        items.append({
            "id": f"mine-{len(items)}",
            "key": row["product_key"],
            "product_key": row["product_key"],
            "name": row["name"],
            "meta": gettext("Vypil jsi ho %(n)s×") % {"n": row["count"]},
            "stars": 0,
            "entry": _rating_entry(row["name"], row.get("brand_name") or "", []),
        })
    return items


@signed_in_page
def beers(request: HttpRequest) -> HttpResponse:
    labels = _labels()
    style = request.GET.get("styl", "")
    style = style if style in STYLES else ""
    query = request.GET.get("q", "").strip()[:80]

    ranking = _api(request, piva_views.BeerRankingView, {"style": style, "limit": 10}) or {}
    search = _api(request, piva_views.BeerSearchView, {"q": query}) if query else None
    listed = (search or {}).get("items") if search is not None else ranking.get("items") or []
    selected_key = request.GET.get("pivo", "").strip()[:120] or (listed[0]["product_key"] if listed else "")

    detail = photos = None
    if selected_key:
        detail = _api(request, api.BeerDetailView, {"product": selected_key})
        if detail and detail.get("product_key"):
            photos = _api(request, vycep_views.BeerPhotosView, {"beer": selected_key})
        elif detail is not None:
            detail = None

    checkins = (_api(request, api.BeerCheckInView) or {}).get("checkins") or []
    collection = _api(request, piva_views.BeerCollectionView) or {}
    mine = _my_beers(checkins, collection.get("unrated") or [])

    entries = {item["id"]: item["entry"] for item in mine}
    if detail:
        entries["selected"] = _rating_entry(detail["beer_name"], detail.get("brewery_name") or "", detail.get("my_history") or [])

    def _url(**changes) -> str:
        params = {"q": query, "styl": style, "pivo": selected_key, **changes}
        clean = {key: value for key, value in params.items() if value}
        return web_reverse("web-beers") + (f"?{urlencode(clean)}" if clean else "")

    style_chips = [{"label": gettext("Všechna"), "url": _url(styl="", pivo=""), "current": not style}] + [
        {"label": labels["styles"][code], "url": _url(styl=code, pivo=""), "current": style == code} for code in STYLES
    ]
    for item in listed:
        item["url"] = _url(pivo=item["product_key"])
        item["current"] = item["product_key"] == selected_key
        item["bar"] = _bar(item.get("stars"))
        item["kind"] = " · ".join(
            part for part in (item.get("brand_name"), labels["styles"].get((item.get("styles") or [""])[0], "").lower()) if part
        )
    for item in mine:
        item["url"] = _url(pivo=item["product_key"]) if item["product_key"] else ""

    selected = None
    if detail:
        party = detail.get("party_drinkers") or []
        selected = {
            **detail,
            "kind": " · ".join(
                part for part in (detail.get("brand_name") or detail.get("brewery_name"),
                                  ", ".join(labels["styles"][code].lower() for code in detail.get("styles") or [] if code in labels["styles"]))
                if part
            ),
            "my_rating": entries["selected"]["rating"],
            "global_stars": round(detail["global_rating"]) if detail.get("global_rating") is not None else 0,
            "count_label": _plural(detail.get("global_rating_count") or 0, gettext("%(n)s hodnocení"), gettext("%(n)s hodnocení"), gettext("%(n)s hodnocení")),
            "pouring_label": _plural(detail.get("pubs_pouring") or 0, gettext("Čepuje ho %(n)s hospoda"), gettext("Čepujou ho %(n)s hospody"), gettext("Čepuje ho %(n)s hospod")),
            "party_names": ", ".join(_person(profile) for profile in party[:3]),
            "party_more": max(0, len(party) - 3),
            "photos": (photos or {}).get("photos", [])[:4],
            "photo_total": (photos or {}).get("total", 0),
        }

    return _render(
        request,
        "web/account/beers.html",
        {
            "query": query,
            "search": search,
            "listed": listed,
            "early": ranking.get("early"),
            "style_chips": style_chips,
            "selected": selected,
            "mine": mine[:12],
            "mine_total": len(mine),
            "rating_entries": entries,
            "labels": labels,
            "stars": range(1, 6),
        },
        title=gettext("Piva"),
        section="beers",
    )


# ---------------------------------------------------------------------------
# Moje hospody
# ---------------------------------------------------------------------------


_DEFAULT_CITY = "praha"
_MY_PUBS_FILTERS = ("open", "max55", "tank", "garden", "parta", "moje")


def _my_pub_info(request: HttpRequest) -> dict[str, list[dict]]:
    """My visits, favourites and added pubs per cache key; a cell can hold more pubs, so each keeps its name."""

    visits = (_api(request, api.PubVisitView) or {}).get("visits") or []
    favorites = (_api(request, api.PubFavoriteView) or {}).get("favorites") or []
    added = _api(request, api.UserAddedPubView) or []
    mine: dict[str, list[dict]] = {}

    def entry(key: str, row: dict) -> dict:
        name = row.get("name") or ""
        rows = mine.setdefault(key, [])
        found = next((item for item in rows if names_match(item["name"], name)), None)
        if found is None:
            found = {"name": name, "city": row.get("city") or "", "visits": 0, "last": None, "favorite": False,
                     "added": None, "lat": row.get("lat"), "lng": row.get("lng")}
            rows.append(found)
        return found

    for visit in visits:
        if visit.get("cache_key"):
            item = entry(visit["cache_key"], visit)
            item["visits"] += 1
            started = _when(visit.get("started_at"))
            if started and (item["last"] is None or started > item["last"]):
                item["last"] = started
    for favorite in favorites:
        if favorite.get("cache_key"):
            entry(favorite["cache_key"], favorite)["favorite"] = True
    for row in added:
        if row.get("cache_key"):
            entry(row["cache_key"], row)["added"] = row
    return mine


def _mine_lines(item: dict | None) -> list[str]:
    if not item:
        return []
    lines = []
    if item["visits"]:
        visited = gettext("Byl jsi tu %(n)s×") % {"n": item["visits"]}
        lines.append(f"{visited} · {gettext('naposledy %(when)s') % {'when': _ago(item['last'])}}" if item["last"] else visited)
    if item["favorite"]:
        lines.append(gettext("Máš ji v oblíbených"))
    if item["added"]:
        lines.append(gettext("Přidal jsi ji ty"))
    return lines


def _slug_of(raw_city: str) -> str:
    return city_slug(city_name(raw_city)) if raw_city else ""


def _my_city(mine: dict[str, list[dict]], cities: dict, picked: str, pub_key: str) -> str:
    """The picked city, else the city of the picked pub, else of my newest visit, else Prague.

    A city only my own added pub is in counts too: the catalogue rebuilds once an hour.
    """

    known = set(cities) | {_slug_of(item["city"]) for items in mine.values() for item in items} - {""}
    if picked in known:
        return picked
    parsed = pubs_data.parse_pub_key(pub_key)
    if parsed:
        places = [pub["c"] for pub in pubs_data._candidates(parsed[1])]
        places += [_slug_of(item["city"]) for item in mine.get(parsed[1], [])]
        found = next((slug for slug in places if slug in known), "")
        if found:
            return found
    newest = sorted(
        (item for items in mine.values() for item in items if item["last"]),
        key=lambda item: item["last"], reverse=True,
    )
    for item in newest:
        slug = _slug_of(item["city"])
        if slug in known:
            return slug
    return _DEFAULT_CITY if _DEFAULT_CITY in known else next(iter(sorted(known)), "")


@signed_in_page
def my_pubs(request: HttpRequest) -> HttpResponse:
    """The pubs of a city on a map, like the app's Hospody, with what I know about each of them.

    The catalogue and its filters are the public ones of ``/hospody/<město>``. "Parta teď"
    only uses the friends the app shows sitting in a pub right now (``active_friends``).
    """

    mine = _my_pub_info(request)
    cities = pubs_data.catalogue()["cities"]
    slug = _my_city(mine, cities, request.GET.get("mesto", ""), request.GET.get("hospoda", ""))
    data = pubs_data.city_pubs(slug) if slug else None
    base = web_reverse("web-my-pubs")
    get = request.GET
    chosen = {key: get.get(key) == "1" for key in _MY_PUBS_FILTERS}
    sort = get.get("razeni", "")
    sort = sort if sort in pubs_views.SORTS else ""
    query = get.get("q", "").strip()[:80]
    params = {"mesto": slug if get.get("mesto") else "", "q": query, "razeni": sort,
              **{key: "1" for key, on in chosen.items() if on}}

    def url(**changes) -> str:
        merged = {key: value for key, value in {**params, **changes}.items() if value}
        return f"{base}?{urlencode(merged)}" if merged else base

    now = timezone.now()
    out_now: dict[str, list[str]] = {}
    for row in (_api(request, api.FriendsView) or {}).get("active_friends") or []:
        if row.get("cache_key"):
            out_now.setdefault(row["cache_key"], []).append(_person(row.get("account")))

    rows = []
    for pub in (data or {}).get("list") or []:
        row = pubs_views._pub_row(pub, now, data["name"])
        item = next((item for item in mine.get(pub["cache_key"], []) if names_match(item["name"], pub["name"])), None)
        row["mine"] = _mine_lines(item)
        row["favorite"] = bool(item and item["favorite"])
        row["visits"] = item["visits"] if item else 0
        row["friends"] = out_now.get(pub["cache_key"], [])
        rows.append(row)

    # My pubs the catalogue does not list (yet): one I just added, or one hidden from the public lists.
    listed = {(row["cache_key"], row["stored_name"]) for row in rows}
    for key, items in mine.items():
        for item in items:
            added = item["added"] or {}
            if item["lat"] is None or _slug_of(item["city"]) != slug:
                continue
            if any(cache_key == key and names_match(item["name"], name) for cache_key, name in listed):
                continue
            row = pubs_views._pub_row({
                "key": key, "cache_key": key, "name": item["name"], "district": "", "address": added.get("address") or "",
                "lat": item["lat"], "lng": item["lng"], "hours": None, "beers": [], "tank": False, "price": None,
                "volume": None, "garden": False, "rating": None, "raters": 0, "ratings": 0,
            }, now, item["city"])
            row.update(url="", mine=_mine_lines(item), favorite=item["favorite"], visits=item["visits"],
                       friends=out_now.get(key, []))
            rows.append(row)

    tests = {
        "open": lambda row: row["status"] and row["status"]["open"],
        "max55": lambda row: row["price"] and pubs_data.half_litre(row["price"], row["volume"]) <= pubs_views.CHEAP_CZK,
        "tank": lambda row: row["tank"],
        "garden": lambda row: row["garden"],
        "parta": lambda row: row["friends"],
        "moje": lambda row: row["mine"],
    }
    visible = rows
    for key, test in tests.items():
        if chosen[key]:
            visible = [row for row in visible if test(row)]
    if query:
        needle = pubs_data.fold(query)
        visible = [
            row for row in visible
            if needle in pubs_data.fold(" ".join([row["name"], row["address"], row["district"], *row["beers"]]))
        ]
    visible = pubs_views._sorted(visible, sort)
    try:
        page = min(max(int(get.get("strana", "1")), 1), pubs_views.MAX_PAGES)
    except ValueError:
        page = 1
    shown = visible[: page * pubs_views.PAGE_SIZE]

    picked = get.get("hospoda", "")
    selected = next((row for row in rows if picked and picked in (row["key"], row["cache_key"])), None)
    selected = selected or (shown[0] if shown else None)
    page_params = {"strana": str(page) if page > 1 else ""}
    for row in shown:
        row["pick_url"] = url(hospoda=row["key"], **page_params)
        row["current"] = row is selected
    on_map = shown[-pubs_views.PAGE_SIZE:]
    if selected is not None and selected not in on_map:
        on_map = [selected, *on_map]
    on_map = sorted(on_map, key=lambda row: row is not selected)
    map_points = [
        {"lat": row["lat"], "lng": row["lng"], "label": row["price_label"], "url": url(hospoda=row["key"], **page_params),
         "name": row["name"], "selected": row is selected}
        for row in on_map if row["lat"] is not None
    ]

    def chip(label: str, key: str) -> dict:
        return {"label": label, "url": url(**{key: "" if chosen[key] else "1"}, strana=""), "current": chosen[key]}

    chips = []
    if any(row["status"] for row in rows):
        chips.append(chip(gettext("Otevřeno teď"), "open"))
    if any(row["price"] for row in rows):
        chips.append(chip(gettext("Do %(price)s Kč") % {"price": pubs_views.CHEAP_CZK}, "max55"))
    if any(row["tank"] for row in rows):
        chips.append(chip(gettext("Čepujou tankové"), "tank"))
    if any(row["garden"] for row in rows):
        chips.append(chip(gettext("Zahrádka"), "garden"))
    if any(row["friends"] for row in rows) or chosen["parta"]:
        chips.append(chip(gettext("Parta teď"), "parta"))
    if any(row["mine"] for row in rows) or chosen["moje"]:
        chips.append(chip(gettext("Moje"), "moje"))

    my_slugs = []
    for items in mine.values():
        for item in items:
            city = _slug_of(item["city"])
            if city and city not in my_slugs:
                my_slugs.append(city)
    city_choices = my_slugs + [city["slug"] for city in pubs_data.cities_by_size()[:12] if city["slug"] not in my_slugs]
    names = {code: city["name"] for code, city in cities.items()}
    for items in mine.values():
        for item in items:
            names.setdefault(_slug_of(item["city"]), city_name(item["city"]))
    menu_city = {
        "label": names.get(slug) or gettext("Město"),
        "current": False,
        "items": [{"label": names[code], "url": url(mesto=code, hospoda="", strana=""), "current": code == slug}
                  for code in city_choices],
    }
    sort_labels = {"": gettext("nejlíp hodnocené"), "price": gettext("nejlevnější"), "name": gettext("podle názvu")}
    menu_sort = {
        "label": gettext("Řadit: %(sort)s") % {"sort": sort_labels[sort]},
        "current": False,
        "items": [{"label": label, "url": url(razeni=key, strana=""), "current": sort == key} for key, label in sort_labels.items()],
    }
    if selected is not None:
        selected["log_url"] = f"{web_reverse('web-log-beer')}?{urlencode({'hospoda': selected['cache_key'], 'n': selected['stored_name']})}"
        destination = f"{selected['lat']},{selected['lng']}"
        selected["route_url"] = f"https://www.google.com/maps/dir/?{urlencode({'api': '1', 'destination': destination})}"
        selected["ratings_label"] = _plural(selected["ratings"], pgettext("one", "%(n)s hodnocení"), gettext("%(n)s hodnocení"),
                                            gettext("%(n)s hodnocení")) if selected["ratings"] else ""
        selected["friends_label"] = (gettext("Teď tu sedí: %(names)s") % {"names": ", ".join(selected["friends"][:3])}
                                     if selected["friends"] else "")
    count = len(visible)
    return _render(
        request,
        "web/account/my_pubs.html",
        {
            "rows": shown,
            "selected": selected,
            "query": query,
            "hidden_params": {key: value for key, value in params.items() if value and key != "q"},
            "chips": chips,
            "menu_city": menu_city,
            "menu_sort": menu_sort,
            "count_label": _plural(count, gettext("%(n)s hospoda"), gettext("%(n)s hospody"), gettext("%(n)s hospod")),
            "more_url": url(strana=str(page + 1)) if len(visible) > len(shown) and page < pubs_views.MAX_PAGES else "",
            "filtered": any(chosen.values()) or bool(query),
            "clear_url": url(**{key: "" for key in _MY_PUBS_FILTERS}, q="", strana=""),
            "map": pub_map(map_points, size=(640, 520)) if map_points else None,
            "live_map": live_map(map_points),
            "city_name": names.get(slug, ""),
        },
        title=gettext("Hospody"),
        section="pubs",
        with_map=True,
    )


@signed_in_page
def add_pub(request: HttpRequest) -> HttpResponse:
    return _render(
        request,
        "web/account/add_pub.html",
        {},
        title=gettext("Přidat hospodu"),
        section="pubs",
    )


# ---------------------------------------------------------------------------
# Parta
# ---------------------------------------------------------------------------


@signed_in_page
def crew(request: HttpRequest) -> HttpResponse:
    data = _api(request, api.FriendsView) or {}
    stats = data.get("friend_stats") or {}
    out_now = {
        (row.get("account") or {}).get("id"): row.get("name") or ""
        for row in data.get("active_friends") or []
    }
    friends = []
    for profile in data.get("friends") or []:
        stat = stats.get(profile["id"]) or {}
        last = _when(stat.get("last_shared_at"))
        if profile["id"] in out_now:
            meta = " · ".join(part for part in (gettext("Teď venku"), out_now[profile["id"]]) if part)
        elif last:
            recent = (timezone.localdate() - timezone.localtime(last).date()).days < 7
            when = _ago(last)
            meta = (gettext("Naposledy %(when)s · %(pub)s") % {"when": when, "pub": stat["last_pub_name"]}
                    if recent and stat.get("last_pub_name") else gettext("Naposledy %(when)s") % {"when": when})
        else:
            meta = gettext("Zatím jste spolu nebyli")
        count = stat.get("shared_pub_count") or 0
        friends.append({
            **profile,
            "name": _person(profile),
            "meta": meta,
            "out": profile["id"] in out_now,
            "together": _plural(count, gettext("%(n)s večer spolu"), gettext("%(n)s večery spolu"), gettext("%(n)s večerů spolu")) if count else "",
        })

    board = data.get("leaderboard") or []
    for row in board:
        row["name"] = gettext("Ty") if row.get("is_me") else _person(row.get("account"))
        row["avatar_name"] = _person(row.get("account")).lstrip("@")
        row["unit"] = _plural(row.get("beers_30d") or 0, gettext("pivo"), gettext("piva"), gettext("piv"))
    board.sort(key=lambda row: -(row.get("beers_30d") or 0))
    chase = ""
    my_index = next((i for i, row in enumerate(board) if row.get("is_me")), None)
    if my_index:
        ahead = board[my_index - 1]
        gap = (ahead.get("beers_30d") or 0) - (board[my_index].get("beers_30d") or 0)
        if gap > 0:
            chase = _plural(gap, gettext("Před tebou je %(name)s o %(n)s pivo."), gettext("Před tebou je %(name)s o %(n)s piva."),
                            gettext("Před tebou je %(name)s o %(n)s piv."), name=ahead["name"])

    term = request.GET.get("hledat", "").strip()[:40]
    results = None
    if len(term) >= 2:
        known = {profile["id"] for profile in data.get("friends") or []}
        pending = {row["recipient"]["id"] for row in data.get("outgoing_requests") or []}
        results = [
            {**profile, "name": _person(profile), "friend": profile["id"] in known, "pending": profile["id"] in pending}
            for profile in (_api(request, api.FriendSearchView, {"q": term}) or {}).get("results") or []
        ]
    invite = _api(request, api.FriendInviteView) or {}
    return _render(
        request,
        "web/account/crew.html",
        {
            "incoming": [
                {**row, "name": _person(row["requester"])} for row in data.get("incoming_requests") or []
            ],
            "outgoing": [
                {**row, "name": _person(row["recipient"])} for row in data.get("outgoing_requests") or []
            ],
            "friends": friends,
            "board": board[:8],
            "chase": chase,
            "term": term,
            "results": results,
            "invite_url": invite.get("web_url") or "",
            "needs_nickname": not request.web_account.nickname,
        },
        title=gettext("Parta"),
        section="crew",
    )


# ---------------------------------------------------------------------------
# Výčep
# ---------------------------------------------------------------------------


def _duration(minutes) -> str:
    if not minutes:
        return ""
    hours, rest = divmod(int(minutes), 60)
    if not hours:
        return gettext("%(m)s min") % {"m": rest}
    return gettext("%(h)s h %(m)s min") % {"h": hours, "m": rest} if rest else gettext("%(h)s h") % {"h": hours}


_SHAREABLE = ("friends", "public")
# How far back "Vyvěsit noc" on the Výčep looks for a night to hang up.
_PUBLISH_DAYS = 60


def publish_context(account, night: d.Night | None) -> dict:
    """The "Vyvěsit noc" dialog for one night, like ``VyvesitSheet`` in the app."""

    if night is None:
        return {"night": None}
    payload = d.publish_payload(night)
    published = d.published_nights(account, [night.day]).get(night.day)
    if published is not None:
        visibility = published.visibility
    elif account.night_autopublish in _SHAREABLE:
        visibility = account.night_autopublish
    else:
        visibility = account.share_default if account.share_default in _SHAREABLE else "friends"
    local = timezone.localtime(night.start)
    return {
        "night": payload,
        "night_json": json.dumps(payload, ensure_ascii=False),
        "published": published,
        "visibility": visibility,
        "handle": f"@{account.nickname}" if account.nickname else (account.display_name or gettext("Ty")),
        "has_nickname": bool(account.nickname),
        "where": " · ".join(part for part in (payload["city"], f"{_ago(night.start)} {local:%H:%M}") if part),
        "beers": _plural(payload["beer_count"], gettext("%(n)s pivo"), gettext("%(n)s piva"), gettext("%(n)s piv")),
        "route": " · ".join(
            part for part in (" → ".join(payload["pub_names"]), _duration(payload.get("duration_minutes"))) if part
        ),
    }


def _night_to_publish(account) -> d.Night | None:
    """The newest night not on the Výčep yet, else the newest, as the app picks it."""

    today = d.today()
    nights = d.nights_of(d.load_drinks(account, today - timedelta(days=_PUBLISH_DAYS), today))
    if not nights:
        return None
    published = d.published_nights(account, [night.day for night in nights])
    return next((night for night in nights if night.day not in published), nights[0])


@signed_in_page
def taproom(request: HttpRequest) -> HttpResponse:
    scope = "friends" if request.GET.get("kde") == "parta" else "global"
    cursor = request.GET.get("dalsi", "")[:200]
    feed = _api(request, api.PublishedNightFeedView, {"scope": scope, "cursor": cursor, "limit": 10}) or {}
    summary = _api(request, vycep_views.NightsSummaryView, {"scope": scope, "days": 7})
    live = _api(request, api.FriendsView) or {}

    nights = []
    for night in feed.get("nights") or []:
        started = _when(night.get("started_at"))
        local = timezone.localtime(started) if started else None
        when = f"{_ago(started)} {local:%H:%M}" if local else ""
        nights.append({
            **night,
            "author_name": f"@{night['author']['nickname']}" if night["author"].get("nickname") else _person(night["author"]),
            "meta": " · ".join(part for part in (night.get("city"), when) if part),
            "route": " → ".join(night.get("pub_names") or []),
            "duration": _duration(night.get("duration_minutes")),
            "photo": (night.get("hero_photos") or [None])[0],
            "beers_label": _plural(night.get("beer_count") or 0, gettext("%(n)s pivo"), gettext("%(n)s piva"), gettext("%(n)s piv")),
        })
    out = [
        {"name": _person(row.get("account")), "pub": row.get("name") or ""}
        for row in live.get("active_friends") or []
    ]
    base = web_reverse("web-taproom")
    return _render(
        request,
        "web/account/taproom.html",
        {
            "scope": scope,
            "nights": nights,
            "summary": summary,
            "out": out,
            "segment": [
                {"label": gettext("Svět"), "url": base, "current": scope == "global"},
                {"label": gettext("Parta"), "url": f"{base}?kde=parta", "current": scope == "friends"},
            ],
            "next_url": (
                f"{base}?{urlencode({**({'kde': 'parta'} if scope == 'friends' else {}), 'dalsi': feed['next_cursor']})}"
                if feed.get("next_cursor") else ""
            ),
            "publish": publish_context(request.web_account, _night_to_publish(request.web_account)),
            "log_url": web_reverse("web-log-beer"),
        },
        title=gettext("Výčep"),
        section="taproom",
    )


# ---------------------------------------------------------------------------
# Nastavení
# ---------------------------------------------------------------------------


@signed_in_page
def settings_page(request: HttpRequest) -> HttpResponse:
    me = _api(request, api.AccountMeView) or {}
    social = _api(request, api.FriendSettingsView) or {}
    providers = me.get("providers") or []
    names = {"email": gettext("E-mail a heslo"), "google": "Google", "apple": "Apple"}
    stats = me.get("stats") or {}
    return _render(
        request,
        "web/account/settings.html",
        {
            "me": me,
            "providers": [{"code": code, "name": names.get(code, code)} for code in providers],
            "provider_names": ", ".join(names.get(code, code) for code in providers),
            "can_unlink": len(providers) > 1,
            "has_password": "email" in providers,
            "share_drinks": social.get("share_drinks_with_parta", True),
            "autopublish": me.get("night_autopublish") or "off",
            "autopublish_options": [
                ("off", gettext("Ručně")),
                ("public", gettext("Automaticky celému světu")),
                ("friends", gettext("Automaticky partě")),
            ],
            "diary_line": _plural(stats.get("total_beers") or 0, gettext("Deník: %(n)s zapsané pivo"),
                                  gettext("Deník: %(n)s zapsaná piva"), gettext("Deník: %(n)s zapsaných piv")),
            "grace_days": settings.ACCOUNT_DELETION_GRACE_DAYS,
            "profile_saved": request.GET.get("ulozeno") == "profil",
            "export_url": "/v1/account/export",
            "lang_urls": {
                "cs": web_reverse("web-settings", "cs"),
                "en": web_reverse("web-settings", "en"),
            },
        },
        title=gettext("Nastavení"),
        section="settings",
    )


def friend_invite(request: HttpRequest, code: str) -> HttpResponse:
    """``/p/<kód>`` for a signed-in browser: who invites me, and "Přidat do party" like the app's claim screen.

    Called by ``invite_landing``, which already set up the page and the session.
    """

    status, resolved = _api_call(request, api.FriendInviteResolveView, code=code)
    inviter = (resolved or {}).get("inviter") if status == 200 else None
    state = "valid"
    if inviter is None:
        state = "expired" if (resolved or {}).get("code") == "invite_expired" else "invalid"
    elif inviter["id"] == str(request.web_account.public_id):
        state = "self"
    else:
        crew = _api(request, api.FriendsView) or {}
        if any(friend["id"] == inviter["id"] for friend in crew.get("friends") or []):
            state = "friends"
        elif any(row["recipient"]["id"] == inviter["id"] for row in crew.get("outgoing_requests") or []):
            state = "pending"
    name = _person(inviter)
    mutual = ((resolved or {}).get("mutual_friends") or {}).get("count") or 0
    return _render(
        request,
        "web/account/invite.html",
        {
            "state": state,
            "inviter": inviter,
            "name": name,
            "initial": name.lstrip("@"),
            "mutual": _plural(mutual, gettext("%(n)s společný kamarád"), gettext("%(n)s společní kamarádi"),
                              gettext("%(n)s společných kamarádů")) if mutual else "",
            "body_json": json.dumps({"invite_code": code}),
            "deep_link": f"napivo://parta/pozvanka?code={quote(code, safe='')}",
        },
        title=gettext("Přidej se k partě"),
        section="crew",
    )


@require_POST
@signed_in_page
def logout_everywhere(request: HttpRequest) -> HttpResponse:
    """Sign out the web, the app and every other device, like the app's "all" logout."""

    if _over_limit(request, "auth"):
        return HttpResponse(gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."), status=429)
    account = request.web_account
    with transaction.atomic():
        accounts.revoke_all_tokens(account)
        _disable_account_push_devices(account)
    end_session(request)
    return HttpResponseRedirect(web_reverse("home"))


@web_page
def account_deleted(request: HttpRequest) -> HttpResponse:
    """Where the web lands after deleting the account; the session is already gone."""

    return render_page(
        request,
        "web/account/deleted.html",
        {"grace_days": settings.ACCOUNT_DELETION_GRACE_DAYS},
        title=gettext("Účet mažeme"),
        indexable=False,
    )


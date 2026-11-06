"""Public pages of na-pivo.cz in the web shell: home, beer prices, beer pages and shared app links.

Invite links never resolve the invite owner: link previews stay generic and never
expose profile data to unauthenticated crawlers. Price and beer pages read the
newest daily snapshot as is; the few live numbers next to it are cached.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncMonth
from django.http import (
    FileResponse,
    Http404,
    HttpRequest,
    HttpResponse,
    HttpResponsePermanentRedirect,
    JsonResponse,
)
from django.utils import formats, timezone, translation
from django.utils.translation import gettext, pgettext, pgettext_lazy

from pubs.beer_pages import PATHS as BEER_PATHS
from pubs.beer_pages import counted, page_path
from pubs.beer_pages import render_og_image as render_beer_og_image
from pubs.beer_ranking import star_shares
from pubs.checks import ANDROID_APP_LINK_FINGERPRINTS_ENV, normalized_cert_fingerprints
from pubs.home_views import (
    APP_STORE_URL,
    AUTHOR,
    DATA_LICENSE_PATH,
    HOME_OG_PATH,
    INVITE_OG_PATH,
    PLAY_STORE_URL,
    WEBSITE_ID,
    app_store_url,
    breadcrumb_list,
    ld_json,
    organization,
    organization_ref,
    play_store_url,
    price_variables,
)
from pubs.home_views import PATHS as HOME_PATHS
from pubs.models import (
    Account,
    BeerBrand,
    BeerCheckIn,
    BeerPage,
    BeerProduct,
    BeerRanking,
    DrinkLog,
    PubPriceSnapshot,
)
from pubs.price_map import PATHS as PRICE_PATHS
from pubs.price_map import city_slug, headline_prices, render_city_og_image
from pubs.web.dates import time_tag, with_times
from pubs.web.pages import login_url, render_page, web_page
from pubs.web.places import in_place, place_name, pub_name
from pubs.web.routes import web_reverse
from pubs.web.words import plural

# Lists longer than this get search and sorting, and start folded to this many rows.
_FOLDED_ROWS = 12
# A beer like Pilsner Urquell is on tap in hundreds of pubs; past this many its list goes on over pages.
PUBS_PER_PAGE = 50
# Live numbers beside a daily snapshot: fresh enough, and one visit costs a few queries at most.
_LIVE_SECONDS = 600

_ASSET_ROOT = Path(__file__).resolve().parent / "static" / "pubs" / "invite"
_ASSETS: dict[str, tuple[str, str]] = {
    "favicon.ico": ("favicon.ico", "image/x-icon"),
    "apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "icon-512.png": ("favicon-512.png", "image/png"),
    "manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json"),
    "og-invite.png": ("og-invite.png", "image/png"),
    "og-home.png": ("og-home.png", "image/png"),
}


def _litres(volume_ml: int) -> str:
    """0,5 / 0,33 / 0,47 / 1: every digit a menu gives, no trailing zeros."""
    return formats.number_format(Decimal(volume_ml) / 1000)


def _stores(campaign: str) -> dict[str, str]:
    return {"app_store_url": app_store_url(campaign), "play_store_url": play_store_url(campaign)}


def _invite(
    request: HttpRequest, path: str, deep_link: str, campaign: str, texts: dict, sign_in: bool = False
) -> HttpResponse:
    response = render_page(
        request,
        "web/reskin/invite.html",
        {
            "og_url": f"{settings.PUBLIC_WEB_ORIGIN}{path}",
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}{INVITE_OG_PATH}",
            "deep_link": deep_link,
            "headline": texts["headline"],
            "body": texts["body"],
            "login_url": login_url(request) if sign_in else "",
            **_stores(campaign),
        },
        title=texts["title"],
        description=texts["description"],
        indexable=False,
    )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@web_page
def invite_landing(request: HttpRequest, code: str) -> HttpResponse:
    """A generic, privacy-preserving landing for a Parta invite; signed in, the web accepts it."""

    if request.web_account is not None:
        # Imported here: the signed-in pages import this module's helpers.
        from pubs.web.account_views import friend_invite

        return friend_invite(request, code)
    encoded = quote(code, safe="")
    return _invite(request, web_reverse("friend-invite-landing", code=code), f"napivo://parta/pozvanka?code={encoded}", "invite", {
        "title": gettext("Přidej se k partě"),
        "description": gettext("Hospoda je lepší s kámoši. Otevři pozvánku v aplikaci Na pivo."),
        "headline": gettext("Kámoš tě zve do party."),
        "body": gettext("Otevři pozvánku v Na pivo a hned budeš vědět, kdy se jde na jedno."),
    }, sign_in=True)


@web_page
def party_invite_landing(request: HttpRequest, code: str) -> HttpResponse:
    """A privacy-preserving landing for a shared table invite."""

    encoded = quote(code, safe="")
    return _invite(request, web_reverse("party-invite-landing", code=code), f"napivo://party-live?code={encoded}", "party", {
        "title": gettext("Přisedni ke stolu"),
        "description": gettext("Kámoši tě zvou ke stolu. Otevři pozvánku v aplikaci Na pivo."),
        "headline": gettext("U stolu je místo."),
        "body": gettext("Otevři Na pivo, potvrď kód a přisedni ke kámošům."),
    })


def apple_app_site_association(_request: HttpRequest) -> JsonResponse:
    """Advertise invite paths as iOS universal links when the team ID is set."""

    team_id = settings.APPLE_TEAM_ID.strip()
    details = (
        [
            {
                "appID": f"{team_id}.com.tomasmach.na-pivo",
                "components": [
                    {"/": "/p/*", "comment": "Parta friend invite links"},
                    {"/": "/party/*", "comment": "Shared table invite links"},
                    {"/": "/t/*", "comment": "Tour itinerary links"},
                ],
            }
        ]
        if team_id
        else []
    )
    response = JsonResponse({"applinks": {"apps": [], "details": details}})
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


_ANDROID_PACKAGE = "com.tomasmach.na_pivo"


def _android_cert_fingerprints() -> list[str]:
    """Read trusted Android signing-cert fingerprints from settings.

    The value is never invented here: without ANDROID_APP_LINK_CERT_FINGERPRINTS
    (or with only malformed entries) the statement list stays empty and Google
    grants no app-link verification — fail closed. Valid entries are 64 hex
    characters; publish the uppercase colon-separated octets required by Google.
    """

    raw = str(getattr(settings, ANDROID_APP_LINK_FINGERPRINTS_ENV, "") or "")
    if not raw.strip():
        return []
    return [
        ":".join(value[index:index + 2] for index in range(0, len(value), 2))
        for value in normalized_cert_fingerprints(raw)
    ]


def android_asset_statements(_request: HttpRequest) -> JsonResponse:
    """Serve /.well-known/assetlinks.json for Android app links.

    assetlinks.json cannot scope by path — the /p/* and /party/* restriction
    lives in the app's autoVerify intent filters (see app.config.ts). With no
    configured fingerprint the response is an empty list — the app simply does
    not verify until ops sets ANDROID_APP_LINK_CERT_FINGERPRINTS.
    """

    fingerprints = _android_cert_fingerprints()
    statements = (
        [
            {
                "relation": ["delegate_permission/common.handle_all_urls"],
                "target": {
                    "namespace": "android_app",
                    "package_name": _ANDROID_PACKAGE,
                    "sha256_cert_fingerprints": fingerprints,
                },
            }
        ]
        if fingerprints
        else []
    )
    response = JsonResponse(statements, safe=False)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


def invite_asset(request: HttpRequest, filename: str) -> FileResponse:
    """Serve the tiny public invite asset set without relying on Caddy paths.

    Only an address with ``?v=`` names one version of the file, so only that one is immutable.
    """

    asset = _ASSETS.get(filename)
    if asset is None:
        raise Http404
    disk_name, content_type = asset
    path = _ASSET_ROOT / disk_name
    if not path.is_file():
        raise Http404
    response = FileResponse(path.open("rb"), content_type=content_type)
    response.headers["Cache-Control"] = "public, max-age=604800" + (", immutable" if request.GET.get("v") else "")
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@web_page
def tour_invite_landing(request: HttpRequest, token: str) -> HttpResponse:
    """Read-only itinerary, with no trackers, map SDK or redirect."""
    from rest_framework.request import Request

    from pubs.api.throttling import SharedScopedRateThrottle
    from pubs.tours import (
        protect_response,
        public_payload,
        public_share,
        readable_publications,
        tour_snapshot,
    )

    throttle = SharedScopedRateThrottle()
    policy = type("TourPublicPolicy", (), {"throttle_scope": "tour_public"})()
    if not throttle.allow_request(Request(request), policy):
        response = HttpResponse(gettext("Zkus to prosím za chvíli."), status=429)
        response["Retry-After"] = str(throttle.wait())
        return protect_response(response)
    share = public_share(token)
    publication = None if share else readable_publications().filter(token=token).first()
    title = "Tour de pub"
    if not share and not publication:
        return protect_response(render_page(
            request, "web/reskin/tour.html", {"unavailable": True}, title=title, status=404, indexable=False,
        ))
    public = public_payload(publication) if publication else None
    tour = public["tour"] if public else tour_snapshot(share.plan)
    first = tour["stops"][0]
    response = render_page(request, "web/reskin/tour.html", {
        "tour": tour,
        "author": public["public"]["author"] if public else None,
        "meeting_date": share.plan.scheduled_date if share else None,
        "deep_link": f"napivo://t/{quote(token, safe='')}",
        "navigation_url": f"https://www.google.com/maps/dir/?api=1&destination={first['lat']},{first['lon']}&travelmode=walking",
        **_stores("tour"),
    }, title=f"{tour['title']} | {title}", indexable=False)
    return protect_response(response)


def _year_in_beer(today: date) -> dict:
    """What everyone wrote into Na pivo this year: beers, evenings, pubs, money and the busiest beers.

    Totals over everyone only, never one person's diary; suspect drinks and closed accounts stay out.
    """

    key = f"web:home-year:{today.isoformat()}"
    year = cache.get(key)
    if year is not None:
        return year
    start = timezone.make_aware(datetime(today.year, 1, 1))
    drinks = DrinkLog.objects.filter(
        drink_type=DrinkLog.DrinkType.BEER,
        is_suspect=False,
        account__status=Account.Status.ACTIVE,
        drank_at__gte=start,
    )
    totals = drinks.aggregate(
        beers=Count("id"),
        evenings=Count("evening_client_id", distinct=True),
        pubs=Count("cache_key", distinct=True, filter=~Q(cache_key="")),
        spent=Sum("price_czk"),
    )
    per_month = {
        month.month: count
        for month, count in drinks.annotate(month=TruncMonth("drank_at"))
        .order_by()
        .values("month")
        .annotate(beers=Count("id"))
        .values_list("month", "beers")
    }
    beers = list(
        drinks.exclude(beer_product_key="")
        .order_by()
        .values("beer_product_key")
        .annotate(beers=Count("id"), beer_product_name=Max("beer_product_name"))
        .order_by("-beers", "beer_product_key")[:4]
    )
    year = {
        **{name: int(value or 0) for name, value in totals.items()},
        "months": [per_month.get(number, 0) for number in range(1, 13)],
        "top_beers": beers,
        "pages": set(
            BeerPage.objects.filter(kind=BeerPage.Kind.BEER, key__in=[beer["beer_product_key"] for beer in beers])
            .values_list("key", flat=True)
        ),
    }
    cache.set(key, year, _LIVE_SECONDS)
    return year


def _home_structured_data(origin: str, lang: str) -> str:
    """The site name Google shows above the result, and the app the page offers."""

    return ld_json({
        "@graph": [
            organization(origin),
            {
                "@type": "WebSite",
                "@id": f"{origin}{WEBSITE_ID}",
                "url": f"{origin}/",
                "name": "Na pivo",
                "alternateName": ["Na Pivo", "na-pivo.cz"],
                "inLanguage": ["cs", "en"],
                "publisher": organization_ref(origin),
            },
            {
                "@type": "MobileApplication",
                "@id": f"{origin}/#app",
                "name": "Na pivo",
                "url": f"{origin}{HOME_PATHS[lang]}",
                "description": gettext(
                    "Kompas ukáže nejbližší hospodu, na počítadle čárkuješ piva a parta hned ví, kde sedíš. Zdarma a bez reklam."
                ),
                "image": f"{origin}/apple-touch-icon.png",
                "operatingSystem": "iOS, Android",
                "applicationCategory": "LifestyleApplication",
                "inLanguage": ["cs", "en"],
                "installUrl": [APP_STORE_URL, PLAY_STORE_URL],
                "sameAs": [APP_STORE_URL, PLAY_STORE_URL],
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "CZK"},
                "author": AUTHOR,
                "publisher": organization_ref(origin),
            },
        ],
    })


def _grouped(number: int) -> str:
    return formats.number_format(number, 0, force_grouping=True)


_MONTHS = (
    pgettext_lazy("short month", "led"), pgettext_lazy("short month", "úno"), pgettext_lazy("short month", "bře"),
    pgettext_lazy("short month", "dub"), pgettext_lazy("short month", "kvě"), pgettext_lazy("short month", "čvn"),
    pgettext_lazy("short month", "čvc"), pgettext_lazy("short month", "srp"), pgettext_lazy("short month", "zář"),
    pgettext_lazy("short month", "říj"), pgettext_lazy("short month", "lis"), pgettext_lazy("short month", "pro"),
)


@web_page
def home(request: HttpRequest) -> HttpResponse:
    """The home page. ``/`` is always Czech and ``/en`` always English."""

    lang = translation.get_language()
    today = timezone.localdate()
    year = _year_in_beer(today)
    peak = max(year["months"]) or 1
    months = []
    for index, count in enumerate(year["months"]):
        future = index + 1 > today.month
        height = 3 if future else max(count * 100 / peak, 3)
        months.append({
            "label": _MONTHS[index],
            "beers": count,
            "height": f"{height:.1f}%",
            "top": f"{100 - height:.1f}%",
            "current": index + 1 == today.month,
            "future": future,
        })
    top_beers = [
        {
            "name": beer["beer_product_name"],
            "beers": _grouped(beer["beers"]),
            "url": page_path(BeerPage.Kind.BEER, beer["beer_product_key"], lang)
            if beer["beer_product_key"] in year["pages"] else "",
        }
        for beer in year["top_beers"]
    ]
    response = render_page(
        request,
        "web/reskin/home.html",
        {
            "year": {
                "number": today.year,
                "count": year["beers"],
                "beers": _grouped(year["beers"]),
                "summary": " · ".join(part for part in (
                    counted(year["evenings"], gettext("večer"), gettext("večery"), gettext("večerů")) if year["evenings"] else "",
                    _pubs_label(year["pubs"]) if year["pubs"] else "",
                    f"{_grouped(year['spent'])}\u00a0{gettext('Kč')}" if year["spent"] else "",
                ) if part),
            },
            "months": months,
            "top_beers": top_beers,
            "structured_data": _home_structured_data(settings.PUBLIC_WEB_ORIGIN, lang),
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}{HOME_OG_PATH}",
            **_stores("home"),
        },
        title=gettext("Pivní deníček s kompasem na hospodu"),
        description=gettext(
            "Kompas ukáže nejbližší hospodu, na počítadle čárkuješ piva a parta hned ví, kde sedíš. Zdarma a bez reklam."
        ),
        section="home",
    )
    response.headers["Cache-Control"] = "public, max-age=600"
    return response


def _price_map_wait(request: HttpRequest, scope: str = "web_pages") -> int | None:
    """Seconds to wait once this address spent its budget of ``scope``."""
    from rest_framework.request import Request

    from pubs.api.throttling import SharedScopedRateThrottle

    throttle = SharedScopedRateThrottle()
    policy = type("PriceMapPolicy", (), {"throttle_scope": scope})()
    if throttle.allow_request(Request(request), policy):
        return None
    return int(throttle.wait())


def _prices_structured_data(
    origin: str, lang: str, snapshot: PubPriceSnapshot | None, area: dict | None, url: str
) -> str:
    """The path Google shows above the result and, once there are numbers, the dataset."""

    crumbs = [
        ("Na pivo", f"{origin}{HOME_PATHS[lang]}"),
        (gettext("Ceny piva"), f"{origin}{PRICE_PATHS[lang]}"),
    ]
    if area:
        crumbs.append((area["name"], url))
    graph: list[dict] = [breadcrumb_list(crumbs)]
    if snapshot and snapshot.data.get("country"):
        since = snapshot.day - timedelta(days=snapshot.data.get("window_days", 365))
        graph.append({
            "@type": "Dataset",
            "name": (
                gettext("Kolik stojí pivo: %(city)s") % {"city": area["name"]}
                if area
                else gettext("Kolik stojí pivo v hospodě")
            ),
            "description": gettext(
                "Z každé hospody beru nejlevnější pivo od 0,4\u00a0l, které někdo zapsal v Na pivo za poslední rok, a město nebo městskou část ukážu, až mám ceny aspoň z 5 tamních hospod."
            ),
            "url": url,
            "creator": AUTHOR,
            "publisher": organization_ref(origin),
            "dateModified": snapshot.day.isoformat(),
            "temporalCoverage": f"{since.isoformat()}/{snapshot.day.isoformat()}",
            "spatialCoverage": {"@type": "Place", "name": area["name"] if area else gettext("Česko")},
            "isAccessibleForFree": True,
            "license": f"{origin}{DATA_LICENSE_PATH}",
            "inLanguage": lang,
            "variableMeasured": price_variables(),
        })
    return ld_json({"@graph": graph})


def _texts(snapshot: PubPriceSnapshot | None, country: dict | None, area: dict | None) -> dict:
    """Heading, title and description. The year answers "cena piva 2026", the median earns the click."""

    if area:
        values = {"city": place_name(area["name"]), "price": area["median"], "low": area["p25"], "high": area["p75"]}
        where = in_place(area["name"])
        return {
            "h1": pgettext("heading", "Kolik stojí pivo %(in_city)s") % {"in_city": where} if where
            else gettext("Kolik stojí pivo: %(city)s") % values,
            "page_title": gettext("Cena piva %(city)s %(year)s: medián %(price)s Kč")
            % {**values, "year": snapshot.day.year},
            "description": gettext(
                "%(city)s: medián ceny piva v hospodě je %(price)s Kč a polovina hospod má nejlevnější pivo mezi %(low)s a %(high)s Kč. Podívej se, kde ho čepujou nejlevněji."
            ) % values,
        }
    return {
        "h1": gettext("Kolik stojí pivo v hospodě"),
        "page_title": (
            gettext("Cena piva %(year)s po městech: kolik stojí v hospodě") % {"year": snapshot.day.year}
            if snapshot
            else gettext("Kolik stojí pivo v hospodě")
        ),
        "description": (
            gettext(
                "Medián ceny piva v českých hospodách je %(price)s Kč. Najdeš tu ceny po městech i nejlevnější hospody podle toho, co lidi zapsali v Na pivo."
            ) % {"price": country["median"]}
            if country
            else gettext(
                "Medián ceny piva v hospodách po městech a pražských městských částech, z cen, které lidi zapsali v Na pivo."
            )
        ),
    }


def _on_axis(lists: list[list[dict]], country: dict | None) -> tuple[list[list[dict]], dict]:
    """Bars for every list on one price axis in round steps, so one spot is one price.

    The step grows with the spread, so a city with tourist prices still leaves at most six
    gaps between the labels.
    """

    areas = [area for rows in lists for area in rows] + ([country] if country else [])
    if not areas:
        return lists, {}
    lowest = min(area["p25"] for area in areas)
    highest = max(area["p75"] for area in areas)
    steps = (10, 20, 50, 100, 200, 500, 1000)
    step = next((step for step in steps if -(-highest // step) - lowest // step <= 6), steps[-1])
    low = lowest // step * step
    high = max(-(-highest // step) * step, low + 2 * step)

    def at(price: int) -> str:
        return f"{(price - low) * 100 / (high - low):.2f}%"

    def bar(area: dict) -> dict:
        spread = area["p75"] - area["p25"]
        return {
            "lo": at(area["p25"]),
            "hi": at(area["p75"]),
            "mid": at(area["median"]),
            # The bar grows out of its median.
            "origin": f"{(area['median'] - area['p25']) * 100 / spread:.2f}%" if spread else "50%",
        }

    axis = {
        "ticks": [{"price": price, "at": at(price)} for price in range(low, high + 1, step)],
        "step": at(low + step),
        "country": at(country["median"]) if country else None,
    }
    return [[{**area, "bar": bar(area)} for area in rows] for rows in lists], axis


def _short_date(day: date, today: date) -> str:
    """6. 10. in Czech, Oct. 6 in English; the year only when it is not this one."""

    if translation.get_language() == "en":
        return formats.date_format(day, "N j" if day.year == today.year else "N j, Y")
    return f"{day.day}. {day.month}." + ("" if day.year == today.year else f" {day.year}")


def _pubs_label(pubs: int) -> str:
    return counted(pubs, gettext("hospoda"), gettext("hospody"), gettext("hospod"))


def _beers_label(beers: int) -> str:
    return counted(beers, gettext("pivo"), gettext("piva"), gettext("piv"))


def _beer_structured_data(origin: str, lang: str, page: BeerPage | None, url: str, live: dict) -> str:
    """The path Google shows above the result, the beers a list links to, and a beer's prices and ratings."""

    crumbs = [("Na pivo", f"{origin}{HOME_PATHS[lang]}"), (gettext("Piva"), f"{origin}{BEER_PATHS[lang]}")]
    data = page.data if page else {}
    if page and page.kind == BeerPage.Kind.BEER and data["brand_page"]:
        crumbs.append((data["brand_name"], f"{origin}{page_path(BeerPage.Kind.BRAND, data['brand_key'], lang)}"))
    if page and page.kind != BeerPage.Kind.LIST:
        crumbs.append((data["name"], url))
    graph: list[dict] = [breadcrumb_list(crumbs)]
    if page and page.kind != BeerPage.Kind.BEER and data["beers"]:
        graph.append({
            "@type": "ItemList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": position,
                    "name": beer["name"],
                    "url": f"{origin}{page_path(BeerPage.Kind.BEER, beer['key'], lang)}",
                }
                for position, beer in enumerate(data["beers"], start=1)
            ],
        })
    if page and page.kind == BeerPage.Kind.BEER:
        # The fresh half litres the page shows, from the cheapest pub to the dearest.
        prices = [
            pub["price_czk"] for pub in data["listed"]
            if pub["fresh"] and pub["volume_ml"] == 500 and pub["price_czk"] is not None
        ]
        ranking = live.get("ranking")
        rated = bool(ranking and ranking["avg"] is not None and ranking["count"])
        product: dict = {
            "@type": "Product",
            "name": data["name"],
            # The page's own summary: where it is on tap and what it usually costs.
            "description": _beer_texts(page.kind, page, page.key)["description"],
            "brand": {"@type": "Brand", "name": data["brand_name"]},
            "url": url,
        }
        if prices:
            product["offers"] = {
                "@type": "AggregateOffer",
                "priceCurrency": "CZK",
                "lowPrice": min(prices),
                "highPrice": max(prices),
                "offerCount": len(prices),
            }
        if rated:
            product["aggregateRating"] = {
                "@type": "AggregateRating",
                "ratingValue": round(ranking["avg"], 1),
                "ratingCount": ranking["count"],
                "bestRating": 5,
                "worstRating": 1,
            }
            # The page shows the reviews only beside the stars, so they go here only with them.
            reviews = [
                {
                    "@type": "Review",
                    "author": {"@type": "Person", "name": review["nickname"]},
                    "datePublished": review["day"].isoformat(),
                    "reviewBody": review["note"],
                    "reviewRating": {"@type": "Rating", "ratingValue": review["rating"], "bestRating": 5, "worstRating": 1},
                }
                for review in live.get("reviews", []) if review["rating"]
            ]
            if reviews:
                product["review"] = reviews
        if prices or rated:
            graph.append(product)
    return ld_json({"@graph": graph})


def _beer_texts(kind: str, page: BeerPage | None, key: str) -> dict:
    """Heading, title and description. The beer's name first, since that is what people search for.

    A missing page keeps the catalogue's name, so an old link still says which beer it was;
    ``known`` tells a beer under the threshold from an address that never was one.
    """

    data = page.data if page else {}
    if kind == BeerPage.Kind.LIST:
        return {
            "h1": gettext("Kde se čepuje které pivo"),
            "page_title": gettext("Kde se čepuje které pivo"),
            "description": gettext(
                "Najdi hospody, kde čepují tvoje pivo, za kolik a kdy to tam naposledy někdo potvrdil. Podle lístků, které lidi zapisují v Na pivo."
            ),
            "known": True,
        }
    catalogue = BeerProduct if kind == BeerPage.Kind.BEER else BeerBrand
    name = data.get("name") or catalogue.objects.filter(key=key, active=True).values_list("name", flat=True).first()
    if not page:
        unknown = gettext("Tohle pivo neznám") if kind == BeerPage.Kind.BEER else gettext("Tuhle značku neznám")
        return {"h1": name or unknown, "page_title": name or unknown, "description": "", "known": bool(name)}
    values = {"beer": name}
    if kind == BeerPage.Kind.BRAND:
        return {
            "h1": gettext("Kde se čepuje %(beer)s") % values,
            "page_title": gettext("Piva značky %(brand)s a kde se čepují") % {"brand": name},
            "description": gettext(
                "Kde se čepuje %(brand)s: %(pubs)s, %(beers)s s vlastní stránkou. U každé hospody cena a datum posledního potvrzení."
            ) % {"brand": name, "beers": _beers_label(len(data["beers"])), "pubs": _pubs_label(data["pubs"])},
            "known": True,
        }
    values.update(pubs=_pubs_label(data["pubs"]), price=data["median"])
    description = (
        gettext("Kde se čepuje %(beer)s a za kolik: %(pubs)s s čerstvým zápisem, obvykle %(price)s Kč za 0,5 l.")
        if data["median"] is not None
        else gettext("Kde se čepuje %(beer)s a za kolik: %(pubs)s s čerstvým zápisem, u každé cena a datum posledního potvrzení.")
    ) % values
    return {
        "h1": gettext("Kde se čepuje %(beer)s") % values,
        "page_title": gettext("%(beer)s: kde se čepuje a za kolik") % values,
        "description": description,
        "known": True,
    }


def _snapshot_texts(snapshot: PubPriceSnapshot | None, area: dict | None) -> dict:
    """The line under the headline number: how many pubs, over which window, as of when."""

    if snapshot is None:
        return {}
    data = snapshot.data
    stats = area or data.get("country")
    if not stats:
        return {}
    return {
        "basis": with_times(
            gettext("Z nejlevnějších piv v %(pubs)s hospodách za poslední rok. Stav k %(date)s."),
            pubs=stats["pubs"],
            date=time_tag(snapshot.day, formats.date_format(snapshot.day, "DATE_FORMAT")),
        ),
    }


def _price_facts(data: dict, area: dict | None, country: dict | None, city_urls: dict) -> list[dict]:
    """The card beside the headline: the cheapest pub, the middle half and the other big cities."""

    unit = gettext("Kč")
    facts = []
    stats = area or country
    cheapest = (area.get("cheapest") if area else data.get("cheapest")) or []
    if cheapest:
        pub = cheapest[0]
        facts.append({
            "title": gettext("Nejlevněji"),
            "meta": ", ".join(part for part in (pub_name(pub["name"]), place_name(pub["city"])) if part),
            "url": _pub_url(pub),
            "value": f"{pub['price_czk']} {unit}",
            "value_meta": "" if pub["volume_ml"] == 500 else gettext("za %(litres)s l") % {
                "litres": _litres(pub["volume_ml"])
            },
        })
    if stats and stats["p25"] != stats["p75"]:
        facts.append({
            "title": gettext("Polovina hospod"),
            "meta": gettext("mezi čtvrtinou a třemi čtvrtinami"),
            "value": gettext("%(low)s až %(high)s Kč") % {"low": stats["p25"], "high": stats["p75"]},
        })
    if area:
        facts.append({"title": gettext("Celá ČR"), "meta": gettext("medián"), "url": PRICE_PATHS[translation.get_language()],
                      "value": f"{country['median']} {unit}" if country else "–"})
    else:
        for label, city_stats in headline_prices(data)[1:]:
            facts.append({
                "title": place_name(label),
                "meta": gettext("medián"),
                "url": city_urls.get(label, ""),
                "value": f"{city_stats['median']} {unit}" if city_stats else "–",
                "value_meta": "" if city_stats else gettext("zatím málo cen"),
            })
    return facts


def _pub_url(pub: dict) -> str:
    """The pub's own page; older snapshots did not keep the pub's cell, so they link nowhere."""

    from pubs.web.pubs_data import pub_key

    return web_reverse("web-pub", key=pub_key(pub["name"], pub["cache_key"])) if pub.get("cache_key") else ""


def _elsewhere(data: dict, area: dict, city_urls: dict) -> list[dict]:
    """Four other big cities next to this one, and the whole country."""

    tiles = []
    for other in data.get("cities", []):
        if other["name"] == area["name"]:
            continue
        gap = other["median"] - area["median"]
        tiles.append({
            "name": place_name(other["name"]),
            "median": other["median"],
            "url": city_urls[other["name"]],
            "note": (
                gettext("o %(gap)s Kč dráž") % {"gap": gap} if gap > 0
                else gettext("o %(gap)s Kč levněji") % {"gap": -gap} if gap < 0
                else gettext("stejně")
            ),
        })
        if len(tiles) == 4:
            break
    return tiles


@web_page
def beer_prices(request: HttpRequest, city: str = "") -> HttpResponse:
    """Public beer price map, or one city of it, read as is from the newest daily snapshot."""

    lang = translation.get_language()
    wait = _price_map_wait(request)
    snapshot = None if wait else PubPriceSnapshot.objects.defer("og_image_cs", "og_image_en").first()
    data = snapshot.data if snapshot else {}
    area = None
    missing = False
    if city and not wait:
        area = next((area for area in data.get("cities", []) if city_slug(area["name"]) == city), None)
        town = data.get("merged", {}).get(city, "")
        if area is None and any(city_slug(other["name"]) == town for other in data.get("cities", [])):
            query = request.META.get("QUERY_STRING", "")
            return HttpResponsePermanentRedirect(f"{PRICE_PATHS[lang]}/{town}" + (f"?{query}" if query else ""))
        # A city drops out once it has fewer than five priced pubs. Its old links get a 404
        # that still leads to the other cities.
        if area is None:
            missing, snapshot, data = True, None, {}
    origin = settings.PUBLIC_WEB_ORIGIN
    path = f"{PRICE_PATHS[lang]}/{city}" if city else PRICE_PATHS[lang]
    country = data.get("country")
    city_urls = {
        city_area["name"]: f"{PRICE_PATHS[lang]}/{city_slug(city_area['name'])}" for city_area in data.get("cities", [])
    }
    (cities, districts), axis = _on_axis(
        [
            [] if area else [{**city_area, "url": city_urls[city_area["name"]]} for city_area in data.get("cities", [])],
            data.get("prague_districts", []) if not area or area["name"] == "Praha" else [],
        ],
        country,
    )
    from pubs.web.pubs_views import indexed_district_url

    texts = _texts(snapshot, country, area)
    crumbs = [{"label": "Na pivo", "url": web_reverse("home")}, {"label": gettext("Ceny piva"), "url": PRICE_PATHS[lang]}]
    if area:
        crumbs.append({"label": place_name(area["name"])})
    elif city:
        crumbs.append({"label": city})
    else:
        crumbs[-1].pop("url")
    stats = area or country
    response = render_page(
        request,
        "web/reskin/prices.html",
        {
            **texts,
            **_snapshot_texts(snapshot, area),
            "crumbs": crumbs,
            "structured_data": _prices_structured_data(origin, lang, snapshot, area, f"{origin}{path}"),
            "page_url": path,
            "prices_url": PRICE_PATHS[lang],
            "og_image_url": (
                f"{origin}{path}/og.png?v={snapshot.day.isoformat()}" if snapshot and (area or country)
                else f"{origin}{HOME_OG_PATH}"
            ),
            "throttled": wait is not None,
            "day": snapshot.day if snapshot else None,
            "stats": stats,
            "city": city,
            "area": area,
            "country": country,
            "missing": missing,
            "facts": _price_facts(data, area, country, city_urls) if stats else [],
            "cities": [{**row, "name": place_name(row["name"])} for row in cities],
            "districts": [
                {**row, "name": place_name(row["name"]), "url": indexed_district_url(row["name"])} for row in districts
            ],
            "axis": axis,
            "folded_rows": _FOLDED_ROWS,
            "area_name": place_name(area["name"]) if area else "",
            "beer_index_url": web_reverse("web-beer-index"),
            "about_url": web_reverse("web-about") + "#ceny",
            "cheapest": [
                {
                    **pub, "litres": _litres(pub["volume_ml"]), "url": _pub_url(pub), "name": pub_name(pub["name"]),
                    # The list is ordered by this, so it is the number each row shows.
                    "per_half_litre": round(pub["price_czk"] * 500 / pub["volume_ml"]),
                }
                for pub in (area.get("cheapest", []) if area else data.get("cheapest", []))
            ],
            "elsewhere": _elsewhere(data, area, city_urls) if area else [],
            **_stores("city-prices" if city else "prices"),
        },
        title=texts["page_title"] if not missing else gettext("Kolik stojí pivo v hospodě"),
        description=texts["description"],
        section="prices",
        status=429 if wait else 404 if missing else 200,
    )
    response["Referrer-Policy"] = "no-referrer"
    if wait:
        response["Retry-After"] = str(wait)
        response["Cache-Control"] = "no-store"
    else:
        response["Cache-Control"] = "public, max-age=600"
    return response


def _too_many(wait: int) -> HttpResponse:
    response = HttpResponse(status=429)
    response["Retry-After"] = str(wait)
    return response


def beer_prices_og_image(request: HttpRequest, lang: str = "cs", city: str = "") -> HttpResponse:
    """Share image of the newest snapshot: the country one drawn with the snapshot, a city's on first ask."""

    if wait := _price_map_wait(request, "web_og"):
        return _too_many(wait)
    field = f"og_image_{lang}"
    if not city:
        snapshot = PubPriceSnapshot.objects.only("day", field).first()
        if snapshot is None:
            raise Http404
        body = bytes(getattr(snapshot, field))
    else:
        snapshot = PubPriceSnapshot.objects.only("day").first()
        if snapshot is None:
            raise Http404
        key = f"web:price-og:{snapshot.day.isoformat()}:{city}:{lang}"
        body = cache.get(key)
        if body is None:
            data = PubPriceSnapshot.objects.only("data").get(pk=snapshot.pk).data
            area = next((area for area in data.get("cities", []) if city_slug(area["name"]) == city), None)
            if area is None:
                raise Http404
            body = render_city_og_image(area, snapshot.day, lang)
            cache.set(key, body, 86400)
    response = HttpResponse(body, content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def _styles() -> dict[str, str]:
    return {
        "pale": gettext("světlé"),
        "amber": gettext("polotmavé"),
        "dark": gettext("tmavé"),
        "craft": gettext("speciál"),
    }


def _degrees() -> dict[str, str]:
    return {"9": gettext("9° a míň"), "10": "10°", "11": "11°", "12": "12°", "13plus": gettext("13° a víc")}


def _ratings(keys: list[str]) -> dict[str, dict]:
    return {
        key: {"avg": avg, "count": count, "stars": stars, "rank": rank, "styles": styles, "degree": degree}
        for key, avg, count, stars, rank, styles, degree in BeerRanking.objects.filter(product__key__in=keys).values_list(
            "product__key", "rating_avg", "rating_count", "stars", "rank", "styles", "degree"
        )
    }


def _public_reviews(product_key: str) -> tuple[int, list[dict]]:
    """Notes their authors made public, under a nickname, like the reviews on the app's beer page.

    The day only, never the time; nobody in ghost mode, nobody without a nickname.
    """

    rows = (
        BeerCheckIn.objects.filter(
            beer_product__key=product_key,
            visibility=BeerCheckIn.Visibility.PUBLIC,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
            account__nickname__isnull=False,
        )
        .exclude(account__nickname="")
        .exclude(note="")
    )
    latest = rows.select_related("account").order_by("-checked_in_at", "-id")[:3]
    return rows.count(), [
        {
            "nickname": row.account.nickname,
            "pub": pub_name(row.pub_name) if row.pub_name else "",
            "day": timezone.localtime(row.checked_in_at).date(),
            "rating": float(row.rating) if row.rating is not None else None,
            "note": row.note,
        }
        for row in latest
    ]


def _beer_live(page: BeerPage) -> dict:
    """Ratings and reviews beside the daily page, cached so a visit costs a few queries."""

    key = f"web:beer-live:{page.kind}:{page.key}:{page.day.isoformat()}"
    live = cache.get(key)
    if live is not None:
        return live
    data = page.data
    if page.kind == BeerPage.Kind.BEER:
        siblings = []
        if data["brand_page"]:
            brand = BeerPage.objects.filter(kind=BeerPage.Kind.BRAND, key=data["brand_key"]).only("data").first()
            siblings = [beer for beer in (brand.data["beers"] if brand else []) if beer["key"] != page.key][:3]
        ratings = _ratings([page.key, *(beer["key"] for beer in siblings)])
        total, reviews = _public_reviews(page.key)
        live = {"ranking": ratings.get(page.key), "ratings": ratings, "siblings": siblings,
                "review_total": total, "reviews": reviews}
    else:
        keys = [beer["key"] for beer in data["beers"]]
        live = {"ratings": _ratings(keys), "cities": []}
        if page.kind == BeerPage.Kind.BRAND:
            pubs: dict[str, set] = defaultdict(set)
            listed: dict = {}
            for beer in BeerPage.objects.filter(kind=BeerPage.Kind.BEER, key__in=keys).values_list("data", flat=True):
                for pub in beer["listed"]:
                    if pub["fresh"] and pub["city"]:
                        pubs[_city_of(pub["city"])].add((pub["name"], pub["lat"], pub["lng"]))
                    _add_brand_pub(listed, pub, beer["name"])
            live["cities"] = sorted(((city, len(found)) for city, found in pubs.items()), key=lambda item: (-item[1], item[0]))[:6]
            live["pubs"] = sorted(listed.values(), key=lambda pub: (not pub["fresh"], -date.fromisoformat(pub["confirmed"]).toordinal(), pub["name"]))
    cache.set(key, live, _LIVE_SECONDS)
    return live


def _add_brand_pub(listed: dict, pub: dict, beer: str) -> None:
    """One row per pub on a brand page: the brand's beers it pours, its latest confirmation, its cheapest half litre."""

    row = listed.setdefault(pub.get("cache_key") or (pub["name"], pub["lat"], pub["lng"]), {
        "cache_key": pub.get("cache_key"), "name": pub["name"], "city": pub["city"], "lat": pub["lat"], "lng": pub["lng"],
        "confirmed": pub["confirmed"], "fresh": False, "beers": [], "per_half_litre": None,
    })
    row["beers"].append(beer)
    row["confirmed"] = max(row["confirmed"], pub["confirmed"])
    row["fresh"] = row["fresh"] or pub["fresh"]
    if pub["fresh"] and pub["price_czk"]:
        half = round(pub["price_czk"] * 500 / (pub["volume_ml"] or 500))
        row["per_half_litre"] = half if row["per_half_litre"] is None else min(row["per_half_litre"], half)


def _city_of(name: str) -> str:
    """Prague's districts count as Praha in a list of cities."""

    return "Praha" if name.startswith("Praha") else name


def _by_city(listed: list[dict], lang: str) -> list[dict]:
    """Median half litre in each city with at least three fresh priced pubs, the most pubs first.

    Three pubs of a city on a menu put the city in the pub catalogue too, so its pub list exists.
    """

    prices: dict[str, list[int]] = defaultdict(list)
    for pub in listed:
        if pub["fresh"] and pub["volume_ml"] == 500 and pub["price_czk"] and pub["city"]:
            prices[_city_of(pub["city"])].append(pub["price_czk"])
    rows = [
        {"city": place_name(city), "median": f"{round(statistics.median(values))}\u00a0{gettext('Kč')}",
         "pubs": len(values), "pubs_label": _pubs_label(len(values)),
         "url": web_reverse("web-pubs-city", lang, city=city_slug(city))}
        for city, values in prices.items() if len(values) >= 3
    ]
    return sorted(rows, key=lambda row: (-row["pubs"], row["city"]))[:5]


def _rating_view(rating: dict | None) -> dict | None:
    if not rating or rating["avg"] is None:
        return None
    avg = round(rating["avg"], 1)
    shares = star_shares(type("Row", (), {"stars": rating["stars"]})())
    return {
        "avg": formats.number_format(avg, 1),
        "count": rating["count"],
        "stars": [index < round(avg) for index in range(5)],
        "rank": rating["rank"],
        "shares": [{"star": 5 - index, "percent": round(share * 100)} for index, share in enumerate(shares)],
    }


def _about(rating: dict | None) -> list[dict]:
    rows = []
    if rating and rating["styles"]:
        styles = _styles()
        rows.append({"label": gettext("Styl"), "value": ", ".join(styles[style] for style in rating["styles"] if style in styles)})
    if rating and rating["degree"]:
        rows.append({"label": gettext("Stupňovitost"), "value": _degrees().get(rating["degree"], rating["degree"])})
    return [row for row in rows if row["value"]]


@web_page
def beer_pages(request: HttpRequest, kind: str = BeerPage.Kind.LIST, key: str = "") -> HttpResponse:
    """The list of beers, a beer or a brand, read as is from the newest daily run."""

    lang = translation.get_language()
    wait = _price_map_wait(request)
    page = None if wait else BeerPage.objects.filter(kind=kind, key=key).first()
    # A beer drops out once fewer than three pubs confirmed it lately. Its old link gets a 404
    # that still leads to the other beers.
    missing = not wait and page is None and kind != BeerPage.Kind.LIST
    origin = settings.PUBLIC_WEB_ORIGIN
    path = page_path(kind, key, lang)
    campaign = {BeerPage.Kind.LIST: "beers", BeerPage.Kind.BEER: "beer", BeerPage.Kind.BRAND: "beer-brand"}[kind]
    data = page.data if page else {}
    live = _beer_live(page) if page else {}
    ratings = live.get("ratings", {})
    today = page.day if page else timezone.localdate()
    first_old = next((index for index, pub in enumerate(data.get("listed", [])) if not pub["fresh"]), None)
    listed = [
        {
            **pub,
            "name": pub_name(pub["name"]),
            "date": _short_date(date.fromisoformat(pub["confirmed"]), today),
            "litres": _litres(pub["volume_ml"]) if pub["volume_ml"] else None,
            # Sorted per half litre, so 41 Kč for 0,3 l is not the cheapest.
            "per_half_litre": round(pub["price_czk"] * 500 / (pub["volume_ml"] or 500)) if pub["price_czk"] else "",
            "url": _pub_url(pub) or f"https://www.google.com/maps/search/?api=1&query={pub['lat']},{pub['lng']}",
            "on_map": not pub.get("cache_key"),
            "first_old": index == first_old,
        }
        for index, pub in enumerate(data.get("listed", []))
    ]
    brand_pubs = [
        {
            **pub,
            "name": pub_name(pub["name"]),
            "url": _pub_url(pub) or f"https://www.google.com/maps/search/?api=1&query={pub['lat']},{pub['lng']}",
            "on_map": not pub.get("cache_key"),
            "date": _short_date(date.fromisoformat(pub["confirmed"]), today),
            "beer_names": ", ".join(pub["beers"]),
        }
        for pub in live.get("pubs", [])
    ]
    pub_rows = listed if kind == BeerPage.Kind.BEER else brand_pubs
    last_page = max(1, -(-len(pub_rows) // PUBS_PER_PAGE))
    try:
        number = max(int(request.GET.get("page", "1")), 1)
    except ValueError:
        number = 1
    if page and number > last_page:
        return HttpResponsePermanentRedirect(path + (f"?page={last_page}" if last_page > 1 else ""))
    start = (number - 1) * PUBS_PER_PAGE
    shown = pub_rows[start:start + PUBS_PER_PAGE]
    for index, row in enumerate(shown, start=start + 1):
        row["anchor"] = f"h{index}"
    pubs_page = {
        "paged": last_page > 1,
        "count_label": gettext("%(shown)s z %(total)s") % {"shown": _grouped(start + len(shown)), "total": _grouped(len(pub_rows))},
        "more_url": f"{path}?page={number + 1}#h{start + len(shown) + 1}" if number < last_page else "",
    }

    def with_rating(beer: dict) -> dict:
        return {
            **beer,
            "pubs_label": _pubs_label(beer["pubs"]),
            "url": page_path(BeerPage.Kind.BEER, beer["key"], lang),
            "rating": _rating_view(ratings.get(beer["key"])),
        }

    beers = [with_rating(beer) for beer in data.get("beers", []) if kind != BeerPage.Kind.BEER]
    brands = [
        {**brand, "beers_label": _beers_label(brand["beers"]), "url": page_path(BeerPage.Kind.BRAND, brand["key"], lang)}
        for brand in data.get("brands", []) if kind == BeerPage.Kind.LIST
    ]
    texts = _beer_texts(kind, page, key)
    brand_url = (
        page_path(BeerPage.Kind.BRAND, data["brand_key"], lang)
        if kind == BeerPage.Kind.BEER and page and data["brand_page"] else ""
    )
    crumbs = [{"label": "Na pivo", "url": web_reverse("home")}, {"label": gettext("Piva"), "url": BEER_PATHS[lang]}]
    if kind == BeerPage.Kind.LIST:
        crumbs[-1].pop("url")
    else:
        if brand_url:
            crumbs.append({"label": data["brand_name"], "url": brand_url})
        crumbs.append({"label": data.get("name") or texts["h1"]})
    unit = gettext("Kč")
    head_stats = []
    if kind == BeerPage.Kind.BEER and page:
        if data["median"] is not None:
            head_stats.append({
                "value": f"{data['median']}\u00a0{unit}",
                "label": gettext("obvykle za 0,5 l"),
                "sub": gettext("polovina hospod %(low)s–%(high)s Kč") % {"low": data["p25"], "high": data["p75"]}
                if data["p25"] != data["p75"] else "",
            })
        if data["cheapest"]:
            head_stats.append({
                "value": f"{data['cheapest']['price_czk']}\u00a0{unit}",
                "label": gettext("nejlevněji za 0,5 l"),
                "sub": ", ".join(part for part in (pub_name(data["cheapest"]["name"]), place_name(data["cheapest"]["city"])) if part),
            })
        head_stats.append({"value": data["pubs"], "label": plural(
            data["pubs"], gettext("hospoda za 3 měsíce"), gettext("hospody za 3 měsíce"), gettext("hospod za 3 měsíce")
        )})
    elif page:
        head_stats.append({"value": data["pubs"], "label": plural(
            data["pubs"], gettext("hospoda čepuje"), gettext("hospody čepují"), gettext("hospod čepuje")
        )})
        head_stats.append({"value": len(data["beers"]), "label": plural(
            len(data["beers"]), gettext("pivo s vlastní stránkou"), gettext("piva s vlastní stránkou"),
            gettext("piv s vlastní stránkou"),
        )})
    brand_rating = None
    rated = [rating for rating in (ratings.get(beer["key"]) for beer in data.get("beers", [])) if rating and rating["avg"] is not None]
    if kind == BeerPage.Kind.BRAND and rated:
        count = sum(rating["count"] for rating in rated)
        average = sum(rating["avg"] * rating["count"] for rating in rated) / count
        brand_rating = {
            "avg": formats.number_format(round(average, 1), 1),
            "stars": [index < round(average) for index in range(5)],
            "meta": plural(
                len(rated), gettext("průměr %(n)s\u00a0piva z %(count)s hodnocení"),
                gettext("průměr %(n)s\u00a0piv z %(count)s hodnocení"), gettext("průměr %(n)s\u00a0piv z %(count)s hodnocení"),
            ) % {"n": len(rated), "count": count},
        }
        head_stats.append({"value": count, "label": gettext("hodnocení")})
    siblings = []
    for sibling in live.get("siblings", []):
        sibling = with_rating(sibling)
        sibling["value"] = (
            sibling["rating"]["avg"] if sibling["rating"]
            else f"{sibling['median']}\u00a0{unit}" if sibling["median"] is not None else ""
        )
        siblings.append(sibling)
    reviews = [{**review, "day_label": _short_date(review["day"], today)} for review in live.get("reviews", [])]
    response = render_page(
        request,
        "web/reskin/beers.html",
        {
            **texts,
            "kind": kind,
            "beer": data,
            "name": data.get("name") or texts["h1"],
            "listed": shown if kind == BeerPage.Kind.BEER else [],
            "pubs_page": pubs_page,
            "beers": beers,
            "brands": brands,
            "brand_url": brand_url,
            "crumbs": crumbs,
            "rating": _rating_view(live.get("ranking")),
            "about": _about(live.get("ranking")),
            "by_city": _by_city(data.get("listed", []), lang) if kind == BeerPage.Kind.BEER else [],
            "siblings": siblings,
            "reviews": reviews,
            "review_total": live.get("review_total", 0),
            "head_stats": head_stats,
            "brand_rating": brand_rating,
            "brand_pubs": shown if kind == BeerPage.Kind.BRAND else [],
            "brand_cities": [
                {"city": place_name(city), "url": web_reverse("web-pubs-city", lang, city=city_slug(city)), "pubs": pubs, "pubs_label": plural(
                    pubs, gettext("hospoda"), gettext("hospody"), gettext("hospod")
                ), "width": f"{pubs * 100 / live['cities'][0][1]:.1f}%"}
                for city, pubs in live.get("cities", [])
            ],
            "structured_data": _beer_structured_data(origin, lang, page, f"{origin}{path}", live),
            "page_url": path,
            "beers_url": BEER_PATHS[lang],
            "og_image_url": f"{origin}{path}/og.png?v={page.day.isoformat()}" if page else f"{origin}{HOME_OG_PATH}",
            "throttled": wait is not None,
            "missing": missing,
            "day": page.day if page else None,
            "folded_rows": _FOLDED_ROWS,
            **_stores(campaign),
        },
        # Every page of a long pub list is its own in search results, so each says which one it is.
        title=gettext("%(title)s, strana %(page)s") % {"title": texts["page_title"], "page": number} if number > 1
        else texts["page_title"],
        description=(
            (gettext("Strana %(page)s z %(pages)s.") % {"page": number, "pages": last_page} + " " if number > 1 else "")
            + texts["description"]
        ),
        section="beer",
        status=429 if wait else 404 if missing else 200,
        canonical_params={"page": number} if number > 1 else None,
    )
    response["Referrer-Policy"] = "no-referrer"
    if wait:
        response["Retry-After"] = str(wait)
        response["Cache-Control"] = "no-store"
    else:
        response["Cache-Control"] = "public, max-age=600"
    return response


def beer_pages_og_image(
    request: HttpRequest, lang: str = "cs", kind: str = BeerPage.Kind.LIST, key: str = ""
) -> HttpResponse:
    """Share image of one page, drawn on the first ask after each daily run and then kept."""

    if wait := _price_map_wait(request, "web_og"):
        return _too_many(wait)
    page = BeerPage.objects.filter(kind=kind, key=key).first()
    if page is None:
        raise Http404
    cache_key = f"web:beer-og:{kind}:{key}:{lang}:{page.day.isoformat()}"
    body = cache.get(cache_key)
    if body is None:
        ranking = _beer_live(page).get("ranking") if kind == BeerPage.Kind.BEER else None
        body = render_beer_og_image(page, lang, ranking)
        cache.set(cache_key, body, 86400)
    response = HttpResponse(body, content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response



# AI search and the fetchers a person sends to one page read the site like a search engine.
# Amzn-SearchBot answers Alexa; Amazonbot below also collects for Amazon's model training.
AI_SEARCH_CRAWLERS = (
    "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User",
    "YouBot", "Amzn-SearchBot", "Amzn-User",
)
# Crawlers that collect pages to train AI models, fill datasets or feed SEO tools. The prices and menus are ours to keep.
DATA_CRAWLERS = (
    "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider",
    "Amazonbot", "meta-externalagent", "FacebookBot", "cohere-ai", "Diffbot", "Omgilibot", "Timpibot",
    "ImagesiftBot", "DataForSeoBot", "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot",
)


def robots_txt(_request: HttpRequest) -> HttpResponse:
    """Search engines and AI search may read every page; training and data crawlers only llms.txt."""

    lines = [
        "User-agent: *",
        "Disallow: /v1/",
        "Disallow: /admin/",
        "",
        *(f"User-agent: {name}" for name in DATA_CRAWLERS),
        "Allow: /llms.txt",
        "Disallow: /",
        "",
        f"Sitemap: {settings.PUBLIC_WEB_ORIGIN}/sitemap.xml",
    ]
    response = HttpResponse("\n".join(lines) + "\n", content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def llms_txt(_request: HttpRequest) -> HttpResponse:
    """What AI tools may do with the site: answer from a page with a link to it, never copy the data."""

    origin = settings.PUBLIC_WEB_ORIGIN
    allowed, blocked = ", ".join(AI_SEARCH_CRAWLERS), ", ".join(DATA_CRAWLERS)
    text = f"""# Na pivo

> Česká appka a web o hospodách, cenách piva a pivním deníku. Czech app and website about pubs, beer prices and a beer diary. {origin}

## Pravidla pro AI a roboty

- Obsah a data webu Na pivo patří Na pivo: ceny piva, lístky hospod, hodnocení, Pivní index, žebříčky a trasy.
- AI vyhledávače a asistenti můžou stránky číst a odpovídat z nich, když u odpovědi odkážou na zdrojovou stránku na {origin}. Platí to pro {allowed}.
- Používat obsah k trénování nebo ladění modelů je bez písemného souhlasu zakázáno. Stejně tak je zakázané obsah hromadně stahovat a ukládat do databází nebo datasetů.
- Roboti, kteří sbírají data pro trénink AI, datasety nebo SEO nástroje, mají v robots.txt zakázaný celý web kromě tohoto souboru: {blocked}.
- O souhlas si napiš na tomades1@gmail.com.

## Rules for AI and crawlers

- The content and data of Na pivo belong to Na pivo: beer prices, pub menus, ratings, the Beer index, rankings and tours.
- AI search engines and assistants may read the pages and answer from them if the answer links to the source page on {origin}. This covers {allowed}.
- Using the content to train or fine-tune models is prohibited without written permission. So is scraping it in bulk or storing it in databases or datasets.
- Crawlers that collect data for AI training, datasets or SEO tools are disallowed from the whole site in robots.txt, except this file: {blocked}.
- To ask for permission, write to tomades1@gmail.com.
"""
    response = HttpResponse(text, content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "public, max-age=86400"
    return response

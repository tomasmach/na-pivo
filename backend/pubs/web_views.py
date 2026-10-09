"""Small public web surface for shareable app links.

The mobile API lives on api.na-pivo.cz, while na-pivo.cz is reverse-proxied to
the same Django service for invite landings. These views intentionally do not
resolve the invite owner: link previews stay generic and never expose profile
data to unauthenticated crawlers.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.utils import formats, timezone, translation
from django.utils.translation import gettext

from pubs.beer_pages import PATHS as BEER_PATHS
from pubs.beer_pages import counted, page_path
from pubs.beer_pages import render_og_image as render_beer_og_image
from pubs.checks import ANDROID_APP_LINK_FINGERPRINTS_ENV, normalized_cert_fingerprints
from pubs.home_views import (
    _LANDING_URLS,
    _LEGAL_ROOT,
    AUTHOR,
    app_store_url,
    canonical_host,
    ld_json,
    play_store_url,
)
from pubs.home_views import PATHS as HOME_PATHS
from pubs.i18n import current_locale
from pubs.models import BeerBrand, BeerPage, BeerProduct, PubPriceSnapshot
from pubs.price_map import PATHS as PRICE_PATHS
from pubs.price_map import city_slug, headline_prices

# og:locale wants a full territory tag; the app only ever speaks these two.
_OG_LOCALES = {"cs": "cs_CZ", "en": "en_US"}

# Nothing but the inline styles of the page itself: no scripts, fonts, images or frames.
_SELF_CONTAINED_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; "
    "frame-ancestors 'none'; form-action 'none'"
)
# The price page also loads the home page's own icon, fonts and one script, all from na-pivo.cz.
_PRICES_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; "
    "script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)
# Lists longer than this get search and sorting, and start folded to this many rows.
_FOLDED_ROWS = 12

_ASSET_ROOT = Path(__file__).resolve().parent / "static" / "pubs" / "invite"
_ASSETS: dict[str, tuple[str, str]] = {
    "favicon.ico": ("favicon.ico", "image/x-icon"),
    "apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "og-invite.png": ("og-invite.png", "image/png"),
}


def _language_context() -> dict[str, str]:
    """Language bits the landing template needs.

    LocaleMiddleware already resolved the request language, but the i18n context
    processor is intentionally not installed, so the template gets these values
    handed to it explicitly.
    """

    locale = current_locale()
    return {"LANGUAGE_CODE": locale, "og_locale": _OG_LOCALES[locale]}


def invite_landing(request: HttpRequest, code: str) -> HttpResponse:
    """Render a generic, privacy-preserving landing for a Parta invite."""

    encoded_code = quote(code, safe="")
    canonical_url = f"{settings.PUBLIC_WEB_ORIGIN}/p/{encoded_code}"
    response = render(
        request,
        "pubs/invite_landing.html",
        {
            "canonical_url": canonical_url,
            "deep_link": f"napivo://parta/pozvanka?code={encoded_code}",
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}/og/invite.png",
            "page_title": gettext("Přidej se k partě | Na pivo"),
            "description": gettext(
                "Hospoda je lepší s kámoši. Otevři pozvánku v aplikaci Na pivo."
            ),
            "headline": gettext("Kámoš tě zve do party."),
            "body": gettext(
                "Otevři pozvánku v Na pivo a hned budeš vědět, kdy se jde na jedno."
            ),
            **_language_context(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


def party_invite_landing(request: HttpRequest, code: str) -> HttpResponse:
    """Render a privacy-preserving landing for a shared table invite."""

    encoded_code = quote(code, safe="")
    canonical_url = f"{settings.PUBLIC_WEB_ORIGIN}/party/{encoded_code}"
    response = render(
        request,
        "pubs/invite_landing.html",
        {
            "canonical_url": canonical_url,
            "deep_link": f"napivo://party-live?code={encoded_code}",
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}/og/invite.png",
            "page_title": gettext("Přisedni ke stolu | Na pivo"),
            "description": gettext(
                "Kámoši tě zvou ke stolu. Otevři pozvánku v aplikaci Na pivo."
            ),
            "headline": gettext("U stolu je místo."),
            "body": gettext("Otevři Na pivo, potvrď kód a přisedni ke kámošům."),
            **_language_context(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


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


def invite_asset(_request: HttpRequest, filename: str) -> FileResponse:
    """Serve the tiny public invite asset set without relying on Caddy paths."""

    asset = _ASSETS.get(filename)
    if asset is None:
        raise Http404
    disk_name, content_type = asset
    path = _ASSET_ROOT / disk_name
    if not path.is_file():
        raise Http404
    response = FileResponse(path.open("rb"), content_type=content_type)
    response.headers["Cache-Control"] = "public, max-age=604800, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def tour_invite_landing(request: HttpRequest, token: str) -> HttpResponse:
    """Read-only itinerary, with no trackers, external fonts, map SDK or redirect."""
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
    if not share and not publication:
        return protect_response(render(request, "pubs/tour_landing.html", {
            "unavailable": True, **_language_context(),
        }, status=404))
    public = public_payload(publication) if publication else None
    tour = public["tour"] if public else tour_snapshot(share.plan)
    first = tour["stops"][0]
    response = render(request, "pubs/tour_landing.html", {
        "tour": tour,
        "author": public["public"]["author"] if public else None,
        "meeting_date": share.plan.scheduled_date if share else None,
        "deep_link": f"napivo://t/{quote(token, safe='')}",
        "navigation_url": f"https://www.google.com/maps/dir/?api=1&destination={first['lat']},{first['lon']}&travelmode=walking",
        **_language_context(),
    })
    response["Content-Security-Policy"] = _SELF_CONTAINED_CSP
    return protect_response(response)


def _price_map_wait(request: HttpRequest) -> int | None:
    """Seconds to wait once this address spent its shared price-page budget."""
    from rest_framework.request import Request

    from pubs.api.throttling import SharedScopedRateThrottle

    throttle = SharedScopedRateThrottle()
    policy = type("PriceMapPolicy", (), {"throttle_scope": "price_map"})()
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
    graph: list[dict] = [{
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": position, "name": name, "item": item}
            for position, (name, item) in enumerate(crumbs, start=1)
        ],
    }]
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
            "dateModified": snapshot.day.isoformat(),
            "temporalCoverage": f"{since.isoformat()}/{snapshot.day.isoformat()}",
            "spatialCoverage": {"@type": "Place", "name": area["name"] if area else gettext("Česko")},
            "isAccessibleForFree": True,
            "inLanguage": lang,
        })
    return ld_json({"@graph": graph})


def _texts(snapshot: PubPriceSnapshot | None, country: dict | None, area: dict | None) -> dict:
    """Heading, title and description. The year answers "cena piva 2026", the median earns the click."""

    if area:
        values = {"city": area["name"], "price": area["median"], "low": area["p25"], "high": area["p75"]}
        return {
            "h1": gettext("Kolik stojí pivo: %(city)s") % values,
            "page_title": gettext("Cena piva %(city)s %(year)s: medián %(price)s Kč")
            % {**values, "year": snapshot.day.year},
            "description": gettext(
                "%(city)s: medián ceny piva v hospodě je %(price)s Kč a polovina hospod má nejlevnější pivo mezi %(low)s a %(high)s Kč. Podívej se, kde ho čepujou nejlevněji."
            ) % values,
        }
    return {
        "h1": gettext("Kolik stojí pivo v hospodě"),
        "page_title": (
            gettext("Cena piva %(year)s: kolik stojí pivo v hospodě") % {"year": snapshot.day.year}
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


@canonical_host
def beer_prices(request: HttpRequest, lang: str = "cs", city: str = "") -> HttpResponse:
    """Public beer price map, or one city of it, read as is from the newest daily snapshot."""

    wait = _price_map_wait(request)
    snapshot = (
        None
        if wait
        else PubPriceSnapshot.objects.defer("og_image_cs", "og_image_en").first()
    )
    data = snapshot.data if snapshot else {}
    area = None
    missing = False
    if city and not wait:
        area = next((area for area in data.get("cities", []) if city_slug(area["name"]) == city), None)
        # A city drops out once it has fewer than five priced pubs. Its old links get a 404
        # that still leads to the other cities.
        if area is None:
            missing, snapshot, data = True, None, {}
    paths = {code: f"{path}/{city}" if city else path for code, path in PRICE_PATHS.items()}
    origin = settings.PUBLIC_WEB_ORIGIN
    with translation.override(lang):
        country = data.get("country")
        city_urls = {
            city_area["name"]: f"{PRICE_PATHS[lang]}/{city_slug(city_area['name'])}"
            for city_area in data.get("cities", [])
        }
        if area:
            headline = [(area["name"], area, None), (gettext("Celá ČR"), country, PRICE_PATHS[lang])]
            cheapest = area.get("cheapest", [])
        else:
            headline = [(label, stats, city_urls.get(label)) for label, stats in headline_prices(data)]
            cheapest = data.get("cheapest", [])
        (cities, districts), axis = _on_axis(
            [
                [] if area else [
                    {**city_area, "url": city_urls[city_area["name"]]} for city_area in data.get("cities", [])
                ],
                data.get("prague_districts", []) if not area or area["name"] == "Praha" else [],
            ],
            country,
        )
        response = render(
            request,
            "pubs/beer_prices.html",
            {
                "LANGUAGE_CODE": lang,
                **_texts(snapshot, country, area),
                "structured_data": _prices_structured_data(origin, lang, snapshot, area, f"{origin}{paths[lang]}"),
                "og_locale": _OG_LOCALES[lang],
                "page_url": paths[lang],
                "canonical_url": f"{origin}{paths[lang]}",
                "cs_url": f"{origin}{paths['cs']}",
                "en_url": f"{origin}{paths['en']}",
                "switch_url": paths["en" if lang == "cs" else "cs"],
                "home_url": "/" if lang == "cs" else "/en",
                "prices_url": PRICE_PATHS[lang],
                "beers_url": BEER_PATHS[lang],
                "og_image_url": (
                    f"{origin}{PRICE_PATHS[lang]}/og.png?v={snapshot.day.isoformat()}"
                    if snapshot
                    else f"{origin}{_LANDING_URLS['og_home_png']}"
                ),
                "throttled": wait is not None,
                "day": snapshot.day if snapshot else None,
                "country": country,
                "area": area,
                "missing": missing,
                "headline": headline,
                "cities": cities,
                "districts": districts,
                "axis": axis,
                "folded_rows": _FOLDED_ROWS,
                "cheapest": [{**pub, "litres": pub["volume_ml"] / 1000} for pub in cheapest],
                "asset": _LANDING_URLS,
                "app_store_url": app_store_url("city-prices" if city else "prices"),
                "play_store_url": play_store_url("city-prices" if city else "prices"),
                "privacy_url": f"{_LEGAL_ROOT}{'' if lang == 'cs' else '/en'}/privacy.html",
            },
            status=429 if wait else 404 if missing else 200,
        )
    response["Content-Language"] = lang
    response["Content-Security-Policy"] = _PRICES_CSP
    response["Referrer-Policy"] = "no-referrer"
    if wait:
        response["Retry-After"] = str(wait)
        response["Cache-Control"] = "no-store"
    else:
        response["Cache-Control"] = "public, max-age=600"
    return response


def beer_prices_og_image(request: HttpRequest, lang: str = "cs") -> HttpResponse:
    """Share image of the newest snapshot, rendered when the snapshot was computed."""

    wait = _price_map_wait(request)
    if wait:
        response = HttpResponse(status=429)
        response["Retry-After"] = str(wait)
        return response
    field = f"og_image_{lang}"
    snapshot = PubPriceSnapshot.objects.only("day", field).first()
    if snapshot is None:
        raise Http404
    response = HttpResponse(bytes(getattr(snapshot, field)), content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def _short_date(day: date, today: date) -> str:
    """6. 10. in Czech, Oct 6 in English; the year only when it is not this one."""

    if translation.get_language() == "en":
        return formats.date_format(day, "M j" if day.year == today.year else "M j, Y")
    return f"{day.day}. {day.month}." + ("" if day.year == today.year else f" {day.year}")


def _pubs_label(pubs: int) -> str:
    return counted(pubs, gettext("hospoda"), gettext("hospody"), gettext("hospod"))


def _beers_label(beers: int) -> str:
    return counted(beers, gettext("pivo"), gettext("piva"), gettext("piv"))


def _beer_structured_data(origin: str, lang: str, page: BeerPage | None, url: str) -> str:
    """The path Google shows above the result, the beers a list links to and a beer's price range."""

    crumbs = [("Na pivo", f"{origin}{HOME_PATHS[lang]}"), (gettext("Piva"), f"{origin}{BEER_PATHS[lang]}")]
    data = page.data if page else {}
    if page and page.kind == BeerPage.Kind.BEER:
        crumbs.append((data["brand_name"], f"{origin}{page_path(BeerPage.Kind.BRAND, data['brand_key'], lang)}"))
    if page and page.kind != BeerPage.Kind.LIST:
        crumbs.append((data["name"], url))
    graph: list[dict] = [{
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": position, "name": name, "item": item}
            for position, (name, item) in enumerate(crumbs, start=1)
        ],
    }]
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
        if prices:
            graph.append({
                "@type": "Product",
                "name": data["name"],
                "brand": {"@type": "Brand", "name": data["brand_name"]},
                "url": url,
                "offers": {
                    "@type": "AggregateOffer",
                    "priceCurrency": "CZK",
                    "lowPrice": min(prices),
                    "highPrice": max(prices),
                    "offerCount": len(prices),
                },
            })
    return ld_json({"@graph": graph})


def _beer_texts(kind: str, page: BeerPage | None, key: str) -> dict:
    """Heading, title and description. The beer's name first, since that is what people search for."""

    data = page.data if page else {}
    if kind == BeerPage.Kind.BEER:
        name = data.get("name") or BeerProduct.objects.filter(key=key, active=True).values_list("name", flat=True).first()
        if not page:
            return {"h1": name or gettext("Tohle pivo tu nemám"), "page_title": name or gettext("Pivo nenalezeno"), "description": ""}
        values = {"beer": name, "pubs": _pubs_label(data["pubs"]), "price": data["median"]}
        description = (
            gettext("Kde se čepuje %(beer)s a za kolik: %(pubs)s s čerstvým zápisem, obvykle %(price)s Kč za 0,5 l.")
            if data["median"] is not None
            else gettext("Kde se čepuje %(beer)s a za kolik: %(pubs)s s čerstvým zápisem, u každé cena a datum posledního potvrzení.")
        ) % values
        return {
            "h1": gettext("Kde se čepuje %(beer)s") % values,
            "page_title": gettext("%(beer)s: kde se čepuje a za kolik") % values,
            "description": description,
        }
    if kind == BeerPage.Kind.BRAND:
        name = data.get("name") or BeerBrand.objects.filter(key=key, active=True).values_list("name", flat=True).first()
        if not page:
            return {"h1": name or gettext("Tuhle značku tu nemám"), "page_title": name or gettext("Značka nenalezena"), "description": ""}
        values = {"brand": name}
        return {
            "h1": name,
            "page_title": gettext("Piva značky %(brand)s a kde se čepují") % values,
            "description": gettext(
                "Piva značky %(brand)s a hospody, kde se čepují. U každé hospody cena a datum posledního potvrzení."
            ) % values,
        }
    return {
        "h1": gettext("Kde se čepuje které pivo"),
        "page_title": gettext("Kde se čepuje které pivo"),
        "description": gettext("Najdi hospody, kde čepují tvoje pivo, za kolik a kdy to tam naposledy někdo potvrdil. Podle lístků, které lidi zapisují v Na pivo."),
    }


@canonical_host
def beer_pages(request: HttpRequest, lang: str = "cs", kind: str = BeerPage.Kind.LIST, key: str = "") -> HttpResponse:
    """The list of beers, a beer or a brand, read as is from the newest daily run."""

    wait = _price_map_wait(request)
    page = None if wait else BeerPage.objects.filter(kind=kind, key=key).first()
    # A beer drops out once fewer than three pubs confirmed it lately. Its old link gets a 404
    # that still leads to the other beers.
    missing = not wait and page is None and kind != BeerPage.Kind.LIST
    origin = settings.PUBLIC_WEB_ORIGIN
    paths = {code: page_path(kind, key, code) for code in BEER_PATHS}
    campaign = {BeerPage.Kind.LIST: "beers", BeerPage.Kind.BEER: "beer", BeerPage.Kind.BRAND: "beer-brand"}[kind]
    with translation.override(lang):
        data = page.data if page else {}
        today = page.day if page else timezone.localdate()
        listed = [
            {
                **pub,
                "date": _short_date(date.fromisoformat(pub["confirmed"]), today),
                "litres": pub["volume_ml"] / 1000 if pub["volume_ml"] else None,
                # Sorted per half litre, so 41 Kč for 0,3 l is not the cheapest.
                "per_half_litre": round(pub["price_czk"] * 500 / (pub["volume_ml"] or 500)) if pub["price_czk"] else "",
            }
            for pub in data.get("listed", [])
        ]
        beers = [
            {**beer, "pubs_label": _pubs_label(beer["pubs"]), "url": page_path(BeerPage.Kind.BEER, beer["key"], lang)}
            for beer in data.get("beers", []) if kind != BeerPage.Kind.BEER
        ]
        brands = [
            {**brand, "beers_label": _beers_label(brand["beers"]), "url": page_path(BeerPage.Kind.BRAND, brand["key"], lang)}
            for brand in data.get("brands", []) if kind == BeerPage.Kind.LIST
        ]
        response = render(
            request,
            "pubs/beers.html",
            {
                "LANGUAGE_CODE": lang,
                **_beer_texts(kind, page, key),
                "kind": kind,
                "page": data,
                "listed": listed,
                "beers": beers,
                "brands": brands,
                "pubs_label": _pubs_label(data["pubs"]) if "pubs" in data else "",
                "beers_label": _beers_label(len(data["beers"])) if kind != BeerPage.Kind.BEER and page else "",
                "brand_url": page_path(BeerPage.Kind.BRAND, data["brand_key"], lang) if kind == BeerPage.Kind.BEER and page else "",
                "structured_data": _beer_structured_data(origin, lang, page, f"{origin}{paths[lang]}"),
                "og_locale": _OG_LOCALES[lang],
                "page_url": paths[lang],
                "canonical_url": f"{origin}{paths[lang]}",
                "cs_url": f"{origin}{paths['cs']}",
                "en_url": f"{origin}{paths['en']}",
                "switch_url": paths["en" if lang == "cs" else "cs"],
                "home_url": HOME_PATHS[lang],
                "beers_url": BEER_PATHS[lang],
                "prices_url": PRICE_PATHS[lang],
                "og_image_url": (
                    f"{origin}{paths[lang]}/og.png?v={page.day.isoformat()}"
                    if page
                    else f"{origin}{_LANDING_URLS['og_home_png']}"
                ),
                "throttled": wait is not None,
                "missing": missing,
                "day": page.day if page else None,
                "folded_rows": _FOLDED_ROWS,
                "asset": _LANDING_URLS,
                "app_store_url": app_store_url(campaign),
                "play_store_url": play_store_url(campaign),
                "privacy_url": f"{_LEGAL_ROOT}{'' if lang == 'cs' else '/en'}/privacy.html",
            },
            status=429 if wait else 404 if missing else 200,
        )
    response["Content-Language"] = lang
    response["Content-Security-Policy"] = _PRICES_CSP
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
    """Share image of one page, drawn from the newest daily run."""

    wait = _price_map_wait(request)
    if wait:
        response = HttpResponse(status=429)
        response["Retry-After"] = str(wait)
        return response
    page = BeerPage.objects.filter(kind=kind, key=key).first()
    if page is None:
        raise Http404
    response = HttpResponse(render_beer_og_image(page, lang), content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def robots_txt(_request: HttpRequest) -> HttpResponse:
    """Crawlers may read every page; the API only answers the app."""

    lines = [
        "User-agent: *",
        "Disallow: /v1/",
        "Disallow: /admin/",
        "",
        f"Sitemap: {settings.PUBLIC_WEB_ORIGIN}/sitemap.xml",
    ]
    response = HttpResponse("\n".join(lines) + "\n", content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "public, max-age=86400"
    return response


def sitemap_xml(request: HttpRequest) -> HttpResponse:
    """Every page worth finding, each with its other language."""

    origin = settings.PUBLIC_WEB_ORIGIN
    snapshot = PubPriceSnapshot.objects.only("day", "data").first()
    day = snapshot.day if snapshot else None
    pages = [
        {"urls": {lang: f"{origin}{path}" for lang, path in HOME_PATHS.items()}},
        {"urls": {lang: f"{origin}{path}" for lang, path in PRICE_PATHS.items()}, "lastmod": day},
    ]
    for area in snapshot.data.get("cities", []) if snapshot else []:
        slug = city_slug(area["name"])
        pages.append({"urls": {lang: f"{origin}{path}/{slug}" for lang, path in PRICE_PATHS.items()}, "lastmod": day})
    for kind, key, beer_day in BeerPage.objects.order_by("kind", "key").values_list("kind", "key", "day"):
        pages.append({"urls": {lang: f"{origin}{page_path(kind, key, lang)}" for lang in BEER_PATHS}, "lastmod": beer_day})
    response = render(
        request, "pubs/sitemap.xml", {"pages": pages}, content_type="application/xml; charset=utf-8"
    )
    response["Cache-Control"] = "public, max-age=3600"
    return response

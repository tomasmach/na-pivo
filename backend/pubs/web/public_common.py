"""What the rankings, news, beer index and tours pages share."""

from __future__ import annotations

import hashlib
import json
from io import BytesIO

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.utils import translation
from django.utils.text import slugify
from django.utils.translation import gettext
from PIL import Image, ImageDraw

from pubs.home_views import HOME_OG_PATH, breadcrumb_list, ld_json
from pubs.price_map import _FOAM, _FOAM_MUTED, _GROUND, _HAIR, _MUTED, _fitted, _font
from pubs.regions import REGION_CODES
from pubs.web.pages import render_page
from pubs.web.routes import web_reverse

# Aggregates for anonymous pages live this long in each worker's cache.
PAGE_CACHE_SECONDS = 600


def throttle_wait(request: HttpRequest, scope: str) -> int | None:
    """Seconds to wait once this address spent the shared budget of ``scope``."""
    from rest_framework.request import Request

    from pubs.api.throttling import SharedScopedRateThrottle

    throttle = SharedScopedRateThrottle()
    policy = type("PublicPagePolicy", (), {"throttle_scope": scope})()
    if throttle.allow_request(Request(request), policy):
        return None
    return int(throttle.wait())


def too_many(request: HttpRequest, wait: int, section: str) -> HttpResponse:
    response = render_page(
        request,
        "web/public/throttled.html",
        title=gettext("Zkus to prosím za chvíli"),
        section=section,
        status=429,
    )
    response["Retry-After"] = str(wait)
    response["Cache-Control"] = "no-store"
    return response


def public_cache(response: HttpResponse, seconds: int = 600) -> HttpResponse:
    # A signed-in page already got private, no-store from @web_page.
    response.headers.setdefault("Cache-Control", f"public, max-age={seconds}")
    return response


def pub_url(name: str, cache_key: str) -> str:
    return web_reverse("web-pub", key=f"{slugify(name) or 'hospoda'}-{cache_key}")


def region_names() -> dict[str, tuple[str, str]]:
    """Short and full name of each kraj, in the language being rendered."""

    names = {
        "CZ010": (gettext("Praha"), gettext("Praha")),
        "CZ020": (gettext("Středočeský"), gettext("Středočeský kraj")),
        "CZ031": (gettext("Jihočeský"), gettext("Jihočeský kraj")),
        "CZ032": (gettext("Plzeňský"), gettext("Plzeňský kraj")),
        "CZ041": (gettext("Karlovarský"), gettext("Karlovarský kraj")),
        "CZ042": (gettext("Ústecký"), gettext("Ústecký kraj")),
        "CZ051": (gettext("Liberecký"), gettext("Liberecký kraj")),
        "CZ052": (gettext("Královéhradecký"), gettext("Královéhradecký kraj")),
        "CZ053": (gettext("Pardubický"), gettext("Pardubický kraj")),
        "CZ063": (gettext("Vysočina"), gettext("Kraj Vysočina")),
        "CZ064": (gettext("Jihomoravský"), gettext("Jihomoravský kraj")),
        "CZ071": (gettext("Olomoucký"), gettext("Olomoucký kraj")),
        "CZ072": (gettext("Zlínský"), gettext("Zlínský kraj")),
        "CZ080": (gettext("Moravskoslezský"), gettext("Moravskoslezský kraj")),
    }
    return {code: names[code] for code in REGION_CODES}


def region_slug(code: str) -> str:
    """The kraj in an address: /zebricky/jihomoravsky or ?kraj=jihomoravsky, the same in both languages."""

    return {"CZ063": "vysocina"}.get(code) or slugify(_CZECH_SHORT[code])


_CZECH_SHORT = {
    "CZ010": "Praha", "CZ020": "Středočeský", "CZ031": "Jihočeský", "CZ032": "Plzeňský",
    "CZ041": "Karlovarský", "CZ042": "Ústecký", "CZ051": "Liberecký", "CZ052": "Královéhradecký",
    "CZ053": "Pardubický", "CZ063": "Vysočina", "CZ064": "Jihomoravský", "CZ071": "Olomoucký",
    "CZ072": "Zlínský", "CZ080": "Moravskoslezský",
}
REGION_BY_SLUG = {region_slug(code): code for code in REGION_CODES}


def money(value: float | int | None) -> str:
    return "" if value is None else f"{round(value)} {gettext('Kč')}"


def decimal(value: float, digits: int = 1) -> str:
    text = f"{value:.{digits}f}"
    return text if translation.get_language() == "en" else text.replace(".", ",")


def thousands(value: int) -> str:
    text = f"{value:,}"
    return text if translation.get_language() == "en" else text.replace(",", "\u00a0")


def breadcrumbs(items: list[tuple[str, str]]) -> tuple[list[dict], str]:
    """Breadcrumbs for the page and the same path as structured data."""

    origin = settings.PUBLIC_WEB_ORIGIN
    crumbs = [{"label": label, "url": url} for label, url in items]
    return crumbs, breadcrumb_list([(label, f"{origin}{url}") for label, url in items])


def structured(*graph: dict):
    return ld_json({"@graph": list(graph)})


def home_og_image() -> str:
    return f"{settings.PUBLIC_WEB_ORIGIN}{HOME_OG_PATH}"


def og_version(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:10]


def og_png(request: HttpRequest, payload: dict | None) -> HttpResponse:
    """A page's share card drawn by ``og_image``, cached a day; the general picture while there is nothing to draw."""

    wait = throttle_wait(request, "web_og")
    if wait:
        response = HttpResponse(status=429)
        response["Retry-After"] = str(wait)
        return response
    if payload is None:
        return HttpResponseRedirect(HOME_OG_PATH)
    image = cache.get_or_set(f"web:og:{og_version(payload)}", lambda: og_image(**payload), 24 * 60 * 60)
    response = HttpResponse(image, content_type="image/png")
    response["Cache-Control"] = "public, max-age=86400"
    return response


# Share images reuse the fonts and colours of the /ceny and /pivo images.
_YELLOW = (255, 196, 0)


def og_image(*, kicker: str, title: str, hero: str, hero_label: str, figures: list[tuple[str, str]], address: str) -> bytes:
    """A 1200 × 630 card: name, address, kicker, big title, yellow number and up to four figures."""

    image = Image.new("RGB", (1200, 630), _GROUND)
    draw = ImageDraw.Draw(image)
    draw.text((64, 92), "Na pivo", font=_font("ExtraBold", 40), fill=_FOAM, anchor="ls")
    draw.text((1136, 88), address, font=_fitted(draw, address, "SemiBold", 26, 640), fill=_MUTED, anchor="rs")

    hero_font = _font("ExtraBold", 150)
    hero_width = draw.textlength(hero, font=hero_font) if hero else 0
    title_width = int(1072 - (hero_width + 48 if hero else 0))
    draw.text((64, 254), kicker, font=_fitted(draw, kicker, "SemiBold", 30, title_width), fill=_FOAM_MUTED, anchor="ls")
    draw.text((64, 352), title, font=_fitted(draw, title, "ExtraBold", 88, title_width), fill=_FOAM, anchor="ls")
    if hero:
        draw.text((1136, 330), hero, font=hero_font, fill=_YELLOW, anchor="rs")
        draw.text((1136, 376), hero_label, font=_font("SemiBold", 26), fill=_FOAM_MUTED, anchor="rs")

    draw.line((64, 470, 1136, 470), fill=_HAIR, width=2)
    x = 64.0
    value_font = _font("ExtraBold", 46)
    label_font = _font("SemiBold", 22)
    for value, label in figures[:4]:
        draw.text((x, 534), value, font=value_font, fill=_FOAM, anchor="ls")
        draw.text((x, 574), label, font=label_font, fill=_MUTED, anchor="ls")
        x += max(draw.textlength(value, font=value_font), draw.textlength(label, font=label_font)) + 56

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()

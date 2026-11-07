"""What every web page shares: language, headers and the base template context.

A page view is decorated with ``@web_page`` and returns ``render_page(...)``::

    @web_page
    def pubs_in_city(request, city):
        return render_page(request, "web/pubs_city.html", {"city": city}, title=...)

The decorator takes the ``lang`` the URL passed (see ``routes.bilingual``) and
renders the page inside it, so views and templates only call ``gettext`` and
``{% web_url %}``.
"""

from __future__ import annotations

from functools import wraps
from urllib.parse import quote, urlencode, urlsplit

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.shortcuts import render
from django.template.response import SimpleTemplateResponse
from django.utils import translation
from django.utils.cache import get_conditional_response, set_response_etag
from django.utils.translation import gettext
from django.views.defaults import page_not_found
from django.views.defaults import server_error as django_server_error

from pubs.home_views import app_store_url, canonical_host, play_store_url
from pubs.pivar import pivar_progress
from pubs.web.routes import base_name, web_reverse
from pubs.web.session import session_token

LANGS = ("cs", "en")
_LEGAL_ROOT = "https://tomasmach.github.io/na-pivo"
_OG_LOCALES = {"cs": "cs_CZ", "en": "en_US"}


# Style, tiles, glyphs and sprites of the street map; see web/components/map.html.
MAP_TILES = "https://tiles.openfreemap.org"


def _csp(with_map: bool = False) -> str:
    # Uploaded avatars are served from the API origin.
    api = urlsplit(settings.PUBLIC_API_ORIGIN)
    images = f"'self' data: {api.scheme}://{api.netloc}" if api.netloc else "'self' data:"
    connect = f"'self' {MAP_TILES}" if with_map else "'self'"
    return (
        "default-src 'none'; style-src 'self'; font-src 'self'; "
        f"img-src {images}; script-src 'self'; connect-src {connect}; "
        "manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    )


def web_page(view):
    """Render the view in the language of its URL and add the shared headers."""

    @wraps(view)
    def wrapper(request: HttpRequest, *args, lang: str = "cs", **kwargs) -> HttpResponse:
        request.web_lang = lang
        request.web_token = session_token(request)
        request.web_account = request.web_token.account if request.web_token else None
        with translation.override(lang):
            response = view(request, *args, **kwargs)
            if isinstance(response, SimpleTemplateResponse):
                response.render()
        response.headers["Content-Language"] = lang
        response.headers.setdefault("Content-Security-Policy", _csp())
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        if request.web_account is not None:
            # The header shows who is signed in, so no shared cache may keep the page.
            response.headers["Cache-Control"] = "private, no-store"
        return _conditional(request, response)

    return canonical_host(wrapper)


def _conditional(request: HttpRequest, response: HttpResponse) -> HttpResponse:
    """A 304 for a crawler that already has this exact public page.

    No Last-Modified: most pages show the clock ("open until 22:00"), so only the body says whether it changed.
    """

    cache_control = response.headers.get("Cache-Control", "")
    if (
        request.method not in ("GET", "HEAD")
        or response.status_code != 200
        or response.streaming
        or "private" in cache_control
        or "no-store" in cache_control
    ):
        return response
    set_response_etag(response)
    return get_conditional_response(request, etag=response.headers["ETag"], response=response)


def login_url(request: HttpRequest) -> str:
    return f"{web_reverse('web-login')}?next={quote(request.get_full_path(), safe='/?=&')}"


def signed_in_page(view):
    """``@web_page`` for pages behind sign-in.

    Without a session the browser goes to the login page with ``next`` set to
    this page. The view reads ``request.web_account`` (the Account) and
    ``request.web_token`` (its AuthToken, e.g. for ``deletion_epoch``).
    """

    @wraps(view)
    def wrapper(request: HttpRequest, *args, **kwargs) -> HttpResponse:
        if request.web_account is None:
            return HttpResponseRedirect(login_url(request))
        return view(request, *args, **kwargs)

    return web_page(wrapper)


def _account_card(account) -> dict | None:
    """What the header, panel and profile card show about the signed-in account."""

    if account is None:
        return None
    name = account.nickname or account.display_name or ""
    usage = getattr(account, "usage_stats", None)
    # One account level like the app: Mapér and Pivař XP together.
    progress = pivar_progress(int(getattr(usage, "pivar_xp", 0) or 0) + int(getattr(usage, "mapper_xp", 0) or 0))
    avatar_url = None
    if account.avatar:
        try:
            avatar_url = f"{settings.PUBLIC_API_ORIGIN}{account.avatar.url}"
        except ValueError:
            avatar_url = None
    return {
        "name": name or gettext("Pivař"),
        "handle": f"@{account.nickname}" if account.nickname else (name or gettext("Pivař")),
        "avatar_url": avatar_url,
        "level_label": gettext("Level %(level)s · %(title)s") % {"level": progress["level"], "title": progress["title"]},
    }


_FOOTER_SECONDS = 3600


def _footer_data() -> dict:
    """Cities with prices and the most poured beers, so every footer link has a page behind it."""

    data = cache.get("web:footer:2")
    if data is None:
        from pubs.models import BeerPage, PubPriceSnapshot
        from pubs.tours import readable_publications

        snapshot = PubPriceSnapshot.objects.defer("og_image_cs", "og_image_en").first()
        cities = sorted((snapshot.data if snapshot else {}).get("cities", []), key=lambda area: -area["pubs"])
        listing = BeerPage.objects.filter(kind=BeerPage.Kind.LIST, key="").only("data").first()
        data = {
            "cities": [area["name"] for area in cities[:4]],
            "beers": [{"key": beer["key"], "name": beer["name"]} for beer in (listing.data if listing else {}).get("beers", [])[:3]],
            # The menu leads to the tours once one is public, by the same rule the sitemap lists them.
            "tours": readable_publications().exists(),
        }
        cache.set("web:footer:2", data, _FOOTER_SECONDS)
    return data


def _footer(lang: str) -> dict:
    from pubs.beer_pages import page_path
    from pubs.models import BeerPage
    from pubs.price_map import city_slug
    from pubs.web.pubs_views import _city_in

    data = _footer_data()
    return {
        "pubs": [
            {"label": gettext("Hospody %(where)s") % {"where": _city_in(name)}, "url": web_reverse("web-pubs-city", city=city_slug(name))}
            for name in data["cities"]
        ],
        "prices": [
            {"label": gettext("Kolik stojí pivo %(where)s") % {"where": _city_in(name)}, "url": web_reverse("beer-prices-city", city=city_slug(name))}
            for name in data["cities"][:2]
        ],
        "beers": [{"label": beer["name"], "url": page_path(BeerPage.Kind.BEER, beer["key"], lang)} for beer in data["beers"]],
    }


def _alternates(request: HttpRequest) -> dict[str, str]:
    """The same page in each language, query string included (search keeps its ``q``)."""

    match = request.resolver_match
    if match is None or not match.url_name:
        return {lang: web_reverse("home", lang) for lang in LANGS}
    query = request.META.get("QUERY_STRING", "")
    suffix = f"?{query}" if query else ""
    name = base_name(match.url_name)
    return {
        lang: web_reverse(name, lang, **match.captured_kwargs) + suffix
        for lang in LANGS
    }


def render_page(
    request: HttpRequest,
    template: str,
    context: dict | None = None,
    *,
    title: str,
    description: str = "",
    section: str = "",
    status: int = 200,
    indexable: bool = True,
    follow: bool = False,
    canonical_params: dict | None = None,
    with_map: bool = False,
    canonical_noindex: bool = False,
) -> HttpResponse:
    """Render a page of the public or signed-in shell.

    ``section`` marks the active item in the header or panel (``"pubs"``,
    ``"diary"``…). ``indexable=False`` keeps the page out of search engines;
    with ``follow=True`` they still follow its links (a public page that is
    thin or a filtered view of another one). ``canonical_params`` stay in the
    canonical and hreflang addresses, which otherwise drop the query string.
    ``with_map=True`` lets the page load the street map of ``web/components/map.html``.
    ``canonical_noindex=True`` keeps the canonical on a page out of the index: a search within a list
    points at the list itself.
    """

    lang = translation.get_language() if translation.get_language() in LANGS else "cs"
    alternates = _alternates(request)
    origin = settings.PUBLIC_WEB_ORIGIN
    legal = _LEGAL_ROOT if lang == "cs" else f"{_LEGAL_ROOT}/en"
    kept = f"?{urlencode(canonical_params)}" if canonical_params else ""
    indexable = indexable and status == 200
    page = {
        "lang": lang,
        "other_lang": "en" if lang == "cs" else "cs",
        "switch_url": alternates["en" if lang == "cs" else "cs"],
        "canonical_url": f"{origin}{alternates[lang].split('?')[0]}{kept}",
        "alternate_urls": {code: f"{origin}{url.split('?')[0]}{kept}" for code, url in alternates.items()},
        "og_locale": _OG_LOCALES[lang],
        "title": title,
        "description": description,
        "section": section,
        "indexable": indexable,
        "canonical_noindex": canonical_noindex and status == 200,
        # Pages that are only out of the index still get a share preview.
        "shareable": indexable or (follow and status == 200),
        "account": _account_card(getattr(request, "web_account", None)),
        "app_store_url": app_store_url("web"),
        "play_store_url": play_store_url("web"),
        "privacy_url": f"{legal}/privacy.html",
        "terms_url": f"{legal}/terms.html",
        "search_query": request.GET.get("q", "")[:120] if section == "search" else "",
        # Called by the template, so only pages with the public footer read it; the 500 page never does.
        "footer": (lambda: _footer(lang)) if status < 500 else None,
        "tours": (lambda: _footer_data()["tours"]) if status < 500 else False,
    }
    response = render(request, template, {"page": page, **(context or {})}, status=status)
    if not indexable:
        response.headers["X-Robots-Tag"] = "noindex, follow" if follow and status == 200 else "noindex, nofollow"
    if with_map:
        response.headers["Content-Security-Policy"] = _csp(with_map=True)
    return response


# Pages whose address is reserved before the page exists: (section, signed-in shell).
_PLACEHOLDERS = {
    "web-pubs": ("pubs", False),
    "web-pubs-city": ("pubs", False),
    "web-pub": ("pubs", False),
    "web-search": ("search", False),
    "web-rankings": ("rankings", False),
    "web-news": ("news", False),
    "web-tours": ("tours", False),
    "web-tour": ("tours", False),
    "web-diary": ("diary", True),
    "web-log-beer": ("diary", True),
    "web-beers": ("beers", True),
    "web-my-pubs": ("pubs", True),
    "web-taproom": ("taproom", True),
    "web-crew": ("crew", True),
    "web-profile": ("profile", True),
    "web-settings": ("settings", True),
}


@web_page
def coming_soon(request: HttpRequest, **_kwargs) -> HttpResponse:
    """A reserved address whose page is not built yet: 404 inside the right shell."""

    name = base_name(request.resolver_match.url_name if request.resolver_match else "")
    section, signed_in = _PLACEHOLDERS.get(name, ("", False))
    if signed_in and request.web_account is None:
        return HttpResponseRedirect(login_url(request))
    return render_page(
        request,
        "web/app_coming_soon.html" if signed_in else "web/coming_soon.html",
        title=gettext("Tuhle stránku ještě čepujeme"),
        section=section,
        status=404,
    )


@web_page
def component_gallery(request: HttpRequest) -> HttpResponse:
    """Every shared web component on one page. Local development only."""

    crumbs = [{"label": "Na pivo", "url": web_reverse("home")}, {"label": "Komponenty"}]
    chips = [
        {"label": "Otevřeno teď", "url": "#", "current": True},
        {"label": "Všechny čtvrti", "url": "#", "icon": "chevron-down"},
        {"label": "Do 55 Kč", "url": "#"},
        {"label": "Tankové", "url": "#"},
    ]
    segment = [
        {"label": "Týden", "url": "#"},
        {"label": "Měsíc", "url": "#", "current": True},
        {"label": "Rok", "url": "#"},
    ]
    return render_page(
        request,
        "web/component_gallery.html",
        {"crumbs": crumbs, "chips": chips, "segment": segment},
        title="Komponenty",
        indexable=False,
    )


def _path_lang(request: HttpRequest) -> str:
    return "en" if request.path == "/en" or request.path.startswith("/en/") else "cs"


def not_found(request: HttpRequest, exception=None) -> HttpResponse:
    """``handler404``: an unknown address inside the public shell. The API keeps Django's plain 404."""

    if request.path.startswith("/v1/"):
        return page_not_found(request, exception)

    @web_page
    def page(request: HttpRequest) -> HttpResponse:
        return render_page(request, "web/404.html", title=gettext("Tohle tu nečepujeme"), status=404)

    return page(request, lang=_path_lang(request))


def server_error(request: HttpRequest) -> HttpResponse:
    """``handler500``: no session, no database, only the template, since either may be what failed.

    The API and a failing template get Django's built-in page: there is no top-level ``500.html``.
    """

    if request.path.startswith("/v1/"):
        return django_server_error(request)
    try:
        with translation.override(_path_lang(request)):
            return render_page(request, "web/500.html", title=gettext("Něco se pokazilo"), status=500)
    except Exception:  # noqa: BLE001 -- the error page itself must not fail
        return django_server_error(request)

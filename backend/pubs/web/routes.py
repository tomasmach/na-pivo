"""Addresses of the web: Czech without a prefix, English under /en/.

Every page is registered twice from one line, as ``<name>`` (Czech) and
``<name>-en`` (English, ``lang="en"`` passed to the view). Links are built with
``web_reverse`` or the ``{% web_url %}`` tag, which pick the variant for the
language being rendered. The older pages (``home``, ``beer-prices``, ``beer``…)
follow the same naming, so the tag reaches them too.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponsePermanentRedirect
from django.urls import NoReverseMatch, Resolver404, URLPattern, path, resolve, reverse
from django.utils import translation

from pubs.i18n import current_locale, normalize_locale

EN_SUFFIX = "-en"


def bilingual(cs: str, en: str, view, name: str) -> list[URLPattern]:
    """The Czech and English address of one page."""

    return [
        path(cs, view, name=name),
        path(en, view, {"lang": "en"}, name=f"{name}{EN_SUFFIX}"),
    ]


def base_name(url_name: str) -> str:
    return url_name.removesuffix(EN_SUFFIX)


def web_reverse(name: str, lang: str | None = None, **kwargs) -> str:
    """Path of a page in the given language (default: the one being rendered)."""

    lang = lang or current_locale()
    name = base_name(name)
    if lang == "en":
        try:
            return reverse(f"{name}{EN_SUFFIX}", kwargs=kwargs or None)
        except NoReverseMatch:
            pass
    return reverse(name, kwargs=kwargs or None)



def _page(path: str) -> str | None:
    """Base name of the page at this address, or None when no page is there."""

    try:
        match = resolve(path)
    except Resolver404:
        return None
    return base_name(match.url_name or "")


# Pages whose addresses are all lower case, so /CENY or /ceny/Praha can only mean the lower-case page.
# Tokens, invite codes, nicknames and file names keep their case and are not listed. A pub page sends
# any spelling of its own key on in one step, so only an address its route does not match is lowered here.
_PUB_PAGE = "web-pub"
_SHARE_PAGE = "pub-share-landing"
CASELESS_PAGES = frozenset({
    "home", "beer-prices", "beer-prices-city", "beer-list", "beer-brand", "beer", "web-pubs", "web-pubs-city",
    "web-rankings", "web-rankings-region", "web-news", "web-tours", "web-beer-index", "web-search",
    "web-login", "web-register",
})


def _address(path: str) -> str:
    """The address a web page asked for this way lives at: no slash at the end, lower case where case means nothing."""

    if path != "/" and path.endswith("/") and _page(path) is None:
        stripped = path.rstrip("/")
        if stripped and not stripped.startswith("//"):
            if _page(stripped) is not None:
                path = stripped
            elif _page(stripped.lower()) in (*CASELESS_PAGES, _PUB_PAGE):
                return stripped.lower()
    lower = path.lower()
    if lower != path:
        asked, meant = _page(path), _page(lower)
        if (meant in CASELESS_PAGES and asked in (None, *CASELESS_PAGES)) or (meant == _PUB_PAGE and asked is None):
            path = lower
    return path


def _pub_address(path: str, request: HttpRequest) -> str:
    """A pub page or an app's /h/ link already at the address its view would send it on to, so that is one 301 too."""

    match = resolve(path)
    page = base_name(match.url_name or "")
    if page not in (_PUB_PAGE, _SHARE_PAGE):
        return path
    from pubs.web import pubs_data

    key = match.kwargs["key"]
    if page == _SHARE_PAGE:
        target = pubs_data.pub_key_for_hint(key.lower(), request.GET.get("n", "")[:120])
        lang = normalize_locale(translation.get_language_from_request(request))
    else:
        target = pubs_data.find_pub(key).get("redirect")
        lang = "en" if match.kwargs.get("lang") == "en" else "cs"
    return web_reverse(_PUB_PAGE, lang, key=target) if target else path


def canonical_address_middleware(get_response):
    """An old or sloppy address of a web page leads to its address in one 301, query string kept.

    /hospody/ and /CENY lose the slash and the capitals, and the old ?kraj= of the rankings moves into the
    path, all at once. GET and HEAD only, so a form post is never turned into a GET, and never the API or admin.
    """

    def middleware(request: HttpRequest):
        path = request.path_info
        if request.method not in ("GET", "HEAD") or path.startswith(("/v1/", "/admin/")):
            return get_response(request)
        if not (path.endswith("/") or path != path.lower() or "kraj" in request.GET):
            return get_response(request)
        target = _address(path)
        query = request.META.get("QUERY_STRING", "")
        old_kraj = "kraj" in request.GET and _page(target) == "web-rankings"
        if old_kraj:
            from pubs.web.rankings import region_path

            params = request.GET.copy()
            lang = "en" if target.startswith("/en/") else "cs"
            target, query = region_path(params.pop("kraj")[-1], lang), params.urlencode()
        if target == path and not old_kraj:
            return get_response(request)
        page = None if old_kraj else _page(target)
        if page in (_PUB_PAGE, _SHARE_PAGE):
            target = _pub_address(target, request)
            if page == _SHARE_PAGE:
                # Like the /h/ view itself: ?n= only picks the pub and the pub page has no use for it.
                query = ""
        location = request.path[: len(request.path) - len(path)] + target
        return HttpResponsePermanentRedirect(f"{location}?{query}" if query else location)

    return middleware

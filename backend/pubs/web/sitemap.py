"""/sitemap.xml: an index of files with every page worth finding, each with its other language.

Built once an hour: reading the catalogue and the price history takes seconds on
production data. ``lastmod`` is the day the data behind a page last changed and
is left out where that day is not known.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from xml.sax.saxutils import escape

from django.conf import settings
from django.core.cache import cache
from django.http import Http404, HttpRequest, HttpResponse
from django.urls import resolve
from django.utils import timezone

from pubs.beer_pages import PATHS as BEER_PATHS
from pubs.beer_pages import page_path
from pubs.home_views import PATHS as HOME_PATHS
from pubs.models import BeerPage, PubPriceSnapshot
from pubs.price_map import PATHS as PRICE_PATHS
from pubs.price_map import city_slug
from pubs.web import pubs_data
from pubs.web.routes import web_reverse

SITEMAP_SECONDS = 60 * 60
# The protocol's limit per file; every page is listed once per language.
MAX_URLS = 50_000
# How far back the price history is compared to find when a price page last changed.
PRICE_HISTORY_DAYS = 120

_LANGS = ("cs", "en")
_XMLNS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'


def _day(value: date | datetime | str | None) -> date | None:
    if isinstance(value, str):
        return date.fromisoformat(value)
    if isinstance(value, datetime):
        return timezone.localdate(value)
    return value


# What /ceny shows. Caches other pages add to the snapshot later, like the Pivní index kraje, are not its news.
_PRICE_PAGE_KEYS = ("window_days", "fresh_days", "min_pubs", "min_czk", "country", "cities", "prague_districts", "cheapest")


def _price_changes() -> dict[str, date]:
    """Day each price page last showed different numbers: ``""`` is /ceny, the rest are city slugs.

    A snapshot is taken every day, so its own day says nothing; the day after the
    last snapshot with other numbers does. A page unchanged over the whole
    compared history has no known day.
    """

    def numbers(data: dict) -> dict[str, str]:
        found = {"": json.dumps({key: data.get(key) for key in _PRICE_PAGE_KEYS}, sort_keys=True)}
        for area in data.get("cities", []):
            found[city_slug(area["name"])] = json.dumps(area, sort_keys=True)
        return found

    rows = PubPriceSnapshot.objects.order_by("-day").values_list("day", "data")[:PRICE_HISTORY_DAYS]
    newest: dict[str, str] | None = None
    changed: dict[str, date] = {}
    later_day = None
    seen = 0
    for day, data in rows.iterator(chunk_size=10):
        seen += 1
        current = numbers(data)
        if newest is None:
            newest = current
        else:
            for key, value in newest.items():
                if key not in changed and current.get(key) != value:
                    changed[key] = later_day
            if len(changed) == len(newest):
                return changed
        later_day = day
    if newest is not None and seen < PRICE_HISTORY_DAYS:
        # The whole history was read: the rest look as they did on the first day they were shown.
        for key in newest:
            changed.setdefault(key, later_day)
    return changed


def _beer_changes() -> dict[tuple[str, str], date]:
    """Day the newest pour of each beer page was confirmed; a brand and the list take their beers' newest."""

    changed: dict[tuple[str, str], date] = {}
    for key, data in BeerPage.objects.filter(kind=BeerPage.Kind.BEER).values_list("key", "data"):
        days = [_day(pub["confirmed"]) for pub in data.get("listed", []) if pub.get("confirmed")]
        if not days:
            continue
        newest = max(days)
        changed[(BeerPage.Kind.BEER, key)] = newest
        for group in ((BeerPage.Kind.BRAND, data.get("brand_key", "")), (BeerPage.Kind.LIST, "")):
            if group not in changed or changed[group] < newest:
                changed[group] = newest
    return changed


def _both(path: str, lastmod=None) -> dict:
    """A Czech path with its English twin."""

    match = resolve(path)
    origin = settings.PUBLIC_WEB_ORIGIN
    return {
        "urls": {lang: f"{origin}{web_reverse(match.url_name, lang, **match.kwargs)}" for lang in _LANGS},
        "lastmod": _day(lastmod),
    }


def _pages() -> dict[str, list[dict]]:
    from pubs.web import about, beer_index, legal, news, pubs_views, rankings, tours

    origin = settings.PUBLIC_WEB_ORIGIN
    snapshot = PubPriceSnapshot.objects.only("data").first()
    prices = _price_changes()
    beers = _beer_changes()
    pages = [
        {"urls": {lang: f"{origin}{path}" for lang, path in HOME_PATHS.items()}, "lastmod": None},
        {"urls": {lang: f"{origin}{path}" for lang, path in PRICE_PATHS.items()}, "lastmod": prices.get("")},
    ]
    for area in snapshot.data.get("cities", []) if snapshot else []:
        slug = city_slug(area["name"])
        pages.append({
            "urls": {lang: f"{origin}{path}/{slug}" for lang, path in PRICE_PATHS.items()},
            "lastmod": prices.get(slug),
        })
    for kind, key in BeerPage.objects.order_by("kind", "key").values_list("kind", "key"):
        pages.append({
            "urls": {lang: f"{origin}{page_path(kind, key, lang)}" for lang in BEER_PATHS},
            "lastmod": beers.get((kind, key)),
        })
    for module in (pubs_views, rankings, news, beer_index, tours, about, legal):
        pages += [_both(path) for path in module.sitemap_paths()]
    pubs = [
        {"urls": {lang: f"{origin}{web_reverse('web-pub', lang, key=key)}" for lang in _LANGS}, "lastmod": _day(changed)}
        for key, changed in pubs_data.indexed_pubs().items()
    ]
    return {"pages": pages, "pubs": pubs}


def _urlset(pages: list[dict]) -> str:
    out = [f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset {_XMLNS} xmlns:xhtml="http://www.w3.org/1999/xhtml">\n']
    for page in pages:
        links = "".join(
            f'\n  <xhtml:link rel="alternate" hreflang="{lang}" href="{escape(url)}"/>' for lang, url in page["urls"].items()
        )
        links += f'\n  <xhtml:link rel="alternate" hreflang="x-default" href="{escape(page["urls"]["cs"])}"/>'
        lastmod = f"\n  <lastmod>{page['lastmod'].isoformat()}</lastmod>" if page["lastmod"] else ""
        for url in page["urls"].values():
            out.append(f"<url>\n  <loc>{escape(url)}</loc>{lastmod}{links}\n</url>\n")
    out.append("</urlset>\n")
    return "".join(out)


def _build() -> dict[str, str]:
    """The index and every file it lists, by file name."""

    origin = settings.PUBLIC_WEB_ORIGIN
    per_file = MAX_URLS // len(_LANGS)
    files: dict[str, str] = {}
    entries = []
    seen: set[str] = set()
    for group, pages in _pages().items():
        unique = []
        for page in pages:
            if page["urls"]["cs"] not in seen:
                seen.add(page["urls"]["cs"])
                unique.append(page)
        for number, start in enumerate(range(0, len(unique), per_file), start=1):
            chunk = unique[start:start + per_file]
            name = f"sitemap-{group}-{number}.xml"
            files[name] = _urlset(chunk)
            newest = max((page["lastmod"] for page in chunk if page["lastmod"]), default=None)
            lastmod = f"<lastmod>{newest.isoformat()}</lastmod>" if newest else ""
            entries.append(f"<sitemap><loc>{escape(f'{origin}/{name}')}</loc>{lastmod}</sitemap>\n")
    files["sitemap.xml"] = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex {_XMLNS}>\n{"".join(entries)}</sitemapindex>\n'
    )
    return files


def _files() -> dict[str, str]:
    return cache.get_or_set("web:sitemap", _build, SITEMAP_SECONDS)


def _response(body: str) -> HttpResponse:
    response = HttpResponse(body, content_type="application/xml; charset=utf-8")
    response["Cache-Control"] = f"public, max-age={SITEMAP_SECONDS}"
    return response


def sitemap_index(_request: HttpRequest) -> HttpResponse:
    return _response(_files()["sitemap.xml"])


def sitemap_file(_request: HttpRequest, part: str) -> HttpResponse:
    body = _files().get(f"sitemap-{part}.xml")
    if body is None:
        raise Http404
    return _response(body)

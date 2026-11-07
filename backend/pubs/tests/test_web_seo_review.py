"""Fixes from the code review of the SEO stack: each test names what a reader or a crawler saw wrong."""

from __future__ import annotations

import json
import re
from datetime import timedelta
from io import StringIO
from urllib.parse import parse_qs, urlsplit

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone

from pubs.models import PubDirectory
from pubs.price_map import save_price_snapshot
from pubs.tests.sitemaps import sitemap_xml
from pubs.tests.test_beer_pages import _pub as _menu_pub
from pubs.tests.test_beer_pages import _second_beer, _three_fresh_pubs, catalog  # noqa: F401
from pubs.tests.test_price_map import BRNO, PRAGUE
from pubs.tests.test_price_map import _price as _indexed_price
from pubs.tests.test_web_account import _member, _web, no_emails  # noqa: F401  (fixture)
from pubs.tests.test_web_pubs import _pub
from pubs.web import beer_index, pubs_data

pytestmark = pytest.mark.django_db

LOUNY = (50.357, 13.797)


@pytest.fixture(autouse=True)
def _fresh(settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    cache.clear()
    pubs_data._built.update(stamp=None, data=None)


def _graph(html: str) -> list[dict]:
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return [node for block in blocks for node in json.loads(block)["@graph"]]


def _pub_names(html: str) -> list[str]:
    return re.findall(r'<span class="np-pubrow__name">([^<]+)</span>', html)


def test_a_later_page_of_a_city_describes_its_own_pubs_for_search_engines(client):
    for index in range(25):
        _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city="Praha")

    html = client.get("/hospody/praha?page=2").content.decode()
    items = next(node for node in _graph(html) if node["@type"] == "ItemList")["itemListElement"]

    assert [item["position"] for item in items] == list(range(21, 26))
    assert [item["name"] for item in items] == _pub_names(html)


def test_the_prices_page_lastmod_ignores_what_the_beer_index_adds_to_the_snapshot(client):
    for _ in range(5):
        _indexed_price("Brno", 48, BRNO)
        _indexed_price("Praha 1", 55, PRAGUE)
    now = timezone.now()
    save_price_snapshot(now - timedelta(days=1))
    save_price_snapshot(now)

    # The Pivní index stores its kraje in the newest snapshot; /ceny still shows the same numbers.
    assert client.get("/pivni-index").status_code == 200
    xml = sitemap_xml(client)

    first_day = (timezone.localdate(now) - timedelta(days=1)).isoformat()
    assert f"<loc>https://na-pivo.cz/ceny</loc>\n  <lastmod>{first_day}</lastmod>" in xml


def test_the_beer_index_knows_the_kraj_of_a_town_merged_from_its_post_office():
    for price in (44, 46, 48, 50, 52):
        _indexed_price("Louny 1", price, LOUNY)
    call_command("snapshot_beer_prices", stdout=StringIO())

    data = beer_index._index()

    assert "Louny" in [area["name"] for area in data["cities"]]
    assert data["city_regions"]["Louny"] == "CZ042"


def test_a_tank_beer_on_a_menu_links_to_the_beer_page():
    _three_fresh_pubs()
    call_command("snapshot_beer_prices", stdout=StringIO())

    rows = pubs_data._with_beer_pages([{"name": "Testovar 11° tankové"}, {"name": "Testovar 11° nefiltrované"}])

    assert [row["beer_page"] for row in rows] == ["testovar-11", ""]


def test_the_pubs_of_a_beer_are_found_by_the_english_town_name(client, monkeypatch):
    from pubs import web_views

    _three_fresh_pubs()  # U Kalicha in Praha 2, Na Růžku in Brno
    call_command("snapshot_beer_prices", stdout=StringIO())

    short = client.get("/en/beer/testovar-11").content.decode()
    kalich = re.search(r'<li id="h\d+"[^>]*data-find="([^"]*)"[^>]*>(?:(?!</li>).)*U Kalicha', short, re.S).group(1)
    assert "Prague 2" in kalich and "Praha 2" in kalich

    monkeypatch.setattr(web_views, "PUBS_PER_PAGE", 2)
    _second_beer()
    call_command("snapshot_beer_prices", "--force", stdout=StringIO())
    cache.clear()
    for path in ("/en/beer/testovar-11?q=prague+2", "/en/beer/brand/testovar?q=prague+2", "/pivo/testovar-11?q=praha+2"):
        html = client.get(path).content.decode()
        listed = re.search(r'<ol class="rs-pubs" role="list" data-rows data-more-rows>.*?</ol>', html, re.S).group(0)
        found = re.findall(r'data-find="([^"]*)"', listed)
        assert found and all("Praha 2" in text for text in found), path
    assert "U Kalicha" in client.get("/en/beer/testovar-11?q=prague+2").content.decode()


def test_the_district_menu_keeps_the_filters_on_the_way_to_a_district_page(client):
    for district, lat in (("Praha 7", 50.10), ("Praha 2", 50.075)):
        for index in range(2):
            _pub(f"{district} hospoda {index}", lat=lat + index / 1000, lng=14.43, city=district)

    html = client.get("/hospody/praha?sort=name&page=1").content.decode()

    assert '<a href="/hospody/praha-7?sort=name" rel="nofollow">' in html
    assert '<a href="/hospody/praha-7">' in client.get("/hospody/praha").content.decode()


def test_a_brand_page_does_not_promise_a_price_at_every_pub(client):
    _three_fresh_pubs()
    _second_beer()
    _menu_pub("Bez Ceny", [("Testovar 12°", None, None)])
    call_command("snapshot_beer_prices", stdout=StringIO())

    czech = client.get("/pivo/znacka/testovar").content.decode()
    english = client.get("/en/beer/brand/testovar").content.decode()

    assert "cena chybí" in czech
    assert "U každé hospody datum posledního potvrzení a cena, pokud ji někdo zapsal." in czech
    assert "Each pub with the date it was last confirmed and its price, if someone logged it." in english


def test_log_a_beer_from_my_pubs_picks_the_pub_whose_stored_name_was_cleaned_for_the_page():
    stored = "P5342 - Pivnice Smíchov, ul.Nádražní"
    for name in ("U Kocoura", stored):
        PubDirectory.objects.create(name=name, lat=50.0712, lng=14.4041, city="Praha 5", country="cz", source="test",
                                    refreshed_at=timezone.now())
    _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")

    rows = client.get("/moje-hospody?mesto=praha").context["rows"]
    pivnice = next(row for row in rows if row["name"] == "Pivnice Smíchov")
    log_url = client.get(f"/moje-hospody?mesto=praha&hospoda={pivnice['key']}").context["selected"]["log_url"]

    assert parse_qs(urlsplit(log_url).query)["n"] == [stored]
    linked = client.get(log_url).context["data"]["pubs"][0]
    assert (linked["name"], linked["linked"]) == (stored, True)

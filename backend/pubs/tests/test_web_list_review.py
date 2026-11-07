"""Fixes after the design review of the SEO stack: one half-litre price everywhere, and long pub lists people can search."""

from __future__ import annotations

import re
from io import StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command

from pubs.tests.test_beer_pages import _second_beer, _three_fresh_pubs, catalog  # noqa: F401
from pubs.tests.test_price_map import _catalog
from pubs.tests.test_price_map import _price as _indexed_price
from pubs.tests.test_web_pubs import _pub
from pubs.web import pubs_data

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh():
    cache.clear()
    pubs_data._built.update(stamp=None, data=None)


def _canonical(html: str) -> str:
    return re.search(r'<link rel="canonical" href="([^"]+)">', html).group(1)


def _text(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


def _list(html: str) -> str:
    return re.search(r'<ol class="rs-pubs" role="list" data-rows data-more-rows>.*?</ol>', html, re.S).group(0)


def _foot(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", re.search(r"data-more-foot>(.*?)</div>", html, re.S).group(1)).split())


def test_the_top_card_names_the_same_half_litre_as_the_list(client):
    for price in (44, 48, 52, 56, 60):
        _catalog(_indexed_price("Praha 2", price), f"Hospoda za {price}")
    _catalog(_indexed_price("Praha 2", 28, volume_ml=400), "Pivnice Na Klikovce")
    call_command("snapshot_beer_prices", stdout=StringIO())

    for path in ("/ceny", "/ceny/praha"):
        html = client.get(path).content.decode()
        card = _text(re.search(r'<aside class="np-card rs-facts".*?</aside>', html, re.S).group(0))
        first = _text(re.search(r'<li class="rs-ranked__row.*?</li>', html, re.S).group(0))
        assert "Pivnice Na Klikovce" in first and "35 Kč" in first
        assert "Nejlevněji za 0,5 l Pivnice Na Klikovce, Praha 2 na lístku 28 Kč za 0,4 l 35 Kč" in card, (path, card)
    english = _text(client.get("/en/prices/praha").content.decode())
    assert "Cheapest per 0.5 l Pivnice Na Klikovce, Prague 2 28 CZK for 0.4 l on the menu 35 CZK" in english
    assert "Půllitr od 35 Kč" in _text(client.get("/zebricky").content.decode())


def test_a_long_pub_list_is_searched_and_sorted_by_the_server(client, monkeypatch):
    from pubs import web_views

    monkeypatch.setattr(web_views, "PUBS_PER_PAGE", 2)
    _three_fresh_pubs()  # U Kalicha 52 Kč, Na Růžku 58 Kč in Brno, U Lípy 64 Kč
    _second_beer()
    call_command("snapshot_beer_prices", stdout=StringIO())

    page = client.get("/pivo/testovar-11").content.decode()
    form = re.search(r'<form class="rs-tools rs-tools--server" method="get" action="/pivo/testovar-11" role="search">.*?</form>', page, re.S).group(0)
    assert 'name="q"' in form and "Najdi hospodu nebo město" in form
    assert 'href="/pivo/testovar-11?sort=cheap#hospody" rel="nofollow"' in form
    assert "X-Robots-Tag" not in client.get("/pivo/testovar-11")

    found = client.get("/pivo/testovar-11?q=brno")
    html = found.content.decode()
    assert found["X-Robots-Tag"] == "noindex, follow"
    assert _canonical(html) == "https://na-pivo.cz/pivo/testovar-11"
    assert "Na Růžku" in _list(html) and "U Kalicha" not in _list(html) and 'value="brno"' in html

    cheap = client.get("/pivo/testovar-11?sort=cheap").content.decode()
    names = re.findall(r'<li id="h\d+" class="rs-pub.*?<a[^>]*>([^<]+)', cheap, re.S)
    assert names == ["U Kalicha", "Na Růžku"]
    assert 'href="/pivo/testovar-11?sort=cheap&amp;page=2#h3" rel="nofollow" data-more' in cheap
    assert "U Lípy" in _list(client.get("/pivo/testovar-11?sort=cheap&page=2").content.decode())
    assert client.get("/pivo/testovar-11?sort=cheap&page=9")["Location"] == "/pivo/testovar-11?sort=cheap&page=2"

    none = client.get("/pivo/testovar-11?q=ostrava").content.decode()
    assert "Takovou hospodu ani město tu s tímhle pivem nemám." in none and 'href="/pivo/testovar-11#hospody"' in none

    brand = client.get("/pivo/znacka/testovar?q=brno").content.decode()
    assert "Na Růžku" in _list(brand) and "U Kalicha" not in _list(brand) and "rs-tools--server" in brand


def test_a_short_pub_list_ignores_the_server_search(client):
    _three_fresh_pubs()
    call_command("snapshot_beer_prices", stdout=StringIO())

    response = client.get("/pivo/testovar-11?q=brno")
    html = response.content.decode()
    assert "rs-tools--server" not in html and "U Kalicha" in _list(html) and "Na Růžku" in _list(html)
    assert "X-Robots-Tag" not in response


def test_a_later_page_says_which_rows_it_shows(client):
    for index in range(45):
        _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city="Praha")

    assert _foot(client.get("/hospody/praha").content.decode()).startswith("20 z 45")
    second = client.get("/hospody/praha?page=2").content.decode()
    assert _foot(second).startswith("21–40 z 45")
    assert 'data-from-start="{last} z 45"' in second and 'data-range="{first}–{last} z 45"' in second
    assert _foot(client.get("/en/pubs/praha?page=3").content.decode()).startswith("41–45 of 45")

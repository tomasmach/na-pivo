"""Mach's four decisions for the public web: the index's name, tours in the menu, the price floor, private taps."""

from __future__ import annotations

import json
import re
from io import StringIO
from pathlib import Path

import pytest
from django.core.cache import cache
from django.core.management import call_command

from pubs.api.tests.test_tour_publications import directory  # noqa: F401  (autouse: the pubs tours use)
from pubs.api.tests.test_tour_search import published
from pubs.models import BeerPage, PubDirectory, PubPriceSnapshot
from pubs.price_map import price_floor, shows_price
from pubs.tests.sitemaps import sitemap_xml
from pubs.tests.test_beer_pages import _pub as _menu_pub
from pubs.tests.test_beer_pages import catalog  # noqa: F401
from pubs.tests.test_price_map import _catalog
from pubs.tests.test_price_map import _price as _indexed_price
from pubs.tests.test_web_pubs import _menu, _pub
from pubs.web import pubs_data
from pubs.web.places import is_private_pub

pytestmark = pytest.mark.django_db
BACKEND = Path(__file__).resolve().parents[2]
# Away from the pubs the tour fixture puts in central Prague, so each menu is its own pub's.
AWAY = (50.02, 14.30)


@pytest.fixture(autouse=True)
def _fresh():
    cache.clear()
    pubs_data._built.update(stamp=None, data=None)
    yield
    cache.clear()


def _graph(html: str) -> list[dict]:
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return [node for block in blocks for node in json.loads(block)["@graph"]]


def _title(html: str) -> str:
    return re.search(r"<title>(.*?)</title>", html, re.S).group(1)


def _snapshot(prices=(48, 52, 56, 60, 64)) -> None:
    for price in prices:
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", "--force", stdout=StringIO())
    cache.clear()


# ---------- 1. Pivní index Na pivo ----------


def test_the_index_goes_by_its_new_name_everywhere(client, monkeypatch):
    from pubs.web import beer_index

    _snapshot()
    drawn = []
    monkeypatch.setattr(beer_index, "og_image", lambda **payload: drawn.append(payload) or b"png")

    html = client.get("/pivni-index").content.decode()
    english = client.get("/en/beer-index").content.decode()

    assert _title(html) == "Pivní index Na pivo: cena piva po krajích a v čase | Na pivo"
    assert _title(english) == "Na pivo Beer Index: beer price by region over time | Na pivo"
    assert len(_title(html)) <= 60 and len(_title(english)) <= 60
    assert _title(html) != _title(client.get("/ceny").content.decode())
    assert '<h1 class="np-h1">Pivní index Na pivo</h1>' in html and '<h1 class="np-h1">Na pivo Beer Index</h1>' in english
    assert "<cite>Zdroj: Pivní index Na pivo, https://na-pivo.cz/pivni-index</cite>" in html
    assert "<cite>Source: Na pivo Beer Index, https://na-pivo.cz/en/beer-index</cite>" in english
    nodes = _graph(html)
    assert [node["name"] for node in nodes if node["@type"] == "Dataset"] == ["Pivní index Na pivo"]
    assert next(node for node in nodes if node["@type"] == "BreadcrumbList")["itemListElement"][-1]["name"] == "Pivní index Na pivo"
    assert '<a href="/pivni-index">Pivní index Na pivo</a>' in client.get("/o-appce").content.decode()
    assert 'Pivní index Na pivo ›</a>' in client.get("/ceny").content.decode()
    llms = client.get("/llms.txt").content.decode()
    assert "Pivní index Na pivo" in llms and "the Na pivo Beer Index" in llms

    client.get("/pivni-index/og.png")
    assert drawn and drawn[0]["kicker"].startswith("Pivní index Na pivo · ")


def test_no_code_or_translation_keeps_the_old_name():
    files = [*BACKEND.glob("pubs/**/*.py"), *BACKEND.glob("pubs/templates/**/*.html"), BACKEND / "locale/en/LC_MESSAGES/django.po"]
    stale = [str(path) for path in files if path.name != Path(__file__).name and re.search(
        r"Pivní index Česka|Czech Beer Index", path.read_text(encoding="utf-8")
    )]
    assert stale == []


# ---------- 2. Tours in the menu ----------


def test_the_menu_leads_to_the_tours_only_once_one_is_public(client):
    page = client.get("/hospody").content.decode()
    assert 'href="/trasy"' not in page
    assert client.get("/trasy").status_code == 200

    published("pivni_vlk", pubs=(0, 1, 2))
    cache.clear()
    page = client.get("/hospody").content.decode()
    assert page.count('href="/trasy"') == 2  # the header and the phone menu
    assert 'href="/en/tours"' in client.get("/en/pubs").content.decode()


# ---------- 3. The price floor ----------


def test_the_floor_is_half_the_median_never_under_twenty():
    assert price_floor([56.0] * 9 + [20.0]) == 28
    assert price_floor([45.0, 46.0]) == 23  # 22.75 rounds to whole crowns
    assert price_floor([30.0, 34.0]) == 20
    assert price_floor([]) == 20
    assert not shows_price(20, 500, 28) and shows_price(30, 500, 28)
    assert shows_price(24, 400, 28) and not shows_price(18, 300, 28)  # 30 Kč and 30 Kč per half litre, but 18 < 20
    assert not shows_price(19, 500, 20)


def test_a_typo_under_half_the_median_stays_off_every_price_page(client):
    for price in (50, 52, 54, 56, 56, 58, 60, 62):
        _catalog(_indexed_price("Praha 2", price), f"Hospoda za {price}")
    _catalog(_indexed_price("Praha 2", 20), "Branická formanka")
    _catalog(_indexed_price("Praha 2", 30), "Levná pivnice")
    tiger = _pub("Formanka na lístku", city="Praha 2")
    _menu(tiger, beers=[
        {"name": "Kozel 11°", "price_czk": 20, "volume_ml": 500},
        {"name": "Braník 10°", "price_czk": 39, "volume_ml": 500},
    ])
    call_command("snapshot_beer_prices", "--force", stdout=StringIO())
    cache.clear()

    data = PubPriceSnapshot.objects.first().data
    # Median of all ten, 20 Kč included: 56, so the floor is 28.
    assert data["min_czk"] == 28
    assert data["country"]["pubs"] == 9
    cheapest = [pub["name"] for pub in data["cheapest"]]
    assert "Branická formanka" not in cheapest and cheapest[0] == "Levná pivnice"
    prices = client.get("/ceny").content.decode()
    assert "Branická formanka" not in prices and "Levná pivnice" in prices
    assert "teď pod 28 Kč" in client.get("/o-appce").content.decode()

    page = client.get(f"/hospoda/formanka-na-listku-{tiger.cache_key}").content.decode()
    place = next(node for node in _graph(page) if node["@type"] == "BarOrPub")
    assert place["priceRange"] == "39\u00a0Kč" and ">20 Kč<" not in page and "20\u00a0Kč" not in page


def test_a_beer_page_leaves_out_a_half_litre_under_the_floor(client):
    _snapshot((50, 54, 56, 58, 62))
    _menu_pub("U Kalicha", [("Testovar 11°", 52, 500)], at=AWAY)
    _menu_pub("Na Růžku", [("Testovar 11°", 58, 500)], at=AWAY)
    _menu_pub("U Lípy", [("Testovar 11°", 21, 500)], at=AWAY)
    call_command("snapshot_beer_prices", "--force", stdout=StringIO())
    cache.clear()

    listed = {pub["name"]: pub["price_czk"] for pub in BeerPage.objects.get(kind=BeerPage.Kind.BEER, key="testovar-11").data["listed"]}
    # The pub stays on the beer's list, it is on tap there; only its 21 Kč is no price.
    assert listed == {"U Kalicha": 52, "Na Růžku": 58, "U Lípy": None}
    html = client.get("/pivo/testovar-11").content.decode()
    assert "21\u00a0Kč" not in html and ">21 Kč<" not in html


# ---------- 4. Private taps ----------


def test_a_name_that_says_private_is_not_a_public_pub():
    for name in ("Plotovka Louny - soukromý výčep", "SOUKROMÁ hospoda", "Privát u Jardy", "Private bar", "privátní výčep"):
        assert is_private_pub(name), name
    for name in ("U Soukromníka", "Hospoda U Lípy", "Pivovar Privatbank"):
        assert not is_private_pub(name), name


def test_a_private_tap_keeps_its_page_but_no_list_or_search_engine_gets_it(client):
    row = _indexed_price("Praha 1", 45, at=(50.0870, 14.4260))
    _catalog(row, "Plotovka Louny - soukromý výčep")
    private = PubDirectory.objects.get(cache_key=row.cache_key)
    _menu(private, beers=[{"name": "Testovar 11°", "price_czk": 45, "volume_ml": 500}])
    neighbour = _pub("Hospůdka vedle", lat=50.0872, lng=14.4262, city="Praha 1")
    _menu(neighbour)
    for name in ("U Kalicha", "Na Růžku", "U Lípy"):
        _menu_pub(name, at=AWAY)
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", "--force", stdout=StringIO())
    cache.clear()

    page = client.get(f"/hospoda/plotovka-louny-soukromy-vycep-{private.cache_key}")
    assert page.status_code == 200 and page["X-Robots-Tag"] == "noindex, follow"
    assert "plotovka" not in sitemap_xml(client)
    for path in ("/hospody/praha", "/hospody/praha-1", "/pivo/testovar-11", "/pivo", "/ceny", "/zebricky",
                 f"/hospoda/hospudka-vedle-{neighbour.cache_key}"):
        assert "Plotovka" not in client.get(path).content.decode(), path
    assert all("Plotovka" not in pub["name"] for pub in PubPriceSnapshot.objects.first().data["cheapest"])


def test_the_web_search_does_not_find_a_private_tap(client):
    private = _pub("Plotovka Louny - soukromý výčep", lat=50.0870, lng=14.4260, city="Praha 1")
    _menu(private)
    _pub("Plotovka u nádraží", lat=50.0880, lng=14.4270, city="Praha 1")

    found = client.get("/hledat?q=plotovka").content.decode()
    assert "Plotovka u nádraží" in found and "soukromý výčep" not in found
    # Nor among the pubs a search that found nothing suggests instead.
    similar = client.get("/hledat?q=plotovkaa").content.decode()
    assert "soukromý výčep" not in similar
    assert f"plotovka-louny-soukromy-vycep-{private.cache_key}" not in found + similar
    assert client.get(f"/hospoda/plotovka-louny-soukromy-vycep-{private.cache_key}").status_code == 200


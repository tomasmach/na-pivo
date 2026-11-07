"""The last round of the public web's SEO fixes: one line per note, plurals, index rules, redirects and lists."""

from __future__ import annotations

import json
import re
import uuid
from io import BytesIO, StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone, translation
from django.utils.translation import pgettext
from PIL import Image

from pubs.models import BeerProduct, BeerRanking, UserAddedPub
from pubs.tests.sitemaps import sitemap_xml
from pubs.tests.test_beer_pages import _pub as _menu_pub
from pubs.tests.test_beer_pages import _second_beer, _three_fresh_pubs, catalog  # noqa: F401
from pubs.tests.test_price_map import _catalog
from pubs.tests.test_price_map import _price as _indexed_price
from pubs.tests.test_web_pubs import _menu, _pub
from pubs.web import pubs_data
from pubs.web.pages import _csp

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_catalogue():
    # The pub catalogue is kept per process, so each test reads the pubs it made.
    pubs_data._built.update(stamp=None, data=None)
BRNO = (49.19, 16.61)


def _graph(html: str) -> list[dict]:
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return [node for block in blocks for node in json.loads(block)["@graph"]]


def _node(html: str, kind: str) -> dict:
    return next(node for node in _graph(html) if node["@type"] == kind)


def _title(html: str) -> str:
    return re.search(r"<title>(.*?)</title>", html, re.S).group(1)


def _rate(key: str, avg: float = 4.2, count: int = 60) -> None:
    BeerRanking.objects.create(product=BeerProduct.objects.get(key=key), rating_avg=avg, rating_count=count, rank=1, computed_at=timezone.now())


def test_the_note_under_a_heading_is_one_line_of_text_beside_its_icon(client):
    _three_fresh_pubs()
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())

    for path in ("/pivo", "/pivo/testovar-11", "/ceny", "/en/beer/testovar-11", "/en/prices"):
        note = re.search(r'<p class="rs-note">(.*?)</p>', client.get(path).content.decode(), re.S).group(1)
        # The note is a flex row: the date inside the sentence must not become a column of its own.
        icon, text = re.fullmatch(r"(<svg.*?</svg>)(<span>.*</span>)", note, re.S).groups()
        assert "<time datetime=" in text, path


def test_a_brand_counts_its_rated_beers_in_both_languages(client):
    _three_fresh_pubs()
    _second_beer()
    call_command("snapshot_beer_prices", stdout=StringIO())
    _rate("testovar-11")

    assert "průměr 1 piva z 60 hodnocení" in client.get("/pivo/znacka/testovar").content.decode()
    assert "average of 1 beer from 60 ratings" in client.get("/en/beer/brand/testovar").content.decode()

    _rate("testovar-12", avg=3.8, count=10)
    cache.clear()
    assert "průměr 2 piv z 70 hodnocení" in client.get("/pivo/znacka/testovar").content.decode()
    assert "average of 2 beers from 70 ratings" in client.get("/en/beer/brand/testovar").content.decode()
    with translation.override("en"):
        assert pgettext("one", "%(n)s hodnocení") == "%(n)s rating"


def test_a_district_is_indexed_only_with_a_pub_that_has_a_menu_or_a_price(client):
    pubs = [_pub(f"Sedmička {index}", lat=50.10 + index * 0.001, lng=14.43, city="Praha 7") for index in range(3)]

    empty = client.get("/hospody/praha-7")
    assert empty.status_code == 200 and empty["X-Robots-Tag"] == "noindex, follow"
    assert "https://na-pivo.cz/hospody/praha-7<" not in sitemap_xml(client)

    _menu(pubs[0])
    cache.clear()
    listed = client.get("/hospody/praha-7")
    assert "X-Robots-Tag" not in listed
    assert '<link rel="canonical" href="https://na-pivo.cz/hospody/praha-7">' in listed.content.decode()
    assert "https://na-pivo.cz/hospody/praha-7<" in sitemap_xml(client)


def test_a_city_names_a_typical_price_only_once_the_prices_page_lists_it(client):
    pubs = [_pub(f"Brněnka {index}", lat=BRNO[0] + index * 0.001, lng=BRNO[1], city="Brno") for index in range(6)]
    for index, pub in enumerate(pubs):
        _menu(pub, beers=[{"name": "Starobrno 11°", "price_czk": 50 + index, "volume_ml": 500}])
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())

    # Six menus with a price, but /ceny does not list Brno yet, so the list does not say what beer costs there.
    assert "Brno" not in re.findall(r'class="rs-strip__name name">(?:<a [^>]*>)?([^<]+)', client.get("/ceny").content.decode())
    html = client.get("/hospody/brno").content.decode()
    assert "Půllitr tu stojí kolem" not in html and "půllitr kolem" not in html

    for price in (40, 42, 44, 46, 48):
        _indexed_price("Brno", price, BRNO)
    call_command("snapshot_beer_prices", "--force", stdout=StringIO())
    cache.clear()
    assert "Půllitr tu stojí kolem 44\u00a0Kč." in client.get("/hospody/brno").content.decode()


def test_the_cheapest_pubs_show_the_half_litre_price_they_are_ordered_by(client):
    for price in (40, 45, 59, 70):
        _catalog(_indexed_price("Praha 2", price), f"Hospoda za {price}")
    _catalog(_indexed_price("Praha 2", 50, volume_ml=400), "Malá míra")
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/ceny").content.decode()
    rows = re.findall(r'<li class="rs-ranked__row.*?</li>', html, re.S)
    shown = [int(re.search(r'<span class="rs-ranked__price">(\d+) Kč</span>', row).group(1)) for row in rows]
    assert shown == sorted(shown) == [40, 45, 59, 62, 70]
    # The unit is in the card's head; the menu's own price is a line under the pub's name.
    assert "cena za 0,5 l" in html.split('id="cheapest-title"')[1].split("</div>")[0]
    who = re.search(r'<span class="rs-ranked__who">(.*?)</span>\s*<span class="rs-ranked__price">', rows[3], re.S).group(1)
    assert "Malá míra" in who and "na lístku 50 Kč za 0,4 l" in who
    assert "50 CZK for 0.4 l on the menu" in client.get("/en/prices").content.decode()


def test_a_pub_address_and_an_app_link_with_a_slash_lead_on_in_one_step(client):
    pub = _pub("Dom Slaski", city="Praha 1")
    key = pub.cache_key

    for asked, meant in (
        (f"/hospoda/DOM-SLASKI-{key.upper()}/", f"/hospoda/dom-slaski-{key}"),
        (f"/en/pub/DOM-SLASKI-{key.upper()}/", f"/en/pub/dom-slaski-{key}"),
        (f"/hospoda/stare-jmeno-{key}/", f"/hospoda/dom-slaski-{key}"),
        (f"/h/{key}/", f"/hospoda/dom-slaski-{key}"),
        (f"/h/{key.upper()}/?n=Dom%20Slaski", f"/hospoda/dom-slaski-{key}"),
    ):
        response = client.get(asked)
        assert (response.status_code, response["Location"]) == (301, meant), asked
        assert client.get(meant).status_code == 200
    english = client.get(f"/h/{key}/", HTTP_ACCEPT_LANGUAGE="en")
    assert english["Location"] == f"/en/pub/dom-slaski-{key}"


def test_an_old_district_filter_keeps_its_page_and_a_page_past_the_end_leads_to_the_last(client):
    for index in range(25):
        _pub(f"Sedmička {index:02d}", lat=50.10 + index * 0.001, lng=14.43, city="Praha 7")
    _pub("Jinde", lat=50.08, lng=14.42, city="Praha 1")
    _pub("Jinde 2", lat=50.081, lng=14.42, city="Praha 1")

    old = client.get("/hospody/praha?district=praha-7&page=2")
    assert (old.status_code, old["Location"]) == (301, "/hospody/praha-7?page=2")
    assert client.get("/hospody/praha?district=praha-7")["Location"] == "/hospody/praha-7"

    past = client.get("/hospody/praha-7?page=9")
    assert (past.status_code, past["Location"]) == (301, "/hospody/praha-7?page=2")
    assert client.get("/hospody/praha-7?page=2").status_code == 200


def test_titles_of_the_long_templates_fit_in_sixty_characters(client):
    _three_fresh_pubs()
    _second_beer()
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())

    titles = {path: _title(client.get(path).content.decode()) for path in (
        "/ceny", "/en/prices", "/pivni-index", "/en/beer-index", "/pivo/testovar-11", "/en/beer/testovar-11",
    )}
    assert all(len(title) <= 60 for title in titles.values()), titles
    assert titles["/en/beer/testovar-11"] == "Testovar 11° on tap: pubs and prices | Na pivo"
    assert "Cena piva" in titles["/ceny"] and "Beer prices" in titles["/en/prices"]


def test_the_site_has_a_manifest_with_the_icons_it_already_serves(client):
    html = client.get("/").content.decode()
    assert '<link rel="manifest" href="/manifest.webmanifest">' in html
    assert "manifest-src 'self'" in _csp()

    response = client.get("/manifest.webmanifest")
    assert response.status_code == 200 and response["Content-Type"] == "application/manifest+json"
    manifest = json.loads(b"".join(response.streaming_content))
    assert manifest["background_color"] == manifest["theme_color"] == "#0A0A0A"
    for icon in manifest["icons"]:
        image = client.get(icon["src"])
        assert image.status_code == 200 and image["Content-Type"] == "image/png"
        width, height = Image.open(BytesIO(b"".join(image.streaming_content))).size
        assert icon["sizes"] == f"{width}x{height}"


def test_datasets_say_what_they_measure_and_a_pub_its_postal_code(client):
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())

    for path in ("/ceny", "/pivni-index"):
        measured = _node(client.get(path).content.decode(), "Dataset")["variableMeasured"]
        assert [variable["name"] for variable in measured] == [
            "Medián ceny nejlevnějšího piva", "Dolní a horní kvartil ceny", "Počet hospod s cenou",
        ]
    assert _node(client.get("/en/prices").content.decode(), "Dataset")["variableMeasured"][0]["unitText"] == "CZK"

    cache.clear()
    pubs_data._built.update(stamp=None, data=None)
    added = UserAddedPub.objects.create(
        client_id=uuid.uuid4(), cache_key="u2fkbjfr", name="Pivnice U Rotundy", lat=50.0866, lng=14.4174,
        city="Praha 1", address="Na Zderaze 266/11, 12000",
    )
    plain = UserAddedPub.objects.create(
        client_id=uuid.uuid4(), cache_key="u2fkbjfx", name="Bez PSČ", lat=50.0867, lng=14.4175,
        city="Praha 1", address="Karoliny Světlé 17",
    )
    address = _node(client.get(f"/hospoda/pivnice-u-rotundy-{added.cache_key}").content.decode(), "BarOrPub")["address"]
    assert address["streetAddress"] == "Na Zderaze 266/11" and address["postalCode"] == "120 00"
    address = _node(client.get(f"/hospoda/bez-psc-{plain.cache_key}").content.decode(), "BarOrPub")["address"]
    assert address["streetAddress"] == "Karoliny Světlé 17" and "postalCode" not in address


def test_the_beer_index_lists_regions_and_cities_in_tables(client):
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    for price in (40, 42, 44, 46, 48):
        _indexed_price("Brno", price, BRNO)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/pivni-index").content.decode()

    regions = re.search(r'<table class="pi-map" role="table" aria-labelledby="pi-regions">.*?</table>', html, re.S).group(0)
    assert re.findall(r'<th scope="col" role="columnheader">([^<]+)</th>', regions) == ["Kraj", "Střední cena"]
    assert re.search(r'role="rowheader"><span aria-hidden="true">[^<]+</span><span class="np-sr-only">Jihomoravský kraj</span>', regions)
    assert "<div" not in regions
    for title in ("pi-big", "pi-dear", "pi-cheap"):
        table = re.search(rf'<table class="pi-[a-z]+" role="table" aria-labelledby="{title}">.*?</table>', html, re.S)
        assert table and '<th scope="col" role="columnheader">Město</th>' in table.group(0), title
        assert "<li" not in table.group(0)


def test_a_long_pub_list_of_a_beer_goes_on_over_pages_a_crawler_can_follow(client, monkeypatch):
    from pubs import web_views

    monkeypatch.setattr(web_views, "PUBS_PER_PAGE", 2)
    _three_fresh_pubs()
    _second_beer()
    call_command("snapshot_beer_prices", stdout=StringIO())

    first = client.get("/pivo/testovar-11").content.decode()
    assert first.count('<li id="h') == 2 and "data-tools" not in first
    assert re.search(r'>2\sz\s3</span>', first) and 'href="/pivo/testovar-11?page=2#h3" data-more' in first
    assert '<link rel="canonical" href="https://na-pivo.cz/pivo/testovar-11">' in first

    second = client.get("/pivo/testovar-11?page=2").content.decode()
    assert second.count('<li id="h') == 1 and 'id="h3"' in second and "data-more>" not in second
    assert re.search(r'>3–3\sz\s3</span>', second)
    assert '<link rel="canonical" href="https://na-pivo.cz/pivo/testovar-11?page=2">' in second
    assert 'hreflang="en" href="https://na-pivo.cz/en/beer/testovar-11?page=2"' in second
    assert _title(second) == "Testovar 11°, strana 2 | Na pivo"

    past = client.get("/pivo/testovar-11?page=7")
    assert (past.status_code, past["Location"]) == (301, "/pivo/testovar-11?page=2")
    assert client.get("/pivo?page=3")["Location"] == "/pivo"

    brand = client.get("/en/beer/brand/testovar").content.decode()
    assert brand.count('<li id="h') == 2 and 'href="/en/beer/brand/testovar?page=2#h3" data-more' in brand


def test_a_short_pub_list_keeps_its_search_and_fold(client):
    for index in range(13):
        _menu_pub(f"Hospoda {index}", days_ago=index + 1)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/pivo/testovar-11").content.decode()
    assert "data-tools" in html and "Ukázat všechny hospody (13)" in html and "data-more-foot" not in html

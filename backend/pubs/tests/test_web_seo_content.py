"""What the public pages say about themselves and where they link: titles, descriptions, districts, about."""

from __future__ import annotations

import re
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import translation

from pubs.models import PubDirectory
from pubs.tests.test_beer_pages import _pub as _beer_pub
from pubs.tests.test_beer_pages import _second_beer, _three_fresh_pubs, catalog  # noqa: F401
from pubs.tests.test_price_map import BRNO, _catalog, _price
from pubs.tests.test_web_pubs import ALWAYS, _menu
from pubs.tests.test_web_pubs import _pub as _place
from pubs.web.places import in_place, municipality, place_name, pub_name
from pubs.web.pubs_views import sitemap_paths

pytestmark = pytest.mark.django_db


def _head(html: str) -> tuple[str, str]:
    title = re.search(r"<title>([^<]+)</title>", html).group(1)
    description = re.search(r'<meta name="description" content="([^"]*)"', html).group(1)
    return title, description


def test_post_office_names_become_the_town_and_prague_speaks_english():
    assert municipality("Louny 1") == "Louny"
    assert municipality("Ústí nad Labem 2") == "Ústí nad Labem"
    assert municipality("Praha 7") == "Praha 7"
    assert municipality("Plzeň 3") == "Plzeň 3"
    assert in_place("Praha 7") == "v Praze 7"
    assert in_place("Louny 1") == "v Lounech"
    assert in_place("Žitenice") == ""
    with translation.override("en"):
        assert place_name("Praha") == "Prague"
        assert place_name("Praha 7") == "Prague 7"
        assert place_name("Plzeň") == "Pilsen"
        assert place_name("Praha-Libuš") == "Praha-Libuš"
        assert in_place("Žitenice") == "in Žitenice"


def test_business_records_and_placeholders_stay_out_of_titles():
    assert pub_name("P5342 - Chrudim pivovar, ul.Obc.Ležáků") == "Chrudim pivovar"
    assert pub_name("PIVOVAR LOUTKÁŘ s.r.o.") == "PIVOVAR LOUTKÁŘ"
    assert pub_name("Nazev Upřesnim") == "Hospoda bez jména"
    assert pub_name("U Zlatého tygra") == "U Zlatého tygra"


def test_a_pub_in_a_post_office_town_names_the_town(client):
    pub = _place("U Mostu", lat=50.3540, lng=13.7970, city="Louny 1")

    html = client.get(f"/hospoda/u-mostu-{pub.cache_key}").content.decode()

    title, description = _head(html)
    assert title == "U Mostu, Louny | Na pivo"
    assert "Louny 1" not in html
    # Nothing on the page knows the menu or the hours, so the description does not promise them.
    assert description == "U Mostu, Louny. Co tu čepují, zatím nevím. Lístek může doplnit každý, kdo tu sedí. Cesta na mapě."


def test_a_pub_page_links_its_beers_its_neighbours_and_the_prices_of_its_city(client):
    _three_fresh_pubs()
    _second_beer()
    for price in range(40, 46):
        _price("Praha", price)
    tiger = _place(city="Praha")
    _menu(tiger, beers=[{"name": "Testovar 11°", "price_czk": 49, "volume_ml": 500}, {"name": "Domácí kvasnicové"}],
          hours=ALWAYS)
    # Next door, so it is among the five closest whatever other pubs the test data put around.
    neighbour = _place("Lokál Dlouhááá", lat=50.0877, lng=14.4215, city="Praha")
    _menu(neighbour)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get(f"/hospoda/u-zlateho-tygra-{tiger.cache_key}").content.decode()
    english = client.get(f"/en/pub/u-zlateho-tygra-{tiger.cache_key}").content.decode()

    assert '<a href="/pivo/testovar-11" class="np-row">' in html
    assert "Domácí kvasnicové" in html and 'href="/pivo/domaci' not in html
    assert "Hospody poblíž" in html and f'href="/hospoda/lokal-dlouhaaa-{neighbour.cache_key}"' in html
    assert "&#x27;open&#x27;" not in html
    assert 'href="/ceny/praha"' in html and "Kolik stojí pivo v Praze" in html
    title, description = _head(html)
    assert description.startswith("Co čepují v hospodě U Zlatého tygra, Praha: 2 piva od 49 Kč, lístek z ")
    assert description.endswith("Otevírací doba a cesta na mapě.")
    assert '<a href="/en/beer/testovar-11" class="np-row">' in english
    assert "U Zlatého tygra, Prague | Na pivo" in english and 'href="/en/prices/praha"' in english


def test_prague_districts_get_their_own_pages(client):
    for index in range(3):
        _place(f"Sedmička {index}", lat=50.1000 + index * 0.001, lng=14.4300, city="Praha 7")
    _place("Jednička", lat=50.0870, lng=14.4210, city="Praha 1")
    _place("Další jednička", lat=50.0880, lng=14.4220, city="Praha 1")
    _place("Pivnice Pegas", lat=49.1950, lng=16.6080, city="Brno-město")
    _place("U Bláhovky", lat=49.2010, lng=16.6010, city="Brno-město")

    seven = client.get("/hospody/praha-7")
    one = client.get("/hospody/praha-1")

    html = seven.content.decode()
    assert seven.status_code == 200 and "X-Robots-Tag" not in seven
    assert "<title>Hospody v Praze 7 | Na pivo</title>" in html
    assert '<link rel="canonical" href="https://na-pivo.cz/hospody/praha-7">' in html
    assert html.count('class="np-pubrow__name"') == 3 and "Jednička" not in html
    assert 'href="/hospody/praha">Praha</a>' in html
    # Two pubs make a page for people, not for search.
    assert one.status_code == 200 and "noindex" in one["X-Robots-Tag"]
    assert "Pubs in Prague 7" in client.get("/en/pubs/praha-7").content.decode()
    redirect = client.get("/hospody/praha?district=praha-7&open=1")
    assert redirect.status_code == 301 and redirect["Location"] == "/hospody/praha-7?open=1"
    # Brno-město is the county of the whole city, not a district.
    assert client.get("/hospody/brno-mesto").status_code == 404
    assert "/hospody/praha-7" in sitemap_paths() and "/hospody/praha-1" not in sitemap_paths()
    assert 'href="/hospody/praha-7"' in client.get("/hospody/praha").content.decode()


def test_a_small_town_describes_itself_with_its_own_pubs(client):
    for index, name in enumerate(("Na Vyhlídce", "Pod Kaštanem", "U Ládi")):
        pub = _place(name, lat=50.3 + index * 0.001, lng=14.1, city="Žitenice")
        if index == 0:
            _menu(pub, hours=ALWAYS)

    title, description = _head(client.get("/hospody/zitenice").content.decode())

    assert title == "Hospody: Žitenice | Na pivo"
    assert description == "Žitenice: 3 hospody. Lístek mám u 1 z nich. Jsou tu Na Vyhlídce, Pod Kaštanem a U Ládi."
    assert "právě teď" not in description


def test_price_pages_link_their_pubs_and_say_prague_in_english(client):
    for price in range(40, 46):
        _price("Praha", price)
    _catalog(_price("Praha", 35), "Pod Lampou")
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/ceny/praha").content.decode()
    english = client.get("/en/prices/praha").content.decode()
    country = client.get("/ceny").content.decode()

    assert re.search(r'<a href="/hospoda/pod-lampou-\w{8}">Pod Lampou</a>', html)
    assert '<h1 class="np-h1" id="page-title">Kolik stojí pivo v Praze</h1>' in html
    assert re.search(r"<title>Beer prices in Prague \d{4}: median \d+ CZK \| Na pivo</title>", english)
    assert '<h1 class="np-h1" id="page-title">What a beer costs in Prague</h1>' in english
    assert ">Praha<" not in english
    assert 'href="/pivni-index"' in country and 'href="/o-appce#ceny"' in country


def test_the_beer_index_aims_at_the_trend_and_links_the_city_prices(client):
    for price in range(40, 46):
        _price("Brno", price, BRNO)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/pivni-index").content.decode()

    assert "<title>Pivní index Na pivo: cena piva po krajích a v čase | Na pivo</title>" in html
    assert 'href="/ceny"' in html and 'href="/o-appce#ceny"' in html


def test_beer_pages_count_pubs_and_beers_in_czech(client):
    _three_fresh_pubs()
    _second_beer()
    _beer_pub("Na Kopci", [("Testovar 12°", 61, 500)], city="Beroun")
    call_command("snapshot_beer_prices", stdout=StringIO())

    beer = client.get("/pivo/testovar-11").content.decode()
    brand = client.get("/pivo/znacka/testovar").content.decode()

    assert re.search(r">3</span>\s*<span [^>]+>hospody za 3 měsíce<", beer)
    assert re.search(r'<a href="/hospoda/u-lipy-\w{8}">U Lípy</a>', beer)
    flat = re.sub(r"<[^>]+>", " ", brand)
    assert re.search(r"2\s+piva s vlastní stránkou", flat)
    assert "1 hospod" not in flat and re.search(r"\b1\s+hospoda\b", flat)
    assert _head(brand)[1].startswith("Kde se čepuje Testovar: 7 hospod, 2 piva s vlastní stránkou.")


def test_the_about_page_says_who_makes_the_app_in_both_languages(client):
    czech = client.get("/o-appce")
    english = client.get("/en/about")

    html = czech.content.decode()
    assert czech.status_code == english.status_code == 200
    assert "Tomáš Mach" in html and "mailto:tomades1@gmail.com" in html and 'id="ceny"' in html
    assert "apps.apple.com" in html and "play.google.com" in html
    assert "Who makes it" in english.content.decode()
    assert 'href="/o-appce">O appce</a>' in client.get("/ceny").content.decode()
    assert "https://na-pivo.cz/o-appce" in client.get("/sitemap.xml").content.decode()


def test_every_list_names_a_pub_without_its_register_code(client):
    """One cleaner for every place a page names a pub: lists, the cheapest pubs, beer pages, nearby pubs."""

    raw = "P5342 - Pivnice Smíchov, ul.Nádražní"
    for price in range(40, 46):
        _price("Praha", price)
    _catalog(_price("Praha", 35), raw)
    for name in ("U Kalicha", "Na Růžku"):
        _beer_pub(name, [("Testovar 11°", 55, 500)], city="Praha")
    coded = _beer_pub(raw, [("Testovar 11°", 52, 500)], city="Praha")
    call_command("snapshot_beer_prices", stdout=StringIO())

    pages = {
        "city": client.get("/hospody/praha").content.decode(),
        "prices": client.get("/ceny/praha").content.decode(),
        "beer": client.get("/pivo/testovar-11").content.decode(),
        "pub": client.get(f"/hospoda/u-kalicha-{PubDirectory.objects.get(name='U Kalicha').cache_key}").content.decode(),
    }

    for page, html in pages.items():
        assert "Pivnice Smíchov" in html, page
        assert "P5342" not in html.replace(f"p5342-pivnice-smichov-ulnadrazni-{coded}", ""), page
    # The address keeps the stored name, so old links and the app still find the pub.
    assert f'href="/hospoda/p5342-pivnice-smichov-ulnadrazni-{coded}"' in pages["beer"]

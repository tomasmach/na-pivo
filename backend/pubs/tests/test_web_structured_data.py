"""Structured data, share tags and the numbers several public pages repeat."""

from __future__ import annotations

import json
import re
import uuid
from io import StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone

from pubs.beer_catalog import match_beer, sync_pub_beer_indexes_for_menu, without_tank_words
from pubs.beer_pages import build_beer_pages
from pubs.models import (
    BeerBrand,
    BeerPage,
    BeerProduct,
    BeerRanking,
    CanonicalPub,
    PubBeerProduct,
    PubCommunityData,
    PubDirectory,
    PubPriceSnapshot,
    UserAddedPub,
)
from pubs.price_map import build_price_map
from pubs.tests.test_beer_pages import (
    BRATISLAVA,
    catalog,  # noqa: F401  (autouse: the Testovar beers)
)
from pubs.tests.test_beer_pages import _pub as _menu_pub
from pubs.tests.test_price_map import _price as _indexed_price
from pubs.tests.test_web_pubs import ALWAYS, _menu, _pub
from pubs.web import pubs_data

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    pubs_data._built.update(stamp=None, data=None)
    yield
    cache.clear()


def _graph(html: str) -> list[dict]:
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return [node for block in blocks for node in json.loads(block)["@graph"]]


def _node(html: str, kind: str) -> dict:
    return next(node for node in _graph(html) if node["@type"] == kind)


def _get(client, path: str) -> str:
    response = client.get(path)
    assert response.status_code == 200, response.content[:300]
    return response.content.decode()


def test_home_names_the_publisher_every_dataset_points_to(client):
    html = _get(client, "/")

    org = _node(html, "Organization")
    assert org["@id"] == "https://na-pivo.cz/#org"
    assert org["logo"]["width"] >= 112 and org["logo"]["url"] == "https://na-pivo.cz/apple-touch-icon.png"
    assert org["sameAs"] == [
        "https://apps.apple.com/cz/app/id6773790025",
        "https://play.google.com/store/apps/details?id=com.tomasmach.na_pivo",
        "https://www.instagram.com/jsem_mach/",
    ]
    assert _node(html, "WebSite")["publisher"]["@id"] == org["@id"]
    assert _node(html, "MobileApplication")["publisher"]["@id"] == org["@id"]


def test_pub_data_says_only_what_the_page_shows_with_the_real_country(client):
    tiger = _pub()
    _menu(tiger, beers=[
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500},
        {"name": "Kozel 11", "price_czk": 45, "volume_ml": 500},
        {"name": "Překlep", "price_czk": 1, "volume_ml": 500},
    ], hours=ALWAYS)
    bratislava = _pub("Tehelná Pub", lat=48.1486, lng=17.1077, city="Bratislava")
    PubDirectory.objects.filter(pk=bratislava.pk).update(country="sk")
    karpacz = CanonicalPub.objects.create(
        cache_key="u350ye9j", name="Dom Śląski", name_key="dom slaski", lat=50.777, lng=15.756, city="Karpacz",
        country="pl",
    )
    added = UserAddedPub.objects.create(
        client_id=uuid.uuid4(), cache_key="u2fkbjfr", name="Pivnice U Rotundy", lat=50.0866, lng=14.4174, city="Praha 1",
        address="Karoliny Světlé 17",
    )

    html = _get(client, f"/hospoda/u-zlateho-tygra-{tiger.cache_key}")
    place = _node(html, "BarOrPub")
    url = f"https://na-pivo.cz/hospoda/u-zlateho-tygra-{tiger.cache_key}"
    assert place["@id"] == f"{url}#pub" and place["url"] == url
    assert place["hasMap"].startswith("https://www.google.com/maps/dir/?api=1&destination=")
    assert place["address"] == {"@type": "PostalAddress", "addressLocality": "Praha 1", "addressCountry": "CZ"}
    # A 1 Kč typo is neither on the menu nor in the range.
    assert place["priceRange"] == "45–62 Kč" and ">1 Kč<" not in html
    assert {span["closes"] for span in place["openingHoursSpecification"]} == {"23:59"}
    assert '<meta property="og:image:alt" content="U Zlatého tygra, Praha 1">' in html

    slovak = _node(_get(client, f"/hospoda/tehelna-pub-{bratislava.cache_key}"), "BarOrPub")
    assert slovak["address"]["addressCountry"] == "SK"
    polish = _node(_get(client, f"/hospoda/dom-slaski-{karpacz.cache_key}"), "BarOrPub")
    assert polish["address"]["addressCountry"] == "PL" and "priceRange" not in polish
    # Somebody added it in the app without a country, so none is guessed.
    typed = _node(_get(client, f"/hospoda/pivnice-u-rotundy-{added.cache_key}"), "BarOrPub")
    assert typed["address"] == {
        "@type": "PostalAddress", "streetAddress": "Karoliny Světlé 17", "addressLocality": "Praha 1",
    }


def test_beer_price_floor_holds_on_the_page_and_in_its_product_data(client):
    _menu_pub("U Kalicha", [("Testovar 11°", 52, 500)], days_ago=3)
    _menu_pub("Na Růžku", [("Testovar 11", 58, 500)], days_ago=10)
    _menu_pub("U Lípy", [("Testovar 11°", 64, 500)], days_ago=20)
    _menu_pub("U Lva", [("Testovar 11°", 1, 500)], days_ago=2)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = _get(client, "/pivo/testovar-11")
    offers = _node(html, "Product")["offers"]
    data = BeerPage.objects.get(kind=BeerPage.Kind.BEER, key="testovar-11").data
    assert offers["lowPrice"] == data["cheapest"]["price_czk"] == 52
    assert offers["offerCount"] == 3 and data["pubs"] == 4
    assert next(pub for pub in data["listed"] if pub["name"] == "U Lva")["price_czk"] is None


def test_price_map_leaves_out_prices_under_the_floor():
    for price in (5, 48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)

    prague = next(area for area in build_price_map()["cities"] if area["name"] == "Praha")

    assert (prague["pubs"], prague["median"], prague["p25"]) == (5, 56, 52)


def test_ranking_counts_the_pubs_the_beer_page_counts(client):
    for name in ("U Kalicha", "Na Růžku", "U Lípy"):
        _menu_pub(name, [("Testovar 11°", 55, 500)])
    # The app's index also links a pub abroad, which the page leaves out, and a tank spelling it counts too.
    for name, beer, kwargs in (
        ("Tehelná", "Testovar 11°", {"at": BRATISLAVA, "country": "sk"}),
        ("Kozlovna", "Testovar 11 tankové", {}),
    ):
        cache_key = _menu_pub(name, [(beer, 60, 500)], **kwargs)
        menu = PubCommunityData.objects.get(cache_key=cache_key)
        sync_pub_beer_indexes_for_menu(
            cache_key=cache_key, data={"name": name, "lat": menu.lat, "lng": menu.lng}, source="community",
            account=None, beers=menu.beers,
        )
    assert PubBeerProduct.objects.filter(product_key="testovar-11").count() == 2
    call_command("snapshot_beer_prices", stdout=StringIO())
    BeerRanking.objects.create(
        product=BeerProduct.objects.get(key="testovar-11"), rating_avg=4.5, rating_count=60, rank=1,
        computed_at=timezone.now(),
    )

    html = _get(client, "/zebricky")
    assert BeerPage.objects.get(kind=BeerPage.Kind.BEER, key="testovar-11").data["pubs"] == 4
    assert re.search(r"a 3\s+další\s+hospody", html), re.findall(r">[^<>]*další[^<>]*<", html)
    item = _node(html, "ItemList")["itemListElement"][0]
    assert item["url"] == "https://na-pivo.cz/pivo/testovar-11"
    urls = [crumb["item"] for crumb in _node(html, "BreadcrumbList")["itemListElement"]]
    assert len(urls) == len(set(urls))


def test_city_page_repeats_the_prices_page_median_and_has_its_own_share_image(client):
    tiger = _pub()
    _menu(tiger, beers=[{"name": "Pilsner Urquell", "price_czk": 70, "volume_ml": 500}])
    PubPriceSnapshot.objects.create(
        day=timezone.localdate(), computed_at=timezone.now(), og_image_cs=b"", og_image_en=b"",
        data={"country": {"median": 49}, "cities": [
            {"name": "Praha", "median": 56, "p25": 49, "p75": 67, "pubs": 471, "mostly_stale": False,
             "cheapest": [{"name": "U Kalicha", "city": "Praha 2", "price_czk": 20, "volume_ml": 500, "stale": False}]},
        ]},
    )

    html = _get(client, "/hospody/praha")
    assert "Půllitr tu stojí kolem 56 Kč." in html
    image = re.search(r'<meta property="og:image" content="https://na-pivo.cz(/hospody/praha/og\.png\?v=\w+)">', html)
    assert image and '<meta name="twitter:card" content="summary_large_image">' in html
    response = client.get(image.group(1))
    assert response.status_code == 200 and response["Content-Type"] == "image/png"
    assert client.get("/hospody/nikde/og.png").status_code == 404


@pytest.mark.parametrize("path", ["/zebricky", "/novinky", "/trasy", "/hospody"])
def test_shared_pages_carry_full_share_tags(client, path):
    html = _get(client, path)
    for tag in (
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="',
        '<meta name="twitter:card" content="summary_large_image">',
    ):
        assert tag in html


_TANK_SPELLINGS = ["Testovar 11° tankové", "Testovar 11 z tanku", "Tanková Testovar 11", "Testovar 11 (tank)"]


@pytest.mark.parametrize("name", [*_TANK_SPELLINGS, "Testovar 11 nefiltrovaný tank", "Testovar 12 tank", "Testovar tank"])
def test_tank_words_are_the_only_ones_dropped(name):
    plain = without_tank_words(name)
    assert "tank" not in plain
    assert plain.split()[-1] != "z"
    # The app's own index already reads every tank spelling as the beer it is.
    if name in _TANK_SPELLINGS:
        assert match_beer(name, fuzzy=True).product.key == "testovar-11"


def test_beer_page_counts_tank_spellings_once_and_keeps_other_beers_apart():
    brand = BeerBrand.objects.get(key="testovar")
    BeerProduct.objects.create(
        key="testovar-11-nefiltrovany", brand=brand, brand_key=brand.key, brand_name=brand.name,
        name="Testovar 11° nefiltrovaný", aliases=["Testovar 11 nefiltrovaný"], rank=2,
    )
    _menu_pub("U Kalicha", [("Testovar 11°", 52, 500)])
    for index, name in enumerate(_TANK_SPELLINGS):
        _menu_pub(f"Tankovna {index}", [(name, 60 + index, 500)])
    # The bottle and the tank of one pub are one pub, at its cheaper half litre.
    _menu_pub("U Lípy", [("Testovar 11°", 58, 500), ("Testovar 11° tankové", 54, 500)])
    for name in ("Testovar 11 nefiltrovaný tank", "Testovar 11 tmavý", "Testovar 12 tank", "Testovar tank"):
        _menu_pub(f"Jinde {name}", [(name, 50, 500)])
    for name in ("Testovar 12°", "Testovar 11 nefiltrovaný"):
        for index in range(2):
            _menu_pub(f"{name} {index}", [(name, 50, 500)])
    _menu_pub("Tehelná", [("Testovar 11° tankové", 45, 500)], at=BRATISLAVA, country="sk")

    beers = build_beer_pages()["beers"]

    listed = {pub["name"]: pub["price_czk"] for pub in beers["testovar-11"]["listed"]}
    assert set(listed) == {"U Kalicha", "U Lípy", *(f"Tankovna {index}" for index in range(4))}
    assert beers["testovar-11"]["pubs"] == 6 and listed["U Lípy"] == 54
    assert beers["testovar-11"]["cheapest"]["price_czk"] == 52
    # A tank of another degree or of the unfiltered beer counts there; dark and the bare brand count nowhere.
    assert "Jinde Testovar 12 tank" in {pub["name"] for pub in beers["testovar-12"]["listed"]}
    assert "Jinde Testovar 11 nefiltrovaný tank" in {pub["name"] for pub in beers["testovar-11-nefiltrovany"]["listed"]}
    everywhere = {pub["name"] for beer in beers.values() for pub in beer["listed"]}
    assert not {"Jinde Testovar 11 tmavý", "Jinde Testovar tank", "Tehelná"} & everywhere


def test_beer_product_describes_itself_with_the_page_summary(client):
    for name in ("U Kalicha", "Na Růžku", "U Lípy"):
        _menu_pub(name, [("Testovar 11°", 55, 500)])
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = _get(client, "/pivo/testovar-11")

    description = _node(html, "Product")["description"]
    assert description == "Kde se čepuje Testovar 11° a za kolik: 3 hospody s čerstvým zápisem, obvykle 55 Kč za 0,5 l."
    assert f'<meta name="description" content="{description}">' in html


def test_home_share_image_carries_its_version_and_only_that_is_immutable(client):
    html = _get(client, "/")
    path = re.search(r'<meta property="og:image" content="https://na-pivo.cz(/og/home.png\?v=[0-9a-f]{10})">', html).group(1)

    assert "immutable" in client.get(path)["Cache-Control"]
    assert client.get("/og/home.png")["Cache-Control"] == "public, max-age=604800"


def test_rankings_and_news_have_their_own_share_cards(client):
    for rank, key in enumerate(("testovar-11", "testovar-12"), start=1):
        BeerRanking.objects.create(
            product=BeerProduct.objects.get(key=key), rating_avg=4.6 - rank / 10, rating_count=60, rank=rank,
            computed_at=timezone.now(),
        )
    for page, alt in (("/zebricky", "Nejlepší piva v Česku"), ("/novinky", "Co je nového v hospodách")):
        html = _get(client, page)
        image = re.search(rf'<meta property="og:image" content="https://na-pivo.cz({page}/og\.png\?v=\w+)">', html)
        assert image and f'<meta property="og:image:alt" content="{alt}">' in html
        response = client.get(image.group(1))
        assert response.status_code == 200 and response["Content-Type"] == "image/png"
    assert client.get("/en/rankings/og.png")["Content-Type"] == "image/png"


def test_rankings_card_waits_for_a_ranking(client):
    response = client.get("/zebricky/og.png")

    assert response.status_code == 302 and response["Location"].startswith("/og/home.png?v=")


def test_dates_are_machine_readable(client):
    tiger = _pub()
    _menu(tiger)
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())
    today = timezone.localdate().isoformat()

    assert f'<time datetime="{today}">ověřeno dnes</time>' in _get(client, f"/hospoda/u-zlateho-tygra-{tiger.cache_key}")
    assert re.search(rf'Stav k <time datetime="{today}">[^<]+</time>\.', _get(client, "/ceny"))
    UserAddedPub.objects.create(
        client_id=uuid.uuid4(), cache_key="u2fkbjfr", name="Pivnice U Rotundy", lat=50.0866, lng=14.4174, city="Praha 1",
    )
    assert f'<h2 class="pp-day"><time datetime="{today}">Dnes</time></h2>' in _get(client, "/novinky")


def test_area_prices_are_a_table_with_headers(client):
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = _get(client, "/ceny")

    table = re.search(r'<table class="rs-strips" role="table" aria-labelledby="cities-title">.*?</table>', html, re.S).group(0)
    assert re.findall(r'<th scope="col" role="columnheader">([^<]+)</th>', table) == ["Město", "Medián"]
    assert re.search(r'<th class="rs-strip__who" scope="row" role="rowheader"><span class="rs-strip__name name"><a href="/ceny/praha">Praha</a>', table)
    assert "<li" not in table


def test_beer_index_goes_by_one_name_in_its_data(client):
    for price in (48, 52, 56, 60, 64):
        _indexed_price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = _get(client, "/pivni-index")

    assert _node(html, "Dataset")["name"] == "Pivní index Česka"
    assert _node(html, "BreadcrumbList")["itemListElement"][-1]["name"] == "Pivní index Česka"

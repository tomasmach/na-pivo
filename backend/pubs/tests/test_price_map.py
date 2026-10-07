from __future__ import annotations

import json
import re
import uuid
from datetime import timedelta
from io import BytesIO, StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from PIL import Image

from pubs.models import (
    Account,
    CanonicalPub,
    DrinkLog,
    PubAlias,
    PubContributionLog,
    PubDirectory,
    PubHours,
    PubPriceIndex,
    PubPriceSnapshot,
)
from pubs.price_map import build_price_map, city_slug, prague_district

PRAGUE = (50.08, 14.42)
BRNO = (49.19, 16.61)
OSTRAVA = (49.83, 18.28)
BRATISLAVA = (48.14, 17.11)
ZITTAU = (50.896, 14.807)
SLUKNOV = (51.004, 14.452)
TOUR_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; "
    "frame-ancestors 'none'; form-action 'none'"
)

pytestmark = pytest.mark.django_db
_keys = iter(range(10_000))


def _price(
    city: str,
    price: int,
    at: tuple[float, float] = PRAGUE,
    *,
    days_ago: int = 1,
    source: str = PubPriceIndex.Source.COMMUNITY,
    active: bool = True,
    volume_ml: int | None = 500,
    menu_days_ago: int | None = None,
) -> PubPriceIndex:
    """An index row plus the submitted menu that wrote its price, by default as old as the row."""

    row = PubPriceIndex.objects.create(
        cache_key=f"t{next(_keys):07d}",
        name="Hospoda",
        lat=at[0],
        lng=at[1],
        city=city,
        price_czk=price,
        volume_ml=volume_ml,
        observed_at=timezone.now() - timedelta(days=days_ago),
        source=source,
        active=active,
    )
    menu = PubContributionLog.objects.create(
        cache_key=row.cache_key,
        name=row.name,
        lat=row.lat,
        lng=row.lng,
        kind=PubContributionLog.Kind.BEERS,
        payload={"beers": [{"name": "Desítka", "price_czk": price, "volume_ml": volume_ml}]},
        client_id=uuid.uuid4(),
    )
    written = timezone.now() - timedelta(days=days_ago if menu_days_ago is None else menu_days_ago)
    PubContributionLog.objects.filter(pk=menu.pk).update(created_at=written)
    return row


def _drink(
    row: PubPriceIndex,
    price: int,
    volume_ml: int | None = 500,
    days_ago: int = 0,
    shares: bool = True,
    drink_type: str = DrinkLog.DrinkType.BEER,
    pub_name: str | None = None,
) -> None:
    account, _ = Account.objects.get_or_create(
        device_id=f"price-map-drinker-{shares}",
        defaults={"ugc_terms_accepted_at": timezone.now() if shares else None},
    )
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=row.cache_key,
        name=pub_name or PubPriceIndex.objects.get(pk=row.pk).name,
        lat=row.lat,
        lng=row.lng,
        drink_type=drink_type,
        drank_at=timezone.now() - timedelta(days=days_ago),
        beer_name="Jedenáctka",
        price_czk=price,
        volume_ml=volume_ml,
    )


def _rename(row: PubPriceIndex, name: str) -> None:
    """The pub the index row and its menu were written for."""

    PubPriceIndex.objects.filter(pk=row.pk).update(name=name)
    PubContributionLog.objects.filter(cache_key=row.cache_key).update(name=name)


def _catalog(row: PubPriceIndex, name: str, country: str = "cz") -> None:
    pub = PubDirectory.objects.create(
        name=name,
        lat=row.lat,
        lng=row.lng,
        city=row.city,
        country=country,
        venue_kind=PubHours.VenueKind.PUB,
        source="test",
        active=True,
        refreshed_at=timezone.now(),
    )
    PubDirectory.objects.filter(pk=pub.pk).update(cache_key=row.cache_key)
    _rename(row, name)


def test_prague_district_reads_the_number_or_the_named_district():
    assert prague_district("Praha 2") == "Praha 2"
    assert prague_district(" Praha 10 - Strašnice ") == "Praha 10"
    assert prague_district("Praha-Libuš") == "Praha-Libuš"
    assert prague_district("Praha") == ""
    assert prague_district("Praha-východ") == ""
    assert prague_district("Brno-střed") == ""
    assert prague_district("Hlavní město Praha") == ""


def test_cities_and_districts_show_from_five_pubs():
    for index, price in enumerate(range(40, 45)):
        _price("Praha 2 - Vinohrady" if index % 2 else "Praha 2", price)
    for _ in range(4):
        _price("Praha 5", 60)
    for _ in range(4):
        _price("Brno-střed", 45, BRNO)

    data = build_price_map()

    assert data["prague_districts"] == [
        {"name": "Praha 2", "median": 42, "p25": 41, "p75": 43, "pubs": 5, "mostly_stale": False},
    ]
    assert [(city["name"], city["pubs"]) for city in data["cities"]] == [("Praha", 9)]
    assert data["country"]["pubs"] == 13


def test_only_active_czech_prices_from_the_app_within_a_year_count(monkeypatch):
    for _ in range(4):
        _price("Ostrava", 50, OSTRAVA)
    _price("Ostrava", 50, OSTRAVA, source=PubPriceIndex.Source.DRINK, days_ago=300)
    _price("Ostrava", 10, OSTRAVA, active=False)
    _price("Ostrava", 10, OSTRAVA, days_ago=366)
    _price("Ostrava", 10, OSTRAVA, source=PubPriceIndex.Source.EXTERNAL)
    reported = _price("Ostrava", 10, OSTRAVA)
    for _ in range(5):
        _price("Bratislava", 30, BRATISLAVA)
    monkeypatch.setattr(
        "pubs.price_map._globally_reported_pub_cache_keys",
        lambda keys: {reported.cache_key} & keys,
    )

    data = build_price_map()

    assert data["cities"] == [
        {"name": "Ostrava", "median": 50, "p25": 50, "p75": 50, "pubs": 5, "mostly_stale": False, "cheapest": []},
    ]
    assert data["country"]["pubs"] == 5


def test_prices_older_than_three_months_count_but_are_flagged(client):
    for _ in range(3):
        _price("Kolín", 42, (50.03, 15.2), days_ago=200)
    for _ in range(2):
        _price("Kolín", 46, (50.03, 15.2))
    _catalog(_price("Beroun", 33, (49.96, 14.07), days_ago=150), "U Berounky")

    data = build_price_map()

    [kolin] = data["cities"]
    assert (kolin["pubs"], kolin["mostly_stale"]) == (5, True)
    assert data["country"]["mostly_stale"] is True
    assert data["cheapest"][0] == {
        "name": "U Berounky", "city": "Beroun", "price_czk": 33, "volume_ml": 500, "stale": True,
    }

    call_command("snapshot_beer_prices", stdout=StringIO())
    html = client.get("/ceny").content.decode()

    assert "hlavně ceny starší 3\u00a0měsíců" in html and "cena starší 3\u00a0měsíců" in html


def test_an_old_cheapest_price_needs_its_own_write_within_a_year():
    row = _price("Praha 4", 39, menu_days_ago=400)
    _catalog(row, "U Starého ceníku")
    # Someone drank another beer there today: the index moved, the 39 Kč did not.
    _drink(row, 55)
    # The offline queue delivered today a 39 Kč beer drunk more than a year ago.
    _drink(row, 39, days_ago=400)
    # This drinker never agreed to share anything, so the drink stays private.
    _drink(row, 39, shares=False)
    # A 39 Kč lemonade, and a 39 Kč beer at another business in the same cell.
    _drink(row, 39, drink_type=DrinkLog.DrinkType.SOFT_DRINK)
    _drink(row, 39, pub_name="Kebab Express")

    assert build_price_map()["cheapest"] == []

    _drink(row, 39, days_ago=120)

    assert [(pub["name"], pub["stale"]) for pub in build_price_map()["cheapest"]] == [
        ("U Starého ceníku", True),
    ]

    _drink(row, 39)

    assert [(pub["name"], pub["stale"]) for pub in build_price_map()["cheapest"]] == [
        ("U Starého ceníku", False),
    ]


def test_a_price_is_named_only_after_the_pub_it_belongs_to():
    row = _price("Praha 3", 35)
    _catalog(row, "Bar Modrá laguna")
    # Another business in the same geohash cell wrote this price.
    _rename(row, "Pivovar U Medvěda")

    assert build_price_map()["cheapest"] == []


def test_a_merged_duplicate_counts_as_one_pub():
    for price in (40, 40, 60):
        _price("Plzeň", price, (49.74, 13.37))
    # A late offline drink moved this row's observed_at, but its 44 Kč was written five days ago.
    canonical = _price("Plzeň", 44, (49.74, 13.37), days_ago=0, menu_days_ago=5)
    duplicate = _price("Plzeň", 48, (49.74, 13.37))
    pub = CanonicalPub.objects.create(
        cache_key=canonical.cache_key, name="U Salzmannů", name_key="u salzmannu",
        lat=49.74, lng=13.37, city="Plzeň", country="cz",
    )
    PubAlias.objects.create(
        canonical_pub=pub, cache_key=duplicate.cache_key, name="Salzmann",
        name_key="salzmann", lat=49.74, lng=13.37,
    )

    data = build_price_map()

    assert data["cities"] == [] and data["country"] is None

    _price("Plzeň", 60, (49.74, 13.37))
    [plzen] = build_price_map()["cities"]

    # The merged pub sits in the middle: its newest price, 48 Kč, is the median.
    assert (plzen["pubs"], plzen["median"]) == (5, 48)


def test_a_merged_duplicate_keeps_its_price_under_the_merged_name():
    canonical = _price("Plzeň", 60, (49.74, 13.37))
    pub = CanonicalPub.objects.create(
        cache_key=canonical.cache_key, name="U Salzmannů", name_key="u salzmannu",
        lat=49.74, lng=13.37, city="Plzeň", country="cz",
    )
    duplicate = _price("Plzeň", 35, (49.74, 13.37), days_ago=0)
    _rename(duplicate, "Pivnice Na Rohu")
    PubAlias.objects.create(
        canonical_pub=pub, cache_key=duplicate.cache_key, name="Pivnice Na Rohu",
        name_key="pivnice na rohu", lat=49.74, lng=13.37,
    )

    assert build_price_map()["cheapest"] == [
        {"name": "U Salzmannů", "city": "Plzeň", "price_czk": 35, "volume_ml": 500, "stale": False},
    ]


def test_the_catalogue_country_beats_the_coverage_polygon():
    _catalog(_price("Zittau", 40, ZITTAU), "Zum Bier", country="de")
    _catalog(_price("Šluknov", 41, SLUKNOV), "U Hranice")

    assert [pub["name"] for pub in build_price_map()["cheapest"]] == ["U Hranice"]


def test_cheapest_pubs_are_named_only_from_the_catalogue_per_half_litre():
    _catalog(_price("Praha 7 - Holešovice", 36, volume_ml=None), "U Lacina")
    _catalog(_price("Brno-střed", 30, BRNO, volume_ml=400), "Pod Špilberkem")
    _catalog(_price("Praha", 12), "Překlep")
    _price("Praha", 25)

    assert build_price_map()["cheapest"] == [
        {"name": "U Lacina", "city": "Praha 7", "price_czk": 36, "volume_ml": 500, "stale": False},
        {"name": "Pod Špilberkem", "city": "Brno", "price_czk": 30, "volume_ml": 400, "stale": False},
    ]
    assert build_price_map()["country"] is None


def test_prague_districts_are_listed_by_number():
    for district in ("Praha-Libuš", "Praha 10", "Praha 2"):
        for _ in range(5 if district != "Praha 2" else 8):
            _price(district, 50)

    names = [area["name"] for area in build_price_map()["prague_districts"]]

    assert names == ["Praha 2", "Praha 10", "Praha-Libuš"]


def test_snapshot_is_computed_once_a_day():
    for _ in range(5):
        _price("Praha", 50)

    out = StringIO()
    call_command("snapshot_beer_prices", stdout=out)
    call_command("snapshot_beer_prices", stdout=out)
    _price("Praha", 50)
    call_command("snapshot_beer_prices", "--force", stdout=out)

    assert PubPriceSnapshot.objects.count() == 1
    assert "already computed" in out.getvalue()
    assert PubPriceSnapshot.objects.get().data["cities"][0]["pubs"] == 6


def test_price_page_serves_the_snapshot_without_external_resources(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    for price in range(40, 55):
        _price("Praha 2", price)
    _catalog(_price("Praha 7", 33), "U Lacina")
    call_command("snapshot_beer_prices", stdout=StringIO())
    day = timezone.localdate().isoformat()

    response = client.get("/ceny", HTTP_ACCEPT_LANGUAGE="en")

    assert response.status_code == 200
    assert response["Content-Language"] == "cs"
    assert response["Content-Security-Policy"] == TOUR_CSP
    assert response["Cache-Control"] == "public, max-age=600"
    html = response.content.decode()
    assert "Kolik stojí pivo v hospodě" in html
    assert '<th scope="row">Praha 2</th>' in html
    assert "U Lacina" in html
    assert f'content="https://na-pivo.cz/ceny/og.png?v={day}"' in html
    # Structured data is the only script block, and browsers never run it.
    assert not re.search(r'<script(?! type="application/ld\+json")', html) and " src=" not in html
    assert not re.search(r'<link rel="(stylesheet|preload|icon)', html)

    english = client.get("/en/prices").content.decode()
    assert "What a beer costs in Czech pubs" in english
    assert "Kolik stojí" not in english


def _structured_data(html: str) -> dict:
    block = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return {item["@type"]: item for item in json.loads(block.group(1))["@graph"]}


def test_price_page_tells_search_engines_the_year_the_median_and_the_dataset(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    for price in range(40, 55):
        _price("Praha 2", price)
    call_command("snapshot_beer_prices", stdout=StringIO())
    today = timezone.localdate()

    html = client.get("/ceny").content.decode()

    assert f"<title>Cena piva {today.year}: kolik stojí pivo v hospodě | Na pivo</title>" in html
    assert 'content="Medián ceny piva v českých hospodách je 47 Kč.' in html
    data = _structured_data(html)
    assert [crumb["item"] for crumb in data["BreadcrumbList"]["itemListElement"]] == [
        "https://na-pivo.cz/",
        "https://na-pivo.cz/ceny",
    ]
    assert data["Dataset"]["dateModified"] == today.isoformat()
    assert data["Dataset"]["temporalCoverage"] == f"{today - timedelta(days=365)}/{today}"

    english = client.get("/en/prices").content.decode()
    assert f"<title>Beer prices {today.year}: what a beer costs in Czech pubs | Na pivo</title>" in english
    assert "The median beer price in Czech pubs is 47 CZK." in english
    assert _structured_data(english)["Dataset"]["description"].startswith("From each pub I take")
    assert _structured_data(english)["BreadcrumbList"]["itemListElement"][0]["item"] == "https://na-pivo.cz/en"
    assert f"<loc>https://na-pivo.cz/ceny</loc>\n  <lastmod>{today}</lastmod>" in client.get("/sitemap.xml").content.decode()


def test_price_page_without_numbers_has_no_dataset(client):
    html = client.get("/ceny").content.decode()

    assert "<title>Kolik stojí pivo v hospodě | Na pivo</title>" in html
    assert "Dataset" not in _structured_data(html)


def test_share_images_have_preview_dimensions(client):
    for _ in range(15):
        _price("Brno", 48, BRNO)
    call_command("snapshot_beer_prices", stdout=StringIO())

    for path in ("/ceny/og.png", "/en/prices/og.png"):
        response = client.get(path)
        assert response.status_code == 200
        assert response["Content-Type"] == "image/png"
        assert Image.open(BytesIO(response.content)).size == (1200, 630)


def test_country_median_shows_before_any_city_has_five_pubs(client):
    for city in ("Kolín", "Beroun"):
        for _ in range(3):
            _price(city, 44, (50.03, 15.2))
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/ceny").content.decode()

    assert "Celá ČR" in html and "zatím málo cen" in html
    assert 'id="cities-title"' not in html


def test_page_without_snapshot_says_it_has_few_prices(client):
    response = client.get("/ceny")

    assert response.status_code == 200
    assert "Zatím mám málo cen." in response.content.decode()
    assert client.get("/ceny/og.png").status_code == 404


def test_price_page_has_its_own_throttle(client, monkeypatch):
    from pubs.api.throttling import SharedScopedRateThrottle

    rates = {}

    def rate(throttle):
        rates[throttle.scope] = True
        return "1/min"

    monkeypatch.setattr(SharedScopedRateThrottle, "get_rate", rate)

    assert client.get("/ceny").status_code == 200
    limited = client.get("/ceny")

    assert rates == {"price_map": True}
    assert limited.status_code == 429
    assert limited["Cache-Control"] == "no-store"
    assert int(limited["Retry-After"]) >= 1
    assert "Ceny se teď nedotáhly. Zkus to za minutu." in limited.content.decode()


def test_the_official_name_of_prague_counts_as_praha():
    for _ in range(3):
        _price("Hlavní město Praha", 50)
    for _ in range(2):
        _price("Praha", 60)

    data = build_price_map()

    assert [(city["name"], city["pubs"]) for city in data["cities"]] == [("Praha", 5)]
    assert data["prague_districts"] == []


def test_each_city_keeps_its_own_cheapest_pubs():
    _catalog(_price("Brno-střed", 41, BRNO), "Pod Špilberkem")
    _catalog(_price("Brno-sever", 38, BRNO), "U Bláhovky")
    for _ in range(3):
        _price("Brno", 50, BRNO)
    _catalog(_price("Praha 2", 30), "U Lacina")

    brno = build_price_map()["cities"][0]

    assert brno["name"] == "Brno"
    assert [(pub["name"], pub["price_czk"]) for pub in brno["cheapest"]] == [
        ("U Bláhovky", 38),
        ("Pod Špilberkem", 41),
    ]


def test_city_addresses_drop_diacritics_and_spaces():
    assert city_slug("Praha") == "praha"
    assert city_slug("České Budějovice") == "ceske-budejovice"
    assert city_slug("Brandýs nad Labem-Stará Boleslav") == "brandys-nad-labem-stara-boleslav"


def _city_snapshot() -> None:
    for price in range(40, 46):
        _price("Brno", price, BRNO)
    _catalog(_price("Brno-střed", 35, BRNO), "Pod Špilberkem")
    for price in range(50, 56):
        _price("Praha 2", price)
    _catalog(_price("Praha 7", 33), "U Lacina")
    call_command("snapshot_beer_prices", stdout=StringIO())


def test_city_page_shows_the_city_beside_the_country_and_its_cheapest_pubs(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _city_snapshot()
    today = timezone.localdate()

    response = client.get("/ceny/brno")

    assert response.status_code == 200
    assert response["Content-Security-Policy"] == TOUR_CSP
    html = response.content.decode()
    assert "<h1>Kolik stojí pivo: Brno</h1>" in html
    assert f"<title>Cena piva Brno {today.year}: medián 42 Kč | Na pivo</title>" in html
    assert 'content="Brno: medián ceny piva v hospodě je 42 Kč a polovina hospod má nejlevnější pivo mezi 41 a 44 Kč.' in html
    assert "z 7 hospod" in html
    assert "<dt>Brno</dt>" in html and "<dt>Celá ČR</dt>" in html
    assert "Pod Špilberkem" in html and "U Lacina" not in html
    assert "Praha podle městských částí" not in html
    assert '<link rel="canonical" href="https://na-pivo.cz/ceny/brno">' in html
    assert '<link rel="alternate" hreflang="en" href="https://na-pivo.cz/en/prices/brno">' in html
    assert 'class="all-cities" href="/ceny"' in html
    assert '<a class="crumb" href="/ceny">Ceny piva</a>' in html
    assert "Hospody od nejlevnější" in html
    crumbs = _structured_data(html)["BreadcrumbList"]["itemListElement"]
    assert [(crumb["name"], crumb["item"]) for crumb in crumbs] == [
        ("Na pivo", "https://na-pivo.cz/"),
        ("Ceny piva", "https://na-pivo.cz/ceny"),
        ("Brno", "https://na-pivo.cz/ceny/brno"),
    ]

    english = client.get("/en/prices/brno").content.decode()
    assert "<h1>What a beer costs in Brno</h1>" in english
    assert f"<title>Beer prices in Brno {today.year}: median 42 CZK | Na pivo</title>" in english
    assert "from 7 pubs" in english


def test_prague_page_lists_its_districts(client):
    _city_snapshot()

    html = client.get("/ceny/praha").content.decode()

    assert "Praha podle městských částí" in html
    # Within Prague the district tells the pubs apart.
    assert '<span class="city">Praha 7</span>' in html


def test_country_page_links_every_city_and_the_sitemap_lists_them(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _city_snapshot()

    assert '<a href="/ceny/brno">Brno</a>' in client.get("/ceny").content.decode()
    assert '<a href="/en/prices/praha">Praha</a>' in client.get("/en/prices").content.decode()
    sitemap = client.get("/sitemap.xml").content.decode()
    assert "<loc>https://na-pivo.cz/ceny/brno</loc>" in sitemap
    assert "<loc>https://na-pivo.cz/en/prices/praha</loc>" in sitemap


def test_city_without_enough_prices_has_no_page_but_leads_to_the_others(client):
    _city_snapshot()

    response = client.get("/ceny/ostrava")

    assert response.status_code == 404
    html = response.content.decode()
    assert "Zatím mám málo cen." in html
    assert 'class="all-cities" href="/ceny"' in html
    assert "Dataset" not in html
    assert client.get("/en/prices/ostrava").status_code == 404

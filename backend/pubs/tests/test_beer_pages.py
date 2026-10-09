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

from pubs.beer_pages import build_beer_pages
from pubs.models import (
    Account,
    BeerBrand,
    BeerPage,
    BeerProduct,
    CanonicalPub,
    DrinkLog,
    PubAlias,
    PubCommunityData,
    PubContributionLog,
    PubDirectory,
    PubHours,
)

PRAGUE = (50.08, 14.42)
BRATISLAVA = (48.14, 17.11)
PAGE_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; "
    "script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)

pytestmark = pytest.mark.django_db
_cells = iter(range(10_000))


@pytest.fixture(autouse=True)
def catalog():
    brand = BeerBrand.objects.create(key="testovar", name="Testovar", rank=1)
    for key, name, aliases in (
        ("testovar-11", "Testovar 11°", ["Testovar 11"]),
        ("testovar-12", "Testovar 12°", []),
    ):
        BeerProduct.objects.create(
            key=key, brand=brand, brand_key=brand.key, brand_name=brand.name, name=name, aliases=aliases, rank=1
        )


def _pub(
    name: str,
    beers: list[tuple[str, int | None, int | None]] | None = None,
    *,
    city: str = "Praha 2",
    days_ago: int = 1,
    at: tuple[float, float] = PRAGUE,
    country: str = "cz",
    rotates: bool = False,
) -> str:
    """A catalogue pub whose menu someone submitted ``days_ago``."""

    index = next(_cells)
    lat, lng = at[0] + index * 0.0007, at[1]
    directory = PubDirectory.objects.create(
        name=name,
        lat=lat,
        lng=lng,
        city=city,
        country=country,
        venue_kind=PubHours.VenueKind.PUB,
        source="test",
        active=True,
        refreshed_at=timezone.now(),
    )
    menu = [
        {"name": beer, "price_czk": price, "volume_ml": volume}
        for beer, price, volume in (beers or [("Testovar 11°", 55, 500)])
    ]
    written = timezone.now() - timedelta(days=days_ago)
    PubCommunityData.objects.create(
        cache_key=directory.cache_key,
        name=name,
        lat=lat,
        lng=lng,
        city=city,
        beers=menu,
        beers_updated_at=written,
        beer_menu_rotates=rotates,
    )
    log = PubContributionLog.objects.create(
        cache_key=directory.cache_key,
        name=name,
        lat=lat,
        lng=lng,
        kind=PubContributionLog.Kind.BEERS,
        payload={"beers": menu},
        client_id=uuid.uuid4(),
    )
    PubContributionLog.objects.filter(pk=log.pk).update(created_at=written)
    return directory.cache_key


def _drink(cache_key: str, *, beer: str = "Testovar 11°", price: int | None = 55, days_ago: int = 0, **account) -> None:
    menu = PubCommunityData.objects.get(cache_key=cache_key)
    owner = Account.objects.create(
        device_id=f"beer-pages-{uuid.uuid4()}",
        ugc_terms_accepted_at=account.pop("ugc_terms_accepted_at", timezone.now()),
        **account,
    )
    DrinkLog.objects.create(
        account=owner,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name=menu.name,
        lat=menu.lat,
        lng=menu.lng,
        drink_type=DrinkLog.DrinkType.BEER,
        drank_at=timezone.now() - timedelta(days=days_ago),
        beer_name=beer,
        price_czk=price,
        volume_ml=500,
    )


def _three_fresh_pubs() -> None:
    _pub("U Kalicha", [("Testovar 11°", 52, 500)], days_ago=3)
    _pub("Na Růžku", [("Testovar 11", 58, 500)], city="Brno", days_ago=10)
    _pub("U Lípy", [("testovar 11.", 64, 500)], city="Praha 7 - Holešovice", days_ago=40)


def test_a_beer_gets_its_page_from_three_pubs_confirmed_within_three_months():
    _pub("U Kalicha", days_ago=3)
    _pub("Na Růžku", days_ago=89)
    _pub("U Lípy", days_ago=120)

    assert build_beer_pages()["beers"] == {}

    _pub("Pod Věží", days_ago=60)
    beer = build_beer_pages()["beers"]["testovar-11"]

    assert beer["pubs"] == 3
    # Newest first; the one confirmed four months ago is still listed, marked as old.
    assert [pub["name"] for pub in beer["listed"]] == ["U Kalicha", "Pod Věží", "Na Růžku", "U Lípy"]
    assert [pub["fresh"] for pub in beer["listed"]] == [True, True, True, False]


def test_spellings_of_one_beer_are_one_page_with_prices_cities_and_dates():
    _three_fresh_pubs()
    _pub("Hospoda Rok", days_ago=400)

    beer = build_beer_pages()["beers"]["testovar-11"]

    assert beer["listed"][0] == {
        "name": "U Kalicha",
        "city": "Praha 2",
        "price_czk": 52,
        "volume_ml": 500,
        "confirmed": timezone.localdate(timezone.now() - timedelta(days=3)).isoformat(),
        "fresh": True,
        "rotates": False,
    }
    assert [pub["city"] for pub in beer["listed"]] == ["Praha 2", "Brno", "Praha 7"]
    assert (beer["median"], beer["p25"], beer["p75"]) == (58, 55, 61)
    assert beer["cheapest"] == {"name": "U Kalicha", "city": "Praha 2", "price_czk": 52}


def test_a_drink_confirms_its_own_beer_but_only_as_the_menu_would_publish_it():
    _three_fresh_pubs()
    old = _pub("Stará Hospoda", [("Testovar 11°", 50, 500), ("Testovar 12°", 60, 500)], days_ago=200)

    _drink(old, days_ago=2, ghost_mode=True)
    _drink(old, days_ago=2, ugc_terms_accepted_at=None)
    _drink(old, days_ago=2, price=None)
    listed = build_beer_pages()["beers"]["testovar-11"]["listed"]
    assert listed[-1]["name"] == "Stará Hospoda" and not listed[-1]["fresh"]

    _drink(old, days_ago=5)
    pages = build_beer_pages()["beers"]
    listed = pages["testovar-11"]["listed"]
    assert listed[1]["name"] == "Stará Hospoda" and listed[1]["fresh"]
    # The other beer on the same menu was not confirmed by that drink.
    assert "testovar-12" not in pages


def test_only_beers_on_the_current_menu_of_the_same_pub_are_listed():
    _three_fresh_pubs()
    gone = _pub("Bez Testovaru", [("Testovar 12°", 60, 500)], days_ago=1)
    _drink(gone, days_ago=0)
    other = _pub("Hospoda Pod Mostem", days_ago=300)
    PubContributionLog.objects.filter(cache_key=other).update(name="Kebab u mostu", created_at=timezone.now())

    names = [pub["name"] for pub in build_beer_pages()["beers"]["testovar-11"]["listed"]]

    assert "Bez Testovaru" not in names
    # A newer write for another business in the same cell confirms nothing here.
    assert "Hospoda Pod Mostem" not in names


def test_a_merged_duplicate_is_one_pub_under_the_merged_name():
    _pub("U Kalicha", days_ago=3)
    _pub("Na Růžku", days_ago=10)
    target = _pub("U Lípy", days_ago=50)
    duplicate = _pub("U Lipy", days_ago=4)
    canonical = CanonicalPub.objects.create(
        cache_key=target, name="U Lípy", name_key="u lipy", lat=PRAGUE[0], lng=PRAGUE[1], city="Praha 2", country="cz",
    )
    PubAlias.objects.create(
        canonical_pub=canonical, cache_key=duplicate, name="U Lipy", name_key="u lipy", lat=PRAGUE[0], lng=PRAGUE[1],
    )

    beer = build_beer_pages()["beers"]["testovar-11"]

    assert beer["pubs"] == 3
    assert [pub["name"] for pub in beer["listed"]] == ["U Kalicha", "U Lípy", "Na Růžku"]


def test_pubs_outside_czechia_stay_out():
    _pub("U Kalicha", days_ago=3)
    _pub("Na Růžku", days_ago=10)
    _pub("Krčma", at=BRATISLAVA, country="sk", city="Bratislava", days_ago=2)

    assert build_beer_pages()["beers"] == {}


def test_beer_page_shows_pubs_prices_and_dates_without_anyone_who_wrote_them(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _three_fresh_pubs()
    _pub("Pivotéka", [("Testovar 11°", None, 500)], days_ago=120, rotates=True)
    _drink(PubCommunityData.objects.get(name="U Lípy").cache_key, days_ago=1, nickname="tajny_pijak")
    call_command("snapshot_beer_prices", stdout=StringIO())
    day = timezone.localdate().isoformat()

    response = client.get("/pivo/testovar-11")

    assert response.status_code == 200
    assert response["Content-Security-Policy"] == PAGE_CSP
    assert response["Cache-Control"] == "public, max-age=600"
    html = response.content.decode()
    assert "<title>Testovar 11°: kde se čepuje a za kolik | Na pivo</title>" in html
    assert '<h1 id="page-title">Kde se čepuje Testovar 11°</h1>' in html
    assert '<span class="name">U Lípy</span><span class="sub">Praha 7</span>' in html
    assert "pípy se tu střídají" in html and "cena chybí" in html and "starší 3 měsíců" in html
    assert html.index("U Lípy</span>") < html.index("U Kalicha</span>") < html.index("Pivotéka</span>")
    assert "tajny_pijak" not in html
    assert f'content="https://na-pivo.cz/pivo/testovar-11/og.png?v={day}"' in html
    assert 'href="/pivo/znacka/testovar"' in html
    assert 'href="https://na-pivo.cz/en/beer/testovar-11"' in html
    assert "ct=web-beer" in html and "utm_campaign%3Dbeer" in html
    urls = re.findall(r'<(?:link|script|img)\b[^>]*?\s(?:src|href)="([^"]+)"', html)
    assert urls and all(re.match(r"/(?!/)|https://na-pivo\.cz/", url) for url in urls)
    data = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html).group(1))
    product = next(item for item in data["@graph"] if item["@type"] == "Product")
    assert product["offers"] == {
        "@type": "AggregateOffer", "priceCurrency": "CZK", "lowPrice": 52, "highPrice": 64, "offerCount": 3,
    }
    crumbs = [crumb["name"] for crumb in data["@graph"][0]["itemListElement"]]
    assert crumbs == ["Na pivo", "Piva", "Testovar", "Testovar 11°"]
    # Nothing about who wrote what is stored for the page either.
    assert "tajny_pijak" not in json.dumps(BeerPage.objects.get(kind=BeerPage.Kind.BEER).data)

    english = client.get("/en/beer/testovar-11").content.decode()
    assert "Where Testovar 11° is on tap" in english
    assert "Kde se čepuje" not in english


def test_beer_under_the_threshold_has_no_page_but_leads_to_the_others(client):
    _three_fresh_pubs()
    _pub("U Kalicha 2", [("Testovar 12°", 60, 500)])
    call_command("snapshot_beer_prices", stdout=StringIO())

    for url in ("/pivo/testovar-12", "/pivo/neznam-tohle", "/en/beer/testovar-12"):
        response = client.get(url)
        assert response.status_code == 404
        assert 'class="all-beers" href="/' in response.content.decode()
    html = client.get("/pivo/testovar-12").content.decode()
    assert '<h1 id="page-title">Testovar 12°</h1>' in html
    assert "Tohle pivo tu teď nemám." in html
    assert 'rel="canonical"' not in html


def test_brand_page_gathers_its_beers_and_the_list_links_them_all(client):
    _three_fresh_pubs()
    call_command("snapshot_beer_prices", stdout=StringIO())

    brand = client.get("/pivo/znacka/testovar")
    listing = client.get("/pivo")

    assert brand.status_code == 200 and listing.status_code == 200
    assert '<a href="/pivo/testovar-11">Testovar 11°</a>' in brand.content.decode()
    assert "3 hospody" in brand.content.decode()
    assert '<a href="/pivo/testovar-11">Testovar 11°</a>' in listing.content.decode()
    assert 'href="/pivo/znacka/testovar"' in listing.content.decode()
    assert client.get("/pivo/znacka/neznam").status_code == 404
    assert client.get("/en/beer/brand/testovar").status_code == 200
    # The home and price pages lead here.
    assert 'href="/pivo"' in client.get("/").content.decode()
    assert 'href="/en/beer"' in client.get("/en/prices").content.decode()


def test_the_list_page_exists_before_any_beer_has_a_page(client):
    call_command("snapshot_beer_prices", stdout=StringIO())

    response = client.get("/pivo")

    assert response.status_code == 200
    assert "Zatím nemám dost lístků." in response.content.decode()


def test_beer_pages_are_computed_once_a_day():
    _three_fresh_pubs()
    out = StringIO()
    call_command("snapshot_beer_prices", stdout=out)
    for name in ("Pod Věží", "Na Hrázi", "U Mlýna"):
        _pub(name, [("Testovar 12°", 60, 500)])
    call_command("snapshot_beer_prices", stdout=out)

    assert "beer pages" in out.getvalue() and "already computed" in out.getvalue()
    assert not BeerPage.objects.filter(key="testovar-12").exists()

    call_command("snapshot_beer_prices", "--force", stdout=out)
    assert BeerPage.objects.filter(kind=BeerPage.Kind.BEER, key="testovar-12").exists()


def test_sitemap_lists_every_beer_page_in_both_languages(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _three_fresh_pubs()
    call_command("snapshot_beer_prices", stdout=StringIO())

    xml = client.get("/sitemap.xml").content.decode()

    for url in (
        "https://na-pivo.cz/pivo",
        "https://na-pivo.cz/en/beer",
        "https://na-pivo.cz/pivo/testovar-11",
        "https://na-pivo.cz/en/beer/testovar-11",
        "https://na-pivo.cz/pivo/znacka/testovar",
        "https://na-pivo.cz/en/beer/brand/testovar",
    ):
        assert f"<loc>{url}</loc>" in xml


def test_share_images_have_preview_dimensions(client):
    _three_fresh_pubs()
    call_command("snapshot_beer_prices", stdout=StringIO())

    for url in ("/pivo/og.png", "/pivo/testovar-11/og.png", "/en/beer/brand/testovar/og.png"):
        response = client.get(url)
        assert response.status_code == 200
        assert Image.open(BytesIO(response.content)).size == (1200, 630)
    assert client.get("/pivo/testovar-12/og.png").status_code == 404


def test_beer_pages_share_the_price_page_throttle(client, monkeypatch):
    from pubs.api.throttling import SharedScopedRateThrottle

    scopes = set()

    def rate(throttle):
        scopes.add(throttle.scope)
        return "1/min"

    monkeypatch.setattr(SharedScopedRateThrottle, "get_rate", rate)

    assert client.get("/pivo").status_code == 200
    limited = client.get("/pivo/testovar-11")

    assert scopes == {"price_map"}
    assert limited.status_code == 429
    assert limited["Cache-Control"] == "no-store"
    assert "Piva se teď nedotáhla. Zkus to za minutu." in limited.content.decode()
    assert client.get("/ceny").status_code == 429

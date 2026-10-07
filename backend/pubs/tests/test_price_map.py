from __future__ import annotations

import re
from datetime import timedelta
from io import BytesIO, StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone
from PIL import Image

from pubs.models import PubDirectory, PubHours, PubPriceIndex, PubPriceSnapshot
from pubs.price_map import build_price_map, prague_district

PRAGUE = (50.08, 14.42)
BRNO = (49.19, 16.61)
OSTRAVA = (49.83, 18.28)
BRATISLAVA = (48.14, 17.11)
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
) -> PubPriceIndex:
    return PubPriceIndex.objects.create(
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


def _catalog(row: PubPriceIndex, name: str) -> None:
    pub = PubDirectory.objects.create(
        name=name,
        lat=row.lat,
        lng=row.lng,
        city=row.city,
        country="cz",
        venue_kind=PubHours.VenueKind.PUB,
        source="test",
        active=True,
        refreshed_at=timezone.now(),
    )
    PubDirectory.objects.filter(pk=pub.pk).update(cache_key=row.cache_key)


def test_prague_district_reads_the_number_or_the_named_district():
    assert prague_district("Praha 2") == "Praha 2"
    assert prague_district(" Praha 10 - Strašnice ") == "Praha 10"
    assert prague_district("Praha-Libuš") == "Praha-Libuš"
    assert prague_district("Praha") == ""
    assert prague_district("Praha-východ") == ""
    assert prague_district("Brno-střed") == ""


def test_cities_and_districts_show_from_fifteen_pubs():
    for index, price in enumerate(range(40, 55)):
        _price("Praha 2 - Vinohrady" if index % 2 else "Praha 2", price)
    for _ in range(14):
        _price("Praha 5", 60)
    for _ in range(14):
        _price("Brno-střed", 45, BRNO)

    data = build_price_map()

    assert data["prague_districts"] == [
        {"name": "Praha 2", "median": 47, "p25": 44, "p75": 51, "pubs": 15},
    ]
    assert [(city["name"], city["pubs"]) for city in data["cities"]] == [("Praha", 29)]
    assert data["country"]["pubs"] == 43


def test_only_fresh_active_czech_prices_from_the_app_count(monkeypatch):
    kept = [_price("Ostrava", 50, OSTRAVA) for _ in range(14)]
    kept.append(_price("Ostrava", 50, OSTRAVA, source=PubPriceIndex.Source.DRINK, days_ago=89))
    _price("Ostrava", 10, OSTRAVA, active=False)
    _price("Ostrava", 10, OSTRAVA, days_ago=91)
    _price("Ostrava", 10, OSTRAVA, source=PubPriceIndex.Source.EXTERNAL)
    reported = _price("Ostrava", 10, OSTRAVA)
    for _ in range(15):
        _price("Bratislava", 30, BRATISLAVA)
    monkeypatch.setattr(
        "pubs.price_map._globally_reported_pub_cache_keys",
        lambda keys: {reported.cache_key} & keys,
    )

    data = build_price_map()

    assert data["cities"] == [{"name": "Ostrava", "median": 50, "p25": 50, "p75": 50, "pubs": 15}]
    assert data["country"]["pubs"] == 15


def test_cheapest_pubs_are_named_only_from_the_catalogue_per_half_litre():
    _catalog(_price("Praha 7 - Holešovice", 36, volume_ml=None), "U Lacina")
    _catalog(_price("Brno-střed", 30, BRNO, volume_ml=400), "Pod Špilberkem")
    _catalog(_price("Praha", 12), "Překlep")
    _price("Praha", 25)

    assert build_price_map()["cheapest"] == [
        {"name": "U Lacina", "city": "Praha 7", "price_czk": 36, "volume_ml": 500},
        {"name": "Pod Špilberkem", "city": "Brno", "price_czk": 30, "volume_ml": 400},
    ]
    assert build_price_map()["country"] is None


def test_prague_districts_are_listed_by_number():
    for district in ("Praha-Libuš", "Praha 10", "Praha 2"):
        for _ in range(15 if district != "Praha 2" else 20):
            _price(district, 50)

    names = [area["name"] for area in build_price_map()["prague_districts"]]

    assert names == ["Praha 2", "Praha 10", "Praha-Libuš"]


def test_snapshot_is_computed_once_a_day():
    for _ in range(15):
        _price("Praha", 50)

    out = StringIO()
    call_command("snapshot_beer_prices", stdout=out)
    call_command("snapshot_beer_prices", stdout=out)
    _price("Praha", 50)
    call_command("snapshot_beer_prices", "--force", stdout=out)

    assert PubPriceSnapshot.objects.count() == 1
    assert "already computed" in out.getvalue()
    assert PubPriceSnapshot.objects.get().data["cities"][0]["pubs"] == 16


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
    assert "<script" not in html and " src=" not in html
    assert not re.search(r'<link rel="(stylesheet|preload|icon)', html)

    english = client.get("/en/prices").content.decode()
    assert "What a beer costs in Czech pubs" in english
    assert "Kolik stojí" not in english


def test_share_images_have_preview_dimensions(client):
    for _ in range(15):
        _price("Brno", 48, BRNO)
    call_command("snapshot_beer_prices", stdout=StringIO())

    for path in ("/ceny/og.png", "/en/prices/og.png"):
        response = client.get(path)
        assert response.status_code == 200
        assert response["Content-Type"] == "image/png"
        assert Image.open(BytesIO(response.content)).size == (1200, 630)


def test_country_median_shows_before_any_city_has_fifteen_pubs(client):
    for city in ("Kolín", "Beroun"):
        for _ in range(8):
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

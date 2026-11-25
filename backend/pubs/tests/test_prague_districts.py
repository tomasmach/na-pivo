"""Which Prague district a pub is in: its position decides, its address only near the border."""

from __future__ import annotations

import logging
import re
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.models import PubDirectory
from pubs.prague_districts import district_at
from pubs.price_map import build_price_map, prague_district
from pubs.tests.prague_points import DISTRICT_POINTS, KLADNO, PRAHA_7_BORDER
from pubs.tests.sitemaps import sitemap_xml
from pubs.tests.test_price_map import _catalog, _price
from pubs.tests.test_web_pubs import _menu
from pubs.tests.test_web_pubs import _pub as _place
from pubs.web import pubs_data

pytestmark = pytest.mark.django_db

SEVEN = DISTRICT_POINTS["Praha 7"]


def test_a_position_falls_in_one_numbered_district_or_none():
    assert district_at(*SEVEN) == "Praha 7"
    assert district_at(*PRAHA_7_BORDER) == "Praha 8"
    assert district_at(*KLADNO) == ""
    assert district_at(None, None) == ""
    for name, point in DISTRICT_POINTS.items():
        assert district_at(*point) == name


def test_the_position_names_the_district_and_the_address_wins_only_at_the_border():
    # A pub in Prague with no district in its address, or a named part of a district.
    assert prague_district("Praha", *SEVEN) == "Praha 7"
    assert prague_district("Hlavní město Praha", *SEVEN) == "Praha 7"
    assert prague_district("Praha-Libuš", *DISTRICT_POINTS["Praha 12"]) == "Praha 12"
    # 20 m past the border of the district its address names: the address holds.
    assert prague_district("Praha 7", *PRAHA_7_BORDER) == "Praha 7"
    assert prague_district("Praha", *PRAHA_7_BORDER) == "Praha 8"
    # Deep in another district the position decides: postal Praha 4 reaches into Praha 11.
    assert prague_district("Praha 4", *DISTRICT_POINTS["Praha 11"]) == "Praha 11"
    # Outside Prague, or not a Prague address, the position changes nothing.
    assert prague_district("Praha", *KLADNO) == ""
    # An address district counts only where it can be true, not in Kladno or Bratislava.
    assert prague_district("Praha 4", *KLADNO) == ""
    assert prague_district("Praha 7", 48.1486, 17.1077) == ""
    assert prague_district("Kladno", *SEVEN) == ""
    assert prague_district("Praha 7") == "Praha 7"


def test_pubs_without_a_district_in_their_address_fill_its_page_sitemap_and_prices(client):
    for index in range(5):
        row = _price("Praha", 45 + index, (SEVEN[0] + index * 0.001, SEVEN[1]))
        _catalog(row, f"Sedmička {index}")
    # Its address says Praha 7, but it stands in Kladno: it stays in the Prague list, in no district.
    _menu(_place("Mimo mapu", lat=KLADNO[0], lng=KLADNO[1], city="Praha 7"))
    call_command("snapshot_beer_prices", stdout=StringIO())

    page = client.get("/hospody/praha-7")
    prices = client.get("/ceny/praha").content.decode()
    first = PubDirectory.objects.get(name="Sedmička 0")
    detail = client.get(f"/hospoda/sedmicka-0-{first.cache_key}").content.decode()

    html = page.content.decode()
    assert page.status_code == 200 and "X-Robots-Tag" not in page
    assert html.count('class="np-pubrow__name"') == 5 and "Mimo mapu" not in html
    assert "Mimo mapu" in client.get("/hospody/praha").content.decode()
    assert "https://na-pivo.cz/hospody/praha-7" in sitemap_xml(client)
    assert [(area["name"], area["pubs"]) for area in build_price_map()["prague_districts"]] == [("Praha 7", 5)]
    assert '<a class="rs-row__link" href="/hospody/praha-7">Praha 7</a>' in prices
    assert 'href="/hospody/praha-7"' in detail


def test_a_pub_whose_address_names_another_district_is_logged_without_its_name(caplog):
    _place("Na Pankráci", lat=DISTRICT_POINTS["Praha 11"][0], lng=DISTRICT_POINTS["Praha 11"][1], city="Praha 4")
    _place("U Hranice", lat=PRAHA_7_BORDER[0], lng=PRAHA_7_BORDER[1], city="Praha 7")

    with caplog.at_level(logging.INFO, logger="pubs.web.pubs_data"):
        pubs_data._build_catalogue()

    (record,) = [record for record in caplog.records if "differs from the address" in record.getMessage()]
    message = record.getMessage()
    assert "for 1 pubs" in message and "Praha 4 -> Praha 11" in message
    assert "Pankráci" not in message


def test_a_city_or_a_district_with_its_own_page_is_a_whole_row_link_on_the_prices(client):
    for index in range(5):
        row = _price("Praha", 45 + index, (SEVEN[0] + index * 0.001, SEVEN[1]))
        _catalog(row, f"Sedmička {index}")
    # Priced in the app, but not in the catalogue: Praha 2 has no page of its own.
    two = DISTRICT_POINTS["Praha 2"]
    for index in range(5):
        _price("Praha", 50 + index, (two[0] + index * 0.001, two[1]))
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/ceny/praha").content.decode()
    rows = {
        re.search(r">(Praha \d+)<", row).group(1): row
        for row in re.findall(r'<tr class="rs-strip.*?</tr>', html, re.S)
    }

    assert set(rows) == {"Praha 2", "Praha 7"}
    assert 'class="rs-strip rs-row--link"' in rows["Praha 7"]
    assert '<a class="rs-row__link" href="/hospody/praha-7">Praha 7</a>' in rows["Praha 7"]
    assert 'class="rs-row__chevron"' in rows["Praha 7"]
    assert "<a " not in rows["Praha 2"] and "rs-row" not in rows["Praha 2"]
    # A city on the country page is a whole-row link the same way.
    country = client.get("/ceny").content.decode()
    city = next(row for row in re.findall(r'<tr class="rs-strip.*?</tr>', country, re.S) if 'href="/ceny/praha"' in row)
    assert 'class="rs-strip rs-row--link"' in city and 'class="rs-row__chevron"' in city
    assert '<a class="rs-row__link" href="/ceny/praha">Praha</a>' in city

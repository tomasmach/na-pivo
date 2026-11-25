"""The public shell: error pages, footer links, header, page language and the page budget."""

from __future__ import annotations

import re
from io import StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, RequestFactory

from pubs.models import Account
from pubs.tests.test_beer_pages import _three_fresh_pubs, catalog  # noqa: F401
from pubs.tests.test_price_map import BRNO, _catalog, _price
from pubs.web.pages import server_error

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fresh_cache():
    cache.clear()


def test_unknown_address_gets_the_shell_404_in_its_language(client):
    cs = client.get("/tohle-neni")
    en = client.get("/en/nothing-here")

    assert cs.status_code == 404 and "Tohle tu nečepujeme" in cs.content.decode()
    assert en.status_code == 404 and '<html lang="en">' in en.content.decode() and "Nothing on tap here" in en.content.decode()
    assert "noindex" in cs["X-Robots-Tag"]
    assert "np-footer" in cs.content.decode()
    assert "Tohle tu nečepujeme" not in client.get("/v1/neni-tu").content.decode()


def test_server_error_page_reads_nothing_from_the_database(django_assert_num_queries):
    request = RequestFactory().get("/en/pubs")
    with django_assert_num_queries(0):
        response = server_error(request)

    html = response.content.decode()
    assert response.status_code == 500
    assert '<html lang="en">' in html and "Something broke on my side." in html


def test_footer_links_only_where_a_page_exists(client):
    empty = client.get("/").content.decode()
    assert "/pivo/testovar-11" not in empty and "/ceny/brno" not in empty
    assert 'href="/hospody">' in empty and 'href="/pivni-index">' in empty

    _three_fresh_pubs()
    for price in range(40, 46):
        _price("Brno", price, BRNO)
    _catalog(_price("Brno-střed", 35, BRNO), "Pod Špilberkem")
    call_command("snapshot_beer_prices", stdout=StringIO())
    cache.clear()

    html = client.get("/").content.decode()
    footer = html[html.index('class="np-footer"'):]
    links = re.findall(r'<li><a href="(/[^"]+)">([^<]+)</a>', footer)
    assert ("/ceny/brno", "Kolik stojí pivo v Brně") in links
    assert ("/hospody/brno", "Hospody v Brně") in links
    assert ("/pivo/testovar-11", "Testovar 11°") in links
    assert "Co je nového" not in footer and "Pivovary" not in footer
    for path, _label in links:
        assert client.get(path).status_code == 200, path

    english = client.get("/en").content.decode()
    assert 'href="/en/prices/brno">What a beer costs in Brno<' in english


def test_signed_in_phone_header_shows_the_avatar_and_menu_closes_by_script(client):
    anonymous = client.get("/hospody").content.decode()
    assert 'class="np-header__me"' not in anonymous and "/web/web.js" in anonymous

    signed = Client()
    signed.post("/registrace", {"display_name": "Tomáš", "email": "hlavicka@example.com", "password": "Pivo-je-zivot-12"})
    html = signed.get("/hospody").content.decode()
    assert 'class="np-header__me" href="/denik" aria-label="Deník"' in html


@pytest.mark.parametrize(
    ("cs", "en"),
    [("/p/ABC123", "/en/p/ABC123"), ("/party/EFJ66G", "/en/party/EFJ66G"), ("/u/stamgast", "/en/u/stamgast")],
)
def test_shared_links_keep_working_and_english_lives_under_en(client, cs, en):
    Account.objects.create(device_id="shell-profile", nickname="stamgast", is_public=True)

    czech = client.get(cs, HTTP_ACCEPT_LANGUAGE="en")
    english = client.get(en)

    assert czech.status_code == english.status_code == 200
    assert czech["Content-Language"] == "cs" and english["Content-Language"] == "en"
    assert f'href="{en}" hreflang="en"' in czech.content.decode()
    assert f'href="{cs}" hreflang="cs"' in english.content.decode()


def test_invite_opens_the_app_on_a_phone_and_offers_the_stores_on_a_computer(client):
    html = client.get("/p/ABC123").content.decode()

    assert re.search(r'class="[^"]*np-on-phone[^"]*" href="napivo://parta/pozvanka\?code=ABC123"', html)
    desktop = html[html.index('class="np-on-desktop"'):]
    desktop = desktop[: desktop.index("</div>")]
    assert "apps.apple.com" in desktop and "play.google.com" in desktop


def test_public_profile_names_the_mapper_level(client):
    Account.objects.create(device_id="shell-mapper", nickname="mapar", is_public=True)

    html = client.get("/u/mapar").content.decode()

    assert "Mapér: Nováček" in html


def test_reading_pages_has_room_for_a_crawler_but_share_images_stay_tight(client, settings):
    from pubs.api.throttling import SharedScopedRateThrottle

    rates = SharedScopedRateThrottle.THROTTLE_RATES
    assert rates["web_pages"] == "120/min"
    assert rates["web_og"] == "60/min" and rates["web_search"] == "30/min"
    statuses = {client.get(path).status_code for path in ("/hospody", "/ceny", "/pivo", "/zebricky", "/trasy") * 20}
    assert 429 not in statuses

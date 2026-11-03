from __future__ import annotations

import re
import uuid
from datetime import timedelta
from io import BytesIO, StringIO

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from PIL import Image, ImageDraw

from pubs.beer_ranking import refresh_beer_ranking
from pubs.models import Account, BeerCheckIn, BeerProduct
from pubs.price_map import _font
from pubs.tests.test_beer_pages import _second_beer, _three_fresh_pubs, catalog  # noqa: F401
from pubs.tests.test_price_map import BRNO, _catalog, _price

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fresh_cache():
    cache.clear()


@pytest.mark.parametrize("name", ["ExtraBold", "SemiBold"])
def test_share_images_draw_czech_text_with_the_web_fonts(name):
    image = Image.new("L", (900, 120))
    ImageDraw.Draw(image).text((10, 10), "Kolik stojí pivo 12° · 62 Kč", font=_font(name, 64), fill=255)

    assert _font(name, 64).getname()[0].startswith("Sofia Sans")
    left, _, right, _ = image.getbbox()
    assert right - left > 400


def _city_snapshot() -> None:
    for price in range(40, 46):
        _price("Brno", price, BRNO)
    _catalog(_price("Brno-střed", 35, BRNO), "Pod Špilberkem")
    call_command("snapshot_beer_prices", stdout=StringIO())


def test_a_city_share_image_is_drawn_once_and_kept(client, monkeypatch, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _city_snapshot()
    drawn = []
    from pubs import web_views

    original = web_views.render_city_og_image
    monkeypatch.setattr(web_views, "render_city_og_image", lambda *args: drawn.append(args) or original(*args))

    html = client.get("/ceny/brno").content.decode()
    first = client.get("/ceny/brno/og.png")
    second = client.get("/en/prices/brno/og.png")
    again = client.get("/ceny/brno/og.png")

    day = timezone.localdate().isoformat()
    assert f'<meta property="og:image" content="https://na-pivo.cz/ceny/brno/og.png?v={day}">' in html
    assert first.status_code == second.status_code == 200
    assert Image.open(BytesIO(first.content)).size == (1200, 630)
    assert again.content == first.content != second.content
    assert [args[2] for args in drawn] == ["cs", "en"]
    assert client.get("/ceny/ostrava/og.png").status_code == 404


def _rate(beer: str, rating: int, *, nickname: str | None, note: str, visibility=BeerCheckIn.Visibility.PUBLIC, **account) -> None:
    owner = Account.objects.create(device_id=f"reskin-{uuid.uuid4()}", nickname=nickname, **account)
    product = BeerProduct.objects.get(key=beer)
    BeerCheckIn.objects.create(
        account=owner, client_id=uuid.uuid4(), beer_name=product.name, beer_product=product, beer_key=beer,
        rating=rating, note=note, visibility=visibility, pub_name="U Kalicha",
        checked_in_at=timezone.now() - timedelta(days=1),
    )


def test_beer_page_shows_the_rating_and_only_public_signed_reviews(client):
    _three_fresh_pubs()
    _second_beer()
    _rate("testovar-11", 5, nickname="stamgast", note="Hladinka jak peřina.")
    _rate("testovar-11", 4, nickname="tajny", note="Jen pro kámoše.", visibility=BeerCheckIn.Visibility.FRIENDS)
    _rate("testovar-11", 3, nickname="duch", note="Sedím tu potají.", ghost_mode=True)
    _rate("testovar-11", 4, nickname=None, note="Bez přezdívky.")
    refresh_beer_ranking(force=True)
    call_command("snapshot_beer_prices", stdout=StringIO())

    html = client.get("/pivo/testovar-11").content.decode()

    assert re.search(r'<span class="rs-rating__value">[\d,]+</span>', html)
    assert "@stamgast" in html and "Hladinka jak peřina." in html and "U Kalicha" in html
    for hidden in ("tajny", "Jen pro kámoše", "duch", "potají", "Bez přezdívky"):
        assert hidden not in html
    # The brand's other beer is one click away.
    assert '<a href="/pivo/testovar-12" class="np-row">' in html
    english = client.get("/en/beer/testovar-11").content.decode()
    assert "What the regulars say" in english


def test_pages_read_their_numbers_in_a_few_queries(client, django_assert_max_num_queries):
    _three_fresh_pubs()
    _second_beer()
    _city_snapshot()

    for path in ("/", "/ceny", "/ceny/brno", "/pivo", "/pivo/testovar-11", "/pivo/znacka/testovar"):
        cache.clear()
        with django_assert_max_num_queries(12):
            assert client.get(path).status_code == 200, path
    # Cached live numbers: a second visit to a beer reads only the daily page and the rate limit.
    client.get("/pivo/testovar-11")
    with django_assert_max_num_queries(3):
        client.get("/pivo/testovar-11")


def test_invites_follow_the_browser_language_and_keep_their_preview(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/party/EFJ66G", HTTP_ACCEPT_LANGUAGE="en")

    html = response.content.decode()
    assert response["Content-Language"] == "en"
    assert response["Referrer-Policy"] == "no-referrer"
    assert "noindex" in response["X-Robots-Tag"]
    assert "There is room at the table." in html
    assert '<meta property="og:image" content="https://na-pivo.cz/og/invite.png">' in html
    assert "utm_campaign%3Dparty" in html and "ct=web-party" in html
    assert 'href="napivo://party-live?code=EFJ66G"' in html


def test_public_profile_shows_public_numbers_and_stays_out_of_search(client):
    Account.objects.create(device_id="reskin-profile", nickname="stamgast", is_public=True)

    response = client.get("/u/stamgast")

    html = response.content.decode()
    assert response.status_code == 200
    assert "noindex" in response["X-Robots-Tag"]
    assert response["Referrer-Policy"] == "no-referrer"
    assert "@stamgast" in html and "level Mapéra" in html
    assert client.get("/u/nikdo").status_code == 404

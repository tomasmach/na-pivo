"""Rankings, news, beer index and tours on the web, written by the same code the app uses."""

from __future__ import annotations

import csv
import io
import uuid

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.api.tests.test_piva import _auth, _products, _rate_many, _register
from pubs.api.tests.test_tour_publications import directory  # noqa: F401  (autouse: the pubs tours use)
from pubs.api.tests.test_tour_search import published
from pubs.beer_ranking import refresh_beer_ranking
from pubs.models import FriendBlock, PubPriceSnapshot, TourPublication
from pubs.price_map import save_price_snapshot
from pubs.pub_events import PubEvent
from pubs.tests.test_price_map import BRNO, PRAGUE, _price
from pubs.web import beer_index, news, rankings, tours

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    yield
    cache.clear()


def _page(client, path: str) -> str:
    response = client.get(path)
    assert response.status_code == 200, response.content[:400]
    return response.content.decode()


# --- rankings ------------------------------------------------------------------


def test_ranking_shows_only_beers_with_fifty_ratings_and_counts_queries(client, django_assert_max_num_queries):
    api = APIClient()
    enough, short = _products(2)
    _rate_many(api, enough, [5] * 30 + [4] * 20)
    _rate_many(api, short, [5] * 49)
    refresh_beer_ranking(force=True)
    cache.clear()

    with django_assert_max_num_queries(12):
        html = _page(client, "/zebricky")
    assert enough.name in html and short.name not in html
    assert "4,6" in html and "50 hodnocení" in html
    assert "Z 99 hodnocení z appky Na pivo" in html
    # Warm cache: the same page no longer aggregates anything.
    with django_assert_max_num_queries(5):
        client.get("/zebricky")

    english = _page(client, "/en/rankings")
    assert "Best beers in Czechia" in english and "50 ratings" in english and "4.6" in english


def test_empty_ranking_and_region_say_so_honestly(client):
    html = _page(client, "/zebricky")
    assert "Žebříček se teprve plní" in html
    regional = _page(client, "/zebricky?kraj=jihomoravsky")
    assert "Nejlepší piva: Jihomoravský kraj" in regional and "Žebříček se teprve plní" in regional
    # A filtered list is the same page for search engines.
    assert 'name="robots"' not in regional and client.get("/zebricky?kraj=praha")["X-Robots-Tag"] == "noindex, nofollow"


# --- news ----------------------------------------------------------------------


def _menu(api: APIClient, token: str, beers: list[dict], name="U Zlatého tygra", lat=50.0876, lng=14.4214):
    response = api.post("/v1/pub-community", {
        "client_id": str(uuid.uuid4()), "name": name, "lat": lat, "lng": lng, "city": "Praha 1", "beers": beers,
    }, format="json", **_auth(token))
    assert response.status_code in (200, 201), response.content


def test_news_lists_new_taps_price_changes_and_gone_beers_without_who_or_when(client):
    api = APIClient()
    first, first_account = _register(api, "klara_na_cepu")
    second, _ = _register(api, "mirek")
    pilsner, kozel = _products(2)
    _menu(api, first, [{"name": pilsner.name, "price_czk": 65, "volume_ml": 500},
                       {"name": kozel.name, "price_czk": 52, "volume_ml": 500}])
    _menu(api, second, [{"name": pilsner.name, "price_czk": 69, "volume_ml": 500}])

    html = _page(client, "/novinky")
    assert f"U Zlatého tygra nově čepuje {pilsner.name}" in html
    assert f"U Zlatého tygra má dražší {pilsner.name}" in html and "65 → 69 Kč" in html
    assert f"U Zlatého tygra už nečepuje {kozel.name}" in html
    assert "Praha 1" in html
    # Who wrote it and at what time would say where that person was.
    assert "klara_na_cepu" not in html and "mirek" not in html
    assert timezone.localtime().strftime("%H:%M") not in html
    assert ">Akce<" not in html

    prices_only = _page(client, "/novinky?typ=ceny&mesto=praha")
    assert "má dražší" in prices_only and "nově čepuje" not in prices_only
    assert "Tady je zatím ticho" in _page(client, "/novinky?typ=hospody")
    assert first_account.nickname not in _page(client, "/en/news")


def test_news_shows_events_only_once_verified(client):
    api = APIClient()
    _, account = _register(api, "akcni")
    PubEvent.objects.create(
        account=account, client_id=uuid.uuid4(), cache_key="u2fkbm3x", name="U Sadu", lat=50.08, lng=14.45,
        city="Praha 3", title="Narážejí kvasnicový ležák", starts_at=timezone.now() + timezone.timedelta(days=2),
        ends_at=timezone.now() + timezone.timedelta(days=2, hours=4),
    )
    assert "Narážejí kvasnicový ležák" not in _page(client, "/novinky")
    PubEvent.objects.update(status=PubEvent.Status.VERIFIED, verified_at=timezone.now())
    cache.clear()
    html = _page(client, "/novinky")
    assert "U Sadu: Narážejí kvasnicový ležák" in html and ">Akce<" in html


def test_empty_news_week(client, django_assert_max_num_queries):
    with django_assert_max_num_queries(14):
        html = _page(client, "/novinky")
    assert "Tenhle týden je v hospodách klid" in html


# --- beer index ----------------------------------------------------------------


def _index_data():
    for price in (60, 62, 64, 66, 70):
        _price("Praha", price, PRAGUE)
    for price in (50, 52, 54, 56, 58):
        _price("Brno", price, BRNO)
    return save_price_snapshot()


def test_beer_index_by_region_with_csv_and_share_image(client, django_assert_max_num_queries):
    country = _index_data().data["country"]
    assert country["median"] == 59
    with django_assert_max_num_queries(20):
        html = _page(client, "/pivni-index")
    assert '<span class="pi-hero__value">59 Kč</span>' in html
    assert "Nejdražší kraj" in html and "Praha" in html and "Jihomoravský kraj" in html
    # The kraje are worked out once and kept in the snapshot for every worker.
    assert PubPriceSnapshot.objects.get().data["web_regions"]["regions"]["CZ064"]["median"] == 54
    cache.clear()
    with django_assert_max_num_queries(12):
        client.get("/pivni-index")

    response = client.get("/pivni-index/data.csv")
    assert response.status_code == 200 and response["Content-Disposition"].startswith('attachment; filename="pivni-index-')
    body = response.content.decode()
    assert body.startswith("# Pivní index Na pivo, https://")
    rows = list(csv.reader(io.StringIO("\n".join(line for line in body.splitlines() if not line.startswith("#")))))
    assert rows[1] == ["Česko", "Česko", "59", str(country["p25"]), str(country["p75"]), "10"]
    assert ["kraj", "Praha", "64", "62", "66", "5"] in rows and ["město", "Brno", "54", "52", "56", "5"] in rows
    assert "region,Prague" in client.get("/en/beer-index/data.csv").content.decode()

    image = client.get("/pivni-index/og.png")
    assert image.status_code == 200 and image.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_beer_index_without_prices_waits(client):
    html = _page(client, "/pivni-index")
    assert "Index se teprve počítá" in html
    assert client.get("/pivni-index/data.csv").status_code == 404


# --- tours ---------------------------------------------------------------------


def test_tours_show_what_the_author_published_and_start_in_the_app(client, django_assert_max_num_queries):
    author, _, publication = published("pivni_vlk", pubs=(0, 1, 2), challenges={1: "Zeptej se na nefiltr"})
    _, _, other = published("druhy", pubs=(2, 3), title="Od vola")

    with django_assert_max_num_queries(16):
        listing = _page(client, "/trasy")
    assert "Pátek po Starém Městě" in listing and "Od vola" in listing and "@pivni_vlk" in listing

    token = publication["token"]
    with django_assert_max_num_queries(16):
        html = _page(client, f"/trasy/{token}")
    assert "Zeptej se na nefiltr" in html and f'href="/t/{token}"' in html
    assert "U Zlatého tygra" in html and "Od vola" in html  # a nearby tour
    # The author's private plan address never reaches the public copy.
    assert "Moje tajná adresa" not in html and author.account.device_id not in html
    assert "prošl" not in html  # nobody walked it yet, so no number

    image = client.get(f"/trasy/{token}/og.png")
    assert image.status_code == 200 and image.content[:4] == b"\x89PNG"

    TourPublication.objects.filter(token=token).update(status=TourPublication.Status.UNPUBLISHED)
    cache.clear()
    assert client.get(f"/trasy/{token}").status_code == 404
    assert "Pátek po Starém Městě" not in _page(client, "/trasy")
    assert other["token"] in tours.sitemap_paths()[-1]


def test_tours_hide_blocked_authors_from_a_signed_in_reader():
    author, _, _ = published("blokovany")
    reader = APIClient()
    _, account = _register(reader, "ctenar")
    FriendBlock.objects.create(blocker=account, blocked=author.account)
    assert tours._hidden_authors(account) == {author.account.pk}
    assert tours._hidden_authors(None) == set()


def test_sitemap_lists_the_new_pages_in_both_languages():
    xml = Client().get("/sitemap.xml").content.decode()

    for module in (rankings, news, beer_index):
        [path] = module.sitemap_paths()
        assert not path.startswith("/en/") and f"{settings.PUBLIC_WEB_ORIGIN}{path}</loc>" in xml
    for path in ("/en/rankings", "/en/news", "/en/beer-index", "/hospody", "/en/pubs"):
        assert f'href="{settings.PUBLIC_WEB_ORIGIN}{path}"' in xml

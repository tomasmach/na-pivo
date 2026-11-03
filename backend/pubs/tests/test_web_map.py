from __future__ import annotations

import html
import json
import re

import pytest
from django.core.cache import cache
from django.utils import timezone

from pubs.api.tests.test_tour_publications import directory  # noqa: F401  (autouse: the pubs tours use)
from pubs.api.tests.test_tour_search import published
from pubs.models import TourPublication
from pubs.tests.test_web_account import _bearer, _member, _web
from pubs.tests.test_web_pubs import TIGER, _price, _pub

pytestmark = pytest.mark.django_db

TILES = "connect-src 'self' https://tiles.openfreemap.org;"


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    yield
    cache.clear()


def _maps(page: str) -> list[dict]:
    return [json.loads(html.unescape(raw)) for raw in re.findall(r'data-map="([^"]*)"', page)]


def _prague_pubs() -> None:
    for index, (name, price) in enumerate([("U Zlatého tygra", 59), ("U Pinkasů", 64), ("Lokál Dlouhááá", 69)]):
        _price(_pub(name=name, lat=TIGER[0] + index * 0.002, lng=TIGER[1] + index * 0.003), price)


def test_pub_pages_carry_the_street_map_and_its_fallback(client):
    _prague_pubs()

    city = client.get("/hospody/praha")
    page = city.content.decode()
    policy = city["Content-Security-Policy"]
    assert TILES in policy and "script-src 'self';" in policy and "worker-src" not in policy
    [live] = _maps(page)
    # The rows of the list, the first (best rated) one yellow.
    assert live["kind"] == "pins" and len(live["points"]) >= 3
    assert [p["selected"] for p in live["points"]].count(True) == 1 and live["points"][0]["selected"]
    first = live["points"][0]
    assert first["label"].endswith("Kč") and first["url"].startswith("/hospoda/") and first["name"]
    assert 'class="np-map__svg"' in page  # the drawing stays without JS or tiles
    assert re.search(r'<script type="module" src="/web/map\.js\?v=\w+">', page)
    assert 'data-lib="/web/maplibre-gl.mjs?v=' in page

    pub_page = client.get(first["url"])
    assert TILES in pub_page["Content-Security-Policy"]
    [focus] = _maps(pub_page.content.decode())
    assert focus["kind"] == "focus" and [p["name"] for p in focus["points"]] == [first["name"]]

    search = client.get("/hledat?q=u")
    assert TILES in search["Content-Security-Policy"]
    assert {"U Zlatého tygra", "U Pinkasů"} <= {p["name"] for p in _maps(search.content.decode())[0]["points"]}


def test_pages_without_a_map_keep_the_strict_policy(client):
    response = client.get("/trasy")
    assert "connect-src 'self';" in response["Content-Security-Policy"]
    assert "openfreemap" not in response["Content-Security-Policy"]
    assert "map.js" not in response.content.decode()


def test_tour_map_joins_only_the_published_pubs_in_order(client):
    author, _, publication = published("pivni_vlk", pubs=(0, 1, 2))

    response = client.get(f"/trasy/{publication['token']}")
    assert TILES in response["Content-Security-Policy"]
    maps = _maps(response.content.decode())
    assert len(maps) == 2  # a phone and a desktop frame; only the one on screen loads
    route = maps[0]
    assert route["kind"] == "route"
    stops = TourPublication.objects.get(token=publication["token"]).snapshot["stops"]
    assert [(p["name"], p["lat"], p["lng"]) for p in route["points"]] == [
        (stop["name"], round(stop["lat"], 6), round(stop["lon"], 6)) for stop in stops
    ]
    assert set(route["points"][0]) == {"lat", "lng", "label", "url", "name", "selected"}
    assert author.account.device_id not in response.content.decode()


def test_my_pubs_map_shows_my_pubs_with_the_selected_one(client):
    _, token = _member("mapa@example.com", "mapar")
    api = _bearer(token)
    for name, lat in (("U Zlatého tygra", 50.0875), ("U Pinkasů", 50.0832)):
        saved = api.put(
            "/v1/pub-favorites",
            {"name": name, "lat": lat, "lng": 14.4213, "city": "Praha", "updated_at": timezone.now().isoformat()},
            format="json",
        )
        assert saved.status_code == 200, saved.content
    web = _web("mapa@example.com")

    response = web.get("/moje-hospody")
    assert TILES in response["Content-Security-Policy"]
    [live] = _maps(response.content.decode())
    assert sorted(p["name"] for p in live["points"]) == ["U Pinkasů", "U Zlatého tygra"]
    assert [p["selected"] for p in live["points"]] == [True, False]

    other = live["points"][1]
    [picked] = _maps(web.get(other["url"]).content.decode())
    assert picked["points"][0]["name"] == other["name"] and picked["points"][0]["selected"]


def test_login_map_shows_prague_pubs_or_just_prague(client):
    empty = client.get("/prihlaseni")
    assert TILES in empty["Content-Security-Policy"]
    assert _maps(empty.content.decode()) == [{"kind": "decor", "centre": [14.4213, 50.0875], "points": []}]

    _prague_pubs()
    cache.clear()
    [pins] = _maps(client.get("/prihlaseni").content.decode())
    assert pins["kind"] == "decor" and 3 <= len(pins["points"]) <= 6
    assert all(p["label"].endswith("Kč") for p in pins["points"])


def test_map_library_is_served_by_us(client):
    page = client.get("/prihlaseni").content.decode()
    for name in ("maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css", "map.js"):
        url = re.search(rf"/web/{re.escape(name)}\?v=\w+", page).group(0)
        response = client.get(url)
        assert response.status_code == 200 and response["Cache-Control"] == "public, max-age=31536000, immutable"
        assert response["Content-Type"].startswith("text/css" if name.endswith(".css") else "text/javascript")

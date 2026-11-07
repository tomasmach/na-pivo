"""What search engines and AI crawlers may read, index and find in the sitemap."""

from __future__ import annotations

import re
import uuid
from datetime import timedelta
from urllib.robotparser import RobotFileParser

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.api.tests.test_piva import _checkin, _products, _register
from pubs.beer_ranking import refresh_beer_ranking
from pubs.models import ApiRateLimitBucket, PubCommunityData, PubDirectory, PubHours
from pubs.price_map import save_price_snapshot
from pubs.tests.sitemaps import sitemap_xml
from pubs.tests.test_price_map import BRNO, PRAGUE, _price
from pubs.tests.test_web_account import PASSWORD, _member, _web, no_emails  # noqa: F401  (fixture)
from pubs.web import pubs_data, sitemap

pytestmark = pytest.mark.django_db

ORIGIN = "https://na-pivo.cz"


@pytest.fixture(autouse=True)
def _origin(settings):
    settings.PUBLIC_WEB_ORIGIN = ORIGIN


def _pub(name: str, lat: float = 50.0875, lng: float = 14.4213, city: str = "Praha 1", source="test") -> PubDirectory:
    return PubDirectory.objects.create(
        name=name, lat=lat, lng=lng, city=city, country="cz", source=source, refreshed_at=timezone.now(),
        venue_kind=PubHours.VenueKind.PUB,
    )


def _menu(pub: PubDirectory, days_ago: int = 0) -> None:
    PubCommunityData.objects.create(
        cache_key=pub.cache_key, name=pub.name, lat=pub.lat, lng=pub.lng, city=pub.city,
        beers=[{"name": "Kozel 11°", "price_czk": 49, "volume_ml": 500}],
        beers_updated_at=timezone.now() - timedelta(days=days_ago),
    )


def _locs(xml: str) -> list[str]:
    return re.findall(r"<loc>([^<]+)</loc>", xml)


def _lastmod(xml: str, url: str) -> str | None:
    found = re.search(rf"<loc>{re.escape(url)}</loc>\n  <lastmod>([^<]+)</lastmod>", xml)
    return found.group(1) if found else None


def _canonical(html: str) -> str | None:
    found = re.search(r'<link rel="canonical" href="([^"]+)">', html)
    return found.group(1) if found else None


# ---------- robots.txt, llms.txt ----------


def test_robots_lets_ai_search_in_and_keeps_training_crawlers_out_but_for_llms_txt(client):
    robots = RobotFileParser()
    robots.parse(client.get("/robots.txt").content.decode().splitlines())

    for agent in ("OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot",
                  "Perplexity-User", "YouBot", "Amzn-SearchBot", "Googlebot", "SeznamBot"):
        assert robots.can_fetch(agent, f"{ORIGIN}/ceny/praha"), agent
        assert not robots.can_fetch(agent, f"{ORIGIN}/v1/pubs"), agent
    for agent in ("GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider",
                  "Amazonbot", "AhrefsBot"):
        assert not robots.can_fetch(agent, f"{ORIGIN}/ceny/praha"), agent
        assert robots.can_fetch(agent, f"{ORIGIN}/llms.txt"), agent


def test_llms_txt_lets_ai_search_quote_with_a_link_and_forbids_training(client):
    text = client.get("/llms.txt").content.decode()

    assert "odpovídat z nich, když u odpovědi odkážou na zdrojovou stránku" in text
    assert "k trénování nebo ladění modelů je bez písemného souhlasu zakázáno" in text
    assert "if the answer links to the source page" in text and "Claude-SearchBot" in text
    # It names exactly the crawlers robots.txt keeps out, and none it lets in.
    robots = client.get("/robots.txt").content.decode()
    blocked = re.findall(r"^User-agent: (\S+)$", robots, re.M)[1:]
    assert f"kromě tohoto souboru: {', '.join(blocked)}." in text
    assert f"except this file: {', '.join(blocked)}." in text
    assert "YouBot" not in blocked and "Amazonbot" in blocked


# ---------- trailing slash ----------


@pytest.mark.parametrize(("asked", "target"), [
    ("/hospody/", "/hospody"),
    ("/hospody/praha/?page=2&open=1", "/hospody/praha?page=2&open=1"),
    ("/en/pub/u-tygra-u2fkbnhu/", "/en/pub/u-tygra-u2fkbnhu"),
    ("/zebricky/", "/zebricky"),
    ("/ceny/praha/", "/ceny/praha"),
    ("/pivo/", "/pivo"),
    ("/en/", "/en"),
    ("/novinky//", "/novinky"),
])
def test_address_with_a_trailing_slash_leads_to_the_page(client, asked, target):
    response = client.get(asked)

    assert response.status_code == 301 and response["Location"] == target


def test_trailing_slash_leaves_the_api_posts_and_unknown_addresses_alone(client):
    assert client.post("/hospody/").status_code == 404
    assert client.get("/tohle-neni/").status_code == 404
    # No loop with APPEND_SLASH: an unknown address without the slash stays a 404.
    assert client.get("/pivni-index/data.csv").status_code == 404
    assert client.get("/v1/pubs/nearby/").status_code != 301


# ---------- pubs and towns: one rule for the sitemap and the index ----------


def test_pub_without_a_menu_or_price_is_noindex_follow_and_out_of_the_sitemap(client):
    listed = _pub("U Tygra")
    _menu(listed, days_ago=3)
    empty = _pub("Prázdná", lat=50.09, lng=14.43)

    for path in (f"/hospoda/prazdna-{empty.cache_key}", f"/en/pub/prazdna-{empty.cache_key}"):
        response = client.get(path)
        html = response.content.decode()
        assert response.status_code == 200 and response["X-Robots-Tag"] == "noindex, follow"
        # Out of the index, still a share preview.
        assert _canonical(html) is None and '<link rel="alternate"' not in html and 'property="og:image"' in html
    shown = client.get(f"/hospoda/u-tygra-{listed.cache_key}")
    assert "X-Robots-Tag" not in shown
    assert _canonical(shown.content.decode()) == f"{ORIGIN}/hospoda/u-tygra-{listed.cache_key}"

    xml = sitemap_xml(client)
    assert f"{ORIGIN}/hospoda/u-tygra-{listed.cache_key}" in _locs(xml)
    assert f"{ORIGIN}/en/pub/u-tygra-{listed.cache_key}" in _locs(xml)
    assert not any(empty.cache_key in loc for loc in _locs(xml))
    assert _lastmod(xml, f"{ORIGIN}/hospoda/u-tygra-{listed.cache_key}") == (
        timezone.localdate() - timedelta(days=3)
    ).isoformat()


def test_two_spellings_of_one_pub_are_one_sitemap_entry(client):
    first = _pub("City Life")
    _pub("City-Life!", source="other")
    _menu(first)

    locs = _locs(sitemap_xml(client))

    assert locs.count(f"{ORIGIN}/hospoda/city-life-{first.cache_key}") == 1
    assert locs.count(f"{ORIGIN}/en/pub/city-life-{first.cache_key}") == 1


def test_town_with_fewer_than_three_pubs_is_noindex_follow_and_out_of_the_sitemap(client):
    _pub("U Lípy", lat=49.38, lng=15.62, city="Pistovice")
    brno = [_pub(f"Brněnka {index}", lat=49.19 + index / 1000, lng=16.61, city="Brno-střed") for index in range(3)]
    _menu(brno[0])

    assert client.get("/hospody/pistovice")["X-Robots-Tag"] == "noindex, follow"
    assert client.get("/en/pubs/pistovice")["X-Robots-Tag"] == "noindex, follow"
    assert "X-Robots-Tag" not in client.get("/hospody/brno")
    locs = _locs(sitemap_xml(client))
    assert f"{ORIGIN}/hospody/brno" in locs and f"{ORIGIN}/hospody/pistovice" not in locs


# ---------- city pages ----------


def test_every_page_of_a_city_is_its_own_canonical_with_only_its_pubs(client):
    for index in range(44):
        _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city="Praha")
    _menu(_pub("Zlatý tygr", lat=50.2, lng=14.5, city="Praha"))

    second = client.get("/hospody/praha?page=2").content.decode()
    assert second.count('class="np-pubrow"') == 20 and 'id="h21"' in second and 'id="h1"' not in second
    assert _canonical(second) == f"{ORIGIN}/hospody/praha?page=2"
    assert f'hreflang="en" href="{ORIGIN}/en/pubs/praha?page=2"' in second
    assert 'href="?page=3#h41" data-more' in second

    last = client.get("/en/pubs/praha?page=9").content.decode()
    assert last.count('class="np-pubrow"') == 5 and _canonical(last) == f"{ORIGIN}/en/pubs/praha?page=3"
    assert "data-more" not in last.split('data-more-foot')[1]
    # A filtered list stays the city's page.
    filtered = client.get("/hospody/praha?sort=name&page=2").content.decode()
    assert _canonical(filtered) == f"{ORIGIN}/hospody/praha"


# ---------- rankings, news, tours ----------


def _rank_in_prague(beers: int = 3) -> None:
    api = APIClient()
    pub = _pub("U Tygra")
    for product in _products(beers):
        for index in range(50):
            # Each rater is a new account; the per-network sign-up limit is not what this tests.
            ApiRateLimitBucket.objects.all().delete()
            token, _ = _register(api, f"r{index}{uuid.uuid4().hex[:8]}")
            _checkin(api, token, product, rating="4", pub_cache_key=pub.cache_key, pub_name=pub.name)
    refresh_beer_ranking(force=True)


def test_kraj_ranking_has_its_own_address_and_is_indexed_once_it_has_beers(client):
    _rank_in_prague()

    old = client.get("/zebricky?kraj=praha&styl=pale")
    assert old.status_code == 301 and old["Location"] == "/zebricky/praha?styl=pale"
    page = client.get("/zebricky/praha")
    html = page.content.decode()
    assert page.status_code == 200 and "X-Robots-Tag" not in page
    assert _canonical(html) == f"{ORIGIN}/zebricky/praha"
    assert f'hreflang="en" href="{ORIGIN}/en/rankings/praha"' in html
    assert 'href="/zebricky/jihomoravsky"' in html
    assert client.get("/zebricky/jihomoravsky")["X-Robots-Tag"] == "noindex, follow"
    assert client.get("/zebricky/praha?styl=pale")["X-Robots-Tag"] == "noindex, follow"
    assert client.get("/zebricky/neexistuje").status_code == 404

    locs = _locs(sitemap_xml(client))
    assert f"{ORIGIN}/zebricky/praha" in locs and f"{ORIGIN}/en/rankings/praha" in locs
    assert f"{ORIGIN}/zebricky/jihomoravsky" not in locs


def test_filtered_news_and_empty_tours_are_noindex_follow(client):
    assert client.get("/novinky?typ=hospody")["X-Robots-Tag"] == "noindex, follow"
    assert client.get("/trasy")["X-Robots-Tag"] == "noindex, follow"
    assert f"{ORIGIN}/trasy" not in _locs(sitemap_xml(client))


# ---------- sitemap ----------


def test_price_pages_carry_the_day_their_numbers_last_changed(client):
    for _ in range(5):
        _price("Brno", 48, BRNO)
        _price("Praha 1", 55, PRAGUE)
    now = timezone.now()
    save_price_snapshot(now - timedelta(days=2))
    save_price_snapshot(now - timedelta(days=1))
    _price("Brno", 60, BRNO)
    save_price_snapshot(now)

    xml = sitemap_xml(client)

    today = timezone.localdate(now)
    assert _lastmod(xml, f"{ORIGIN}/ceny/brno") == today.isoformat()
    assert _lastmod(xml, f"{ORIGIN}/ceny") == today.isoformat()
    # Prague showed the same numbers in the whole history: since its first day.
    assert _lastmod(xml, f"{ORIGIN}/ceny/praha") == (today - timedelta(days=2)).isoformat()
    assert _lastmod(xml, f"{ORIGIN}/hospody") is None and f"{ORIGIN}/hospody" in _locs(xml)


def test_sitemap_index_splits_files_under_the_url_limit(client, monkeypatch, django_assert_max_num_queries):
    monkeypatch.setattr(sitemap, "MAX_URLS", 4)
    for index in range(5):
        pub = _pub(f"Hospoda {index}", lat=50.08 + index / 1000, lng=14.42)
        _menu(pub)

    index = client.get("/sitemap.xml").content.decode()
    files = re.findall(r"<loc>https://na-pivo.cz/(sitemap-pubs-\d+\.xml)</loc>", index)
    assert files == ["sitemap-pubs-1.xml", "sitemap-pubs-2.xml", "sitemap-pubs-3.xml"]
    assert [len(_locs(client.get(f"/{name}").content.decode())) for name in files] == [4, 4, 2]
    assert client.get("/sitemap-pubs-4.xml").status_code == 404
    # Built once, then every file comes from the cache.
    with django_assert_max_num_queries(0):
        client.get("/sitemap-pubs-2.xml")


# ---------- app share links, conditional GET ----------


def test_app_share_link_moves_for_good(client):
    pub = _pub("U Tygra")

    response = client.get(f"/h/{pub.cache_key}?n=U+Tygra")

    assert response.status_code == 301 and response["Location"] == f"/hospoda/u-tygra-{pub.cache_key}"
    assert response["Cache-Control"] == "public, max-age=86400"


def test_public_page_answers_304_when_unchanged_and_signed_in_pages_never(client, no_emails):  # noqa: F811
    _menu(_pub("U Tygra"))
    first = client.get("/hospody/praha")
    assert first.status_code == 200 and first["ETag"]
    assert client.get("/hospody/praha", HTTP_IF_NONE_MATCH=first["ETag"]).status_code == 304

    _member("pivar@example.com", "pivar")
    signed_in = _web("pivar@example.com").get("/hospody/praha")
    assert signed_in["Cache-Control"] == "private, no-store" and "ETag" not in signed_in


# ---------- post office names ----------


@pytest.mark.parametrize(("raw", "town"), [
    ("Louny 1", "Louny"),
    ("Ústí nad Labem 1", "Ústí nad Labem"),
    ("Olomouc 9", "Olomouc"),
    ("Praha 7", "Praha"),
    ("Plzeň 3", "Plzeň"),
    ("Brno-střed", "Brno"),
    ("Praha-východ", "Praha-východ"),
    ("Kladno", "Kladno"),
])
def test_town_of_a_pub_drops_the_post_office_number_but_not_the_district(raw, town):
    assert pubs_data.town_name(raw) == town


def test_post_office_town_is_one_city_page_and_its_address_moves_there(client):
    _menu(_pub("U Lva", lat=50.356, lng=13.797, city="Louny"))
    _pub("Na Mostě", lat=50.357, lng=13.798, city="Louny")
    _pub("Pod Poštou", lat=50.358, lng=13.799, city="Louny 1")
    _pub("U Kříže", lat=50.10, lng=14.44, city="Praha 7")

    page = client.get("/hospody/louny")
    assert page.status_code == 200 and "X-Robots-Tag" not in page
    assert page.content.decode().count('class="np-pubrow"') == 3
    moved = client.get("/hospody/louny-1?sort=name")
    assert moved.status_code == 301 and moved["Location"] == "/hospody/louny?sort=name"
    assert client.get("/en/pubs/louny-1")["Location"] == "/en/pubs/louny"
    # A Prague district is still Prague's, and an unknown address stays a 404.
    assert client.get("/hospody/praha-7").status_code != 301
    assert client.get("/hospody/neexistuje-1").status_code == 404

    locs = _locs(sitemap_xml(client))
    assert f"{ORIGIN}/hospody/louny" in locs and not any("louny-1" in loc for loc in locs)


def test_post_office_town_is_one_price_page_and_its_address_moves_there(client):
    louny = (50.356, 13.797)
    for price in (45, 48, 50, 52, 55):
        _price("Louny", price, louny)
    _price("Louny 1", 47, louny)
    snapshot = save_price_snapshot()

    assert [(area["name"], area["pubs"]) for area in snapshot.data["cities"]] == [("Louny", 6)]
    assert client.get("/ceny/louny").status_code == 200
    assert client.get("/ceny/louny-1")["Location"] == "/ceny/louny"
    assert client.get("/en/prices/louny-1?x=1")["Location"] == "/en/prices/louny?x=1"
    assert client.get("/ceny/praha-7").status_code == 404

    locs = _locs(sitemap_xml(client))
    assert f"{ORIGIN}/ceny/louny" in locs and not any("louny-1" in loc for loc in locs)



# ---------- second audit round ----------


def test_filters_of_a_city_are_not_followed_but_districts_are(client):
    for index in range(25):
        pub = _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city=f"Praha {index % 2 + 1}")
        PubCommunityData.objects.create(
            cache_key=pub.cache_key, name=pub.name, lat=pub.lat, lng=pub.lng, city=pub.city,
            beers=[{"name": "Kozel 11° tankové", "price_czk": 45, "volume_ml": 500}], beers_updated_at=timezone.now(),
        )

    html = client.get("/hospody/praha").content.decode()
    links = dict(re.findall(r'<a [^>]*href="(\?[^"]*)"([^>]*)>', html))
    for url, attrs in links.items():
        facet = any(f"{key}=" in url for key in ("open", "beer", "max55", "tank", "garden", "sort"))
        assert ('rel="nofollow"' in attrs) == facet, (url, attrs)
    assert "?max55=1" in links and "?sort=name" in links
    # A district with a page of its own is a plain link to that page.
    assert re.search(r'<a [^>]*href="/hospody/praha-1"(?![^>]*nofollow)[^>]*>', html)
    assert 'rel="nofollow"' not in links["?page=2#h21"]
    filtered = client.get("/hospody/praha?tank=1").content.decode()
    assert 'href="?tank=1&amp;page=2#h21" rel="nofollow" data-more' in filtered


@pytest.mark.parametrize(("asked", "target"), [
    ("/CENY", "/ceny"),
    ("/ceny/Praha", "/ceny/praha"),
    ("/HOSPODY/praha?page=2&sort=name", "/hospody/praha?page=2&sort=name"),
    ("/En/Pubs/Praha/", "/en/pubs/praha"),
    ("/Zebricky/Praha", "/zebricky/praha"),
    ("/Pivo/Pilsner-Urquell", "/pivo/pilsner-urquell"),
    ("/Hospoda/U-Tygra-U2FKBNHU", "/hospoda/u-tygra-u2fkbnhu"),
])
def test_capitals_in_a_page_address_lead_to_lower_case(client, asked, target):
    response = client.get(asked)

    assert response.status_code == 301 and response["Location"] == target


@pytest.mark.parametrize("path", ["/trasy/AbCdEf", "/t/AbCdEf", "/p/AbCd", "/u/KralVycepu", "/party/ABCD",
                                  "/pozvanka/AbCdEf", "/V1/pubs", "/web/MAPLIBRE-LICENSE.txt"])
def test_addresses_where_case_matters_keep_it(client, path):
    assert client.get(path).status_code != 301


def test_capitals_leave_posts_alone(client):
    assert client.post("/CENY").status_code == 404


def test_later_pages_of_a_city_say_which_page_they_are(client):
    for index in range(45):
        _pub(f"Hospoda {index:02d}", lat=50.08 + index / 1000, lng=14.42, city="Praha")

    first = client.get("/hospody/praha").content.decode()
    second = client.get("/hospody/praha?page=2").content.decode()
    english = client.get("/en/pubs/praha?page=3").content.decode()

    assert "<title>Hospody v Praze | Na pivo</title>" in first and "Strana" not in first.split("</head>")[0]
    assert "<title>Hospody v Praze, strana 2 | Na pivo</title>" in second
    assert '<meta name="description" content="Strana 2 z 3. Praha: 45\u00a0hospod.' in second
    assert "<title>Pubs in Prague, page 3 | Na pivo</title>" in english
    assert '<meta name="description" content="Page 3 of 3. Prague: 45' in english


@pytest.mark.parametrize(("asked", "target"), [
    ("/zebricky/?kraj=praha", "/zebricky/praha"),
    ("/zebricky//?kraj=praha&styl=pale", "/zebricky/praha?styl=pale"),
    ("/en/rankings/?kraj=jihomoravsky", "/en/rankings/jihomoravsky"),
    ("/Zebricky?kraj=praha", "/zebricky/praha"),
    ("/zebricky?kraj=neznamy&n=40", "/zebricky?n=40"),
    ("/zebricky/praha/?styl=pale", "/zebricky/praha?styl=pale"),
])
def test_old_kraj_links_reach_the_kraj_in_one_step(client, asked, target):
    response = client.get(asked)

    assert response.status_code == 301 and response["Location"] == target
    assert client.get(target).status_code == 200


def test_login_and_register_stay_out_of_search_results(client):
    for path in ("/prihlaseni", "/registrace", "/en/login", "/en/register"):
        response = client.get(path)
        assert response.status_code == 200 and response["X-Robots-Tag"] == "noindex, follow"
        assert _canonical(response.content.decode()) is None
    locs = _locs(sitemap_xml(client))
    assert not any(part in loc for loc in locs for part in ("prihlaseni", "registrace", "/en/login", "/en/register"))


def _breadcrumb_names(html: str) -> list[str]:
    import json

    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        data = json.loads(block)
        for node in data.get("@graph", [data]):
            if node.get("@type") == "BreadcrumbList":
                return [(item["name"], item["item"]) for item in node["itemListElement"]]
    return []


def test_kraj_ranking_has_its_own_description_and_breadcrumb(client):
    _rank_in_prague(beers=1)
    [product] = _products(1)

    czech = client.get("/zebricky/praha").content.decode()
    assert (
        f'content="Praha: nejlíp hodnocená piva z 50 hodnocení v appce Na pivo. Vede {product.name} (4,0)."' in czech
    )
    assert _breadcrumb_names(czech)[-1] == ("Praha", f"{ORIGIN}/zebricky/praha")
    assert '<span aria-current="page">Praha</span>' in czech
    english = client.get("/en/rankings/praha").content.decode()
    assert f'content="Prague: the best rated beers from 50 ratings in the Na pivo app. {product.name} (4.0) leads."' in english
    assert _breadcrumb_names(english)[-1] == ("Prague", f"{ORIGIN}/en/rankings/praha")

    empty = client.get("/zebricky/jihomoravsky").content.decode()
    assert 'content="Jihomoravský kraj: žebříček se teprve plní.' in empty
    assert _breadcrumb_names(empty)[-1] == ("Jihomoravský kraj", f"{ORIGIN}/zebricky/jihomoravsky")
    # The whole of Czechia keeps its own text and crumb.
    national = client.get("/zebricky").content.decode()
    assert 'content="Která piva lidi v appce Na pivo hodnotí nejlíp.' in national
    # "Žebříčky" and "Piva" had the same address, so the crumbs end at "Žebříčky".
    assert _breadcrumb_names(national)[-1][0] == "Žebříčky"


def test_kraj_ranking_has_its_own_share_card(client):
    _rank_in_prague()

    html = client.get("/zebricky/praha").content.decode()
    card = re.search(r'<meta property="og:image" content="([^"]+)"', html).group(1)
    assert card.startswith(f"{ORIGIN}/zebricky/praha/og.png?v=")
    national = re.search(r'<meta property="og:image" content="([^"]+)"', client.get("/zebricky").content.decode()).group(1)
    assert national.startswith(f"{ORIGIN}/zebricky/og.png?v=") and national.split("?v=")[1] != card.split("?v=")[1]
    image = client.get("/zebricky/praha/og.png")
    assert image.status_code == 200 and image["Content-Type"] == "image/png" and image.content[:4] == b"\x89PNG"
    english = client.get("/en/rankings/praha").content.decode()
    assert f"{ORIGIN}/en/rankings/praha/og.png?v=" in english
    assert client.get("/en/rankings/praha/og.png").status_code == 200
    assert client.get("/zebricky/neexistuje/og.png").status_code == 404



# ---------- content thresholds ----------


def test_kraj_with_fewer_than_three_ranked_beers_stays_out_of_the_index(client):
    _rank_in_prague(beers=2)

    page = client.get("/zebricky/praha")
    assert page.status_code == 200 and page["X-Robots-Tag"] == "noindex, follow"
    assert client.get("/en/rankings/praha")["X-Robots-Tag"] == "noindex, follow"
    locs = _locs(sitemap_xml(client))
    assert f"{ORIGIN}/zebricky" in locs and f"{ORIGIN}/zebricky/praha" not in locs


def test_town_needs_a_pub_with_content_besides_three_pubs(client):
    for index in range(3):
        _pub(f"Žitenická {index}", lat=50.55 + index / 1000, lng=14.15, city="Žitenice")
    zaky = [_pub(f"Žacká {index}", lat=49.88 + index / 1000, lng=15.40, city="Žáky") for index in range(3)]
    _menu(zaky[2])

    assert client.get("/hospody/zitenice")["X-Robots-Tag"] == "noindex, follow"
    assert client.get("/en/pubs/zitenice")["X-Robots-Tag"] == "noindex, follow"
    assert "X-Robots-Tag" not in client.get("/hospody/zaky")
    locs = _locs(sitemap_xml(client))
    assert f"{ORIGIN}/hospody/zaky" in locs and f"{ORIGIN}/en/pubs/zaky" in locs
    assert not any("zitenice" in loc for loc in locs)

from __future__ import annotations

import json
import re
from io import BytesIO
from xml.etree import ElementTree

import pytest
from PIL import Image

from pubs.home_views import APP_STORE_URL, PLAY_STORE_URL

# The home page shows this year's totals from the database.
pytestmark = pytest.mark.django_db


def test_home_is_czech_with_store_links_and_alternates(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/", HTTP_ACCEPT_LANGUAGE="en")

    assert response.status_code == 200
    assert response["Content-Language"] == "cs"
    assert "X-Robots-Tag" not in response
    html = response.content.decode()
    assert '<html lang="cs">' in html
    assert "Kolik piv,<br>kde a s kým." in html
    assert f'href="{APP_STORE_URL}?ct=web-home&amp;mt=8"' in html
    assert f'href="{PLAY_STORE_URL}&amp;referrer=utm_source%3Dna-pivo.cz%26utm_medium%3Dweb%26utm_campaign%3Dhome"' in html
    assert '<link rel="canonical" href="https://na-pivo.cz/">' in html
    assert '<link rel="alternate" hreflang="en" href="https://na-pivo.cz/en">' in html
    assert "https://tomasmach.github.io/na-pivo/privacy.html" in html


def test_english_home_is_translated_and_links_english_documents(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/en")

    assert response.status_code == 200
    assert response["Content-Language"] == "en"
    html = response.content.decode()
    assert '<html lang="en">' in html
    assert "How many beers,<br>where and with whom." in html
    assert "Kolik piv" not in html
    assert "https://tomasmach.github.io/na-pivo/en/privacy.html" in html


def test_home_loads_nothing_from_other_origins(client):
    html = client.get("/").content.decode()
    loaded = re.findall(r'<(?:link|script|img)\b[^>]*?\s(?:src|href)="([^"]+)"', html)

    assert len(loaded) >= 6
    for url in loaded:
        assert re.match(r"/(?!/)|https://na-pivo\.cz/", url), url


def test_every_home_asset_is_served(client):
    html = client.get("/").content.decode()
    paths = set(re.findall(r'(/web/[^"?\s]+)\?v=\w+', html))

    assert {
        "/web/np+reskin.css", "/web/reskin.js", "/web/home-phones.avif", "/web/home-phones.webp",
        "/web/home-phones-720.avif", "/web/home-phones-720.webp",
    } <= paths
    for path in paths:
        response = client.get(path)
        assert response.status_code == 200, path
        assert "immutable" in response["Cache-Control"]


def test_home_social_image_has_preview_dimensions(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    assert re.search(r'<meta property="og:image" content="https://na-pivo.cz/og/home.png\?v=[0-9a-f]{10}">', client.get("/").content.decode())
    response = client.get("/og/home.png")
    image = Image.open(BytesIO(b"".join(response.streaming_content)))

    assert image.size == (1200, 630)


def test_home_counts_this_years_beers_of_everyone_but_suspect_ones(client):
    import uuid
    from datetime import timedelta

    from django.utils import timezone

    from pubs.models import Account, DrinkLog

    account = Account.objects.create(device_id="home-year")
    evening = uuid.uuid4()
    for price, suspect in ((52, False), (48, False), (999, True)):
        DrinkLog.objects.create(
            account=account, client_id=uuid.uuid4(), evening_client_id=evening, cache_key="u2fkb",
            name="U Lípy", drink_type=DrinkLog.DrinkType.BEER, beer_name="Desítka", price_czk=price,
            drank_at=timezone.now() - timedelta(minutes=5), is_suspect=suspect,
        )

    html = client.get("/").content.decode()

    assert '<span class="np-stat__value">2</span>' in html
    assert "1\u00a0večer · 1\u00a0hospoda · 100\u00a0Kč" in html


def _structured_data(html: str) -> dict:
    block = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    return {item["@type"]: item for item in json.loads(block.group(1))["@graph"]}


def test_home_names_the_site_and_the_app_for_search_engines(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    data = _structured_data(client.get("/").content.decode())

    assert data["WebSite"]["name"] == "Na pivo"
    assert data["WebSite"]["url"] == "https://na-pivo.cz/"
    app = data["MobileApplication"]
    assert app["installUrl"] == [APP_STORE_URL, PLAY_STORE_URL]
    assert app["offers"] == {"@type": "Offer", "price": "0", "priceCurrency": "CZK"}
    assert app["description"].startswith("Kompas ukáže nejbližší hospodu")
    english = _structured_data(client.get("/en").content.decode())
    assert english["MobileApplication"]["description"].startswith("The compass points")


def test_home_links_the_price_page_in_its_language(client):
    assert 'href="/ceny"' in client.get("/").content.decode()
    assert 'href="/en/prices"' in client.get("/en").content.decode()


@pytest.mark.parametrize("path", ["/", "/en", "/ceny", "/en/prices?ref=x"])
def test_pages_on_the_api_host_move_to_the_web_host(client, settings, path):
    settings.DEBUG = False
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    settings.PUBLIC_API_ORIGIN = "https://api.na-pivo.cz"

    response = client.get(path, HTTP_HOST="api.na-pivo.cz")

    assert response.status_code == 301
    assert response["Location"] == f"https://na-pivo.cz{path}"
    assert client.get(path, HTTP_HOST="na-pivo.cz").status_code == 200
    assert client.get("/v1/health", HTTP_HOST="api.na-pivo.cz").status_code == 200


def test_local_dev_keeps_pages_on_its_one_host(client, settings):
    settings.DEBUG = True
    settings.PUBLIC_API_ORIGIN = "http://localhost:8012"

    assert client.get("/", HTTP_HOST="localhost:8012").status_code == 200


def test_robots_lets_crawlers_in_and_points_to_the_sitemap(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/robots.txt")

    assert response.status_code == 200
    assert response["Content-Type"] == "text/plain; charset=utf-8"
    everyone, data_crawlers, _ = response.content.decode().split("\n\n")
    assert everyone.splitlines() == ["User-agent: *", "Disallow: /v1/", "Disallow: /admin/"]
    assert "User-agent: GPTBot" in data_crawlers and "User-agent: CCBot" in data_crawlers
    assert data_crawlers.splitlines()[-2:] == ["Allow: /llms.txt", "Disallow: /"] and "Googlebot" not in data_crawlers
    assert response.content.decode().endswith("Sitemap: https://na-pivo.cz/sitemap.xml\n")


def test_llms_txt_forbids_copying_the_data(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    text = client.get("/llms.txt").content.decode()

    assert text.startswith("# Na pivo") and "bez písemného souhlasu zakázáno" in text
    assert "prohibited without written permission" in text and "https://na-pivo.cz" in text


def test_sitemap_lists_both_languages_of_every_page(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}
    index = client.get("/sitemap.xml")
    assert index.status_code == 200
    files = [loc.text for loc in ElementTree.fromstring(index.content).findall("s:sitemap/s:loc", ns)]
    assert files == ["https://na-pivo.cz/sitemap-pages-1.xml"]
    response = client.get("/sitemap-pages-1.xml")
    root = ElementTree.fromstring(response.content)
    urls = {url.findtext("s:loc", namespaces=ns): url for url in root.findall("s:url", ns)}
    pages = ("/", "/en", "/ceny", "/en/prices", "/hospody", "/en/pubs", "/zebricky", "/en/rankings")
    # No tour is published yet, so /trasy is not listed.
    pages += ("/novinky", "/en/news", "/pivni-index", "/en/beer-index", "/o-appce", "/en/about")
    assert set(urls) == {f"https://na-pivo.cz{path}" for path in pages}
    alternates = {
        link.get("hreflang"): link.get("href")
        for link in urls["https://na-pivo.cz/en/prices"].findall("x:link", ns)
    }
    assert alternates == {
        "cs": "https://na-pivo.cz/ceny",
        "en": "https://na-pivo.cz/en/prices",
        "x-default": "https://na-pivo.cz/ceny",
    }
    # No snapshot yet, so no date the prices changed.
    assert urls["https://na-pivo.cz/ceny"].find("s:lastmod", ns) is None


def test_home_phones_are_sharp_on_retina_and_keep_their_box(client):
    html = client.get("/").content.decode()
    picture = re.search(r'<picture class="rs-hero__picture">.*?</picture>', html, re.S).group(0)

    def candidates(srcset: str) -> dict[str, str]:
        return {density: re.sub(r"\?v=\w+$", "", url) for url, density in (part.split() for part in srcset.split(","))}

    avif = re.search(r'<source type="image/avif" srcset="([^"]+)">', picture).group(1)
    webp = re.search(r'<img [^>]*srcset="([^"]+)"', picture).group(1)
    assert candidates(avif) == {"1x": "/web/home-phones-720.avif", "2x": "/web/home-phones.avif"}
    assert candidates(webp) == {"1x": "/web/home-phones-720.webp", "2x": "/web/home-phones.webp"}
    img = re.search(r"<img [^>]*>", picture).group(0)
    assert re.search(r'src="/web/home-phones-720\.webp\?v=\w+"', img)
    assert 'width="720" height="740"' in img and 'fetchpriority="high"' in img and 'alt="' in img
    for path, size in (("/web/home-phones-720.webp", (720, 740)), ("/web/home-phones.webp", (1440, 1480))):
        response = client.get(re.search(rf'({re.escape(path)}\?v=\w+)', picture).group(1))
        assert response.status_code == 200 and Image.open(BytesIO(response.content)).size == size

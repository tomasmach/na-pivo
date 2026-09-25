from __future__ import annotations

import re
from io import BytesIO

import pytest
from PIL import Image

from pubs.home_views import APP_STORE_URL, PLAY_STORE_URL


def test_home_is_czech_with_store_links_and_alternates(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/", HTTP_ACCEPT_LANGUAGE="en")

    assert response.status_code == 200
    assert response["Content-Language"] == "cs"
    assert "X-Robots-Tag" not in response
    html = response.content.decode()
    assert '<html lang="cs">' in html
    assert "Čárkuj piva jak na tácku." in html
    assert f'href="{APP_STORE_URL}"' in html
    assert f'href="{PLAY_STORE_URL}"' in html
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
    assert "Keep a tally, pub style." in html
    assert "Čárkuj" not in html
    assert '"empty": "Clean coaster."' in html
    assert "https://tomasmach.github.io/na-pivo/en/privacy.html" in html


def test_home_loads_nothing_from_other_origins(client):
    html = client.get("/").content.decode()
    loaded = re.findall(r'(?:src|srcset|<image href|rel="preload" href)="([^"]+)"', html)
    loaded += re.findall(r'url\("([^"]+)"\)', html)

    assert len(loaded) >= 10
    for url in loaded:
        assert url.startswith("/landing/"), url


def test_every_home_asset_is_served(client):
    html = client.get("/").content.decode()
    paths = {chunk.split('"', 1)[0].split(" ", 1)[0] for chunk in html.split('"/landing/')[1:]}

    assert len(paths) >= 10
    for path in paths:
        response = client.get(f"/landing/{path.split('?', 1)[0]}")
        assert response.status_code == 200, path
        assert "immutable" in response["Cache-Control"]


@pytest.mark.parametrize("name", ["missing.js", "..%2Fhome_views.py", "coaster.min.js"])
def test_landing_serves_only_known_files(client, name):
    assert client.get(f"/landing/{name}").status_code == 404


def test_home_social_image_has_preview_dimensions(client):
    response = client.get("/landing/og-home.png")
    image = Image.open(BytesIO(b"".join(response.streaming_content)))

    assert image.size == (1200, 630)

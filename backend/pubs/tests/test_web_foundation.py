from __future__ import annotations

import re

import pytest
from django.test import override_settings
from django.urls import resolve

from pubs.web.assets import URLS
from pubs.web.routes import web_reverse
from pubs.web.urls import urlpatterns as web_patterns

pytestmark = pytest.mark.django_db

_WEB_NAMES = sorted(
    p.name for p in web_patterns if p.name and p.name.startswith("web-") and not p.name.endswith("-en")
    and p.name != "web-components" and p.name != "web-asset"
)
_SAMPLE_KWARGS = {"web-pubs-city": {"city": "praha"}, "web-pub": {"key": "u-pinkasu"}, "web-tour": {"tour_id": "abc"}}


@pytest.mark.parametrize("name", _WEB_NAMES)
def test_every_reserved_page_answers_in_both_languages(client, name):
    kwargs = _SAMPLE_KWARGS.get(name, {})
    cs, en = web_reverse(name, "cs", **kwargs), web_reverse(name, "en", **kwargs)
    assert not cs.startswith("/en/") and en.startswith("/en/")
    for path, lang in ((cs, "cs"), (en, "en")):
        response = client.get(path)
        assert response.status_code == 404
        assert response["Content-Language"] == lang
        assert "script-src 'self'" in response["Content-Security-Policy"]
        assert f'<html lang="{lang}">' in response.content.decode()


def test_english_page_is_translated_and_links_stay_english(client):
    html = client.get("/en/pubs/praha").content.decode()
    assert "Log in" in html and "Přihlásit se" not in html
    assert 'href="/en/login"' in html
    assert 'href="/en/prices/praha"' in html
    assert 'href="/en/beer/pilsner-urquell"' in html
    assert 'action="/en/search"' in html


def test_language_switch_points_at_the_same_page(client):
    html = client.get("/hospody/praha").content.decode()
    assert 'href="/en/pubs/praha" hreflang="en"' in html
    html = client.get("/en/search?q=bobr").content.decode()
    assert 'href="/hledat?q=bobr" hreflang="cs"' in html


def test_signed_in_pages_use_the_panel_shell(client):
    html = client.get("/denik").content.decode()
    assert 'class="np-panel"' in html
    assert 'href="/denik" aria-current="page"' in html
    assert 'class="np-header"' not in html


def test_existing_pub_share_link_still_resolves():
    assert resolve("/h/u2fkbz").url_name == "pub-share-landing"
    assert resolve("/hospoda/u2fkbz").url_name == "web-pub"


def test_stylesheet_is_versioned_and_points_at_versioned_fonts(client):
    html = client.get("/hospody").content.decode()
    css_url = re.search(r'href="(/web/np\.css\?v=[0-9a-f]{10})"', html).group(1)
    response = client.get(css_url)
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/css")
    assert response["Cache-Control"] == "public, max-age=31536000, immutable"
    css = response.content.decode()
    assert f'url("{URLS["sofia-sans.woff2"]}")' in css
    assert client.get(URLS["sofia-sans.woff2"])["Content-Type"] == "font/woff2"
    assert client.get("/web/PROVENANCE.md").status_code == 404
    assert client.get("/web/..%2Fsettings.py").status_code == 404


@override_settings(DEBUG=False, PUBLIC_WEB_ORIGIN="https://na-pivo.cz", PUBLIC_API_ORIGIN="https://api.na-pivo.cz",
                   ALLOWED_HOSTS=["api.na-pivo.cz", "na-pivo.cz"], SECURE_SSL_REDIRECT=False)
def test_web_page_on_api_host_redirects_to_web_host(client):
    response = client.get("/hospody/praha?x=1", HTTP_HOST="api.na-pivo.cz")
    assert response.status_code == 301
    assert response["Location"] == "https://na-pivo.cz/hospody/praha?x=1"

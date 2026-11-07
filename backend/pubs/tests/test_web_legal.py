"""The privacy policy and terms on na-pivo.cz, which the app, the stores and the old GitHub Pages addresses point to."""

from __future__ import annotations

import json
import re

import pytest

PAGES = [
    ("/ochrana-soukromi", "/en/privacy", ["kdo-jsme", "data", "pouziti", "treti-strany", "uchovani", "smazani-uctu", "prava", "deti",
                                                "zmeny-zasad", "kontakt"]),
    ("/podminky", "/en/terms", ["uvod", "popis", "alkohol", "ucty", "obsah", "pravidla", "moderace", "setkani",
                                "verejne-tour", "fotosoutez", "ai", "presnost", "dostupnost", "odpovednost", "pravo",
                                "obchody", "zmeny", "kontakt"]),
]


@pytest.fixture(autouse=True)
def _origin(settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"


@pytest.mark.django_db
@pytest.mark.parametrize(("cs", "en", "anchors"), PAGES)
def test_each_document_is_indexed_in_both_languages_with_every_anchor_the_app_links_to(client, cs, en, anchors):
    for path, lang in ((cs, "cs"), (en, "en")):
        response = client.get(path)
        html = response.content.decode()

        assert response.status_code == 200
        assert "X-Robots-Tag" not in response
        assert response["Content-Language"] == lang
        assert f'<link rel="canonical" href="https://na-pivo.cz{path}">' in html
        assert f'<link rel="alternate" hreflang="cs" href="https://na-pivo.cz{cs}">' in html
        assert f'<link rel="alternate" hreflang="en" href="https://na-pivo.cz{en}">' in html
        assert re.findall(r'<h2 id="([^"]+)"', html) == anchors
        # Every section is in both the side contents and the folded one on a phone.
        assert re.findall(r'<a href="#([^"]+)">', html) == anchors * 2
        page = next(
            node
            for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html)
            for node in json.loads(block)["@graph"]
            if node["@type"] == "WebPage"
        )
        assert page["url"] == f"https://na-pivo.cz{path}"
        assert page["publisher"]["@id"] == "https://na-pivo.cz/#org"


@pytest.mark.django_db
def test_the_terms_section_called_obsah_is_not_the_skip_link_target(client):
    html = client.get("/podminky").content.decode()

    assert html.count('id="obsah"') == 1
    assert 'href="#stranka"' in html and '<main class="np-main" id="stranka">' in html


@pytest.mark.django_db
def test_links_between_the_documents_stay_in_the_page_language(client):
    html = client.get("/en/terms").content.decode()

    assert 'href="/en/privacy"' in html
    assert 'href="/en/delete-account"' in html
    assert ".html" not in re.sub(r'href="https?://[^"]+"', "", html)


@pytest.mark.django_db
def test_the_footer_leads_to_the_documents_on_the_web(client):
    home = client.get("/").content.decode()

    assert 'href="/ochrana-soukromi"' in home and 'href="/podminky"' in home
    assert "github.io" not in home

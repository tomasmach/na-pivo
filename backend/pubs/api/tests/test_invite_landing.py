from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image


@pytest.mark.parametrize(
    ("path", "content_type"),
    [
        ("/favicon.ico", "image/x-icon"),
        ("/apple-touch-icon.png", "image/png"),
        ("/og/invite.png", "image/png"),
    ],
)
def test_invite_assets_are_public_and_cacheable(client, path, content_type):
    response = client.get(path)

    assert response.status_code == 200
    assert response["Content-Type"] == content_type
    assert "immutable" in response["Cache-Control"]
    assert b"".join(response.streaming_content)


def test_invite_landing_has_canonical_deep_link_and_social_metadata(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/p/Ab3xK9_pQ2sT")

    assert response.status_code == 200
    html = response.content.decode()
    assert 'href="napivo://parta/pozvanka?code=Ab3xK9_pQ2sT"' in html
    assert '<meta property="og:url" content="https://na-pivo.cz/p/Ab3xK9_pQ2sT">' in html
    assert '<meta property="og:image" content="https://na-pivo.cz/og/invite.png">' in html
    assert "noindex" in response["X-Robots-Tag"]


def test_party_invite_landing_opens_the_prefilled_table_flow(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"

    response = client.get("/party/EFJ66G")

    assert response.status_code == 200
    html = response.content.decode()
    assert 'href="napivo://party-live?code=EFJ66G"' in html
    assert '<meta property="og:url" content="https://na-pivo.cz/party/EFJ66G">' in html
    assert "U stolu je místo." in html
    assert "noindex" in response["X-Robots-Tag"]


def test_invite_og_image_has_social_preview_dimensions(client):
    response = client.get("/og/invite.png")
    image = Image.open(BytesIO(b"".join(response.streaming_content)))

    assert image.size == (1200, 630)


def test_apple_association_limits_universal_links_to_invites(client, settings):
    settings.APPLE_TEAM_ID = "TEAM123"

    response = client.get("/.well-known/apple-app-site-association")

    assert response.status_code == 200
    assert response.json() == {
        "applinks": {
            "apps": [],
            "details": [
                {
                    "appID": "TEAM123.com.tomasmach.na-pivo",
                    "components": [
                        {"/": "/p/*", "comment": "Parta friend invite links"},
                        {"/": "/party/*", "comment": "Shared table invite links"},
                    ],
                }
            ],
        }
    }


def test_assetlinks_fails_closed_without_configured_fingerprint(client, settings):
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = ""

    response = client.get("/.well-known/assetlinks.json")

    assert response.status_code == 200
    assert response.json() == []
    assert "max-age=3600" in response["Cache-Control"]


def test_assetlinks_serves_android_statement_for_valid_fingerprints(client, settings):
    fingerprint = "AA" * 32
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = f"{fingerprint}, bb:bb:bb"

    response = client.get("/.well-known/assetlinks.json")

    payload = response.json()
    assert len(payload) == 1
    statement = payload[0]
    assert statement["relation"] == ["delegate_permission/common.handle_all_urls"]
    assert statement["target"]["package_name"] == "com.tomasmach.na_pivo"
    # Malformed entries are dropped, valid ones are normalized to plain hex.
    assert statement["target"]["sha256_cert_fingerprints"] == [fingerprint]


def test_assetlinks_drops_only_malformed_fingerprints(client, settings):
    settings.ANDROID_APP_LINK_CERT_FINGERPRINTS = "not-a-fingerprint"

    response = client.get("/.well-known/assetlinks.json")

    assert response.json() == []

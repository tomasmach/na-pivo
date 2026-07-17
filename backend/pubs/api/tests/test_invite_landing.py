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
                    "components": [{"/": "/p/*", "comment": "Parta invite links"}],
                }
            ],
        }
    }

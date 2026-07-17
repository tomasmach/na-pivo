"""Small public web surface for shareable app links.

The mobile API lives on api.na-pivo.cz, while na-pivo.cz is reverse-proxied to
the same Django service for invite landings. These views intentionally do not
resolve the invite owner: link previews stay generic and never expose profile
data to unauthenticated crawlers.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render

_ASSET_ROOT = Path(__file__).resolve().parent / "static" / "pubs" / "invite"
_ASSETS: dict[str, tuple[str, str]] = {
    "favicon.ico": ("favicon.ico", "image/x-icon"),
    "apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "og-invite.png": ("og-invite.png", "image/png"),
}


def invite_landing(request: HttpRequest, code: str) -> HttpResponse:
    """Render a generic, privacy-preserving landing for a Parta invite."""

    encoded_code = quote(code, safe="")
    canonical_url = f"{settings.PUBLIC_WEB_ORIGIN}/p/{encoded_code}"
    response = render(
        request,
        "pubs/invite_landing.html",
        {
            "canonical_url": canonical_url,
            "deep_link": f"napivo://parta/pozvanka?code={encoded_code}",
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}/og/invite.png",
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


def apple_app_site_association(_request: HttpRequest) -> JsonResponse:
    """Advertise invite paths as iOS universal links when the team ID is set."""

    team_id = settings.APPLE_TEAM_ID.strip()
    details = (
        [
            {
                "appID": f"{team_id}.com.tomasmach.na-pivo",
                "components": [{"/": "/p/*", "comment": "Parta invite links"}],
            }
        ]
        if team_id
        else []
    )
    response = JsonResponse({"applinks": {"apps": [], "details": details}})
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


def invite_asset(_request: HttpRequest, filename: str) -> FileResponse:
    """Serve the tiny public invite asset set without relying on Caddy paths."""

    asset = _ASSETS.get(filename)
    if asset is None:
        raise Http404
    disk_name, content_type = asset
    path = _ASSET_ROOT / disk_name
    if not path.is_file():
        raise Http404
    response = FileResponse(path.open("rb"), content_type=content_type)
    response.headers["Cache-Control"] = "public, max-age=604800, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

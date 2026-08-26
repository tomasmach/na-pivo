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
from django.utils.translation import gettext

from pubs.checks import ANDROID_APP_LINK_FINGERPRINTS_ENV, normalized_cert_fingerprints
from pubs.i18n import current_locale

# og:locale wants a full territory tag; the app only ever speaks these two.
_OG_LOCALES = {"cs": "cs_CZ", "en": "en_US"}

_ASSET_ROOT = Path(__file__).resolve().parent / "static" / "pubs" / "invite"
_ASSETS: dict[str, tuple[str, str]] = {
    "favicon.ico": ("favicon.ico", "image/x-icon"),
    "apple-touch-icon.png": ("apple-touch-icon.png", "image/png"),
    "og-invite.png": ("og-invite.png", "image/png"),
}


def _language_context() -> dict[str, str]:
    """Language bits the landing template needs.

    LocaleMiddleware already resolved the request language, but the i18n context
    processor is intentionally not installed, so the template gets these values
    handed to it explicitly.
    """

    locale = current_locale()
    return {"LANGUAGE_CODE": locale, "og_locale": _OG_LOCALES[locale]}


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
            "page_title": gettext("Přidej se k partě | Na pivo"),
            "description": gettext(
                "Hospoda je lepší s kámoši. Otevři pozvánku v aplikaci Na pivo."
            ),
            "headline": gettext("Kámoš tě zve do party."),
            "body": gettext(
                "Otevři pozvánku v Na pivo a hned budeš vědět, kdy se jde na jedno."
            ),
            **_language_context(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


def party_invite_landing(request: HttpRequest, code: str) -> HttpResponse:
    """Render a privacy-preserving landing for a shared table invite."""

    encoded_code = quote(code, safe="")
    canonical_url = f"{settings.PUBLIC_WEB_ORIGIN}/party/{encoded_code}"
    response = render(
        request,
        "pubs/invite_landing.html",
        {
            "canonical_url": canonical_url,
            "deep_link": f"napivo://party-live?code={encoded_code}",
            "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}/og/invite.png",
            "page_title": gettext("Přisedni ke stolu | Na pivo"),
            "description": gettext(
                "Kámoši tě zvou ke stolu. Otevři pozvánku v aplikaci Na pivo."
            ),
            "headline": gettext("U stolu je místo."),
            "body": gettext("Otevři Na pivo, potvrď kód a přisedni ke kámošům."),
            **_language_context(),
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
                "components": [
                    {"/": "/p/*", "comment": "Parta friend invite links"},
                    {"/": "/party/*", "comment": "Shared table invite links"},
                ],
            }
        ]
        if team_id
        else []
    )
    response = JsonResponse({"applinks": {"apps": [], "details": details}})
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


_ANDROID_PACKAGE = "com.tomasmach.na_pivo"


def _android_cert_fingerprints() -> list[str]:
    """Read trusted Android signing-cert fingerprints from settings.

    The value is never invented here: without ANDROID_APP_LINK_CERT_FINGERPRINTS
    (or with only malformed entries) the statement list stays empty and Google
    grants no app-link verification — fail closed. Valid entries are 64 hex
    characters; colons are tolerated and stripped.
    """

    raw = str(getattr(settings, ANDROID_APP_LINK_FINGERPRINTS_ENV, "") or "")
    if not raw.strip():
        return []
    return normalized_cert_fingerprints(raw)


def android_asset_statements(_request: HttpRequest) -> JsonResponse:
    """Serve /.well-known/assetlinks.json for Android app links.

    assetlinks.json cannot scope by path — the /p/* and /party/* restriction
    lives in the app's autoVerify intent filters (see app.config.ts). With no
    configured fingerprint the response is an empty list — the app simply does
    not verify until ops sets ANDROID_APP_LINK_CERT_FINGERPRINTS.
    """

    fingerprints = _android_cert_fingerprints()
    statements = (
        [
            {
                "relation": ["delegate_permission/common.handle_all_urls"],
                "target": {
                    "namespace": "android_app",
                    "package_name": _ANDROID_PACKAGE,
                    "sha256_cert_fingerprints": fingerprints,
                },
            }
        ]
        if fingerprints
        else []
    )
    response = JsonResponse(statements, safe=False)
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

"""Public share page of one pub at na-pivo.cz/h/<geohash-8>.

The page shows only what anybody can already see in the app's catalogue: the
pub's name and city plus the community opening hours and tap list. It never
reads accounts, visits, ratings from the enrichment source or anything that
says who shared the link, and it never starts an enrichment lookup.
"""

from __future__ import annotations

import re
from urllib.parse import quote, urlencode

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.utils.translation import gettext

from pubs.identity import normalize_pub_name
from pubs.models import PubCommunityData, PubDirectory, PubHours, PubReport

_CACHE_KEY = re.compile(r"^[0123456789bcdefghjkmnpqrstuvwxyz]{8}$")
_NAME_HINT_MAX = 120
_DAY_KEYS = ("mo", "tu", "we", "th", "fr", "sa", "su")
_SELF_CONTAINED_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; "
    "frame-ancestors 'none'; form-action 'none'"
)


def _day_labels() -> dict[str, str]:
    return {
        "mo": gettext("Pondělí"),
        "tu": gettext("Úterý"),
        "we": gettext("Středa"),
        "th": gettext("Čtvrtek"),
        "fr": gettext("Pátek"),
        "sa": gettext("Sobota"),
        "su": gettext("Neděle"),
    }


def _resolve(cache_key: str, name_hint: str) -> dict | None:
    """Name, city and coordinates of the catalogue pub in this cell."""

    hint = normalize_pub_name(name_hint) if name_hint else ""
    directory = list(
        PubDirectory.objects.filter(cache_key=cache_key, active=True)
        .exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
        .order_by("name")
        .values("name", "name_key", "city", "lat", "lng")
    )
    if directory:
        chosen = next((row for row in directory if hint and row["name_key"] == hint), directory[0])
        return {"name": chosen["name"], "city": chosen["city"], "lat": chosen["lat"], "lng": chosen["lng"]}
    community = PubCommunityData.objects.filter(cache_key=cache_key).values("name", "city", "lat", "lng").first()
    if community:
        return {**community, "city": community["city"] or ""}
    hours = (
        PubHours.objects.filter(cache_key=cache_key)
        .exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
        .values("name", "city", "lat", "lng")
        .first()
    )
    return hours


def _hours_rows(hours_json) -> list[dict]:
    if not isinstance(hours_json, dict):
        return []
    labels = _day_labels()
    rows = []
    for day in _DAY_KEYS:
        intervals = hours_json.get(day)
        if not isinstance(intervals, list):
            return []
        spans = [
            f"{span[0]}–{span[1]}"
            for span in intervals
            if isinstance(span, (list, tuple)) and len(span) == 2 and all(isinstance(x, str) for x in span)
        ]
        rows.append({"day": labels[day], "hours": ", ".join(spans) if spans else gettext("Zavřeno")})
    return rows


def _beer_rows(beers) -> list[dict]:
    rows = []
    for beer in beers if isinstance(beers, list) else []:
        if not isinstance(beer, dict) or not isinstance(beer.get("name"), str) or not beer["name"].strip():
            continue
        volume = beer.get("volume_ml")
        price = beer.get("price_czk")
        rows.append(
            {
                "name": beer["name"].strip(),
                "volume": f"{volume / 1000:.1f} l".replace(".", ",") if isinstance(volume, int) and volume > 0 else "",
                "price": f"{price} Kč" if isinstance(price, int) and price > 0 else "",
            }
        )
    return rows[:12]


def pub_share_landing(request: HttpRequest, key: str) -> HttpResponse:
    """Render the public pub page, or 404 for an unknown or reported cell."""
    from rest_framework.request import Request

    from pubs.api.throttling import SharedScopedRateThrottle
    from pubs.web_views import _language_context

    throttle = SharedScopedRateThrottle()
    policy = type("PubPublicPolicy", (), {"throttle_scope": "pub_public"})()
    if not throttle.allow_request(Request(request), policy):
        response = HttpResponse(gettext("Zkus to prosím za chvíli."), status=429)
        response["Retry-After"] = str(throttle.wait())
        return response

    cache_key = key.lower()
    name_hint = request.GET.get("n", "")[:_NAME_HINT_MAX]
    pub = None
    if _CACHE_KEY.match(cache_key) and not PubReport.objects.filter(cache_key=cache_key, active=True).exists():
        pub = _resolve(cache_key, name_hint)
    if pub is None:
        response = render(request, "pubs/pub_landing.html", {"unavailable": True, **_language_context()}, status=404)
        response["Content-Security-Policy"] = _SELF_CONTAINED_CSP
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response

    community = PubCommunityData.objects.filter(cache_key=cache_key).values("hours_json", "beers").first() or {}
    query = urlencode({"n": pub["name"]})
    canonical_url = f"{settings.PUBLIC_WEB_ORIGIN}/h/{cache_key}?{query}"
    response = render(
        request,
        "pubs/pub_landing.html",
        {
            "pub": pub,
            "hours": _hours_rows(community.get("hours_json")),
            "beers": _beer_rows(community.get("beers")),
            "canonical_url": canonical_url,
            "deep_link": f"napivo://h/{cache_key}?{query}",
            "navigation_url": (
                "https://www.google.com/maps/dir/?api=1&travelmode=walking&destination="
                + quote(f"{pub['lat']},{pub['lng']}", safe=",")
            ),
            "page_title": gettext("%(name)s | Na pivo") % {"name": pub["name"]},
            "description": gettext("Mrkni, co čepují v hospodě %(name)s, a otevři ji v Na pivo.")
            % {"name": pub["name"]},
            **_language_context(),
        },
    )
    response["Content-Security-Policy"] = _SELF_CONTAINED_CSP
    response["Cache-Control"] = "public, max-age=300"
    response["Referrer-Policy"] = "no-referrer"
    return response

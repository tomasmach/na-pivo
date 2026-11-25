"""POST /web/stats: a web page tells us it was opened, or that a store link on it was tapped.

The page's script sends it, so crawlers that do not run JavaScript never count;
the ones that do are dropped by their user agent. See ``pubs.web_stats`` for what
is kept.
"""

from __future__ import annotations

import json
from urllib.parse import urlsplit

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.request import Request

from pubs import pub_reach, web_stats
from pubs.api.throttling import SharedScopedRateThrottle

_MAX_BODY = 2048
_METRICS = {"view": web_stats.VIEW, "store_ios": web_stats.STORE_IOS, "store_android": web_stats.STORE_ANDROID}


def _throttled(request: HttpRequest) -> bool:
    policy = type("WebStatsPolicy", (), {"throttle_scope": "web_stats"})()
    return not SharedScopedRateThrottle().allow_request(Request(request), policy)


@csrf_exempt
@require_POST
def web_stats_beacon(request: HttpRequest) -> HttpResponse:
    done = HttpResponse(status=204)
    done["Cache-Control"] = "no-store"
    user_agent = request.headers.get("User-Agent", "")
    if len(request.body) > _MAX_BODY or pub_reach.is_bot(user_agent):
        return done
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return done
    if not isinstance(data, dict) or not isinstance(data.get("type"), str) or data["type"] not in _METRICS:
        return done
    page = web_stats.page_of(str(data.get("path", "")), missing=data.get("missing") is True)
    if page is None or _throttled(request):
        return done
    own_hosts = {host for host in (urlsplit(settings.PUBLIC_WEB_ORIGIN).hostname, request.get_host().split(":")[0]) if host}
    referrer = str(data.get("ref", ""))[:500]
    try:
        source = pub_reach.web_source(referrer, own_hosts)
        referrer_host = web_stats.referrer_host(referrer, source)
    except ValueError:
        return done
    name, path, lang = page
    web_stats.record(
        web_stats.Hit(
            day=pub_reach.reach_day(timezone.now()),
            page=name,
            path=path,
            lang=lang,
            metric=_METRICS[data["type"]],
            source=source,
            referrer=referrer_host,
            campaign=web_stats.campaign_of(str(data.get("utm", ""))),
            device=web_stats.device_of(user_agent),
        )
    )
    return done

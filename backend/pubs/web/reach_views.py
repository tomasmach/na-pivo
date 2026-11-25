"""POST /web/reach: the pub page tells us it was viewed or its navigation was tapped.

The page's script sends it, so crawlers that do not run JavaScript never count;
the ones that do are dropped by their user agent. Only the pub, the action and
the kind of referrer are kept. No cookie, address or browser detail is stored.
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

from pubs import pub_reach
from pubs.api.throttling import SharedScopedRateThrottle
from pubs.models import PubReach

_MAX_BODY = 2048
_WEB_METRICS = {PubReach.DETAIL_VIEW.value, PubReach.NAVIGATION.value}


def _throttled(request: HttpRequest) -> bool:
    policy = type("WebReachPolicy", (), {"throttle_scope": "web_reach"})()
    return not SharedScopedRateThrottle().allow_request(Request(request), policy)


@csrf_exempt
@require_POST
def web_reach(request: HttpRequest) -> HttpResponse:
    done = HttpResponse(status=204)
    done["Cache-Control"] = "no-store"
    if len(request.body) > _MAX_BODY or pub_reach.is_bot(request.headers.get("User-Agent", "")):
        return done
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return done
    if not isinstance(data, dict):
        return done
    key = str(data.get("pub", "")).lower()
    metric = data.get("type")
    if not pub_reach.CACHE_KEY_RE.match(key) or metric not in _WEB_METRICS:
        return done
    if _throttled(request):
        return done
    own_hosts = {host for host in (urlsplit(settings.PUBLIC_WEB_ORIGIN).hostname, request.get_host().split(":")[0]) if host}
    source = pub_reach.web_source(str(data.get("ref", ""))[:500], own_hosts)
    event = pub_reach.ReachEvent(key, pub_reach.reach_day(timezone.now()), metric, source)
    pub_reach.record([event], pub_reach.WEB)
    return done

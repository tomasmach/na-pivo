"""Throttles for web forms, counted in the same database buckets as the API."""

from __future__ import annotations

import hashlib
import hmac

from django.conf import settings
from django.http import HttpRequest

from pubs.api.throttling import SharedScopedRateThrottle


class _KeyedThrottle(SharedScopedRateThrottle):
    """Counts per a key (a plan, an e-mail address) instead of per network."""

    def __init__(self, key: str):
        super().__init__()
        self.key = key

    def _identity_hash(self, request) -> str:
        return hmac.new(str(settings.SECRET_KEY).encode(), f"key:{self.key}".encode(), hashlib.sha256).hexdigest()


def over_limit(request: HttpRequest, scope: str, key: str | None = None) -> bool:
    """Count one attempt against ``scope``: per network, or per ``key`` when given."""

    class _Scope:
        throttle_scope = scope

    throttle = _KeyedThrottle(key) if key is not None else SharedScopedRateThrottle()
    return not throttle.allow_request(request, _Scope)

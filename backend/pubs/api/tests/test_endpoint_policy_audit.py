from __future__ import annotations

from django.urls import URLPattern, URLResolver
from rest_framework.views import APIView

from pubs.api.party_views import party_game_stream
from pubs.api.urls import urlpatterns


def _patterns(items):
    for item in items:
        if isinstance(item, URLResolver):
            yield from _patterns(item.url_patterns)
        elif isinstance(item, URLPattern):
            yield item


def test_every_api_view_declares_auth_permissions_and_throttling() -> None:
    failures: list[str] = []
    function_views = set()
    for pattern in _patterns(urlpatterns):
        view_class = getattr(pattern.callback, "view_class", None)
        if view_class is None:
            function_views.add(pattern.callback)
            continue
        route = str(pattern.pattern)
        policy_bases = [base for base in view_class.__mro__ if base is not APIView]
        if not any("authentication_classes" in base.__dict__ for base in policy_bases):
            failures.append(f"{route}: authentication_classes")
        if not any("permission_classes" in base.__dict__ for base in policy_bases):
            failures.append(f"{route}: permission_classes")
        if not any("throttle_classes" in base.__dict__ for base in policy_bases):
            failures.append(f"{route}: throttle_classes")
            continue
        throttle_classes = getattr(view_class, "throttle_classes", None)
        if throttle_classes and not (
            getattr(view_class, "throttle_scope", None)
            or "get_throttles" in view_class.__dict__
        ):
            failures.append(f"{route}: throttle_scope")

    assert failures == []
    # The SSE endpoint cannot use APIView because it streams an async iterator;
    # its handshake performs the same token auth and shared throttle manually.
    assert function_views == {party_game_stream}

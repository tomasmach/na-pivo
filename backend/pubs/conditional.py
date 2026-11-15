"""Let API readers skip a download when their copy is still current."""

from __future__ import annotations

from django.middleware.http import ConditionalGetMiddleware


class ApiConditionalGetMiddleware(ConditionalGetMiddleware):
    """Answer an API GET with 304 when the body equals the copy the client holds.

    The ETag is a hash of the uncompressed body, so a client gets 304 only when a
    full answer would be byte-identical to what it sent the tag for. Clients that
    never send If-None-Match keep getting the same 200 responses as before.
    """

    def process_response(self, request, response):
        if not request.path.startswith("/v1/"):
            return response
        if request.method == "GET" and not response.has_header("Cache-Control"):
            response["Cache-Control"] = "private, no-cache"
        return super().process_response(request, response)

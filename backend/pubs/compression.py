"""Response compression that never touches streamed responses."""

from __future__ import annotations

from django.middleware.gzip import GZipMiddleware


class BufferedGZipMiddleware(GZipMiddleware):
    """Gzip complete responses; pass every streamed response through untouched.

    Django's GZipMiddleware also wraps streaming responses, and gzip holds data
    back until it has enough to compress. On a server-sent-events stream (the
    live party game) that turns each event into silence followed by a burst, so
    streams are skipped by default instead of being opted out at each call site.
    Django adds random filename padding to every compressed body (Heal The
    Breach), which masks length changes caused by secrets in the response.
    """

    def process_response(self, request, response):
        if response.streaming or response.get("Content-Type", "").startswith("text/event-stream"):
            return response
        return super().process_response(request, response)

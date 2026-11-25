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
        content_type = response.get("Content-Type", "")
        if response.streaming or content_type.startswith("text/event-stream"):
            return response
        # Images and fonts are compressed already: gzip saves nothing, and with the random padding
        # it would sometimes even send a WebP or an AVIF bigger than it is.
        if content_type.startswith(("image/", "font/")) and not content_type.startswith("image/svg"):
            return response
        return super().process_response(request, response)

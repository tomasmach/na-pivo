"""Compress only large, frequently downloaded JSON snapshots."""

from django.middleware.gzip import GZipMiddleware


class LargeSnapshotGZipMiddleware(GZipMiddleware):
    def process_response(self, request, response):
        if request.method != "GET" or request.path not in {
            "/v1/pubs/near",
            "/v1/drinks",
            "/v1/pub-visits",
        }:
            return response
        if response.streaming:
            return response
        if not response.get("Content-Type", "").startswith("application/json"):
            return response
        return super().process_response(request, response)

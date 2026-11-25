"""POST /v1/beer-label-scan — the "Vyfoť etiketu" helper for drinking at home."""

from __future__ import annotations

from datetime import UTC, datetime

import requests
from django.conf import settings
from django.utils.translation import gettext
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
from pubs.api.views import (
    _coded_error,
    _install_menu_scan_upload_limit,
    _menu_scan_count_today,
    _menu_scan_daily_cap_response,
    _menu_scan_request_too_large,
    _menu_scan_too_large_response,
    _menu_scan_vision_unavailable,
)
from pubs.enrichment.openrouter import (
    OpenRouterDailyCapExceededError,
    OpenRouterUnavailableError,
)
from pubs.label_scan import scan_label
from pubs.menu_scan import MenuScanError, validate_and_prepare_image


class BeerLabelScanView(APIView):
    """
    POST /v1/beer-label-scan (multipart, one ``image`` file part)

    Reads one beer from a bottle or can label and matches it against the beer
    catalogue. A pure extractor: no DB writes, no XP, no stored image. Shares
    the menu scan's upload limits, throttle scope, per-account daily cap and
    the OpenRouter daily budget, so it can never spend more than the menu scan
    already may.

    Responses
    ---------
    200 ``{"beer": null | {"name", "brewery", "matched", "serving_type",
        "volume_ml"}, "model": <str>}``; ``beer`` is null when nothing was read.
    400 ``{"detail", "code": image_missing | image_invalid | image_too_large}``
    429 throttled (scope ``menu_scan``)
    503 ``{"detail", "code": vision_unavailable | daily_cap}``
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "menu_scan"

    def post(self, request: Request) -> Response:
        if _menu_scan_request_too_large(request):
            return _menu_scan_too_large_response()
        _install_menu_scan_upload_limit(request)
        upload = request.FILES.get("image")
        if request._request.META.get("MENU_SCAN_UPLOAD_TOO_LARGE") == "1":
            return _menu_scan_too_large_response()
        if upload is None:
            return Response(
                {"detail": gettext("Chybí fotka etikety."), "code": "image_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            jpeg_bytes = validate_and_prepare_image(upload)
        except MenuScanError as exc:
            return _coded_error(exc)

        if not settings.OPENROUTER_API_KEY:
            return _menu_scan_vision_unavailable()
        cap = settings.MENU_SCAN_DAILY_PER_ACCOUNT_CAP
        account_id = getattr(request.user, "pk", None)
        if (
            cap
            and account_id is not None
            and _menu_scan_count_today(account_id, datetime.now(tz=UTC)) > cap
        ):
            return _menu_scan_daily_cap_response()

        try:
            beer = scan_label(jpeg_bytes)
        except OpenRouterDailyCapExceededError:
            return _menu_scan_daily_cap_response()
        except OpenRouterUnavailableError, requests.RequestException:
            return _menu_scan_vision_unavailable()
        return Response({"beer": beer, "model": settings.OPENROUTER_MODEL})

"""Prague public transport for the "last ride home" card of a beer evening."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs import transit
from pubs.api.authentication import AccountTokenAuthentication
from pubs.api.serializers import TransitLastDirectQuerySerializer
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle

_UNAVAILABLE = {"detail": "transit_unavailable"}


class TransitStopsView(APIView):
    """GET /v1/transit/stops — every PID stop a stored trip uses.

    The app picks the stops near home itself, so home never reaches the server.

    Response 200: {"feed_version": str, "stops": [[stop_id, lat, lng], ...]}
    Response 503: {"detail": "transit_unavailable"} before the first import.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "transit_stops"

    def get(self, request: Request) -> Response:
        feed = transit.active_feed()
        if feed is None:
            return Response(_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(transit.stops_payload(feed))


class TransitLastDirectView(APIView):
    """GET /v1/transit/last-direct?from_lat=&from_lng=&to_stop_ids=A,B — last ride home tonight.

    The last direct PID ride leaving within 500 m of the point and stopping at
    one of ``to_stop_ids`` before the night ends at 04:00, if it has not left yet.

    Response 200: {"departure": null} or {"departure": {"line", "headsign",
        "route_type", "from_stop_id", "from_stop_name", "to_stop_id",
        "to_stop_name", "departs_at": "<ISO 8601, Prague offset>"}}
    Response 400: serializer errors.
    Response 503: {"detail": "transit_unavailable"} without a current timetable.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "transit_last_direct"

    def get(self, request: Request) -> Response:
        serializer = TransitLastDirectQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        now = timezone.now()
        feed = transit.active_feed()
        if feed is None or not transit.feed_covers(feed, transit.night_end(now)):
            return Response(_UNAVAILABLE, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        data = serializer.validated_data
        departure = transit.last_direct(
            feed, data["from_lat"], data["from_lng"], data["to_stop_ids"], now
        )
        return Response({"departure": departure})

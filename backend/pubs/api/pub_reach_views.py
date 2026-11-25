"""POST /v1/pub-reach: the app's batch of pins seen on the map, pub pages opened and navigation taps."""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs import pub_reach
from pubs.models import Account, PubReach

from .authentication import AccountTokenAuthentication
from .throttling import SharedScopedRateThrottle

logger = logging.getLogger("pubs.api.pub_reach")

MAX_EVENTS = 500


class PubReachEventSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=PubReach.choices)
    pub = serializers.RegexField(pub_reach.CACHE_KEY_RE, max_length=12)
    at = serializers.DateTimeField(required=False)


class PubReachView(APIView):
    """Counts only. A malformed event is skipped so it cannot cost the rest of the batch.

    Distinct people are counted for a signed-in or anonymous account; a request
    without a token still adds to the counts.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "pub_reach"

    def post(self, request):
        raw = request.data.get("events") if isinstance(request.data, dict) else None
        if not isinstance(raw, list) or len(raw) > MAX_EVENTS:
            return Response(
                {"detail": f"events must be a list of at most {MAX_EVENTS} items."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        events = []
        for item in raw:
            serializer = PubReachEventSerializer(data=item if isinstance(item, dict) else {})
            if not serializer.is_valid():
                continue
            data = serializer.validated_data
            at = min(data.get("at") or now, now)
            if at < now - pub_reach.MAX_EVENT_AGE:
                continue
            events.append(pub_reach.ReachEvent(data["pub"].lower(), pub_reach.reach_day(at), data["type"]))

        account = request.user if isinstance(request.user, Account) else None
        try:
            with transaction.atomic():
                visitor = None
                if account is not None:
                    # Deletion and merge take this lock; a batch from a removed account is dropped.
                    if not Account.objects.select_for_update().filter(
                        pk=account.pk, status=Account.Status.ACTIVE
                    ).exists():
                        return Response({"accepted": 0}, status=status.HTTP_202_ACCEPTED)
                    visitor = pub_reach.visitor_id(account.pk)
                pub_reach.record(events, pub_reach.APP, visitor=visitor)
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-reach: could not save a batch (%s)", type(exc).__name__)
            return Response({"detail": "internal_error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"accepted": len(events)}, status=status.HTTP_202_ACCEPTED)

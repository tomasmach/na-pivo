"""
pubs.api.views — DRF views for the pub-hours API.

Endpoints
---------
POST /v1/pub-hours   → PubHoursView
GET  /v1/health      → HealthView
"""

from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.models import Account, generate_account_token, hash_account_token

from .authentication import AccountTokenAuthentication
from .cache import get_or_enrich
from .serializers import (
    AccountMeSerializer,
    AccountRegisterSerializer,
    AccountSerializer,
    PubHoursRequestSerializer,
    PubHoursResponseSerializer,
)

logger = logging.getLogger(__name__)


class HealthView(APIView):
    """GET /v1/health — liveness probe."""

    def get(self, request: Request) -> Response:  # noqa: ARG002
        return Response({"status": "ok"})


class PubHoursView(APIView):
    """
    POST /v1/pub-hours

    Accept a list of pubs and return opening hours + isOpenNow for each.
    Pubs are served from cache when fresh; otherwise enriched synchronously
    up to sync_budget, with the remainder queued as EnrichTask rows.
    """

    def post(self, request: Request) -> Response:
        req_serializer = PubHoursRequestSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated = req_serializer.validated_data
        pubs: list[dict] = validated["pubs"]
        sync_budget: int | None = validated.get("sync_budget")  # None → use settings default

        try:
            results = get_or_enrich(pubs, sync_budget=sync_budget)
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-hours: unexpected error: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        resp_serializer = PubHoursResponseSerializer({"results": results})
        return Response(resp_serializer.data, status=status.HTTP_200_OK)


class AccountView(APIView):
    """
    POST /v1/account

    Idempotently register (ensure) an anonymous device-bound account. The mobile
    app sends the device_id it generated and persisted locally; we get_or_create
    the Account and return it with a token. Re-posting a known device_id returns
    the same account with a freshly ROTATED token (only the token's hash is
    stored, so the original cannot be re-returned), letting a client that lost its
    token recover.

    Unauthenticated by design — this is how a brand-new device gets its first
    credentials — but throttled per-IP (scope "account") to blunt scripted mass
    account creation.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account"

    def post(self, request: Request) -> Response:
        serializer = AccountRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        device_id = serializer.validated_data["device_id"]
        raw_token = generate_account_token()
        try:
            # Idempotent on the device_id UNIQUE constraint: under a concurrent
            # first-registration race, get_or_create wraps the INSERT in a
            # savepoint and re-SELECTs on IntegrityError, so a lost-response retry
            # never creates a duplicate Account.
            #
            # Only the SHA-256 hash of the token is stored, so the raw token cannot
            # be recovered later — re-registration therefore ROTATES it (issues a
            # fresh token). For the mobile client this happens only on recovery (it
            # caches the token and re-registers solely after a cache miss), where a
            # fresh working token is exactly what it needs.
            #
            # SECURITY TODO (blocker for the future credentials feature): a re-POST
            # of a known device_id still hands back a usable token, so device_id is
            # effectively a bearer-equivalent recovery key. Acceptable ONLY while
            # accounts hold no personal data. Once real credentials / per-user data
            # attach to Account, device_id must NOT recover a token for a *claimed*
            # account — require the verified credential — and stop differentiating
            # 200/201 here to avoid account-existence enumeration.
            account, created = Account.objects.get_or_create(
                device_id=device_id,
                defaults={"token_hash": hash_account_token(raw_token)},
            )
            if not created:
                # Rotate the token (old hash discarded) and touch last_seen_at
                # (auto_now fires because the field is in update_fields).
                raw_token = generate_account_token()
                account.token_hash = hash_account_token(raw_token)
                account.save(update_fields=["token_hash", "last_seen_at"])
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "account: unexpected error registering device %r: %s",
                device_id,
                exc,
                exc_info=True,
            )
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # The raw token is injected here — it is never a model field, never stored.
        body = dict(AccountSerializer(account).data)
        body["token"] = raw_token
        body["created"] = created
        return Response(
            body,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class AccountMeView(APIView):
    """
    GET /v1/account/me

    Return the account that owns the supplied Bearer token. Token-authenticated;
    never echoes the token back. This is the scaffolding future per-user features
    build on.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        # request.user is the authenticated Account instance.
        return Response(AccountMeSerializer(request.user).data, status=status.HTTP_200_OK)

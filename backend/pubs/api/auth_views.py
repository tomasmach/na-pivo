"""
pubs.api.auth_views — DRF endpoints for user accounts.

All real logic lives in :mod:`pubs.accounts`; these views only parse input, call
the service, and shape the response. Every successful auth response is the
canonical :class:`AccountMeSerializer` body plus a raw ``token`` (the bearer
secret the client stores) — except link/unlink/set-password, which keep the
current session and return no new token.

Endpoint map (all under /v1/):
  POST auth/register                — email+password, claims the anon account
  POST auth/login                   — email+password
  POST auth/google                  — Google ID-token sign-in / claim
  POST auth/apple                   — Apple identity-token sign-in / claim
  POST auth/link                    — link a provider to the signed-in account
  POST auth/unlink                  — remove a sign-in method (keeps >= 1)
  POST auth/set-password            — add / change the password (escape hatch)
  POST auth/logout                  — revoke this token (or all)
  POST auth/request-password-reset  — email a reset link (always 202)
  POST auth/reset-password          — consume reset token, set new password
  POST auth/request-email-verify    — (re)send the verification email
  POST auth/verify-email            — consume an email-verification token
Account deletion is DELETE /v1/account/me (see pubs.api.views.AccountMeView).
"""

from __future__ import annotations

import logging
import uuid

from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs import accounts
from pubs.accounts import AccountError
from pubs.models import Account, AuthIdentity

from . import auth_serializers as s
from .authentication import AccountTokenAuthentication
from .serializers import AccountMeSerializer

logger = logging.getLogger("pubs.api.auth")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _account_state(
    account: Account,
    *,
    request: Request | None = None,
    token: str | None = None,
    created: bool | None = None,
) -> dict:
    # Thread the request into the serializer context so avatar_url is built
    # ABSOLUTE — the highest-leverage bug if omitted (mobile <Image> can't load a
    # relative /media/ path). Every auth response goes through here.
    data = dict(AccountMeSerializer(account, context={"request": request}).data)
    if token is not None:
        data["token"] = token
    if created is not None:
        data["created"] = created
    return data


def _current_account(request: Request) -> Account | None:
    """The Account behind an optional Bearer token, or None when unauthenticated."""
    user = getattr(request, "user", None)
    return user if isinstance(user, Account) else None


def _optional_bearer_account(request: Request) -> Account | None:
    """Best-effort bearer lookup for endpoints where auth is only a merge hint."""
    try:
        result = AccountTokenAuthentication().authenticate(request)
    except AuthenticationFailed:
        return None
    if result is None:
        return None
    account, _raw_token = result
    return account if isinstance(account, Account) else None


def _error_response(exc: AccountError) -> Response:
    return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)


class _AuthView(APIView):
    """Base view: scoped throttling + uniform AccountError / 500 handling."""

    throttle_classes = [ScopedRateThrottle]

    def _safe(self, fn):
        try:
            return fn()
        except AccountError as exc:
            return _error_response(exc)
        except Exception as exc:  # noqa: BLE001
            logger.error("auth: unexpected error: %s", exc, exc_info=True)
            return Response(
                {"detail": "Internal server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# ---------------------------------------------------------------------------
# Email + password
# ---------------------------------------------------------------------------
class RegisterView(_AuthView):
    # Optional auth: a Bearer token identifies the anonymous account to CLAIM so
    # its already-synced data follows the new credential.
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            account = _current_account(request)
            if account is None:
                account = Account.objects.create(device_id=f"reg-{uuid.uuid4()}")
            account, token = accounts.register_email(
                account,
                email=ser.validated_data["email"],
                password=ser.validated_data["password"],
                display_name=ser.validated_data.get("display_name", ""),
            )
            return Response(
                _account_state(account, request=request, token=token, created=True),
                status=status.HTTP_201_CREATED,
            )

        return self._safe(run)


class LoginView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.LoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            account, token = accounts.login_email(
                email=ser.validated_data["email"],
                password=ser.validated_data["password"],
                current_account=_optional_bearer_account(request),
            )
            return Response(
                _account_state(account, request=request, token=token),
                status=status.HTTP_200_OK,
            )

        return self._safe(run)


# ---------------------------------------------------------------------------
# Social sign-in / claim
# ---------------------------------------------------------------------------
class GoogleAuthView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.GoogleAuthSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            claims = accounts.verify_provider_token(
                AuthIdentity.Provider.GOOGLE, ser.validated_data["id_token"]
            )
            account, token, created = accounts.resolve_social(
                _current_account(request),
                provider=AuthIdentity.Provider.GOOGLE,
                claims=claims,
                # Forward Google's asserted name so display_name is captured (the
                # token also carries `picture`, captured in resolve_social).
                full_name=claims.get("name", ""),
            )
            return Response(
                _account_state(account, request=request, token=token, created=created),
                status=status.HTTP_200_OK,
            )

        return self._safe(run)


class AppleAuthView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.AppleAuthSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            data = ser.validated_data
            claims = accounts.verify_provider_token(
                AuthIdentity.Provider.APPLE, data["identity_token"]
            )
            refresh = accounts.apple_refresh_from_code(data.get("authorization_code", ""))
            account, token, created = accounts.resolve_social(
                _current_account(request),
                provider=AuthIdentity.Provider.APPLE,
                claims=claims,
                full_name=data.get("full_name", ""),
                apple_refresh_token=refresh,
            )
            return Response(
                _account_state(account, request=request, token=token, created=created),
                status=status.HTTP_200_OK,
            )

        return self._safe(run)


# ---------------------------------------------------------------------------
# Linking / unlinking (authenticated)
# ---------------------------------------------------------------------------
class LinkView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.LinkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            data = ser.validated_data
            provider = data["provider"]
            if provider == AuthIdentity.Provider.GOOGLE:
                claims = accounts.verify_provider_token(provider, data["id_token"])
                refresh = ""
            else:
                claims = accounts.verify_provider_token(provider, data["identity_token"])
                refresh = accounts.apple_refresh_from_code(data.get("authorization_code", ""))
            accounts.link_social(
                request.user,
                provider=provider,
                claims=claims,
                apple_refresh_token=refresh,
                full_name=data.get("full_name", ""),
            )
            return Response(
                _account_state(request.user, request=request), status=status.HTTP_200_OK
            )

        return self._safe(run)


class UnlinkView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.UnlinkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            accounts.unlink(request.user, provider=ser.validated_data["provider"])
            return Response(
                _account_state(request.user, request=request), status=status.HTTP_200_OK
            )

        return self._safe(run)


class SetPasswordView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.SetPasswordSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            accounts.set_password(
                request.user,
                ser.validated_data["password"],
                email=ser.validated_data.get("email") or None,
            )
            # If this just attached an email, kick off verification.
            accounts.request_email_verification(request.user)
            return Response(
                _account_state(request.user, request=request), status=status.HTTP_200_OK
            )

        return self._safe(run)


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------
class LogoutView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.LogoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            if ser.validated_data.get("all"):
                accounts.revoke_all_tokens(request.user)
            else:
                # request.auth is the raw presented token (see authentication.py).
                accounts.revoke_token(request.auth)
            return Response({"ok": True}, status=status.HTTP_200_OK)

        return self._safe(run)


# ---------------------------------------------------------------------------
# Password reset & email verification
# ---------------------------------------------------------------------------
class RequestPasswordResetView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth_email"

    def post(self, request: Request) -> Response:
        ser = s.RequestPasswordResetSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            # Always 202 regardless of whether the email exists (no enumeration).
            accounts.request_password_reset(ser.validated_data["email"])
            return Response({"ok": True}, status=status.HTTP_202_ACCEPTED)

        return self._safe(run)


class ResetPasswordView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.ResetPasswordSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            account = accounts.reset_password(
                ser.validated_data["token"], new_password=ser.validated_data["password"]
            )
            # Reset revoked all sessions; issue a fresh one so the user is logged in.
            token = accounts.issue_token(account)
            return Response(
                _account_state(account, request=request, token=token),
                status=status.HTTP_200_OK,
            )

        return self._safe(run)


class RequestEmailVerificationView(_AuthView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth_email"

    def post(self, request: Request) -> Response:
        def run() -> Response:
            accounts.request_email_verification(request.user)
            return Response({"ok": True}, status=status.HTTP_202_ACCEPTED)

        return self._safe(run)


class VerifyEmailView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.VerifyEmailSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            accounts.verify_email(ser.validated_data["token"])
            return Response({"ok": True}, status=status.HTTP_200_OK)

        return self._safe(run)

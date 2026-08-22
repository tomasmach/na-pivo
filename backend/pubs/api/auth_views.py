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
  GET  auth/reset?token=...         — browser landing page that opens the app
  POST auth/reset-password          — consume reset token, set new password
  POST auth/request-email-verify    — (re)send the verification email
  GET  auth/verify-email?token=...  — browser-friendly verification link from e-mail
  POST auth/verify-email            — consume an email-verification token from the app
Account deletion is DELETE /v1/account/me (see pubs.api.views.AccountMeView).
"""

from __future__ import annotations

import logging
import uuid
from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpResponse
from django.urls import reverse
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs import accounts
from pubs.accounts import AccountError
from pubs.api.throttling import SharedScopedRateThrottle as ScopedRateThrottle
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


def _bearer_was_present(request: Request) -> bool:
    """Return only whether the request carried a Bearer header, never its value."""
    scheme = str(request.META.get("HTTP_AUTHORIZATION", "")).partition(" ")[0]
    return scheme.lower() == "bearer"


def _log_auth_failure(
    flow: str, reason: str, *, anonymous_bearer_present: bool
) -> None:
    logger.warning(
        "authentication flow rejected",
        extra={
            "event": "auth_failure",
            "observability": {
                "flow": flow,
                "reason": reason,
                "anonymous_bearer_present": anonymous_bearer_present,
            },
        },
    )


def _error_response(exc: AccountError) -> Response:
    return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)


def _verification_link_base(request: Request) -> str:
    """Absolute HTTPS action URL used by verification e-mails."""
    return request.build_absolute_uri(reverse("auth-verify-email"))


def _verify_email_page(
    *,
    title: str,
    body: str,
    success: bool,
    status_code: int,
    action_link: str | None = None,
    action_label: str = "Otevřít Na Pivo",
) -> HttpResponse:
    """Small standalone HTML page for users opening auth links from e-mail."""
    accent = "#46c173" if success else "#d99a2b"
    app_link = action_link or f"{settings.APP_DEEP_LINK_SCHEME}://"
    html = f"""<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} - Na Pivo</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #1c1410;
      --card: #241a13;
      --text: #f3e9dd;
      --muted: #b9a896;
      --border: #3a2c20;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}
    main {{
      width: min(100%, 440px);
      padding: 32px 24px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--card);
      text-align: center;
    }}
    .brand {{
      margin-bottom: 14px;
      color: #d99a2b;
      font-size: 22px;
      font-weight: 800;
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: 28px;
      line-height: 1.15;
    }}
    p {{
      margin: 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.55;
    }}
    .dot {{
      width: 48px;
      height: 48px;
      margin: 0 auto 18px;
      border-radius: 999px;
      background: {accent};
      box-shadow: 0 0 0 8px rgba(217, 154, 43, 0.12);
    }}
    a {{
      display: block;
      margin-top: 24px;
      padding: 17px 20px;
      border-radius: 999px;
      background: #d99a2b;
      color: #1c1410;
      font-size: 17px;
      font-weight: 800;
      text-decoration: none;
    }}
  </style>
</head>
<body>
  <main>
    <div class="brand">Na Pivo</div>
    <div class="dot" aria-hidden="true"></div>
    <h1>{title}</h1>
    <p>{body}</p>
    <a href="{app_link}">{action_label}</a>
  </main>
</body>
</html>"""
    return HttpResponse(html, status=status_code, content_type="text/html; charset=utf-8")


class _AuthView(APIView):
    """Base view: scoped throttling + uniform AccountError / 500 handling."""

    throttle_classes = [ScopedRateThrottle]

    def _safe(
        self,
        fn,
        *,
        flow: str | None = None,
        anonymous_bearer_present: bool = False,
    ):
        try:
            return fn()
        except AccountError as exc:
            if flow is not None:
                _log_auth_failure(
                    flow,
                    exc.code,
                    anonymous_bearer_present=anonymous_bearer_present,
                )
            return _error_response(exc)
        except Exception as exc:  # noqa: BLE001
            observability = {"reason": "unexpected_error"}
            if flow is not None:
                observability.update(
                    {
                        "flow": flow,
                        "anonymous_bearer_present": anonymous_bearer_present,
                    }
                )
            logger.error(
                "auth: unexpected error (%s)",
                type(exc).__name__,
                extra={"event": "auth_failure", "observability": observability},
            )
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
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.RegisterSerializer(data=request.data)
        if not ser.is_valid():
            _log_auth_failure(
                "register",
                "invalid_request",
                anonymous_bearer_present=_bearer_was_present(request),
            )
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        def run() -> Response:
            account = _optional_bearer_account(request)
            merge_operation_id = ser.validated_data.get("merge_operation_id")
            if account is None and merge_operation_id is None:
                account = Account.objects.create(device_id=f"reg-{uuid.uuid4()}")
            account, token = accounts.register_email(
                account,
                email=ser.validated_data["email"],
                password=ser.validated_data["password"],
                display_name=ser.validated_data.get("display_name", ""),
                verification_link_base=_verification_link_base(request),
                merge_operation_id=merge_operation_id,
            )
            return Response(
                _account_state(account, request=request, token=token, created=True),
                status=status.HTTP_201_CREATED,
            )

        return self._safe(
            run,
            flow="register",
            anonymous_bearer_present=_bearer_was_present(request),
        )


class LoginView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.LoginSerializer(data=request.data)
        if not ser.is_valid():
            _log_auth_failure(
                "login",
                "invalid_request",
                anonymous_bearer_present=_bearer_was_present(request),
            )
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        def run() -> Response:
            account, token = accounts.login_email(
                email=ser.validated_data["email"],
                password=ser.validated_data["password"],
                current_account=_optional_bearer_account(request),
                merge_operation_id=ser.validated_data.get("merge_operation_id"),
            )
            return Response(
                _account_state(account, request=request, token=token),
                status=status.HTTP_200_OK,
            )

        return self._safe(
            run,
            flow="login",
            anonymous_bearer_present=_bearer_was_present(request),
        )


# ---------------------------------------------------------------------------
# Social sign-in / claim
# ---------------------------------------------------------------------------
class GoogleAuthView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.GoogleAuthSerializer(data=request.data)
        if not ser.is_valid():
            _log_auth_failure(
                "google",
                "invalid_request",
                anonymous_bearer_present=_bearer_was_present(request),
            )
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        def run() -> Response:
            claims = accounts.verify_provider_token(
                AuthIdentity.Provider.GOOGLE, ser.validated_data["id_token"]
            )
            account, token, created = accounts.resolve_social(
                _optional_bearer_account(request),
                provider=AuthIdentity.Provider.GOOGLE,
                claims=claims,
                # Forward Google's asserted name so display_name is captured (the
                # token also carries `picture`, captured in resolve_social).
                full_name=claims.get("name", ""),
                merge_operation_id=ser.validated_data.get("merge_operation_id"),
            )
            return Response(
                _account_state(account, request=request, token=token, created=created),
                status=status.HTTP_200_OK,
            )

        return self._safe(
            run,
            flow="google",
            anonymous_bearer_present=_bearer_was_present(request),
        )


class AppleAuthView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.AppleAuthSerializer(data=request.data)
        if not ser.is_valid():
            _log_auth_failure(
                "apple",
                "invalid_request",
                anonymous_bearer_present=_bearer_was_present(request),
            )
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        def run() -> Response:
            data = ser.validated_data
            claims = accounts.verify_provider_token(
                AuthIdentity.Provider.APPLE, data["identity_token"]
            )
            refresh = accounts.apple_refresh_from_code(data.get("authorization_code", ""))
            account, token, created = accounts.resolve_social(
                _optional_bearer_account(request),
                provider=AuthIdentity.Provider.APPLE,
                claims=claims,
                full_name=data.get("full_name", ""),
                apple_refresh_token=refresh,
                merge_operation_id=data.get("merge_operation_id"),
            )
            return Response(
                _account_state(account, request=request, token=token, created=created),
                status=status.HTTP_200_OK,
            )

        return self._safe(
            run,
            flow="apple",
            anonymous_bearer_present=_bearer_was_present(request),
        )


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
            accounts.request_email_verification(
                request.user, link_base=_verification_link_base(request)
            )
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
            accounts.request_password_reset(
                ser.validated_data["email"],
                link_base=request.build_absolute_uri(reverse("auth-reset-page")),
            )
            return Response({"ok": True}, status=status.HTTP_202_ACCEPTED)

        return self._safe(run)


class ResetPasswordLandingView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def get(self, request: Request) -> HttpResponse:
        raw_token = str(request.query_params.get("token") or "").strip()
        if not raw_token:
            return _verify_email_page(
                title="Tenhle odkaz nefunguje",
                body=(
                    "Odkazu chybí kód. Otevři e-mail znovu a klepni na tlačítko, "
                    "nebo si v appce řekni o nový."
                ),
                success=False,
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        app_link = (
            f"{settings.APP_DEEP_LINK_SCHEME}://auth/reset?"
            f"{urlencode({'token': raw_token})}"
        )
        return _verify_email_page(
            title="Nové heslo",
            body=(
                "Klepni na tlačítko a nastav si nové heslo přímo v appce. "
                "Otevři tenhle odkaz na telefonu, kde máš Na Pivo nainstalované."
            ),
            success=True,
            status_code=status.HTTP_200_OK,
            action_link=app_link,
            action_label="Nastavit nové heslo v appce",
        )


class ResetPasswordView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        ser = s.ResetPasswordSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            account, token = accounts.reset_password(
                ser.validated_data["token"], new_password=ser.validated_data["password"]
            )
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
            accounts.request_email_verification(
                request.user, link_base=_verification_link_base(request)
            )
            return Response({"ok": True}, status=status.HTTP_202_ACCEPTED)

        return self._safe(run)


class VerifyEmailView(_AuthView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def get(self, request: Request) -> HttpResponse:
        raw_token = str(request.query_params.get("token") or "").strip()
        if not raw_token:
            return _verify_email_page(
                title="Chybí ověřovací kód",
                body="Odkaz vypadá neúplně. V appce si nech poslat nový ověřovací e-mail.",
                success=False,
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        try:
            accounts.verify_email(raw_token)
        except AccountError:
            return _verify_email_page(
                title="Ověření se nezdařilo",
                body=(
                    "Odkaz už neplatí nebo byl použitý. "
                    "V appce si nech poslat nový ověřovací e-mail."
                ),
                success=False,
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "auth: unexpected email verification link error (%s)",
                type(exc).__name__,
            )
            return _verify_email_page(
                title="Něco se pokazilo",
                body="Ověření teď neproběhlo. Zkus odkaz otevřít za chvíli znovu.",
                success=False,
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return _verify_email_page(
            title="E-mail ověřen",
            body="Hotovo. E-mail máš ověřený, můžeš se vrátit do appky.",
            success=True,
            status_code=status.HTTP_200_OK,
        )

    def post(self, request: Request) -> Response:
        ser = s.VerifyEmailSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        def run() -> Response:
            accounts.verify_email(ser.validated_data["token"])
            return Response({"ok": True}, status=status.HTTP_200_OK)

        return self._safe(run)

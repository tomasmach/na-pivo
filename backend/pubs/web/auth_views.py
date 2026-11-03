"""Sign-in pages of the web: login, registration, forgotten password, Google and Apple.

Every credential check runs the same code as the app's ``/v1/auth/*``: the DRF
serializers validate the form, ``pubs.accounts`` proves the credential and
issues the token, and the token becomes a browser session (``pubs.web.session``).
Each POST is throttled with the same scope and per-IP counter as the API, so the
web and the API share one budget.
"""

from __future__ import annotations

import json
import logging
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.http import (
    Http404,
    HttpRequest,
    HttpResponse,
    HttpResponseNotAllowed,
    HttpResponseRedirect,
)
from django.urls import reverse
from django.utils.translation import gettext
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from pubs import accounts
from pubs.accounts import AccountError
from pubs.api import auth_serializers as s
from pubs.api.throttling import SharedScopedRateThrottle
from pubs.models import AuthIdentity
from pubs.web.pages import render_page, web_page
from pubs.web.routes import web_reverse
from pubs.web.session import end_session, safe_next, start_session

logger = logging.getLogger("pubs.web.auth")

_OAUTH_SESSION_KEY = "np_oauth"
_PROVIDERS = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "scope": "openid email profile",
        "response_type": "id_token",
    },
    "apple": {
        "authorize": "https://appleid.apple.com/auth/authorize",
        "scope": "name email",
        "response_type": "code id_token",
    },
}


def _client_id(provider: str) -> str:
    return settings.GOOGLE_WEB_CLIENT_ID if provider == "google" else settings.APPLE_SERVICES_ID


def _social_buttons() -> dict[str, bool]:
    return {provider: bool(_client_id(provider)) for provider in _PROVIDERS}


def _over_limit(request: HttpRequest, scope: str) -> bool:
    """Count one attempt against the API's own throttle scope."""

    class _Scope:
        throttle_scope = scope

    return not SharedScopedRateThrottle().allow_request(request, _Scope)


def _after_sign_in(request: HttpRequest, raw_token: str, next_url: str | None) -> HttpResponse:
    start_session(request, raw_token)
    return HttpResponseRedirect(safe_next(request, next_url) or web_reverse("web-diary"))


def _first_errors(errors: dict) -> dict[str, str]:
    return {field: str(messages[0]) for field, messages in errors.items() if messages}


def _render_auth(
    request: HttpRequest, mode: str, *, values: dict, errors: dict, error: str = "", status: int = 200, sent: bool = False
):
    titles = {
        "login": gettext("Přihlášení"),
        "register": gettext("Registrace"),
        "forgot": gettext("Zapomenuté heslo"),
    }
    return render_page(
        request,
        "web/auth.html",
        {
            "mode": mode,
            "values": values,
            "errors": errors,
            "error": error,
            "next": safe_next(request, request.POST.get("next") or request.GET.get("next")) or "",
            "social": _social_buttons(),
            "sent": sent,
        },
        title=titles[mode],
        status=status,
        indexable=mode != "forgot",
    )


def _too_many(request: HttpRequest, mode: str, values: dict) -> HttpResponse:
    return _render_auth(
        request,
        mode,
        values=values,
        errors={},
        error=gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."),
        status=429,
    )


@web_page
def login(request: HttpRequest) -> HttpResponse:
    if request.web_account is not None and request.method == "GET":
        return HttpResponseRedirect(safe_next(request, request.GET.get("next")) or web_reverse("web-diary"))
    if request.method == "GET":
        return _render_auth(request, "login", values={}, errors={})
    if request.method != "POST":
        return HttpResponseNotAllowed(["GET", "POST"])
    values = {"email": request.POST.get("email", "")[:254]}
    if _over_limit(request, "auth"):
        return _too_many(request, "login", values)
    form = s.LoginSerializer(data={"email": request.POST.get("email", ""), "password": request.POST.get("password", "")})
    if not form.is_valid():
        return _render_auth(request, "login", values=values, errors=_first_errors(form.errors), status=400)
    try:
        _account, token = accounts.login_email(
            email=form.validated_data["email"], password=form.validated_data["password"]
        )
    except AccountError as exc:
        return _render_auth(request, "login", values=values, errors={}, error=str(exc.message), status=exc.http_status)
    return _after_sign_in(request, token, request.POST.get("next"))


@web_page
def register(request: HttpRequest) -> HttpResponse:
    if request.web_account is not None and request.method == "GET":
        return HttpResponseRedirect(web_reverse("web-diary"))
    if request.method == "GET":
        return _render_auth(request, "register", values={}, errors={})
    if request.method != "POST":
        return HttpResponseNotAllowed(["GET", "POST"])
    values = {
        "display_name": request.POST.get("display_name", "")[:120],
        "email": request.POST.get("email", "")[:254],
    }
    if _over_limit(request, "auth"):
        return _too_many(request, "register", values)
    form = s.RegisterSerializer(
        data={
            "display_name": request.POST.get("display_name", "").strip(),
            "email": request.POST.get("email", ""),
            "password": request.POST.get("password", ""),
        }
    )
    if not form.is_valid():
        return _render_auth(request, "register", values=values, errors=_first_errors(form.errors), status=400)
    try:
        _account, token = accounts.register_email(
            accounts.new_registration_account(),
            email=form.validated_data["email"],
            password=form.validated_data["password"],
            display_name=form.validated_data.get("display_name", ""),
            verification_link_base=request.build_absolute_uri(reverse("auth-verify-email")),
        )
    except AccountError as exc:
        return _render_auth(request, "register", values=values, errors={}, error=str(exc.message), status=exc.http_status)
    return _after_sign_in(request, token, request.POST.get("next"))


@web_page
def forgot_password(request: HttpRequest) -> HttpResponse:
    """Send the same reset e-mail as the app; its link opens the reset in the app."""

    if request.method == "GET":
        return _render_auth(request, "forgot", values={}, errors={})
    if request.method != "POST":
        return HttpResponseNotAllowed(["GET", "POST"])
    values = {"email": request.POST.get("email", "")[:254]}
    if _over_limit(request, "auth_email"):
        return _too_many(request, "forgot", values)
    form = s.RequestPasswordResetSerializer(data={"email": request.POST.get("email", "")})
    if not form.is_valid():
        return _render_auth(request, "forgot", values=values, errors=_first_errors(form.errors), status=400)
    accounts.request_password_reset(
        form.validated_data["email"],
        link_base=request.build_absolute_uri(reverse("auth-reset-page")),
    )
    return _render_auth(request, "forgot", values={}, errors={}, sent=True)


@require_POST
@web_page
def logout(request: HttpRequest) -> HttpResponse:
    end_session(request)
    return HttpResponseRedirect(web_reverse("home"))


def _oauth_redirect_uri(provider: str) -> str:
    return f"{settings.PUBLIC_WEB_ORIGIN}{reverse('web-oauth-return', kwargs={'provider': provider})}"


@web_page
def oauth_start(request: HttpRequest, provider: str) -> HttpResponse:
    """GET sends the browser to Google or Apple; POST finishes the sign-in."""

    if provider not in _PROVIDERS or not _client_id(provider):
        raise Http404
    if request.method == "POST":
        return _oauth_finish(request, provider)
    if _over_limit(request, "auth"):
        return _too_many(request, "login", {})
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    request.session[_OAUTH_SESSION_KEY] = {
        "provider": provider,
        "state": state,
        "nonce": nonce,
        "next": safe_next(request, request.GET.get("next")) or "",
        "lang": request.web_lang,
    }
    config = _PROVIDERS[provider]
    query = urlencode({
        "client_id": _client_id(provider),
        "redirect_uri": _oauth_redirect_uri(provider),
        "response_type": config["response_type"],
        "response_mode": "form_post",
        "scope": config["scope"],
        "state": state,
        "nonce": nonce,
    })
    return HttpResponseRedirect(f"{config['authorize']}?{query}")


@csrf_exempt
@web_page
def oauth_return(request: HttpRequest, provider: str) -> HttpResponse:
    """Google and Apple post the result here from their own site.

    That cross-site POST carries no SameSite=Lax session cookie, so this page
    only hands the fields back to ``oauth_start`` as a same-site POST. That
    request has the session and the CSRF token, and checks ``state`` there.
    No throttle here: the page writes nothing and only renders the form; the
    start and the finish count against the ``auth`` scope.
    """

    if provider not in _PROVIDERS or request.method != "POST":
        raise Http404
    fields = {
        key: request.POST.get(key, "")[:8192]
        for key in ("state", "id_token", "code", "user", "error")
    }
    response = render_page(
        request,
        "web/oauth_return.html",
        {"fields": fields, "action": web_reverse("web-oauth", provider=provider)},
        title=gettext("Přihlašuju…"),
        indexable=False,
    )
    response.headers["Cache-Control"] = "no-store"
    return response


def _apple_full_name(raw: str) -> str:
    try:
        name = json.loads(raw).get("name") or {}
    except (ValueError, AttributeError):
        return ""
    if not isinstance(name, dict):
        return ""
    return " ".join(str(name.get(part) or "").strip() for part in ("firstName", "lastName")).strip()[:120]


def _oauth_finish(request: HttpRequest, provider: str) -> HttpResponse:
    pending = request.session.pop(_OAUTH_SESSION_KEY, None) or {}
    state = request.POST.get("state", "")
    if (
        pending.get("provider") != provider
        or not state
        or not secrets.compare_digest(str(pending.get("state", "")), state)
    ):
        return _render_auth(
            request, "login", values={}, errors={},
            error=gettext("Přihlášení vypršelo. Zkus to prosím znovu."), status=400,
        )
    if _over_limit(request, "auth"):
        return _too_many(request, "login", {})
    id_token = request.POST.get("id_token", "")
    try:
        if not id_token:
            raise AccountError(gettext("Přihlášení se nepovedlo. Zkus to prosím znovu."), code="oauth_cancelled")
        idp = AuthIdentity.Provider.GOOGLE if provider == "google" else AuthIdentity.Provider.APPLE
        claims = accounts.verify_provider_token(idp, id_token)
        if not secrets.compare_digest(str(claims.get("nonce", "")), str(pending.get("nonce", ""))):
            raise AccountError(gettext("Přihlášení se nepovedlo. Zkus to prosím znovu."), code="oauth_nonce")
        if provider == "google":
            _account, token, _created = accounts.resolve_social(
                None, provider=idp, claims=claims, full_name=claims.get("name", "")
            )
        else:
            _account, token, _created = accounts.resolve_social(
                None,
                provider=idp,
                claims=claims,
                full_name=_apple_full_name(request.POST.get("user", "")),
                apple_refresh_token=accounts.apple_refresh_from_code(request.POST.get("code", "")),
            )
    except AccountError as exc:
        logger.warning(
            "web social sign-in rejected",
            extra={"event": "auth_failure", "observability": {"flow": f"web_{provider}", "reason": exc.code}},
        )
        return _render_auth(request, "login", values={}, errors={}, error=str(exc.message), status=400)
    start_session(request, token)
    return HttpResponseRedirect(
        safe_next(request, pending.get("next")) or web_reverse("web-diary", pending.get("lang") or "cs")
    )

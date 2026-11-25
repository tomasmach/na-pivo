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
from pubs.web import pubs_data
from pubs.web.pages import render_page, web_page
from pubs.web.pub_map import live_map, pub_map
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


def _field_error(field: str, code: str) -> str:
    # DRF's own Czech messages say "Vložte…" and "Toto pole…"; the web speaks like the app.
    if code in ("required", "blank", "null"):
        return {
            "email": gettext("Napiš svůj e-mail."),
            "password": gettext("Napiš heslo."),
        }.get(field, gettext("Tohle ještě vyplň."))
    if field == "email":
        return gettext("Tohle nevypadá jako e-mail.")
    if field == "password":
        return gettext("Heslo potřebuje aspoň 8 znaků.") if code == "min_length" else gettext("Tohle heslo je moc dlouhé.")
    if field == "display_name":
        return gettext("Přezdívka je moc dlouhá, vejdi se do 120 znaků.")
    return gettext("Tohle ještě zkontroluj.")


def _first_errors(errors: dict) -> dict[str, str]:
    return {
        field: _field_error(field, getattr(messages[0], "code", ""))
        for field, messages in errors.items() if messages
    }


def _account_error(exc: AccountError) -> tuple[dict[str, str], str]:
    """Field errors and the alert for a refused credential."""

    if exc.code == "weak_password":
        # Django's password validators also say "Vaše heslo…".
        return {"password": gettext("Tohle heslo se dá moc snadno uhodnout. Zkus delší nebo méně obvyklé.")}, ""
    return {}, str(exc.message)


# Old Town Square: the map beside the form shows central Prague.
_PRAGUE = (50.0875, 14.4213)


def _prague_pins() -> list[dict]:
    """A few pubs of central Prague with a known price, from the catalogue."""

    city = pubs_data.city_pubs("praha")
    near = [
        pub for pub in (city or {}).get("list", [])
        if pub["price"] and abs(pub["lat"] - _PRAGUE[0]) < 0.012 and abs(pub["lng"] - _PRAGUE[1]) < 0.018
    ]
    near.sort(key=lambda pub: (-pub["raters"], pub["name"]))
    return [
        {"lat": pub["lat"], "lng": pub["lng"], "label": f"{pub['price']}\u00a0{gettext('Kč')}", "name": pub["name"],
         "selected": index == 0}
        for index, pub in enumerate(near[:6])
    ]


def _render_auth(
    request: HttpRequest,
    mode: str,
    *,
    values: dict,
    errors: dict,
    error: str = "",
    status: int = 200,
    sent: bool = False,
    **extra,
):
    titles = {
        "login": gettext("Přihlášení"),
        "register": gettext("Registrace"),
        "forgot": gettext("Zapomenuté heslo"),
        "reset": gettext("Nové heslo"),
    }
    pins = _prague_pins()
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
            "map": pub_map(pins, size=(720, 960)),
            "live_map": live_map(pins, kind="decor", centre=_PRAGUE),
            **extra,
        },
        title=titles[mode],
        status=status,
        # Nobody searches for a login form; its links still lead on.
        indexable=False,
        follow=True,
        with_map=True,
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
        errors, error = _account_error(exc)
        return _render_auth(request, "login", values=values, errors=errors, error=error, status=exc.http_status)
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
        errors, error = _account_error(exc)
        return _render_auth(request, "register", values=values, errors=errors, error=error, status=exc.http_status)
    return _after_sign_in(request, token, request.POST.get("next"))


@web_page
def forgot_password(request: HttpRequest) -> HttpResponse:
    """Send the same reset e-mail as the app; its link opens ``reset_password`` below."""

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


def _render_reset(request: HttpRequest, token: str, *, errors: dict, error: str = "", status: int = 200) -> HttpResponse:
    response = _render_auth(
        request,
        "reset",
        values={},
        errors=errors,
        error=error,
        status=status,
        token=token,
        app_link=f"{settings.APP_DEEP_LINK_SCHEME}://auth/reset?{urlencode({'token': token})}" if token else "",
    )
    # The address carries a one-time password token: no other site may see it. "no-referrer"
    # would make the browser post the form with Origin: null, which the CSRF check refuses.
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


@web_page
def reset_password(request: HttpRequest) -> HttpResponse:
    """New password from the e-mail link, through the same ``accounts.reset_password`` as the app.

    The old link ``/v1/auth/reset?token=…`` from e-mails already sent redirects here.
    A finished reset signs this browser in with the fresh token it returns.
    """

    if request.method not in ("GET", "POST"):
        return HttpResponseNotAllowed(["GET", "POST"])
    token = (request.POST if request.method == "POST" else request.GET).get("token", "").strip()[:512]
    expired = gettext("Tenhle odkaz už neplatí. Nech si poslat nový, platí jen chvíli.")
    if not token:
        return _render_reset(request, "", errors={}, error=expired, status=400)
    if request.method == "GET":
        return _render_reset(request, token, errors={})
    if _over_limit(request, "auth"):
        return _render_reset(
            request, token, errors={}, error=gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."), status=429
        )
    form = s.ResetPasswordSerializer(data={"token": token, "password": request.POST.get("password", "")})
    if not form.is_valid():
        return _render_reset(request, token, errors=_first_errors(form.errors), status=400)
    try:
        _account, fresh = accounts.reset_password(
            form.validated_data["token"], new_password=form.validated_data["password"]
        )
    except AccountError as exc:
        if exc.code == "token_invalid":
            return _render_reset(request, "", errors={}, error=expired, status=400)
        errors, error = _account_error(exc)
        return _render_reset(request, token, errors=errors, error=error, status=exc.http_status)
    start_session(request, fresh)
    return HttpResponseRedirect(web_reverse("web-diary"))


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
    """Apple sends the name only at the first sign-in, as JSON beside the token."""
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
            client_id = _client_id(provider)
            _account, token, _created = accounts.resolve_social(
                None,
                provider=idp,
                claims=claims,
                full_name=_apple_full_name(request.POST.get("user", "")),
                apple_refresh_token=accounts.apple_refresh_from_code(
                    request.POST.get("code", ""),
                    client_id=client_id,
                    redirect_uri=_oauth_redirect_uri(provider),
                ),
                apple_client_id=client_id,
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

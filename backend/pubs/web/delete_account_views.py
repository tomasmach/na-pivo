"""Account deletion without signing in: ``/smazat-ucet`` sends a one-time link by e-mail.

The link confirms the same deletion as the app's ``DELETE /v1/account/me``:
every token is revoked, Apple is told, and the account waits out the grace
period, during which signing in brings it back. Google Play links here.
"""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.http import HttpRequest, HttpResponse, HttpResponseNotAllowed
from django.utils import formats
from django.utils import timezone as dj_timezone
from django.utils.translation import gettext
from django.views.decorators.csrf import csrf_exempt

from pubs import accounts
from pubs.accounts import AccountError, normalize_email
from pubs.api import auth_serializers as s
from pubs.web.limits import over_limit
from pubs.web.pages import render_page, web_page
from pubs.web.routes import web_reverse
from pubs.web.session import end_session


def sitemap_paths() -> list[str]:
    return [web_reverse("web-delete-account", "cs"), web_reverse("web-delete-account", "en")]


def _settings_link(request: HttpRequest) -> str:
    target = web_reverse("web-settings")
    if request.web_account is not None:
        return target
    return f"{web_reverse('web-login')}?next={quote(target)}"


@web_page
def delete_account(request: HttpRequest) -> HttpResponse:
    if request.method not in ("GET", "POST"):
        return HttpResponseNotAllowed(["GET", "POST"])
    values = {"email": request.POST.get("email", "")[:254]}
    errors: dict[str, str] = {}
    error = ""
    sent = False
    status = 200
    if request.method == "POST":
        form = s.RequestPasswordResetSerializer(data={"email": values["email"]})
        if over_limit(request, "auth_email"):
            error, status = gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."), 429
        elif not form.is_valid():
            errors, status = {"email": gettext("Tohle nevypadá jako e-mail.")}, 400
        else:
            email = form.validated_data["email"]
            # The per-address limit answers like a sent link, so it says nothing about the address.
            if not over_limit(request, "delete_link_email", key=normalize_email(email)):
                accounts.request_account_deletion_link(
                    email,
                    link_base=f"{settings.PUBLIC_WEB_ORIGIN}{web_reverse('web-delete-account-confirm')}",
                )
            sent = True
    return render_page(
        request,
        "web/delete_account/request.html",
        {
            "values": values,
            "errors": errors,
            "error": error,
            "sent": sent,
            "settings_url": _settings_link(request),
            "grace_days": settings.ACCOUNT_DELETION_GRACE_DAYS,
        },
        title=gettext("Smazání účtu"),
        description=gettext(
            "Jak smazat účet Na pivo i s deníkem, hodnoceními a partou. Bez appky stačí e-mail."
        ),
        status=status,
    )


def _cancel_by(account) -> str:
    deleted_at = account.deleted_at or dj_timezone.now()
    day = dj_timezone.localdate(deleted_at + timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS))
    return formats.date_format(day, "DATE_FORMAT")


# No-referrer makes the browser post with "Origin: null", which Django's CSRF check
# rejects. The one-time token in the form is the proof, so no CSRF token is needed.
@csrf_exempt
@web_page
def delete_account_confirm(request: HttpRequest) -> HttpResponse:
    """GET only shows the question, so a mail scanner opening the link deletes nothing."""

    if request.method not in ("GET", "POST"):
        return HttpResponseNotAllowed(["GET", "POST"])
    token = (request.POST.get("token") or request.GET.get("token") or "")[:128]
    context: dict = {"token": token, "grace_days": settings.ACCOUNT_DELETION_GRACE_DAYS}
    status = 200
    if request.method == "POST":
        if over_limit(request, "auth"):
            context["state"], status = "limited", 429
        else:
            try:
                account = accounts.delete_account_with_link(token)
            except AccountError:
                context["state"], status = "invalid", 400
            else:
                if request.web_account is not None and request.web_account.pk == account.pk:
                    end_session(request)
                    request.web_account = None
                context.update(state="done", cancel_by=_cancel_by(account))
    else:
        account = accounts.account_for_deletion_link(token)
        if account is None:
            context["state"], status = "invalid", 404
        else:
            context.update(state="confirm", email=account.primary_email)
    context["request_url"] = web_reverse("web-delete-account")
    response = render_page(
        request,
        "web/delete_account/confirm.html",
        context,
        title=gettext("Potvrzení smazání účtu"),
        status=status,
        indexable=False,
    )
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "private, no-store"
    return response

"""Signed-in web: a Django session that points at a server-side AuthToken.

Signing in on the web mints the same ``AuthToken`` the app gets, but the raw
token never leaves the server: the session (an HttpOnly cookie holding only the
session id) stores the token's SHA-256 digest. Every request looks the token up
again, so anything that deletes tokens ends the web session at once: log out
everywhere, account deletion, a merge that retires an account. A pending-deletion
account is not active and therefore not signed in, exactly like a bearer token.
"""

from __future__ import annotations

from django.http import HttpRequest
from django.utils.http import url_has_allowed_host_and_scheme

from pubs.models import Account, AuthToken, hash_account_token

SESSION_KEY = "np_token_hash"


def start_session(request: HttpRequest, raw_token: str) -> None:
    """Sign the browser in with a token that ``pubs.accounts`` just issued."""

    previous = request.session.get(SESSION_KEY)
    if previous:
        AuthToken.objects.filter(token_hash=previous).delete()
    request.session.cycle_key()
    request.session[SESSION_KEY] = hash_account_token(raw_token)


def session_token(request: HttpRequest) -> AuthToken | None:
    """The live token behind this browser session, or None.

    Applies the same checks as ``AccountTokenAuthentication``: the token row
    exists, has not expired and its account is active.
    """

    token_hash = request.session.get(SESSION_KEY) if hasattr(request, "session") else None
    if not token_hash:
        return None
    token = AuthToken.objects.select_related("account").filter(token_hash=token_hash).first()
    if token is None or token.is_expired or token.account.status != Account.Status.ACTIVE:
        request.session.pop(SESSION_KEY, None)
        return None
    return token


def end_session(request: HttpRequest) -> None:
    """Sign out this browser only. The app and other browsers stay signed in."""

    token_hash = request.session.get(SESSION_KEY)
    if token_hash:
        AuthToken.objects.filter(token_hash=token_hash).delete()
    request.session.flush()


def safe_next(request: HttpRequest, value: str | None) -> str | None:
    """A ``next`` target on this site, or None for anything that leaves it."""

    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return None
    if not url_has_allowed_host_and_scheme(value, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        return None
    return value

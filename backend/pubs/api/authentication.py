"""
pubs.api.authentication — token auth for anonymous device accounts.

Resolves an ``Authorization: Bearer <token>`` header to the owning Account and
exposes it as ``request.user`` (DRF convention). Pub-hours stays unauthenticated;
this class is opted into only by views that need an account (e.g. /account/me and
future per-user features).
"""

from __future__ import annotations

import logging

from rest_framework import authentication, exceptions

from pubs.models import Account, AuthToken, hash_account_token

logger = logging.getLogger("pubs.api.auth")


def _authentication_failed(reason: str, detail: str) -> exceptions.AuthenticationFailed:
    logger.warning(
        "account token rejected",
        extra={
            "event": "auth_token_rejected",
            "observability": {"reason": reason},
        },
    )
    return exceptions.AuthenticationFailed(detail)


class AccountTokenAuthentication(authentication.BaseAuthentication):
    """Authenticate via ``Authorization: Bearer <account-token>``.

    Tokens live in the AuthToken table (one or more per Account, each revocable).
    Only the SHA-256 digest is stored, so we hash the presented token and look it
    up by digest. Returns ``(account, raw_token)`` so ``request.user`` is the
    owning Account (DRF convention) and ``request.auth`` is the raw token.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()

        if not header or header[0].lower() != self.keyword.lower().encode():
            # No Bearer credentials — defer to the permission layer (no 401 here).
            return None

        if len(header) == 1:
            raise _authentication_failed(
                "malformed_header", "Invalid token header: no credentials provided."
            )
        if len(header) > 2:
            raise _authentication_failed(
                "malformed_header", "Invalid token header: token must not contain spaces."
            )

        try:
            token = header[1].decode()
        except UnicodeDecodeError:
            raise _authentication_failed(
                "malformed_header", "Invalid token header: invalid encoding."
            ) from None
        try:
            # Tokens are stored hashed; look up by the digest of the presented token.
            auth_token = AuthToken.objects.select_related("account").get(
                token_hash=hash_account_token(token)
            )
        except AuthToken.DoesNotExist:
            raise _authentication_failed("unknown_token", "Invalid account token.") from None

        if auth_token.is_expired:
            # Prune the dead row so it can't linger, then reject.
            auth_token.delete()
            raise _authentication_failed("token_expired", "Account token has expired.")

        account = auth_token.account
        if account.status != Account.Status.ACTIVE:
            # Soft-deleted (pending deletion) accounts can't authenticate by token;
            # reactivation happens via a fresh credential login, not the old token.
            raise _authentication_failed("account_inactive", "Account is no longer active.")

        # The request logging middleware runs outside DRF's Request wrapper.
        # Attach only the public account id to the underlying HttpRequest so logs
        # can be correlated without ever exposing request.auth / bearer tokens.
        request._request.na_pivo_account_id = str(account.public_id)
        # Private request-only authorization generation. Account deletion checks
        # this again under the Account row lock so a request authenticated before
        # credential reactivation cannot commit afterward. Middleware/logging
        # must never serialize this internal attribute.
        request._request.na_pivo_deletion_epoch = auth_token.deletion_epoch
        return (account, token)

    def authenticate_header(self, request):  # noqa: ARG002
        # Returning a value makes DRF answer 401 (not 403) when auth is missing.
        return self.keyword

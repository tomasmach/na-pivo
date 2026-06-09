"""
pubs.api.authentication — token auth for anonymous device accounts.

Resolves an ``Authorization: Bearer <token>`` header to the owning Account and
exposes it as ``request.user`` (DRF convention). Pub-hours stays unauthenticated;
this class is opted into only by views that need an account (e.g. /account/me and
future per-user features).
"""

from __future__ import annotations

from rest_framework import authentication, exceptions

from pubs.models import Account, hash_account_token


class AccountTokenAuthentication(authentication.BaseAuthentication):
    """Authenticate via ``Authorization: Bearer <account-token>``."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()

        if not header or header[0].lower() != self.keyword.lower().encode():
            # No Bearer credentials — defer to the permission layer (no 401 here).
            return None

        if len(header) == 1:
            raise exceptions.AuthenticationFailed("Invalid token header: no credentials provided.")
        if len(header) > 2:
            raise exceptions.AuthenticationFailed(
                "Invalid token header: token must not contain spaces."
            )

        token = header[1].decode()
        try:
            # Tokens are stored hashed; look up by the digest of the presented token.
            account = Account.objects.get(token_hash=hash_account_token(token))
        except Account.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid account token.") from None

        return (account, token)

    def authenticate_header(self, request):  # noqa: ARG002
        # Returning a value makes DRF answer 401 (not 403) when auth is missing.
        return self.keyword

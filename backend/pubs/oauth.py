"""
pubs.oauth — server-side verification of Google and Apple sign-in tokens.

This module is the trust boundary for "Sign in with Google" and "Sign in with
Apple". The mobile client performs the interactive sign-in and forwards the
resulting identity token (and, for Apple, optionally an authorization code) to
the backend. We re-verify everything here: nothing the client sends is trusted
until the signature, expiry, issuer, and audience have been checked against the
provider's published keys and our own configured client IDs.

Flows
-----
Google
    The client obtains a Google ID token (a JWT signed by Google). We hand it to
    ``google-auth`` which fetches and caches Google's public certs and validates
    the signature + expiry, then we additionally enforce the issuer, that the
    ``aud`` is one of *our* OAuth client IDs, and that the email is verified.
    Because the same Google project can issue tokens under several client IDs
    (web, iOS, Android), we do NOT pin a single audience inside the library call;
    we verify membership in ``GOOGLE_OAUTH_ALLOWED_AUDIENCES`` ourselves.

Apple — identity token
    The client obtains an Apple identity token (a JWT, RS256) and forwards it.
    We verify it against Apple's JWKS (https://appleid.apple.com/auth/keys),
    checking signature, expiry, issuer (https://appleid.apple.com) and audience.

Apple — authorization code exchange + revocation
    Apple requires that a relying party be able to *revoke* the user's tokens
    when the user deletes their account (App Store guideline 5.1.1(v)). To do
    that we need a refresh token, which is only obtainable by exchanging the
    one-time authorization code at first sign-in. ``exchange_apple_auth_code``
    performs that exchange and returns the token response (containing
    ``refresh_token``), which the caller persists. ``revoke_apple_token`` later
    revokes it at account deletion.

    Both the exchange and the revoke require a "client secret": a short-lived
    ES256 JWT we sign ourselves with the Apple private key (.p8), built by
    ``_apple_client_secret``.

The ``aud`` distinction: bundle id vs services id
-------------------------------------------------
Apple issues identity tokens whose ``aud`` claim depends on where the sign-in
happened:

* A native iOS app signs in with the app's **bundle identifier** (e.g.
  ``com.example.napivo``) as the audience.
* A web / "Sign in with Apple JS" flow uses a **Services ID** (a separate
  identifier you register, e.g. ``com.example.napivo.web``) as the audience.

``APPLE_ALLOWED_AUDIENCES`` therefore lists every value we accept — typically
the bundle id, plus the services id if we ever add a web sign-in. PyJWT accepts
a list for ``audience`` and treats it as "any of these is acceptable".

Email and name caveats
-----------------------
Apple only returns the user's email on the *first* authorization (and even then
only if the user did not choose "Hide My Email"; with relay enabled it is a
``@privaterelay.appleid.com`` address). The user's name is *never* present in the
identity token — Apple sends it once, out of band, in the authorization response
body, and only on first sign-in. Callers must capture and store these on the
first sign-in; subsequent tokens will not contain them.
"""

from __future__ import annotations

import datetime
import logging
from typing import Any

import jwt
import requests
from django.conf import settings
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jwt import PyJWKClient

logger = logging.getLogger("pubs.oauth")

# Apple endpoints.
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"

# Accepted Google issuer values.
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# Networking guardrails for Apple's REST calls.
_APPLE_HTTP_TIMEOUT = 10  # seconds
_APPLE_CLIENT_SECRET_TTL = 300  # seconds (Apple allows up to ~6 months; keep short)

# Module-level JWKS client. PyJWKClient caches the fetched signing keys, so a
# single shared instance avoids re-downloading Apple's keys on every request.
_apple_jwk_client = PyJWKClient(APPLE_KEYS_URL)


class OAuthError(Exception):
    """Raised when an OAuth token is invalid or verification is misconfigured."""


def verify_google_id_token(token: str) -> dict:
    """Verify a Google ID token. Returns the claims dict on success.

    Raises OAuthError on any failure (bad signature, exp, wrong iss, aud not in
    GOOGLE_OAUTH_ALLOWED_AUDIENCES, or email_verified is False).
    """
    allowed = set(getattr(settings, "GOOGLE_OAUTH_ALLOWED_AUDIENCES", None) or ())
    if not allowed:
        raise OAuthError("Google sign-in is not configured.")

    try:
        # Verify signature + expiry against Google's certs. We deliberately do
        # not pass `audience` here because several of our client IDs are valid;
        # the audience is checked against our allow-list below.
        claims: dict[str, Any] = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
        )
    except ValueError as exc:
        logger.warning("Google ID token verification failed: %s", exc)
        raise OAuthError("Invalid Google ID token.") from exc

    issuer = claims.get("iss")
    if issuer not in GOOGLE_ISSUERS:
        logger.warning("Google ID token rejected: unexpected issuer %r", issuer)
        raise OAuthError("Invalid Google ID token issuer.")

    audience = claims.get("aud")
    if audience not in allowed:
        logger.warning("Google ID token rejected: audience not allow-listed")
        raise OAuthError("Google ID token audience is not allowed.")

    if claims.get("email_verified") is not True:
        logger.warning("Google ID token rejected: email not verified")
        raise OAuthError("Google account email is not verified.")

    return claims


def verify_apple_identity_token(token: str) -> dict:
    """Verify an Apple identity token (JWT, RS256) using Apple's JWKS.

    Validates signature, exp, iss == https://appleid.apple.com, and aud in
    APPLE_ALLOWED_AUDIENCES. Returns claims dict. Raises OAuthError on failure.
    """
    allowed = list(getattr(settings, "APPLE_ALLOWED_AUDIENCES", None) or ())
    if not allowed:
        raise OAuthError("Apple sign-in is not configured.")

    try:
        signing_key = _apple_jwk_client.get_signing_key_from_jwt(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=allowed,
            issuer=APPLE_ISSUER,
        )
    except jwt.PyJWTError as exc:
        logger.warning("Apple identity token verification failed: %s", exc)
        raise OAuthError("Invalid Apple identity token.") from exc

    return claims


def exchange_apple_auth_code(code: str) -> dict:
    """Exchange an Apple authorization code at https://appleid.apple.com/auth/token.

    Returns the JSON dict (contains refresh_token). Used at first sign-in so we
    can later revoke. Raises OAuthError on failure.
    """
    client_id = _apple_client_id()
    data = {
        "client_id": client_id,
        "client_secret": _apple_client_secret(),
        "code": code,
        "grant_type": "authorization_code",
    }

    try:
        response = requests.post(
            APPLE_TOKEN_URL,
            data=data,
            timeout=_APPLE_HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.warning("Apple auth-code exchange request failed: %s", exc)
        raise OAuthError("Apple authorization code exchange failed.") from exc

    if response.status_code != 200:
        logger.warning(
            "Apple auth-code exchange returned %s: %s",
            response.status_code,
            response.text,
        )
        raise OAuthError("Apple authorization code exchange failed.")

    try:
        return response.json()
    except ValueError as exc:
        logger.warning("Apple auth-code exchange returned non-JSON body")
        raise OAuthError("Apple authorization code exchange returned invalid JSON.") from exc


def revoke_apple_token(token: str, token_type_hint: str = "refresh_token") -> None:
    """Revoke an Apple token at account deletion.

    POSTs to https://appleid.apple.com/auth/revoke. Raises OAuthError on
    non-200.
    """
    client_id = _apple_client_id()
    data = {
        "client_id": client_id,
        "client_secret": _apple_client_secret(),
        "token": token,
        "token_type_hint": token_type_hint,
    }

    try:
        response = requests.post(
            APPLE_REVOKE_URL,
            data=data,
            timeout=_APPLE_HTTP_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.warning("Apple token revoke request failed: %s", exc)
        raise OAuthError("Apple token revocation failed.") from exc

    if response.status_code != 200:
        logger.warning(
            "Apple token revoke returned %s: %s",
            response.status_code,
            response.text,
        )
        raise OAuthError("Apple token revocation failed.")


def _apple_client_id() -> str:
    """Return the Apple client_id used for the client-secret JWT and REST calls.

    Defaults to APPLE_CLIENT_ID (the app's bundle id). Raises OAuthError if it
    is not configured.
    """
    client_id = getattr(settings, "APPLE_CLIENT_ID", None)
    if not client_id:
        raise OAuthError("Apple client_id is not configured.")
    return str(client_id)


def _normalize_private_key(raw: str) -> str:
    """Normalize a .p8 PEM that may carry literal ``\\n`` escape sequences.

    Environment-variable-sourced keys frequently contain the two characters
    backslash-n instead of real newlines; PEM parsers require real newlines.
    """
    return raw.replace("\\n", "\n")


def _apple_client_secret() -> str:
    """Build a short-lived ES256 client-secret JWT signed with APPLE_PRIVATE_KEY.

    The JWT proves to Apple that we control the registered key. Raises OAuthError
    if any of the required Apple revoke/secret settings are missing.
    """
    team_id = getattr(settings, "APPLE_TEAM_ID", None)
    key_id = getattr(settings, "APPLE_KEY_ID", None)
    private_key = getattr(settings, "APPLE_PRIVATE_KEY", None)
    client_id = _apple_client_id()

    if not team_id or not key_id or not private_key:
        raise OAuthError("Apple client-secret settings are not configured.")

    now = datetime.datetime.now(datetime.UTC)
    issued_at = int(now.timestamp())
    expires_at = int((now + datetime.timedelta(seconds=_APPLE_CLIENT_SECRET_TTL)).timestamp())

    payload = {
        "iss": team_id,
        "iat": issued_at,
        "exp": expires_at,
        "aud": APPLE_ISSUER,
        "sub": client_id,
    }

    try:
        return jwt.encode(
            payload,
            _normalize_private_key(str(private_key)),
            algorithm="ES256",
            headers={"alg": "ES256", "kid": str(key_id)},
        )
    except (ValueError, jwt.PyJWTError) as exc:
        logger.warning("Failed to build Apple client secret: %s", exc)
        raise OAuthError("Failed to build Apple client secret.") from exc

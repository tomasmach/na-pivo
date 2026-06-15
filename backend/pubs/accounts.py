"""
pubs.accounts — the account/auth service layer.

This is where the real logic of user accounts lives, kept out of the DRF views
so it is independently testable and reusable. The mobile app starts ANONYMOUS:
the first contact creates a device-bound :class:`~pubs.models.Account` (see
``AccountView``) and issues an :class:`~pubs.models.AuthToken` of kind ``device``.

Registering or signing in then **claims** that same anonymous account by attaching
a credential to it — an :class:`~pubs.models.EmailCredential` (email + password)
or an :class:`~pubs.models.AuthIdentity` (Google / Apple). Because the credential
attaches to the existing row, all the user's already-synced data (drinks, ratings,
visits, …) follows them with zero migration.

Identity resolution rules (see :func:`resolve_social`):

* A login is resolved by the provider's stable ``sub`` (``AuthIdentity`` lookup),
  never by email — email is mutable and may be an Apple private-relay address.
* A *new* social identity claims the CURRENT anonymous account if there is one;
  otherwise it creates a fresh account.
* We never silently link a social identity to a *different* existing account by
  matching email (the classic account-takeover vector). If the asserted email
  already belongs to a password account, we reject and tell the user to sign in
  with their password and link the provider explicitly.
* Linking a provider to an *already-authenticated* account (``link_social``) is
  the blessed flow — the live session is the authorization.

Tokens are opaque random secrets stored only as SHA-256 digests; revocation is a
row delete. Account deletion is a soft-delete with a grace window (the
``purge_deleted_accounts`` command hard-purges later), and revokes the Apple
token because Apple requires it.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from pubs import emailer, oauth
from pubs.models import (
    Account,
    AuthIdentity,
    AuthToken,
    EmailCredential,
    OneTimeToken,
    generate_account_token,
    hash_account_token,
)

logger = logging.getLogger("pubs.accounts")


class AccountError(Exception):
    """A domain error the API layer maps to an HTTP response.

    ``code`` is a stable machine-readable string the mobile app can branch on;
    ``message`` is human-facing (Czech); ``http_status`` is the response status.
    """

    def __init__(self, message: str, *, code: str = "invalid", http_status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status


# ---------------------------------------------------------------------------
# Normalization & validation
# ---------------------------------------------------------------------------
def normalize_email(email: str) -> str:
    """Canonical form used for storage and uniqueness: trimmed + lowercased."""
    return (email or "").strip().lower()


def validate_password_strength(raw_password: str, *, account: Account | None = None) -> None:
    """Run Django's AUTH_PASSWORD_VALIDATORS. Raise AccountError on failure."""
    try:
        validate_password(raw_password, user=account)
    except DjangoValidationError as exc:
        raise AccountError(
            " ".join(exc.messages) or "Heslo je příliš slabé.",
            code="weak_password",
            http_status=400,
        ) from exc


# ---------------------------------------------------------------------------
# Token issuance / revocation
# ---------------------------------------------------------------------------
def issue_token(
    account: Account,
    *,
    kind: str = AuthToken.Kind.SESSION,
    device_label: str = "",
) -> str:
    """Create a fresh AuthToken for the account and return the RAW secret (the
    only time it exists in plaintext — only its digest is stored)."""
    raw = generate_account_token()
    expires_at = None
    if settings.AUTH_TOKEN_TTL_DAYS:
        expires_at = timezone.now() + timedelta(days=settings.AUTH_TOKEN_TTL_DAYS)
    AuthToken.objects.create(
        account=account,
        token_hash=hash_account_token(raw),
        kind=kind,
        device_label=device_label[:120],
        expires_at=expires_at,
    )
    return raw


def revoke_token(raw_token: str) -> None:
    """Revoke a single token (this device / sign-out)."""
    AuthToken.objects.filter(token_hash=hash_account_token(raw_token)).delete()


def revoke_all_tokens(account: Account) -> None:
    """Revoke every token for the account (sign out everywhere)."""
    account.auth_tokens.all().delete()


# ---------------------------------------------------------------------------
# Email + password
# ---------------------------------------------------------------------------
def _email_taken_by_other(email: str, *, account: Account) -> bool:
    return EmailCredential.objects.filter(email=email).exclude(account=account).exists()


def set_password(account: Account, raw_password: str, *, email: str | None = None) -> EmailCredential:
    """Create or update the account's EmailCredential.

    When the account has no credential yet, ``email`` is required (this is the
    "set a password" escape hatch for a social-only account, or part of
    registration). When it already has one, the password is rotated and the email
    left unchanged unless a new one is supplied.
    """
    validate_password_strength(raw_password, account=account)
    cred = EmailCredential.objects.filter(account=account).first()

    if cred is None:
        if not email:
            raise AccountError("Pro nastavení hesla je potřeba e-mail.", code="email_required")
        norm = normalize_email(email)
        if _email_taken_by_other(norm, account=account):
            raise AccountError(
                "Tento e-mail už používá jiný účet.", code="email_taken", http_status=409
            )
        cred = EmailCredential(account=account, email=norm, email_verified=False)
    elif email:
        norm = normalize_email(email)
        if norm != cred.email and _email_taken_by_other(norm, account=account):
            raise AccountError(
                "Tento e-mail už používá jiný účet.", code="email_taken", http_status=409
            )
        if norm != cred.email:
            cred.email = norm
            cred.email_verified = False

    cred.password = make_password(raw_password)
    cred.save()
    return cred


def register_email(
    current_account: Account,
    *,
    email: str,
    password: str,
    display_name: str = "",
) -> tuple[Account, str]:
    """Register email+password, claiming the current anonymous account.

    Returns ``(account, raw_session_token)``. Sends a verification email
    (best-effort).
    """
    norm = normalize_email(email)
    if not norm:
        raise AccountError("Zadej platný e-mail.", code="email_invalid")

    if current_account.has_email_credential:
        raise AccountError(
            "Účet už má nastavené heslo.", code="already_has_password", http_status=409
        )
    if EmailCredential.objects.filter(email=norm).exists():
        raise AccountError(
            "Tento e-mail už používá jiný účet.", code="email_taken", http_status=409
        )

    validate_password_strength(password, account=current_account)

    with transaction.atomic():
        EmailCredential.objects.create(
            account=current_account,
            email=norm,
            password=make_password(password),
            email_verified=False,
        )
        if display_name and not current_account.display_name:
            current_account.display_name = display_name[:120]
            current_account.save(update_fields=["display_name"])

    token = issue_token(current_account, device_label=display_name)
    request_email_verification(current_account)
    return current_account, token


def login_email(*, email: str, password: str) -> tuple[Account, str]:
    """Authenticate email+password. Returns ``(account, raw_session_token)``.

    Uses a single generic error for both unknown-email and wrong-password to
    avoid account enumeration. Reactivates an account that was pending deletion.
    """
    norm = normalize_email(email)
    cred = EmailCredential.objects.select_related("account").filter(email=norm).first()
    generic = AccountError(
        "Nesprávný e-mail nebo heslo.", code="invalid_credentials", http_status=401
    )
    if cred is None or not check_password(password, cred.password):
        raise generic

    account = cred.account
    _reactivate_if_pending(account)
    token = issue_token(account)
    return account, token


# ---------------------------------------------------------------------------
# Social (Google / Apple)
# ---------------------------------------------------------------------------
def verify_provider_token(provider: str, token: str) -> dict:
    """Verify an ID/identity token with the right provider. Raises AccountError."""
    try:
        if provider == AuthIdentity.Provider.GOOGLE:
            return oauth.verify_google_id_token(token)
        if provider == AuthIdentity.Provider.APPLE:
            return oauth.verify_apple_identity_token(token)
    except oauth.OAuthError as exc:
        raise AccountError(str(exc), code="oauth_failed", http_status=401) from exc
    raise AccountError("Neznámý poskytovatel přihlášení.", code="bad_provider")


def apple_refresh_from_code(authorization_code: str) -> str:
    """Best-effort exchange of an Apple auth code for a refresh token (stored so
    we can revoke at deletion, which Apple requires). Never fatal — a missing
    refresh token only means we can't revoke later."""
    if not authorization_code:
        return ""
    try:
        data = oauth.exchange_apple_auth_code(authorization_code)
        return data.get("refresh_token", "") or ""
    except oauth.OAuthError as exc:
        logger.warning("apple auth-code exchange failed: %s", exc)
        return ""


def resolve_social(
    current_account: Account | None,
    *,
    provider: str,
    claims: dict,
    full_name: str = "",
    apple_refresh_token: str = "",
) -> tuple[Account, str, bool]:
    """Resolve a verified social login to an account and issue a token.

    Returns ``(account, raw_session_token, created)`` where ``created`` is True
    when a brand-new account was made. See the module docstring for the rules.
    """
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise AccountError("Poskytovatel nevrátil identitu.", code="oauth_failed", http_status=401)
    email = normalize_email(claims.get("email", ""))

    existing = (
        AuthIdentity.objects.select_related("account")
        .filter(provider=provider, subject=subject)
        .first()
    )
    if existing is not None:
        # Known identity → sign in to its account.
        account = existing.account
        _reactivate_if_pending(account)
        updated = []
        if apple_refresh_token and apple_refresh_token != existing.apple_refresh_token:
            existing.apple_refresh_token = apple_refresh_token
            updated.append("apple_refresh_token")
        if email and email != existing.email:
            existing.email = email
            updated.append("email")
        if updated:
            existing.save(update_fields=updated)
        _maybe_set_display_name(account, full_name)
        return account, issue_token(account), False

    # New identity. Decide which account it attaches to.
    claim_target = (
        current_account
        if (current_account is not None and not current_account.is_claimed)
        else None
    )

    # Guard the email-collision takeover vector: a new social identity whose
    # asserted email already belongs to a password account on a DIFFERENT account
    # must NOT auto-link. Make the user prove ownership (sign in + link).
    if email:
        collision = EmailCredential.objects.filter(email=email)
        if claim_target is not None:
            collision = collision.exclude(account=claim_target)
        if collision.exists():
            raise AccountError(
                "Tento e-mail už používá jiný účet. Přihlas se heslem a propoj "
                "poskytovatele v nastavení účtu.",
                code="email_exists",
                http_status=409,
            )

    try:
        with transaction.atomic():
            if claim_target is not None:
                account = claim_target
                created = False
            else:
                account = Account.objects.create(device_id=f"social-{generate_account_token()}")
                created = True
            AuthIdentity.objects.create(
                account=account,
                provider=provider,
                subject=subject,
                email=email,
                apple_refresh_token=apple_refresh_token,
            )
            _maybe_set_display_name(account, full_name)
    except IntegrityError:
        # Concurrent first sign-in for the same (provider, subject) — re-resolve.
        existing = (
            AuthIdentity.objects.select_related("account")
            .filter(provider=provider, subject=subject)
            .first()
        )
        if existing is None:
            raise
        return existing.account, issue_token(existing.account), False

    return account, issue_token(account), created


# ---------------------------------------------------------------------------
# Linking / unlinking (authenticated account)
# ---------------------------------------------------------------------------
def link_social(
    account: Account,
    *,
    provider: str,
    claims: dict,
    apple_refresh_token: str = "",
    full_name: str = "",
) -> AuthIdentity:
    """Link a social provider to the already-authenticated account.

    Rejects if the identity is already linked to a different account, or if this
    account already has an identity for the provider.
    """
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise AccountError("Poskytovatel nevrátil identitu.", code="oauth_failed", http_status=401)
    email = normalize_email(claims.get("email", ""))

    existing = (
        AuthIdentity.objects.filter(provider=provider, subject=subject)
        .select_related("account")
        .first()
    )
    if existing is not None:
        if existing.account_id == account.id:
            return existing  # already linked to this account — idempotent
        raise AccountError(
            "Tento účet u poskytovatele je už propojený s jiným účtem.",
            code="provider_linked_elsewhere",
            http_status=409,
        )
    if account.identities.filter(provider=provider).exists():
        raise AccountError(
            "K účtu už je propojený jiný účet tohoto poskytovatele.",
            code="provider_already_linked",
            http_status=409,
        )

    identity = AuthIdentity.objects.create(
        account=account,
        provider=provider,
        subject=subject,
        email=email,
        apple_refresh_token=apple_refresh_token,
    )
    _maybe_set_display_name(account, full_name)
    return identity


def unlink(account: Account, *, provider: str) -> None:
    """Remove a sign-in method, enforcing that at least one always remains.

    ``provider`` is one of 'email', 'google', 'apple'.
    """
    methods = account.auth_methods()
    if provider not in methods:
        raise AccountError("Tento způsob přihlášení není propojený.", code="not_linked")
    if len(methods) <= 1:
        raise AccountError(
            "Tohle je tvůj jediný způsob přihlášení. Nejdřív přidej heslo nebo "
            "jiného poskytovatele.",
            code="last_credential",
            http_status=400,
        )

    if provider == "email":
        EmailCredential.objects.filter(account=account).delete()
        return

    identity = account.identities.filter(provider=provider).first()
    if identity is None:
        raise AccountError("Tento způsob přihlášení není propojený.", code="not_linked")
    if provider == AuthIdentity.Provider.APPLE and identity.apple_refresh_token:
        # Revoke at Apple so a stale token can't be reused. Best-effort.
        try:
            oauth.revoke_apple_token(identity.apple_refresh_token)
        except oauth.OAuthError as exc:
            logger.warning("apple token revoke on unlink failed: %s", exc)
    identity.delete()


# ---------------------------------------------------------------------------
# One-time tokens: email verification & password reset
# ---------------------------------------------------------------------------
def _create_one_time_token(account: Account, *, purpose: str, ttl: timedelta) -> str:
    """Mint a single-use token, store only its digest, return the raw value."""
    raw = generate_account_token()
    OneTimeToken.objects.create(
        account=account,
        purpose=purpose,
        token_hash=hash_account_token(raw),
        expires_at=timezone.now() + ttl,
    )
    return raw


def _consume_one_time_token(raw_token: str, *, purpose: str) -> Account:
    ott = (
        OneTimeToken.objects.select_related("account")
        .filter(token_hash=hash_account_token(raw_token), purpose=purpose)
        .first()
    )
    if ott is None or not ott.is_usable:
        raise AccountError("Odkaz je neplatný nebo vypršel.", code="token_invalid", http_status=400)
    ott.used_at = timezone.now()
    ott.save(update_fields=["used_at"])
    return ott.account


def _deep_link(path: str, raw_token: str) -> str:
    """Build the app deep link carried in an email."""
    scheme = settings.APP_DEEP_LINK_SCHEME
    return f"{scheme}://auth/{path}?token={raw_token}"


def request_email_verification(account: Account) -> bool:
    """Send (or re-send) the email-verification message. No-op without an email."""
    cred = EmailCredential.objects.filter(account=account).first()
    if cred is None or cred.email_verified:
        return False
    raw = _create_one_time_token(
        account,
        purpose=OneTimeToken.Purpose.VERIFY_EMAIL,
        ttl=timedelta(hours=settings.EMAIL_VERIFY_TTL_HOURS),
    )
    return emailer.send_verification_email(cred.email, link=_deep_link("verify", raw), code=raw)


def verify_email(raw_token: str) -> Account:
    account = _consume_one_time_token(raw_token, purpose=OneTimeToken.Purpose.VERIFY_EMAIL)
    EmailCredential.objects.filter(account=account).update(email_verified=True)
    return account


def request_password_reset(email: str) -> None:
    """Email a password-reset link. ALWAYS succeeds silently (no enumeration)."""
    norm = normalize_email(email)
    cred = EmailCredential.objects.select_related("account").filter(email=norm).first()
    if cred is None:
        logger.info("password reset requested for unknown email (ignored)")
        return
    raw = _create_one_time_token(
        cred.account,
        purpose=OneTimeToken.Purpose.RESET_PASSWORD,
        ttl=timedelta(hours=settings.PASSWORD_RESET_TTL_HOURS),
    )
    emailer.send_password_reset_email(cred.email, link=_deep_link("reset", raw), code=raw)


def reset_password(raw_token: str, *, new_password: str) -> Account:
    """Consume a reset token, set the new password, revoke all sessions."""
    account = _consume_one_time_token(raw_token, purpose=OneTimeToken.Purpose.RESET_PASSWORD)
    validate_password_strength(new_password, account=account)
    cred = EmailCredential.objects.filter(account=account).first()
    if cred is None:
        raise AccountError("Účet nemá nastavené heslo.", code="no_password", http_status=400)
    cred.password = make_password(new_password)
    cred.email_verified = True  # proving control of the inbox verifies it
    cred.save(update_fields=["password", "email_verified", "updated_at"])
    revoke_all_tokens(account)  # force re-login everywhere after a reset
    return account


# ---------------------------------------------------------------------------
# Deletion (soft-delete + grace window; Apple revoke required)
# ---------------------------------------------------------------------------
def schedule_deletion(account: Account) -> None:
    """Begin account deletion: log out everywhere, revoke Apple, mark pending,
    email the user a cancel-by date. The purge command hard-deletes later."""
    revoke_all_tokens(account)
    _revoke_apple_identities(account)

    account.status = Account.Status.PENDING_DELETION
    account.deleted_at = timezone.now()
    account.save(update_fields=["status", "deleted_at"])

    email = account.primary_email
    if email:
        cancel_by = (
            account.deleted_at + timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS)
        ).strftime("%-d. %-m. %Y")
        emailer.send_account_deletion_scheduled_email(email, cancel_by=cancel_by)


def cancel_deletion(account: Account) -> None:
    account.status = Account.Status.ACTIVE
    account.deleted_at = None
    account.save(update_fields=["status", "deleted_at"])


def hard_delete(account: Account) -> None:
    """Irreversibly delete the account. Cascades wipe credentials/identities/
    tokens and CASCADE-bound personal data; SET_NULL community data is orphaned.
    Emails a confirmation first (the row is about to vanish)."""
    email = account.primary_email
    _revoke_apple_identities(account)
    if email:
        emailer.send_account_deleted_email(email)
    account.delete()


def _revoke_apple_identities(account: Account) -> None:
    for identity in account.identities.filter(provider=AuthIdentity.Provider.APPLE):
        if not identity.apple_refresh_token:
            continue
        try:
            oauth.revoke_apple_token(identity.apple_refresh_token)
        except oauth.OAuthError as exc:
            logger.warning("apple token revoke on deletion failed: %s", exc)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _reactivate_if_pending(account: Account) -> None:
    if account.status == Account.Status.PENDING_DELETION:
        cancel_deletion(account)
        logger.info("account %s reactivated by sign-in within grace window", account.public_id)


def _maybe_set_display_name(account: Account, full_name: str) -> None:
    name = (full_name or "").strip()
    if name and not account.display_name:
        account.display_name = name[:120]
        account.save(update_fields=["display_name"])

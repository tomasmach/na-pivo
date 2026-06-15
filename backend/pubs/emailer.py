"""Transactional email helper for the Na Pivo backend, backed by Resend.

This module is the single place where the backend sends transactional e-mails
(verification, password reset, account-deletion notices). It wraps the Resend
HTTP API (https://resend.com) behind a tiny, stable surface so the rest of the
codebase never imports ``resend`` directly.

Configuration is read from Django settings:

* ``RESEND_API_KEY`` -- the Resend API key (may be an empty string).
* ``EMAIL_ENABLED``   -- master switch. When ``False`` (or when no API key is
  configured) nothing is sent.
* ``EMAIL_FROM``      -- the ``From`` header, e.g. ``"Na Pivo <noreply@napivo.cz>"``.

Dev / no-op fallback
--------------------
When ``EMAIL_ENABLED`` is ``False`` *or* ``RESEND_API_KEY`` is empty, no network
call is made: the e-mail is logged at ``INFO`` and the send functions return
``True``. This lets local and CI environments run the full auth / account flows
without a Resend account or even the ``resend`` package installed. The ``resend``
dependency is imported lazily inside :func:`send_email` for exactly this reason --
the module imports cleanly even when the package is missing.

Never raises
------------
These helpers are called from request handlers (sign-up, password reset, account
deletion). Sending an e-mail must never break the surrounding API request, so
every function swallows its own exceptions and reports failure via a ``False``
return value plus an error log -- it never propagates an exception to the caller.

All user-facing copy is Czech (the app is Czech).
"""

from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger("pubs.emailer")

# Brand palette -- dark amber "taproom" look, kept deliberately minimal/robust so
# the markup survives across e-mail clients.
_BG = "#1c1410"
_CARD = "#241a13"
_TEXT = "#f3e9dd"
_MUTED = "#b9a896"
_ACCENT = "#d99a2b"
_ACCENT_TEXT = "#1c1410"
_BORDER = "#3a2c20"

_APP_NAME = "Na Pivo \U0001f37a"  # "Na Pivo 🍺"


def _render(
    title: str,
    message_html: str,
    *,
    button_label: str | None = None,
    button_url: str | None = None,
    code: str | None = None,
) -> str:
    """Build a consistent inline-styled HTML body shared by all e-mails.

    ``message_html`` is treated as trusted markup (our own strings only). The
    optional button and code blocks are rendered only when provided.
    """
    button_block = ""
    if button_label and button_url:
        button_block = (
            '<tr><td align="center" style="padding:8px 0 24px 0;">'
            f'<a href="{button_url}" '
            f'style="display:inline-block;background:{_ACCENT};color:{_ACCENT_TEXT};'
            "text-decoration:none;font-weight:700;font-size:16px;"
            'padding:14px 28px;border-radius:10px;">'
            f"{button_label}</a></td></tr>"
        )

    code_block = ""
    if code:
        code_block = (
            '<tr><td align="center" style="padding:0 0 24px 0;">'
            f'<div style="color:{_MUTED};font-size:13px;margin-bottom:8px;">'
            "nebo zadej tento kód v aplikaci:</div>"
            f'<div style="display:inline-block;background:{_BG};'
            f"border:1px solid {_BORDER};border-radius:10px;padding:12px 20px;"
            f"font-family:Menlo,Consolas,monospace;font-size:24px;font-weight:700;"
            f'letter-spacing:6px;color:{_TEXT};">{code}</div></td></tr>'
        )

    return (
        '<!DOCTYPE html><html lang="cs"><head>'
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{title}</title></head>"
        f'<body style="margin:0;padding:0;background:{_BG};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{_BG};padding:32px 16px;">'
        "<tr><td align=\"center\">"
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:480px;background:{_CARD};border:1px solid {_BORDER};'
        'border-radius:16px;overflow:hidden;">'
        # Header / app name
        f'<tr><td align="center" style="padding:32px 32px 8px 32px;'
        f"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        f'font-size:22px;font-weight:800;color:{_ACCENT};">{_APP_NAME}</td></tr>'
        # Title
        f'<tr><td align="center" style="padding:8px 32px 4px 32px;'
        f"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        f'font-size:18px;font-weight:700;color:{_TEXT};">{title}</td></tr>'
        # Message
        f'<tr><td align="center" style="padding:12px 32px 24px 32px;'
        f"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        f'font-size:15px;line-height:1.55;color:{_MUTED};">{message_html}</td></tr>'
        # Optional button + code
        f'<tr><td style="padding:0 32px;"><table role="presentation" width="100%" '
        f'cellpadding="0" cellspacing="0">{button_block}{code_block}</table></td></tr>'
        # Footer
        f'<tr><td align="center" style="padding:8px 32px 28px 32px;'
        f"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        f'font-size:12px;color:{_BORDER};border-top:1px solid {_BORDER};'
        f'padding-top:20px;">Na Pivo — najdi nejbližší pivo</td></tr>'
        "</table></td></tr></table></body></html>"
    )


def send_email(to: str, subject: str, html: str, *, text: str | None = None) -> bool:
    """Send one transactional e-mail via Resend.

    Returns ``True`` on success (or in no-op dev mode), ``False`` on failure.
    Never raises -- e-mail must never break an API request.
    """
    if not getattr(settings, "EMAIL_ENABLED", False) or not getattr(
        settings, "RESEND_API_KEY", ""
    ):
        logger.info("email (dev no-op) to=%s subject=%s", to, subject)
        return True

    try:
        import resend

        resend.api_key = settings.RESEND_API_KEY
        resend.Emails.send(
            {
                "from": settings.EMAIL_FROM,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text or _html_to_text_fallback(subject),
            }
        )
    except Exception:  # noqa: BLE001 -- email must never propagate into a request
        logger.exception("failed to send email to=%s subject=%s", to, subject)
        return False

    logger.info("email sent to=%s subject=%s", to, subject)
    return True


def _html_to_text_fallback(subject: str) -> str:
    """Minimal plain-text body used when no explicit ``text`` is supplied."""
    return f"{subject}\n\nOtevři aplikaci Na Pivo pro více informací."


def send_verification_email(to: str, *, link: str, code: str) -> bool:
    """Send the e-mail verification message (button + manual code)."""
    subject = "Ověř svůj e-mail – Na Pivo"
    message = (
        "Ahoj! Díky, že jsi s námi. Pro dokončení "
        "registrace ověř svou e-mailovou adresu – klepni na "
        "tlačítko níže, nebo zadej kód v aplikaci.<br><br>"
        "Odkaz brzy vyprší, takže to nenechávej na dlouho."
    )
    html = _render(
        "Ověř svůj e-mail",
        message,
        button_label="Ověřit e-mail",
        button_url=link,
        code=code,
    )
    text = (
        "Ahoj!\n\n"
        "Pro dokončení registrace ověř svou e-mailovou adresu.\n\n"
        f"Otevři tento odkaz: {link}\n"
        f"Nebo zadej v aplikaci tento kód: {code}\n\n"
        "Odkaz brzy vyprší.\n\nNa Pivo"
    )
    return send_email(to, subject, html, text=text)


def send_password_reset_email(to: str, *, link: str, code: str) -> bool:
    """Send the password-reset message (button + manual code)."""
    subject = "Obnova hesla – Na Pivo"
    message = (
        "Někdo požádal o obnovu hesla k tomuto účtu. "
        "Klepni na tlačítko níže, nebo zadej kód "
        "v aplikaci a nastav si nové heslo.<br><br>"
        "Pokud jsi to nebyl ty, tento e-mail klidně ignoruj — nic "
        "se nestane. Odkaz brzy vyprší."
    )
    html = _render(
        "Obnova hesla",
        message,
        button_label="Nastavit nové heslo",
        button_url=link,
        code=code,
    )
    text = (
        "Někdo požádal o obnovu hesla k tomuto účtu.\n\n"
        f"Otevři tento odkaz: {link}\n"
        f"Nebo zadej v aplikaci tento kód: {code}\n\n"
        "Pokud jsi to nebyl ty, e-mail ignoruj. Odkaz brzy vyprší.\n\n"
        "Na Pivo"
    )
    return send_email(to, subject, html, text=text)


def send_account_deletion_scheduled_email(to: str, *, cancel_by: str) -> bool:
    """Notify the user that their account is scheduled for deletion."""
    subject = "Tvůj účet bude smazán – Na Pivo"
    message = (
        "Tvůj účet Na Pivo je naplánován ke "
        "smazání. Po datu <strong>"
        f"{cancel_by}</strong> bude trvale odstraněn včetně "
        "všech tvých dat.<br><br>"
        "Změnil jsi názor? Stačí se do té doby znovu "
        "přihlásit a smazání se zruší."
    )
    html = _render("Tvůj účet bude smazán", message)
    text = (
        "Tvůj účet Na Pivo je naplánován ke "
        "smazání.\n\n"
        f"Po datu {cancel_by} bude trvale odstraněn včetně "
        "všech tvých dat.\n\n"
        "Smazání zrušíš tím, že se do té "
        "doby znovu přihlásíš.\n\nNa Pivo"
    )
    return send_email(to, subject, html, text=text)


def send_account_deleted_email(to: str) -> bool:
    """Confirm to the user that their account and data have been deleted."""
    subject = "Účet byl smazán – Na Pivo"
    message = (
        "Tvůj účet a všechna související data byla "
        "trvale smazána.<br><br>"
        "Děkujeme, že jsi byl s námi. Kdykoli se můžeš "
        "vrátit a založit si nový účet. \U0001f37b"
    )
    html = _render("Účet byl smazán", message)
    text = (
        "Tvůj účet a všechna související data byla "
        "trvale smazána.\n\n"
        "Děkujeme, že jsi byl s námi.\n\nNa Pivo"
    )
    return send_email(to, subject, html, text=text)

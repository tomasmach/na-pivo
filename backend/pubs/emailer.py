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
call is made: a redacted event is logged at ``INFO`` and the send functions
return ``True``. This lets local and CI environments run the full auth / account
flows without a Resend account or even the ``resend`` package installed. The
``resend`` dependency is imported lazily inside :func:`send_email` for exactly
this reason -- the module imports cleanly even when the package is missing.

Never raises
------------
These helpers are called from request handlers (sign-up, password reset, account
deletion). Sending an e-mail must never break the surrounding API request, so
every function swallows its own exceptions and reports failure via a ``False``
return value plus an error log -- it never propagates an exception to the caller.

All user-facing copy is written in Czech and translated through gettext; the
recipient's language is passed in per send.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Sequence

from django.conf import settings
from django.utils import translation
from django.utils.translation import gettext, gettext_lazy

from pubs.i18n import current_locale

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

EmailAttachment = dict[str, str]


def _attachment_count(attachments: Sequence[EmailAttachment] | None) -> int:
    return len(attachments) if attachments is not None else 0


def _render(
    title: str,
    message_html: str,
    *,
    code: str | None = None,
    code_label: str = gettext_lazy("Tvůj kód:"),
    link: str | None = None,
    link_label: str | None = None,
) -> str:
    """Build a consistent inline-styled HTML body shared by all e-mails.

    ``message_html`` is trusted markup (our own strings only). ``link`` is the
    main action when present and ``code`` is shown only for flows that have a
    real in-app/manual entry screen.
    """
    code_block = ""
    if code:
        code_block = (
            '<tr><td align="center" style="padding:0 0 20px 0;">'
            f'<div style="color:{_MUTED};font-size:13px;margin-bottom:10px;">'
            f"{str(code_label)}</div>"
            f'<div style="display:inline-block;background:{_BG};'
            f"border:1px solid {_BORDER};border-radius:12px;padding:16px 26px;"
            f"font-family:Menlo,Consolas,monospace;font-size:28px;font-weight:700;"
            f'letter-spacing:8px;color:{_TEXT};">{code}</div></td></tr>'
        )

    link_block = ""
    if link and link_label:
        link_block = (
            '<tr><td align="center" style="padding:0 0 18px 0;'
            "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
            f'font-size:16px;color:{_ACCENT_TEXT};">'
            f'<a href="{link}" style="display:inline-block;background:{_ACCENT};'
            f"border-radius:999px;padding:13px 22px;color:{_ACCENT_TEXT};"
            'font-weight:800;text-decoration:none;">'
            f"{link_label}</a></td></tr>"
        )

    lang = current_locale()
    footer = gettext("Na Pivo. Najdi nejbližší pivo.")
    return (
        f'<!DOCTYPE html><html lang="{lang}"><head>'
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
        # Optional code (hero) + small "open in app" link
        f'<tr><td style="padding:0 32px;"><table role="presentation" width="100%" '
        f'cellpadding="0" cellspacing="0">{code_block}{link_block}</table></td></tr>'
        # Footer
        f'<tr><td align="center" style="padding:8px 32px 28px 32px;'
        f"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        f'font-size:12px;color:{_BORDER};border-top:1px solid {_BORDER};'
        f'padding-top:20px;">{footer}</td></tr>'
        "</table></td></tr></table></body></html>"
    )


def send_email(
    to: str,
    subject: str,
    html: str,
    *,
    text: str | None = None,
    attachments: Sequence[EmailAttachment] | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """Send one transactional e-mail via Resend.

    Returns ``True`` on success (or in no-op dev mode), ``False`` on failure.
    Never raises -- e-mail must never break an API request.
    """
    attachment_count = _attachment_count(attachments)
    if not getattr(settings, "EMAIL_ENABLED", False) or not getattr(
        settings, "RESEND_API_KEY", ""
    ):
        logger.info("email (dev no-op); attachments=%d", attachment_count)
        return True

    try:
        import resend

        resend.api_key = settings.RESEND_API_KEY
        payload: dict[str, object] = {
            "from": settings.EMAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
            "text": text or _html_to_text_fallback(subject),
        }
        if attachments:
            payload["attachments"] = list(attachments)
        options = {"idempotency_key": idempotency_key} if idempotency_key else None
        resend.Emails.send(payload, options)
    except Exception as exc:  # noqa: BLE001 -- email must never propagate into a request
        logger.error(
            "failed to send email; error_type=%s attachments=%d",
            type(exc).__name__,
            attachment_count,
        )
        return False

    logger.info("email sent; attachments=%d", attachment_count)
    return True


def _html_to_text_fallback(subject: str) -> str:
    """Minimal plain-text body used when no explicit ``text`` is supplied."""
    return f"{subject}\n\n" + gettext("Otevři aplikaci Na Pivo pro více informací.")


def send_verification_email(to: str, *, link: str, code: str, locale: str = "cs") -> bool:
    """Send the e-mail verification message.

    The HTTPS verification link is the primary action. The raw one-time token is
    still accepted as an argument for the test hooks and service contract, but
    it is intentionally not rendered because the app has no manual-entry screen
    for verification codes.
    """
    with translation.override(locale):
        subject = gettext("Na Pivo: ověř si e-mail")
        message = gettext(
            "Čau! Ještě jedna věc, než to roztočíme. "
            "Klepni na tlačítko a e-mail ověříme v prohlížeči. "
            "Pak se jen vrať do appky. Platí jen chvíli, tak s tím nečekej."
        )
        html = _render(
            gettext("Ověř si e-mail"),
            message,
            link=link,
            link_label=gettext("Ověřit e-mail"),
        )
        text = gettext(
            "Čau!\n\n"
            "Klepni na odkaz a e-mail ověříme v prohlížeči:\n\n"
            "%(link)s\n\n"
            "Pak se vrať do appky Na Pivo. Odkaz platí jen chvíli.\n\nNa Pivo"
        ) % {"link": link}
        return send_email(to, subject, html, text=text)


def send_password_reset_email(to: str, *, link: str, code: str, locale: str = "cs") -> bool:
    """Send the password-reset message.

    The app link is the quickest path, while the code remains available for
    manual entry when an e-mail client refuses to open custom URL schemes.
    """
    with translation.override(locale):
        subject = gettext("Na Pivo: nové heslo")
        message = gettext(
            "Někdo si řekl o nové heslo k tvému účtu. Snad ty. "
            "Klepni na tlačítko, nebo se vrať do appky a zadej kód.<br><br>"
            "Jestli to nebyl ty, klidně to nech být, nic se nestane."
        )
        html = _render(
            gettext("Nové heslo"),
            message,
            code=code,
            link=link,
            link_label=gettext("Nastavit nové heslo"),
        )
        text = gettext(
            "Někdo si řekl o nové heslo k tvému účtu. Snad ty.\n\n"
            "Klepni na odkaz a nastav si nové heslo:\n\n"
            "%(link)s\n\n"
            "Nebo se vrať do appky a zadej tenhle kód:\n\n"
            "    %(code)s\n\n"
            "Jestli to nebyl ty, nech to být. Kód platí jen chvíli.\n\nNa Pivo"
        ) % {"link": link, "code": code}
        return send_email(to, subject, html, text=text)


def send_account_deletion_scheduled_email(
    to: str, *, cancel_by: str, locale: str = "cs"
) -> bool:
    """Notify the user that their account is scheduled for deletion."""
    with translation.override(locale):
        subject = gettext("Na Pivo: mažeme ti účet")
        message = gettext(
            "Dali jsme tvůj účet do fronty na smazání. "
            "Po <strong>%(cancel_by)s</strong> zmizí napořád, i se všemi daty.<br><br>"
            "Rozmyslel sis to? Než ten den přijde, stačí se přihlásit "
            "a je to zase tvoje."
        ) % {"cancel_by": cancel_by}
        html = _render(gettext("Mažeme ti účet"), message)
        text = gettext(
            "Dali jsme tvůj účet do fronty na smazání.\n\n"
            "Po %(cancel_by)s zmizí napořád, i se všemi daty.\n\n"
            "Rozmyslel sis to? Než ten den přijde, stačí se přihlásit "
            "a je to zase tvoje.\n\nNa Pivo"
        ) % {"cancel_by": cancel_by}
        return send_email(to, subject, html, text=text)


def send_account_deleted_email(to: str, *, locale: str = "cs") -> bool:
    """Confirm to the user that their account and data have been deleted."""
    with translation.override(locale):
        subject = gettext("Na Pivo: účet je pryč")
        message = gettext(
            "A je to. Tvůj účet i všechna data jsme smazali natrvalo.<br><br>"
            "Díky, žes s námi chvíli vydržel. Kdyby ses někdy chtěl vrátit, "
            "hospoda je pořád otevřená. \U0001f37b"
        )
        html = _render(gettext("Účet je pryč"), message)
        text = gettext(
            "A je to. Tvůj účet i všechna data jsme smazali natrvalo.\n\n"
            "Díky, žes s námi chvíli vydržel. Kdyby ses chtěl vrátit, "
            "hospoda je pořád otevřená.\n\nNa Pivo"
        )
        return send_email(to, subject, html, text=text)


def send_account_export_email(
    to: str,
    *,
    filename: str,
    json_bytes: bytes,
    idempotency_key: str | None = None,
    locale: str = "cs",
) -> bool:
    """Send a GDPR-style account export as a JSON attachment."""
    with translation.override(locale):
        subject = gettext("Tvoje data z Na Pivo")
        message = gettext(
            "V příloze najdeš export svého účtu, pivního deníku, hodnocení a dalších "
            "dat, která k účtu máme uložená.<br><br>"
            "Soubor je ve formátu JSON."
        )
        html = _render(gettext("Tvoje data"), message)
        text = gettext(
            "V příloze najdeš export svého účtu, pivního deníku, hodnocení a dalších "
            "dat, která k účtu máme uložená.\n\nSoubor je ve formátu JSON.\n\nNa Pivo"
        )
        attachment = {
            "filename": filename,
            "content": base64.b64encode(json_bytes).decode("ascii"),
            "content_type": "application/json",
        }
        kwargs = {"idempotency_key": idempotency_key} if idempotency_key else {}
        return send_email(to, subject, html, text=text, attachments=[attachment], **kwargs)

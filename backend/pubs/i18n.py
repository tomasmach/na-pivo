"""Locale helpers shared by the API, push, e-mail and cron code paths.

The app speaks exactly two languages: Czech and English. Slovak users get Czech
(the app has always shipped Czech for them and Slovak is close enough to read).
Anything we do not recognise falls back to Czech, because every RELEASED app
version sends no language at all and must keep seeing Czech.

Inside a request Django's ``LocaleMiddleware`` already resolved the language
from ``Accept-Language``, so views only need ``gettext``. Out of request context
(push notifications, cron commands, e-mails) there is no header, so we render
inside ``translation.override()`` using the locale stored on the account or on
its push devices.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from django.utils import translation

DEFAULT_LOCALE = "cs"


def normalize_locale(value: object) -> str:
    """Map any language tag onto "cs" or "en".

    ``"en"``, ``"en-GB"``, ``"en_US"`` become ``"en"``. Czech and Slovak become
    ``"cs"``. Empty, unknown or non-string input becomes ``"cs"``, which is what
    every released app version implicitly asks for.
    """

    if not isinstance(value, str):
        return DEFAULT_LOCALE
    tag = value.strip().lower().replace("_", "-")
    if tag.split("-", 1)[0] == "en":
        return "en"
    return DEFAULT_LOCALE


def locale_for_account(account: object) -> str:
    """Locale to render for this account outside a request.

    Reads the ``locale`` column the app keeps fresh through PUT /v1/push-device
    and the account settings write. Missing or unknown means Czech.
    """

    return normalize_locale(getattr(account, "locale", "") or "")


def current_locale() -> str:
    """Locale of the request being handled, normalized to cs/en.

    ``LocaleMiddleware`` already parsed ``Accept-Language``; this only clamps its
    answer to the two languages we actually ship.
    """

    return normalize_locale(translation.get_language() or DEFAULT_LOCALE)


def remember_account_locale(account: object, value: object) -> str:
    """Persist the app language on the account when it actually changed.

    Costs nothing on the common path (no query when the value is unchanged or
    unknown). Returns the effective locale so callers can reuse it.
    """

    current = getattr(account, "locale", "") or ""
    if not value:
        return normalize_locale(current)
    locale = normalize_locale(value)
    if locale == current:
        return locale
    account.locale = locale
    save = getattr(account, "save", None)
    if callable(save):
        save(update_fields=["locale"])
    return locale


@dataclass(frozen=True)
class LocalizedText:
    """A string written for somebody else, rendered once the reader is known.

    Push notifications and inbox rows are composed on the sender's thread but
    read by the recipient, so the language cannot be decided at the call site.
    Keep the lazy msgid plus its named placeholders and let the delivery code
    render it inside ``translation.override(...)``.
    """

    template: object
    params: Mapping[str, object] | None = None

    def __str__(self) -> str:
        text = str(self.template)
        return text % dict(self.params) if self.params else text


def render_localized(value: object, locale: str) -> str:
    """Render a LocalizedText (or a plain string) in the given locale."""

    with translation.override(locale):
        return str(value)

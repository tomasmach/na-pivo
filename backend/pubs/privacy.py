"""Shared redaction helpers for sensitive values that appear in paths.

Capability routes carry secrets in the URL itself: table join codes
(``/v1/party-evenings/<code>`` and ``/party/<code>``) and friend invite
tokens (``/p/<token>``). Everything that ends up in logs must pass through
:red:`redact_party_codes` first so neither value survives a log line.
"""

from __future__ import annotations

import re

# Servers hand PATH_INFO over either decoded or percent-encoded, so every
# slash in these patterns tolerates the %2F form.
_SLASH = r"(?:/|%2F)"

_PARTY_PATH_RE = re.compile(
    rf"({_SLASH}v1{_SLASH}party-evenings{_SLASH})[A-Z2-9]{{6}}(?![A-Z2-9])",
    re.IGNORECASE,
)
_PARTY_WEB_PATH_RE = re.compile(
    rf"({_SLASH}party{_SLASH})[A-Z2-9]{{6}}(?![A-Z2-9])",
    re.IGNORECASE,
)
_INVITE_PATH_RE = re.compile(
    rf"({_SLASH}p{_SLASH})[A-Za-z0-9_-]{{8,}}(?=[^A-Za-z0-9_-]|$)",
)
_PARTY_FIELD_RE = re.compile(
    r"(?P<prefix>(?<!\w)[\"']?(?:join_code|party_code)[\"']?\s*[:=]\s*[\"']?)"
    r"[A-Z2-9]{6}(?=[\"']|\b)",
    re.IGNORECASE,
)
_QUERY_SECRET_RE = re.compile(
    r"(?P<prefix>[?&][\"']?(?:code|invite|invite_token|join_code|joinCode)"
    r"[\"']?[=:])[^&\s'\"]+",
    re.IGNORECASE,
)


def redact_party_codes(value: str) -> str:
    """Remove capability secrets from request paths and diagnostic text."""

    redacted = _PARTY_PATH_RE.sub(r"\1[redacted-party-code]", value)
    redacted = _PARTY_WEB_PATH_RE.sub(r"\1[redacted-party-code]", redacted)
    redacted = _INVITE_PATH_RE.sub(r"\1[redacted-invite-token]", redacted)
    redacted = _PARTY_FIELD_RE.sub(r"\g<prefix>[redacted-party-code]", redacted)
    return _QUERY_SECRET_RE.sub(r"\g<prefix>[redacted]", redacted)

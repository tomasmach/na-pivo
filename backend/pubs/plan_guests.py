"""Guests of a plan: people without an account who answer through the plan's link.

The link token is an HMAC of the plan's public id under ``SECRET_KEY``, so the
host gets the same link on every device, while the database keeps only its
SHA-256. A leaked database alone cannot rebuild a link; rotating ``SECRET_KEY``
retires all of them.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import unicodedata

from django.conf import settings
from django.utils.translation import gettext

from pubs.accounts import RESERVED_NICKNAMES
from pubs.models import Account, FriendActivityResponse, FriendPubActivity

MAX_GUESTS = 30
NAME_MIN = 2
NAME_MAX = 30
_LINKISH = re.compile(r"https?:|://|www\.|[@/\\]|\b[\w-]+\.[a-z]{2,}\b", re.IGNORECASE)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def guest_token(activity: FriendPubActivity) -> str:
    digest = hmac.new(
        str(settings.SECRET_KEY).encode(),
        f"plan-guest:{activity.public_id}".encode(),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest[:18]).decode().rstrip("=")


def guest_link(activity: FriendPubActivity, lang: str = "cs") -> str:
    """The host's shareable link; stores the token's hash the first time."""

    from pubs.web.routes import web_reverse

    token = guest_token(activity)
    token_hash = _hash(token)
    if activity.guest_token_hash != token_hash:
        FriendPubActivity.objects.filter(pk=activity.pk).update(guest_token_hash=token_hash)
        activity.guest_token_hash = token_hash
    return f"{settings.PUBLIC_WEB_ORIGIN}{web_reverse('web-plan-invite', lang, token=token)}"


def activity_for_token(token: str) -> FriendPubActivity | None:
    if not token or len(token) > 64:
        return None
    return (
        FriendPubActivity.objects.select_related("account")
        .filter(guest_token_hash=_hash(token))
        .first()
    )


def device_hash(cookie_value: str) -> str:
    return _hash(f"plan-guest-device:{cookie_value}")


def clean_guest_name(raw: str) -> str:
    """The name as stored, or ``ValueError`` with a message for the guest."""

    text = "".join(ch for ch in str(raw or "") if unicodedata.category(ch)[0] != "C")
    name = " ".join(text.split())
    if len(name) < NAME_MIN or not any(ch.isalpha() for ch in name):
        raise ValueError(gettext("Napiš jméno, ať tě parta pozná."))
    if len(name) > NAME_MAX:
        raise ValueError(gettext("Stačí kratší jméno, nejvýš %(max)s znaků.") % {"max": NAME_MAX})
    if _LINKISH.search(name):
        raise ValueError(gettext("Jméno nesmí obsahovat odkaz ani adresu."))
    if name.lower().replace(" ", "") in RESERVED_NICKNAMES:
        raise ValueError(gettext("Tohle jméno použít nejde. Zkus jiné."))
    return name


def short_name(account: Account) -> str:
    """First name or nickname: what a stranger with the link may read about a person."""

    first = (account.display_name or "").split()
    if first:
        return first[0][:30]
    if account.nickname:
        return account.nickname
    return gettext("Kamarád")


def visible_guests(activity: FriendPubActivity, *, is_owner: bool) -> list[dict]:
    """Guests for the plan detail in the app: the host sees all, invitees who goes."""

    rows = activity.guests.all()
    return [
        {"id": str(row.public_id), "name": row.name, "response": row.response}
        for row in rows
        if is_owner or row.response == FriendActivityResponse.Response.GOING
    ]

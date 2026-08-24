"""Community quorum-trust domain helpers (Phase A).

``Account.quorum_trusted_at`` records that the account proved its identity
through a channel a community quorum can trust: consuming a verified-email
one-time token, completing a password-reset proof, or a cryptographically
verified Google/Apple sign-in or link. For the social proofs the verified
provider SUBJECT is the proof — no asserted email or ``email_verified``
flag is required. Plain password login never counts.

Rules:

* The stamp is set ONCE. Later proofs never advance an existing stamp.
* ``mark_quorum_trusted`` must be called inside the same DB transaction as
  the proof/identity mutation, so any rollback removes both together.
* A stamp only ripens into trust after exactly :data:`QUORUM_TRUST_AGE`
  (24 hours) AND only while the account is ACTIVE.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone

from pubs.models import Account

QUORUM_TRUST_AGE = timedelta(hours=24)


def mark_quorum_trusted(account_pk: int, *, proven_at: datetime | None = None) -> bool:
    """Stamp the account once; never advance an existing stamp.

    Runs as one conditional UPDATE inside whatever transaction the caller has
    open (the proof transaction). Returns True when this call did the stamping.
    """
    proven_at = proven_at if proven_at is not None else timezone.now()
    stamped = Account.objects.filter(
        pk=account_pk,
        quorum_trusted_at__isnull=True,
    ).update(quorum_trusted_at=proven_at)
    return stamped == 1


def is_quorum_trusted(account: Account | None, now: datetime | None = None) -> bool:
    """Whether the account's stamp has fully ripened (>= 24h old, ACTIVE).

    Uses only the passed instance — no database queries.
    """
    if (
        account is None
        or account.pk is None
        or account.quorum_trusted_at is None
        or account.status != Account.Status.ACTIVE
    ):
        return False
    now = now if now is not None else timezone.now()
    return now - account.quorum_trusted_at >= QUORUM_TRUST_AGE


def trusted_account_q(prefix: str = "", now: datetime | None = None) -> Q:
    """Prefix-safe Q for JOIN filters over related accounts.

    ``prefix`` selects the relation path ("" for Account itself,
    "account__" from a credential row, ...). Exact 24h boundary: a stamp at
    ``now - QUORUM_TRUST_AGE`` matches, anything newer does not.
    """
    now = now if now is not None else timezone.now()
    return Q(
        **{
            f"{prefix}status": Account.Status.ACTIVE,
            f"{prefix}quorum_trusted_at__isnull": False,
            f"{prefix}quorum_trusted_at__lte": now - QUORUM_TRUST_AGE,
        }
    )

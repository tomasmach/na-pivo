from __future__ import annotations

from datetime import timedelta

from pubs.models import XpEvent

# Long enough to explain any level-up the app has not shown yet.
XP_EVENT_RETENTION = timedelta(days=90)


def record_xp_event(
    account_id: int,
    *,
    reason: str,
    amount: int,
    cache_key: str | None = "",
    pub_name: str | None = "",
) -> None:
    if amount <= 0:
        return
    XpEvent.objects.create(
        account_id=account_id,
        reason=reason,
        amount=amount,
        cache_key=(cache_key or "")[:12],
        pub_name=(pub_name or "")[:200],
    )

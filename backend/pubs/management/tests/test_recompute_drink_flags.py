from __future__ import annotations

import uuid
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.models import Account, DrinkLog


def _drink(
    account: Account,
    drank_at,
    *,
    is_suspect: bool = False,
    suspect_reason: str = "",
) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        beer_name="Pilsner Urquell",
        price_czk=65,
        drank_at=drank_at,
        is_suspect=is_suspect,
        suspect_reason=suspect_reason,
    )


@pytest.mark.django_db
def test_recompute_sets_and_clears_auto_flags_and_skips_manual_rows():
    daily_account = Account.objects.create(device_id=str(uuid.uuid4()))
    burst_account = Account.objects.create(device_id=str(uuid.uuid4()))
    backdated_account = Account.objects.create(device_id=str(uuid.uuid4()))
    local_now = timezone.localtime(timezone.now())
    day_start = (local_now - timedelta(days=1)).replace(
        hour=8, minute=0, second=0, microsecond=0
    )

    stale_auto = _drink(
        daily_account,
        day_start,
        is_suspect=True,
        suspect_reason="burst",
    )
    manual = _drink(
        daily_account,
        day_start + timedelta(minutes=30),
        is_suspect=True,
        suspect_reason="manual",
    )
    daily_rows = [stale_auto, manual]
    for index in range(2, 15):
        daily_rows.append(_drink(daily_account, day_start + timedelta(minutes=30 * index)))

    burst_start = day_start
    burst_rows = [
        _drink(burst_account, burst_start + timedelta(seconds=index)) for index in range(13)
    ]
    backdated = _drink(backdated_account, timezone.now() - timedelta(days=61))

    out = StringIO()
    call_command("recompute_drink_flags", "--since", "90", stdout=out)

    for row in [stale_auto, manual, daily_rows[-1], burst_rows[-1], backdated]:
        row.refresh_from_db()
    assert (stale_auto.is_suspect, stale_auto.suspect_reason) == (False, "")
    assert (manual.is_suspect, manual.suspect_reason) == (True, "manual")
    assert (daily_rows[-1].is_suspect, daily_rows[-1].suspect_reason) == (
        True,
        "daily_cap",
    )
    assert (burst_rows[-1].is_suspect, burst_rows[-1].suspect_reason) == (True, "burst")
    assert (backdated.is_suspect, backdated.suspect_reason) == (True, "backdated")
    assert "manual_skipped=1" in out.getvalue()

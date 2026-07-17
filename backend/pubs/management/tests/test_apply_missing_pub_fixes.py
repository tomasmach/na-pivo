from __future__ import annotations

import json

import pytest
from django.core.management import call_command

from pubs.management.commands.apply_missing_pub_fixes import FIXES
from pubs.models import PubReport, UserAddedPub


@pytest.mark.django_db
def test_apply_missing_pub_fixes_dry_run_does_not_write(capsys):
    call_command("apply_missing_pub_fixes", "--issue", "PIV-9")

    assert UserAddedPub.objects.count() == 0
    output = json.loads(capsys.readouterr().out)
    assert output["dry_run"] is True
    assert {record["name"] for record in output["records"]} == {
        "Restaurace Drápal",
        "Radegastovna U Fleka",
    }


@pytest.mark.django_db
def test_apply_missing_pub_fixes_apply_is_idempotent():
    call_command("apply_missing_pub_fixes", "--issue", "PIV-9", "--apply")
    call_command("apply_missing_pub_fixes", "--issue", "PIV-9", "--apply")

    assert UserAddedPub.objects.count() == 2
    names = set(UserAddedPub.objects.values_list("name", flat=True))
    assert names == {"Restaurace Drápal", "Radegastovna U Fleka"}


@pytest.mark.django_db
def test_apply_missing_pub_fixes_deactivates_matching_piv4_report():
    fix = next(item for item in FIXES if item.issue == "PIV-4")
    report = PubReport.objects.create(
        cache_key=fix.cache_key,
        name="Hospoda U Náhonu",
        lat=fix.lat,
        lng=fix.lng,
        city=fix.city,
        address=fix.address,
        reason=PubReport.Reason.NOT_PUB,
        active=True,
    )

    call_command("apply_missing_pub_fixes", "--issue", "PIV-4", "--apply")

    report.refresh_from_db()
    assert report.active is False
    assert UserAddedPub.objects.filter(cache_key=fix.cache_key, name=fix.name).exists()

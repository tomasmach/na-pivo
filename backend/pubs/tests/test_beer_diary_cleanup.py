"""Drink logs get the menu names without losing a beer (clean_beer_names)."""

from __future__ import annotations

import json
import uuid
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.api.profile_helpers import derive_account_achievements, derive_account_profile_stats
from pubs.beer_diary_cleanup import FIELDS, _distinct_beers, run_diary_cleanup
from pubs.beer_menu_cleanup import build_canonicalizer
from pubs.enrichment import geohash8
from pubs.models import Account, DrinkLog, PubCommunityData

pytestmark = pytest.mark.django_db

_LAT, _LNG = 50.0876, 14.4214
_KEY = geohash8(_LAT, _LNG)


def _menu(*names) -> None:
    PubCommunityData.objects.create(
        cache_key=_KEY,
        name="U Tygra",
        lat=_LAT,
        lng=_LNG,
        beers=[{"name": name, "price_czk": 45, "volume_ml": 500} for name in names],
    )


def _drink(account, beer_name, *, price=45, drink_type=DrinkLog.DrinkType.BEER, suspect=False, minutes=0):
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=_KEY,
        name="U Tygra",
        lat=_LAT,
        lng=_LNG,
        beer_name=beer_name,
        drink_type=drink_type,
        price_czk=price,
        volume_ml=500,
        is_suspect=suspect,
        drank_at=timezone.now() - timedelta(minutes=minutes),
    )


def _unchanged_facts(account) -> list[tuple]:
    return list(
        account.drinks.order_by("pk").values_list(
            "pk", "client_id", "drink_type", "price_czk", "volume_ml", "cache_key",
            "drank_at", "is_suspect", "evening_client_id",
        )
    )


def _lines(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_diary_gets_the_menu_names_and_keeps_every_beer(tmp_path):
    _menu("Stodolní 11°", "Stodolní 11°", "Stodolní 11")
    account = Account.objects.create(device_id="diary-drinker")
    _drink(account, "Radek 12", minutes=5)
    _drink(account, "Primátor 11", minutes=4)
    _drink(account, "Stodolní 11", minutes=3)
    _drink(account, "Kofola", drink_type=DrinkLog.DrinkType.SOFT_DRINK, minutes=2)
    _drink(account, "Radek 12", suspect=True, minutes=1)
    facts = _unchanged_facts(account)
    stats = derive_account_profile_stats(account)

    report = tmp_path / "report.jsonl"
    call_command("clean_beer_names", "--apply", "--report", str(report))

    names = list(account.drinks.order_by("pk").values_list("beer_name", "beer_product_key"))
    assert names == [
        ("Radegast Ryze Hořká 12°", "radegast-ryze-horka-12"),
        ("Primátor 11°", "primator-11"),
        ("Stodolní 11°", ""),
        ("Kofola", ""),
        ("Radegast Ryze Hořká 12°", "radegast-ryze-horka-12"),
    ]
    assert _unchanged_facts(account) == facts
    after = derive_account_profile_stats(account)
    assert after["total_beers"] == stats["total_beers"] == 3
    assert after["total_spent_czk"] == stats["total_spent_czk"]
    # The Python twin used by the badge guard counts what the profile counts.
    rows = [(d, {name: getattr(d, name) for name in FIELDS}) for d in account.drinks.all()]
    assert _distinct_beers(rows) == after["distinct_beer_identities"]

    assert _lines(report)[-1]["summary"]["drinks_renamed"] == 4
    assert run_diary_cleanup(build_canonicalizer().name, apply=False).changes == []

    call_command("clean_beer_names", "--revert", str(report))
    assert list(account.drinks.order_by("pk").values_list("beer_name", "beer_product_key")) == [
        ("Radek 12", ""),
        ("Primátor 11", ""),
        ("Stodolní 11", ""),
        ("Kofola", ""),
        ("Radek 12", ""),
    ]
    assert _unchanged_facts(account) == facts


def test_nobody_loses_the_taster_badge():
    _menu("Stodolní 11°")
    kept = Account.objects.create(device_id="exactly-ten")
    cleaned = Account.objects.create(device_id="eleven")
    for account in (kept, cleaned):
        _drink(account, "Stodolní 11")
        _drink(account, "Stodolní 11°")
        for n in range(8):
            _drink(account, f"Pivo číslo {n}")
    _drink(cleaned, "Ještě jedno")
    assert derive_account_achievements(kept)["taster"] is True

    plan = run_diary_cleanup(build_canonicalizer().name, apply=True)

    assert plan.accounts_kept_for_badge == 1
    assert derive_account_achievements(kept)["taster"] is True
    assert sorted(kept.drinks.values_list("beer_name", flat=True))[-2:] == ["Stodolní 11", "Stodolní 11°"]
    assert derive_account_achievements(cleaned)["taster"] is True
    assert cleaned.drinks.filter(beer_name="Stodolní 11°").count() == 2


def test_a_beer_renamed_by_its_owner_meanwhile_keeps_the_owners_name(tmp_path):
    account = Account.objects.create(device_id="renamer")
    first = _drink(account, "Radek 12")
    second = _drink(account, "Primátor 11")

    def owner_renames(changes) -> None:
        DrinkLog.objects.filter(pk=first.pk).update(beer_name="Kozel 11")

    plan = run_diary_cleanup(build_canonicalizer().name, apply=True, record=owner_renames)

    assert plan.rows_edited_meanwhile == 1
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.beer_name == "Kozel 11"
    assert second.beer_name == "Primátor 11°"


def test_revert_keeps_a_beer_renamed_after_the_cleanup(tmp_path):
    account = Account.objects.create(device_id="later-renamer")
    first = _drink(account, "Radek 12")
    second = _drink(account, "Primátor 11")
    report = tmp_path / "report.jsonl"
    call_command("clean_beer_names", "--apply", "--report", str(report))
    DrinkLog.objects.filter(pk=first.pk).update(beer_name="Kozel 11")

    call_command("clean_beer_names", "--revert", str(report))

    first.refresh_from_db()
    second.refresh_from_db()
    assert first.beer_name == "Kozel 11"
    assert second.beer_name == "Primátor 11"

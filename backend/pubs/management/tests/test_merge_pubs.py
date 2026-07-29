from __future__ import annotations

import json
import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.api.cache import get_cached_pub_details
from pubs.enrichment import geohash8
from pubs.identity import resolve_pub_identity
from pubs.models import (
    Account,
    CanonicalPub,
    DrinkLog,
    PubAlias,
    PubCommunityData,
    PubDirectory,
    PubExternalBeerMenu,
    PubMergeAudit,
    PubRating,
    PubVisit,
    UserAddedPub,
)
from pubs.pub_merge import apply_pub_merge_plan, build_pub_merge_plan


def _directory_pub(name: str, lat: float, lng: float) -> PubDirectory:
    return PubDirectory.objects.create(
        name=name,
        lat=lat,
        lng=lng,
        city="Praha",
        country="cz",
        source="test",
        refreshed_at=timezone.now(),
    )


@pytest.mark.django_db
def test_merge_only_deactivates_source_catalog_and_keeps_user_rows_unchanged():
    source = _directory_pub("Hospoda Test", 50.0000, 14.0000)
    target = _directory_pub("Hospoda Test", 50.0005, 14.0005)
    account = Account.objects.create(device_id=str(uuid.uuid4()))
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=source.cache_key,
        name=source.name,
        lat=source.lat,
        lng=source.lng,
        city=source.city,
        external_id="source-place",
        beer_name="Testovací ležák",
        price_czk=55,
        volume_ml=500,
        drank_at=timezone.now(),
    )
    visit = PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=source.cache_key,
        name=source.name,
        lat=source.lat,
        lng=source.lng,
        city=source.city,
        external_id="source-place",
        started_at=timezone.now(),
        client_updated_at=timezone.now(),
    )
    rating = PubRating.objects.create(
        account=account,
        cache_key=source.cache_key,
        name=source.name,
        lat=source.lat,
        lng=source.lng,
        external_id="source-place",
        verdict=PubRating.Verdict.LIKE,
        note="Pořád stejné",
        client_updated_at=timezone.now(),
    )
    original = {
        "drink": (
            drink.cache_key,
            drink.name,
            drink.lat,
            drink.lng,
            drink.beer_name,
            drink.price_czk,
        ),
        "visit": (
            visit.cache_key,
            visit.name,
            visit.lat,
            visit.lng,
            visit.started_at,
        ),
        "rating": (
            rating.cache_key,
            rating.name,
            rating.note,
            rating.verdict,
        ),
    }

    plan = build_pub_merge_plan(
        source_cache_key=source.cache_key,
        source_name=source.name,
        target_cache_key=target.cache_key,
        target_name=target.name,
        canonical_name="Hospoda Test",
    )
    audit = apply_pub_merge_plan(
        plan,
        actor="test",
        reason="Explicitly reviewed duplicate",
    )

    source.refresh_from_db()
    target.refresh_from_db()
    drink.refresh_from_db()
    visit.refresh_from_db()
    rating.refresh_from_db()
    assert source.active is False
    assert target.active is True
    assert (
        drink.cache_key,
        drink.name,
        drink.lat,
        drink.lng,
        drink.beer_name,
        drink.price_czk,
    ) == original["drink"]
    assert (
        visit.cache_key,
        visit.name,
        visit.lat,
        visit.lng,
        visit.started_at,
    ) == original["visit"]
    assert (
        rating.cache_key,
        rating.name,
        rating.note,
        rating.verdict,
    ) == original["rating"]
    assert DrinkLog.objects.count() == 1
    assert PubVisit.objects.count() == 1
    assert PubRating.objects.count() == 1
    assert audit.affected_rows["pubs.DrinkLog"] == 1
    assert audit.affected_rows["pubs.PubVisit"] == 1
    assert audit.affected_rows["pubs.PubRating"] == 1

    resolved = resolve_pub_identity(source.cache_key, source.name)
    assert resolved.canonical_id == str(audit.canonical_pub.public_id)
    assert resolved.cache_key == target.cache_key
    assert set(resolved.cache_keys) == {source.cache_key, target.cache_key}


@pytest.mark.django_db
def test_merge_command_is_dry_run_by_default(capsys):
    source = _directory_pub("Zdrojová hospoda", 50.0100, 14.0100)
    target = _directory_pub("Cílová hospoda", 50.0105, 14.0105)

    call_command(
        "merge_pubs",
        source_cache_key=source.cache_key,
        source_name=source.name,
        target_cache_key=target.cache_key,
        target_name=target.name,
    )

    payload = json.loads(capsys.readouterr().out)
    source.refresh_from_db()
    assert payload["mode"] == "dry-run"
    assert payload["destructive_changes"] is False
    assert source.active is True
    assert not CanonicalPub.objects.exists()
    assert not PubAlias.objects.exists()
    assert not PubMergeAudit.objects.exists()


@pytest.mark.django_db
def test_unmerge_reactivates_source_and_retains_audit_and_alias_rows():
    source = _directory_pub("Zdrojová hospoda", 50.0200, 14.0200)
    target = _directory_pub("Cílová hospoda", 50.0205, 14.0205)
    plan = build_pub_merge_plan(
        source_cache_key=source.cache_key,
        source_name=source.name,
        target_cache_key=target.cache_key,
        target_name=target.name,
    )
    audit = apply_pub_merge_plan(plan, actor="merge-test", reason="reviewed")
    alias_count = PubAlias.objects.count()

    call_command("unmerge_pubs", audit_id=audit.pk, actor="rollback-test")

    source.refresh_from_db()
    audit.refresh_from_db()
    audit.canonical_pub.refresh_from_db()
    assert source.active is True
    assert audit.reverted_at is not None
    assert audit.reverted_by == "rollback-test"
    assert audit.canonical_pub.active is False
    assert PubAlias.objects.count() == alias_count
    assert not PubAlias.objects.filter(active=True).exists()


@pytest.mark.django_db
def test_late_user_added_alias_can_be_retained_inactive():
    source_lat, source_lng = 50.0300, 14.0300
    target = _directory_pub("Jedna hospoda", 50.0305, 14.0305)
    source = UserAddedPub.objects.create(
        client_id=uuid.uuid4(),
        cache_key=geohash8(source_lat, source_lng),
        name="Jedna hospoda - restaurace",
        lat=source_lat,
        lng=source_lng,
        city="Praha",
    )
    plan = build_pub_merge_plan(
        source_cache_key=source.cache_key,
        source_name=source.name,
        target_cache_key=target.cache_key,
        target_name=target.name,
        canonical_name="Jedna hospoda",
    )
    apply_pub_merge_plan(plan, actor="test", reason="reviewed")

    resolved = resolve_pub_identity(source.cache_key, source.name)
    late_row = UserAddedPub.objects.create(
        client_id=uuid.uuid4(),
        cache_key=source.cache_key,
        name=source.name,
        lat=source.lat,
        lng=source.lng,
        city=source.city,
        active=resolved.canonical_id is None,
    )

    assert late_row.active is False
    assert UserAddedPub.objects.filter(cache_key=source.cache_key).count() == 2


@pytest.mark.django_db
def test_detail_read_combines_beers_without_mutating_source_rows():
    source = _directory_pub("Pivovar - restaurace", 50.0400, 14.0400)
    target = _directory_pub("Pivovar", 50.0405, 14.0405)
    source_menu = PubCommunityData.objects.create(
        cache_key=source.cache_key,
        name=source.name,
        lat=source.lat,
        lng=source.lng,
        city=source.city,
        beers=[{"name": "Zdrojový ležák", "price_czk": 55, "volume_ml": 500}],
    )
    target_menu = PubCommunityData.objects.create(
        cache_key=target.cache_key,
        name=target.name,
        lat=target.lat,
        lng=target.lng,
        city=target.city,
        beers=[{"name": "Cílová IPA", "price_czk": 65, "volume_ml": 500}],
    )
    external = PubExternalBeerMenu.objects.create(
        cache_key=source.cache_key,
        name=source.name,
        lat=source.lat,
        lng=source.lng,
        city=source.city,
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="retained-source-menu",
        source_url="https://example.com/menu",
        beers=[{"name": "Archivní desítka", "price_czk": 45, "volume_ml": 500}],
    )
    plan = build_pub_merge_plan(
        source_cache_key=source.cache_key,
        source_name=source.name,
        target_cache_key=target.cache_key,
        target_name=target.name,
    )
    apply_pub_merge_plan(plan, actor="test", reason="reviewed")

    result = get_cached_pub_details(
        [{"name": source.name, "lat": source.lat, "lng": source.lng}]
    )[0]

    assert result is not None
    assert result["key"] == target.cache_key
    assert {beer["name"] for beer in result["beers"]} == {
        "Zdrojový ležák",
        "Cílová IPA",
    }
    assert {beer["name"] for beer in result["historical_beers"]} == {
        "Archivní desítka"
    }
    source_menu.refresh_from_db()
    target_menu.refresh_from_db()
    external.refresh_from_db()
    assert source_menu.cache_key == source.cache_key
    assert target_menu.cache_key == target.cache_key
    assert external.cache_key == source.cache_key

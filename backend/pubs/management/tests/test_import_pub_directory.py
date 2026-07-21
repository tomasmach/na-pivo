from __future__ import annotations

import json
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.enrichment.matcher import geohash8
from pubs.identity import normalize_pub_name
from pubs.models import PubDirectory, PubHours

REFRESHED_AT = "2026-06-01"
NAME = "Hospoda U Černého vola"
LAT = 50.087
LNG = 14.421
KEY = geohash8(LAT, LNG)


def _row(**changes):
    row = {
        "country": "cz", "name": NAME, "lat": LAT, "lng": LNG,
        "cache_key": KEY, "city": "Praha", "venue_kind": "pub",
        "opening_hours_raw": "Mo-Su 10:00-23:00", "rating_value": 4.7,
        "rating_count": 42, "rating_label": "Výborné", "source_ref": "123",
        "confidence": 0.96, "status": "ok",
    }
    row.update(changes)
    return row


def _export(tmp_path, *rows):
    path = tmp_path / "export.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return path


def _run(path, **options):
    stdout = StringIO()
    call_command("import_pub_directory", path, refreshed_at=REFRESHED_AT, stdout=stdout, **options)
    return stdout.getvalue()


@pytest.mark.django_db
def test_empty_import_and_rerun_are_idempotent(tmp_path):
    path = _export(tmp_path, _row())
    first = _run(path)
    second = _run(path)
    assert "created=1 updated=0 unchanged=0" in first
    assert "inserted=1 filled=0" in first
    assert "created=0 updated=0 unchanged=1" in second
    assert "protected=1" in second
    assert PubDirectory.objects.count() == PubHours.objects.count() == 1


@pytest.mark.django_db
def test_import_preserves_reviewed_secondary_discovery_metadata(tmp_path):
    _run(
        _export(
            tmp_path,
            _row(discovery_kind="campsite", has_beer_signal=True),
        )
    )

    directory = PubDirectory.objects.get()
    assert directory.discovery_kind == PubDirectory.DiscoveryKind.CAMPSITE
    assert directory.has_beer_signal is True


@pytest.mark.django_db
def test_existing_hours_are_protected_field_by_field(tmp_path):
    existing = PubHours.objects.create(
        cache_key=KEY, name="Original", lat=1, lng=2, city="Original city",
        opening_hours_raw="old", source="manual", source_ref="old-ref", confidence=0.1,
        rating_value=1, rating_count=2, rating_label="old", status="ok",
        venue_kind="maybe",
    )
    before = {field.name: getattr(existing, field.name) for field in existing._meta.fields}
    report = _run(_export(tmp_path, _row()))
    existing.refresh_from_db()
    after = {field.name: getattr(existing, field.name) for field in existing._meta.fields}
    assert "protected=1" in report
    assert after == before


@pytest.mark.django_db
def test_empty_matching_row_is_filled_without_identity_changes(tmp_path):
    existing = PubHours.objects.create(
        cache_key=KEY, name="Hospoda U Cerneho vola", lat=1, lng=2,
        opening_hours_raw=None, status="unknown",
    )
    report = _run(_export(tmp_path, _row()))
    existing.refresh_from_db()
    assert "filled=1" in report
    assert (existing.name, existing.lat, existing.lng) == ("Hospoda U Cerneho vola", 1, 2)
    assert existing.opening_hours_raw == "Mo-Su 10:00-23:00"


@pytest.mark.django_db
def test_different_business_in_same_cell_is_name_conflict(tmp_path):
    existing = PubHours.objects.create(
        cache_key=KEY, name="Lékárna Slunce", lat=1, lng=2,
        opening_hours_raw=None, status="error",
    )
    report = _run(_export(tmp_path, _row()))
    existing.refresh_from_db()
    assert "name_conflict=1" in report
    assert existing.opening_hours_raw is None


@pytest.mark.django_db
def test_inactive_directory_entry_stays_inactive(tmp_path):
    PubDirectory.objects.create(
        cache_key=KEY, name_key=normalize_pub_name(NAME), name=NAME, lat=LAT, lng=LNG,
        city="", country="cz", venue_kind="maybe", source="bulk_scrape",
        active=False, refreshed_at="2025-01-01T00:00:00Z",
    )
    _run(_export(tmp_path, _row(opening_hours_raw=None, rating_value=None, rating_count=None, rating_label=None)))
    assert PubDirectory.objects.get().active is False


@pytest.mark.django_db
def test_dry_run_reports_exact_work_and_rolls_back(tmp_path):
    report = _run(_export(tmp_path, _row()), dry_run=True)
    assert "DRY RUN - PubDirectory: created=1" in report
    assert "DRY RUN - PubHours: inserted=1" in report
    assert not PubDirectory.objects.exists()
    assert not PubHours.objects.exists()

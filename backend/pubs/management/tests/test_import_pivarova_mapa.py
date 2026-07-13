from __future__ import annotations

import json
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.enrichment.matcher import geohash8
from pubs.identity import normalize_pub_name
from pubs.models import PubDirectory, PubExternalBeerMenu

NAME = "Restaurace U Fleků"
LAT = 50.0812
LNG = 14.4182
KEY = geohash8(LAT, LNG)


def _directory():
    return PubDirectory.objects.create(
        name=NAME,
        name_key=normalize_pub_name(NAME),
        lat=LAT,
        lng=LNG,
        cache_key=KEY,
        city="Praha",
        country="cz",
        venue_kind="pub",
        source="bulk_scrape",
        refreshed_at="2026-07-01T00:00:00Z",
    )


def _row(**changes):
    row = {
        "source": "pivarova_mapa",
        "source_id": "source-1",
        "source_slug": "u-fleku",
        "source_url": "https://pivarovamapa.cz/podnik/u-fleku",
        "name": "U Fleků",
        "lat": LAT,
        "lng": LNG,
        "city": "Praha",
        "beers": [
            {
                "name": "Flekovský ležák 13°",
                "price_czk": 79,
                "volume_ml": 400,
                "verified_at": "2026-06-30T16:27:49Z",
                "verification_method": "ai_phone",
            }
        ],
    }
    row.update(changes)
    return row


def _export(tmp_path, *rows):
    path = tmp_path / "prices.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return path


def _run(path, **options):
    stdout = StringIO()
    call_command("import_pivarova_mapa", path, stdout=stdout, **options)
    return stdout.getvalue()


@pytest.mark.django_db
def test_dry_run_matches_but_rolls_back(tmp_path):
    _directory()
    report = _run(_export(tmp_path, _row()))
    assert "DRY RUN - External menus: created=1" in report
    assert not PubExternalBeerMenu.objects.exists()


@pytest.mark.django_db
def test_apply_creates_reviewed_fallback_and_is_idempotent(tmp_path):
    _directory()
    path = _export(tmp_path, _row())

    first = _run(path, apply=True)
    second = _run(path, apply=True)

    assert "created=1 updated=0" in first
    assert "created=0 updated=0 unchanged=1" in second
    menu = PubExternalBeerMenu.objects.get()
    assert menu.cache_key == KEY
    assert menu.name == NAME
    assert menu.beers == [{"name": "Flekovský ležák 13°", "price_czk": 79, "volume_ml": 400}]
    assert menu.verified_at.isoformat() == "2026-06-30T16:27:49+00:00"


@pytest.mark.django_db
def test_unmatched_and_empty_rows_are_not_imported(tmp_path):
    _directory()
    report = _run(
        _export(
            tmp_path,
            _row(source_id="far", lat=48.0, lng=12.0),
            _row(source_id="empty", beers=[]),
        ),
        apply=True,
    )
    assert "unmatched=1" in report
    assert "empty=1" in report
    assert not PubExternalBeerMenu.objects.exists()

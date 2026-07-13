from __future__ import annotations

import json
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.enrichment.matcher import geohash8
from pubs.identity import normalize_pub_name
from pubs.models import PubCommunityData, PubDirectory, PubExternalBeerMenu

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
    assert "DRY RUN - Pubs: matched=1 created=0" in report
    assert "External menus: created=1" in report
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
def test_source_pub_promotes_existing_directory_classification(tmp_path):
    directory = _directory()
    directory.venue_kind = "not_pub"
    directory.save(update_fields=["venue_kind"])

    report = _run(_export(tmp_path, _row()), apply=True)

    directory.refresh_from_db()
    assert "promoted=1" in report
    assert directory.venue_kind == "pub"


@pytest.mark.django_db
def test_generic_nearby_name_does_not_steal_missing_pub(tmp_path):
    PubDirectory.objects.create(
        name="Restaurace Rong Vang II",
        name_key=normalize_pub_name("Restaurace Rong Vang II"),
        lat=LAT + 0.0002,
        lng=LNG + 0.0002,
        cache_key=geohash8(LAT + 0.0002, LNG + 0.0002),
        city="Praha",
        country="cz",
        venue_kind="not_pub",
        source="bulk_scrape",
        refreshed_at="2026-07-01T00:00:00Z",
    )

    report = _run(_export(tmp_path, _row(name="Restaurace Sbeerka")), apply=True)

    assert "matched=0 created=1" in report
    assert PubDirectory.objects.filter(name="Restaurace Sbeerka").exists()


@pytest.mark.django_db
def test_clear_nearest_candidate_resolves_close_scores(tmp_path):
    for name, lat, lng in (
        ("Hostivařský pivovar", 50.04668, 14.55042),
        ("Restaurace Hostivar H1", 50.04636, 14.54941),
    ):
        PubDirectory.objects.create(
            name=name,
            name_key=normalize_pub_name(name),
            lat=lat,
            lng=lng,
            cache_key=geohash8(lat, lng),
            city="Praha",
            country="cz",
            venue_kind="pub",
            source="bulk_scrape",
            refreshed_at="2026-07-01T00:00:00Z",
        )
    path = _export(
        tmp_path,
        _row(name="Pivovar Hostivar H1", lat=50.046287, lng=14.549386),
    )

    report = _run(path, apply=True)

    assert "matched=1 created=0" in report
    assert PubExternalBeerMenu.objects.get().name == "Restaurace Hostivar H1"


@pytest.mark.django_db
def test_unmatched_and_empty_rows_add_missing_pubs(tmp_path):
    _directory()
    report = _run(
        _export(
            tmp_path,
            _row(source_id="far", lat=48.0, lng=12.0),
            _row(
                source_id="empty",
                name="Hospoda bez cen",
                lat=48.1,
                lng=12.1,
                beers=[],
            ),
        ),
        apply=True,
    )
    assert "created=2" in report
    assert "empty=1" in report
    assert PubDirectory.objects.count() == 3
    assert PubExternalBeerMenu.objects.count() == 1
    assert PubExternalBeerMenu.objects.get().source_id == "far"


@pytest.mark.django_db
def test_user_menu_is_never_seeded_over(tmp_path):
    directory = _directory()
    PubCommunityData.objects.create(
        cache_key=directory.cache_key,
        name=directory.name,
        lat=directory.lat,
        lng=directory.lng,
        beers=[{"name": "Uživatelské pivo", "price_czk": 55, "volume_ml": 500}],
    )

    report = _run(_export(tmp_path, _row()), apply=True)

    assert "skipped_user_menu=1" in report
    assert not PubExternalBeerMenu.objects.exists()


@pytest.mark.django_db
def test_explicitly_cleared_user_menu_is_never_seeded_over(tmp_path):
    directory = _directory()
    PubCommunityData.objects.create(
        cache_key=directory.cache_key,
        name=directory.name,
        lat=directory.lat,
        lng=directory.lng,
        beers=[],
        beers_updated_at="2026-07-01T00:00:00Z",
    )

    report = _run(_export(tmp_path, _row()), apply=True)

    assert "skipped_user_menu=1" in report
    assert not PubExternalBeerMenu.objects.exists()


@pytest.mark.django_db
def test_seed_normalizes_pub_and_known_beer_names(tmp_path):
    path = _export(
        tmp_path,
        _row(
            name="  Nová   hospoda  ",
            lat=48.0,
            lng=12.0,
            beers=[
                {
                    "name": "  Plzeň  ",
                    "price_czk": 62,
                    "volume_ml": 500,
                    "verified_at": "2026-06-30T16:27:49Z",
                },
                {
                    "name": "Plzeň",
                    "price_czk": 62,
                    "volume_ml": 500,
                    "verified_at": "2026-06-30T16:27:49Z",
                },
            ],
        ),
    )

    _run(path, apply=True)

    directory = PubDirectory.objects.get()
    assert directory.name == "Nová hospoda"
    assert directory.name_key == "nová hospoda"
    assert PubExternalBeerMenu.objects.get().beers == [
        {"name": "Pilsner Urquell", "price_czk": 62, "volume_ml": 500}
    ]

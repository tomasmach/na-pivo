"""One-off and weekly cleanup of beer names on pub menus (clean_beer_names)."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from pubs.api.views import _merge_drink_into_menu
from pubs.beer_catalog import normalize_beer_text
from pubs.beer_menu_cleanup import preferred_spellings, run_menu_cleanup, tidy_beer_name
from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    BeerBrand,
    BeerProduct,
    DrinkLog,
    PubBeerProduct,
    PubCommunityData,
    PubExternalBeerMenu,
)

_LAT, _LNG = 50.0876, 14.4214
_KEY = geohash8(_LAT, _LNG)


def _menu(*beers, historical=(), name="U Tygra", lat=_LAT, lng=_LNG) -> PubCommunityData:
    return PubCommunityData.objects.create(
        cache_key=geohash8(lat, lng),
        name=name,
        lat=lat,
        lng=lng,
        beers=list(beers),
        historical_beers=list(historical),
        beers_updated_at=timezone.now() - timedelta(days=3),
    )


def _beer(name, price=None, volume=500):
    return {"name": name, "price_czk": price, "volume_ml": volume}


def _report_lines(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_letters_and_digits_are_separate_tokens():
    assert normalize_beer_text("Holba Šerák11°") == normalize_beer_text("holba serak 11")
    assert normalize_beer_text("Primátor 11°") == normalize_beer_text("primator 11.")


def test_tidy_fixes_spacing_and_degree_marks_only_for_plato_numbers():
    assert tidy_beer_name("Holba  Šerák11˚") == "Holba Šerák 11°"
    assert tidy_beer_name("Mustang 12´") == "Mustang 12°"
    assert tidy_beer_name("Radek 12.") == "Radek 12"
    assert tidy_beer_name("Svijany 450*") == "Svijany 450*"
    assert tidy_beer_name("Radegast 12 %") == "Radegast 12 %"
    assert tidy_beer_name("Konrád 11°tmavé") == "Konrád 11° tmavé"
    assert tidy_beer_name("Dock7 Dark 13°") == "Dock7 Dark 13°"


def test_preferred_spelling_wants_the_degree_sign_then_the_majority():
    names = ["Primátor 11"] * 5 + ["Primátor 11°"] * 2 + ["primator 11"]
    assert preferred_spellings(names)[normalize_beer_text("Primátor 11")] == "Primátor 11°"
    names = ["Svijany 450"] * 4 + ["Svijany 450°"]
    assert preferred_spellings(names)[normalize_beer_text("Svijany 450")] == "Svijany 450"
    assert preferred_spellings(["Rada", "raďa"])[normalize_beer_text("Rada")] == "Rada"


def test_drink_merge_updates_an_existing_spelling_instead_of_adding_a_row():
    beers = [_beer("Primátor 11°", 45)]
    assert _merge_drink_into_menu(beers, _beer("Primátor 11", 48)) is True
    assert beers == [_beer("Primátor 11°", 48)]


@pytest.mark.django_db
def test_menu_write_keeps_one_row_per_beer_and_volume():
    from pubs.api.serializers import PubCommunityRequestSerializer

    serializer = PubCommunityRequestSerializer(
        data={
            "client_id": str(uuid.uuid4()),
            "name": "U Tygra",
            "lat": _LAT,
            "lng": _LNG,
            "beers": [
                {"name": "Stodolní 11", "price_czk": 40, "volume_ml": 500},
                {"name": "Stodolní 11°", "price_czk": 42, "volume_ml": 500},
                {"name": "Stodolní 11°", "price_czk": 30, "volume_ml": 300},
            ],
        }
    )
    assert serializer.is_valid(), serializer.errors
    assert [(b["name"], b["volume_ml"]) for b in serializer.validated_data["beers"]] == [
        ("Stodolní 11", 500),
        ("Stodolní 11°", 300),
    ]


@pytest.mark.django_db
def test_cleanup_unifies_names_and_merges_duplicates(tmp_path):
    account = Account.objects.create(device_id="cleanup-drinker")
    pub = _menu(
        _beer("Kozel 11", 45),
        _beer("Dudák 11", 40),
        _beer("Dudák 11°", 40),
        _beer("Dudák 11", 35, volume=300),
        "not a beer row",
        historical=[_beer("dudák 11", 38), _beer("Stodolní 13", 50)],
    )
    _menu(_beer("Stodolní 13°", 55), name="Jinde", lat=50.2, lng=14.6)
    drink = DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=_KEY,
        name="U Tygra",
        lat=_LAT,
        lng=_LNG,
        beer_name="Dudák 11",
        price_czk=40,
        volume_ml=500,
        drank_at=timezone.now(),
    )

    report = tmp_path / "report.json"
    call_command("clean_beer_names", "--apply", "--report", str(report))

    pub.refresh_from_db()
    assert pub.beers == [
        _beer("Velkopopovický Kozel 11°", 45),
        _beer("Dudák 11°", 40),
        _beer("Dudák 11°", 35, volume=300),
        "not a beer row",
    ]
    # The history keeps only beers that are off tap, in the shared spelling.
    assert pub.historical_beers == [_beer("Stodolní 13°", 50)]
    drink.refresh_from_db()
    assert (drink.beer_name, drink.price_czk) == ("Dudák 11°", 40)
    assert DrinkLog.objects.count() == 1

    lines = _report_lines(report)
    assert lines[-1]["summary"]["merged_items"] == 2
    before = next(c for c in lines[:-1] if c["pk"] == pub.pk and c["field"] == "beers")
    assert before["before"][0] == _beer("Kozel 11", 45)
    # The catalog product is now indexed for the brand filter, credited to nobody.
    link = PubBeerProduct.objects.get(cache_key=_KEY, product_key="velkopopovicky-kozel-11")
    assert link.active is True
    assert link.account is None

    # Idempotent: a second run finds nothing to change.
    second = run_menu_cleanup(apply=False)
    assert second.changes == []
    assert second.index_links_created == 0


@pytest.mark.django_db
def test_conflicting_duplicate_prices_follow_the_newest_drink():
    account = Account.objects.create(device_id="cleanup-price")
    # A nickname on the menu, typed differently in the diary.
    _menu(_beer("Radek 12", 27), _beer("Radegast 12°", 21))
    for minutes, price in ((30, 27), (5, 21)):
        DrinkLog.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            cache_key=_KEY,
            name="U Tygra",
            lat=_LAT,
            lng=_LNG,
            beer_name="Radek 12.",
            price_czk=price,
            volume_ml=500,
            drank_at=timezone.now() - timedelta(minutes=minutes),
        )

    plan = run_menu_cleanup(apply=True)

    assert PubCommunityData.objects.get().beers == [_beer("Radegast Ryze Hořká 12°", 21)]
    [conflict] = plan.changes[0].price_conflicts
    assert conflict["prices"] == [27, 21]
    assert conflict["chosen"] == 21
    assert conflict["from_drink"] is True


@pytest.mark.django_db
def test_dry_run_writes_nothing_and_cleans_imported_menus_too():
    community = _menu(_beer("Primátor 11", 50), _beer("Primátor 11°", 50))
    imported = PubExternalBeerMenu.objects.create(
        cache_key=geohash8(50.3, 14.7),
        name="Pivnice",
        lat=50.3,
        lng=14.7,
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="1",
        source_url="https://example.com/1",
        beers=[_beer("Plzeň", 60), _beer("Pilsner Urquell", 60)],
    )

    plan = run_menu_cleanup(apply=False)

    assert {(change.model, change.pk) for change in plan.changes} == {
        ("community", community.pk),
        ("external", imported.pk),
    }
    community.refresh_from_db()
    imported.refresh_from_db()
    assert len(community.beers) == 2
    assert len(imported.beers) == 2

    run_menu_cleanup(apply=True)
    imported.refresh_from_db()
    assert imported.beers == [_beer("Pilsner Urquell", 60)]


def test_apply_requires_a_backup_report():
    with pytest.raises(CommandError):
        call_command("clean_beer_names", "--apply")


@pytest.mark.django_db
def test_imported_menu_keeps_one_beer_listed_at_two_prices():
    imported = PubExternalBeerMenu.objects.create(
        cache_key=geohash8(50.3, 14.7),
        name="Pivnice",
        lat=50.3,
        lng=14.7,
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="2",
        source_url="https://example.com/2",
        beers=[_beer("Plzeň", 64, 300), _beer("Pilsner Urquell", 65, 300)],
    )

    run_menu_cleanup(apply=True)

    imported.refresh_from_db()
    assert imported.beers == [_beer("Pilsner Urquell", 64, 300), _beer("Pilsner Urquell", 65, 300)]


@pytest.mark.django_db
def test_every_catalog_alias_names_one_beer():
    """An exact alias rewrites what people type, so it must be unambiguous.

    A brand may share an alias with its own default product ("Budvar"), never
    with another brand's beer, and two products never share one.
    """
    owners: dict[str, set[tuple[str, str, str]]] = defaultdict(set)
    for product in BeerProduct.objects.select_related("brand"):
        for alias in [product.name, *product.aliases]:
            owners[normalize_beer_text(alias)].add(("product", product.key, product.brand.key))
    for brand in BeerBrand.objects.all():
        for alias in [brand.name, *brand.aliases]:
            owners[normalize_beer_text(alias)].add(("brand", brand.key, brand.key))
    for alias, entries in owners.items():
        assert len({entry for entry in entries if entry[0] == "product"}) <= 1, (alias, entries)
        assert len({entry[2] for entry in entries}) == 1, (alias, entries)


@pytest.mark.django_db
def test_an_interrupted_run_has_a_backup_for_every_saved_menu(tmp_path):
    pub = _menu(_beer("Primátor 11", 50), _beer("Primátor 11°", 50))
    PubExternalBeerMenu.objects.create(
        cache_key=geohash8(50.3, 14.7),
        name="Pivnice",
        lat=50.3,
        lng=14.7,
        source=PubExternalBeerMenu.Source.PIVAROVA_MAPA,
        source_id="3",
        source_url="https://example.com/3",
        beers=[_beer("Plzeň", 60)],
    )
    report = tmp_path / "report.jsonl"

    with patch("pubs.beer_menu_cleanup._clean_external_row", side_effect=RuntimeError("db gone")):
        with pytest.raises(RuntimeError):
            call_command("clean_beer_names", "--apply", "--report", str(report))

    pub.refresh_from_db()
    assert pub.beers == [_beer("Primátor 11°", 50)]
    [saved] = _report_lines(report)
    assert saved["before"] == [_beer("Primátor 11", 50), _beer("Primátor 11°", 50)]

    call_command("clean_beer_names", "--revert", str(report))
    pub.refresh_from_db()
    assert pub.beers == [_beer("Primátor 11", 50), _beer("Primátor 11°", 50)]


@pytest.mark.django_db
def test_revert_keeps_menus_edited_after_the_cleanup(tmp_path):
    untouched = _menu(_beer("Kozel 11", 45))
    edited = _menu(_beer("Plzeň", 60), name="Jinde", lat=50.2, lng=14.6)
    report = tmp_path / "report.jsonl"
    call_command("clean_beer_names", "--apply", "--report", str(report))
    edited.beers = [_beer("Pilsner Urquell", 65)]
    edited.save(update_fields=["beers"])

    call_command("clean_beer_names", "--revert", str(report))

    untouched.refresh_from_db()
    edited.refresh_from_db()
    assert untouched.beers == [_beer("Kozel 11", 45)]
    assert edited.beers == [_beer("Pilsner Urquell", 65)]


@pytest.mark.django_db
def test_catalog_knows_czech_beer_nicknames():
    from pubs.beer_catalog import match_beer

    def product(name):
        match = match_beer(name, fuzzy=False)
        return match.product.key if match and match.product else None

    assert product("Radek 12") == "radegast-ryze-horka-12"
    assert product("Radegast Ryzí hořká 12°") == "radegast-ryze-horka-12"
    assert product("radek 10") == "radegast-razna-10"
    assert product("Plznička") == "pilsner-urquell"
    assert product("Staráč 10") == "staropramen-10"
    assert match_beer("Radek", fuzzy=False).brand.key == "radegast"
    # Holba 11 may be Šerák or the half-dark 11, so it stays free text.
    assert match_beer("Holba 11", fuzzy=False) is None


@pytest.mark.django_db
def test_every_catalog_rewrite_lands_on_its_final_name_in_one_step():
    """A rewritten name must not be rewritten again by the next write or cleanup."""
    from pubs.beer_catalog import normalize_beer_payload

    names = [
        name
        for entity in [*BeerProduct.objects.all(), *BeerBrand.objects.all()]
        for name in [entity.name, *entity.aliases]
    ]
    chains = []
    for name in names:
        once = normalize_beer_payload({"name": name})["name"]
        twice = normalize_beer_payload({"name": once})["name"]
        if once != twice:
            chains.append((name, once, twice))
    assert chains == [], chains

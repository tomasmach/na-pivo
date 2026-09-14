"""RED tests for account hard-delete privacy gaps.

These tests pin down the *intended* final behaviour of ``accounts.hard_delete``
and intentionally fail against the current implementation:

A. Rows authored by the deleted account (UGC, telemetry, feedback) are removed
   outright instead of lingering behind SET_NULL.
B. Community signals whose sole author was the deleted account disappear for
   the pub cache key — including in-app DRINK-derived brand/product/price
   rows, while independently verified EXTERNAL price data survives.
C. Current community state is rebuilt from the latest *surviving* contributor's
   logged payloads, so the pub does not advertise data nobody stands behind;
   identity fields the logs cannot prove (city, external_id) are cleared, and
   an exact HOURS/BEERS timestamp tie resolves deterministically by id.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from pubs import accounts
from pubs.enrichment.matcher import geohash8
from pubs.models import (
    Account,
    BeerBrand,
    BeerProduct,
    ClientEvent,
    ContentReport,
    FeedbackReport,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubContributionLog,
    PubNameCorrection,
    PubPriceIndex,
    PubReport,
    UserAddedPub,
)


def _weekly_hours(monday_ranges: list[list[str]]) -> dict:
    """Weekly hours payload shape accepted by the community write endpoint."""
    return {
        "mo": monday_ranges,
        "tu": [],
        "we": [],
        "th": [],
        "fr": [],
        "sa": [],
        "su": [],
    }


def _beer(name: str, price_czk: int, volume_ml: int = 500) -> dict:
    return {"name": name, "price_czk": price_czk, "volume_ml": volume_ml}


def _pub_identity(cache_key: str, name: str, lat: float, lng: float) -> dict:
    return {
        "cache_key": cache_key,
        "name": name,
        "lat": lat,
        "lng": lng,
    }


@pytest.mark.django_db
def test_hard_delete_removes_all_rows_authored_by_the_deleted_account():
    deleted = Account.objects.create(device_id="final-purge-author")
    other = Account.objects.create(device_id="final-purge-other")
    cache_key = geohash8(50.0755, 14.4378)

    pub_report = PubReport.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "Zavřená hospoda", 50.0755, 14.4378),
        external_id="mapy-1",
        reason=PubReport.Reason.CLOSED,
    )
    name_correction = PubNameCorrection.objects.create(
        account=deleted,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        lat=50.0755,
        lng=14.4378,
        original_name="Spatny nazev",
        suggested_name="Spravny nazev",
    )
    added_pub = UserAddedPub.objects.create(
        account=deleted,
        client_id=uuid.uuid4(),
        **_pub_identity(cache_key, "Hospoda od autora", 50.0756, 14.4379),
    )
    contribution = PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "Zavřená hospoda", 50.0755, 14.4378),
        kind=PubContributionLog.Kind.HOURS,
        payload=_weekly_hours([["11:00", "23:00"]]),
        client_id=uuid.uuid4(),
    )
    client_event = ClientEvent.objects.create(
        account=deleted,
        event=ClientEvent.Event.APP_OPEN,
        app_version="3.0.0",
        platform="ios",
    )
    feedback = FeedbackReport.objects.create(
        account=deleted,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.OTHER,
        message="Author-authored support note",
    )
    foreign_snapshot = {
        "nickname": "innocent-bystander",
        "display_name": "Innocent Bystander",
        "marker": "foreign-target-stays",
    }
    reporter_report = ContentReport.objects.create(
        reporter=deleted,
        target_account=other,
        reason=ContentReport.Reason.SPAM,
        comment="Reporter-authored note about someone else",
        target_snapshot=foreign_snapshot,
        status=ContentReport.Status.TRIAGED,
        moderator_note="Triaged before deletion",
    )
    received_report = ContentReport.objects.create(
        reporter=other,
        target_account=deleted,
        reason=ContentReport.Reason.INAPPROPRIATE_NICKNAME,
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()
    assert not PubReport.objects.filter(pk=pub_report.pk).exists()
    assert not PubNameCorrection.objects.filter(pk=name_correction.pk).exists()
    assert not UserAddedPub.objects.filter(pk=added_pub.pk).exists()
    assert not PubContributionLog.objects.filter(pk=contribution.pk).exists()
    assert not ClientEvent.objects.filter(pk=client_event.pk).exists()
    assert not FeedbackReport.objects.filter(pk=feedback.pk).exists()

    # Reports ABOUT the deleted account are necessary moderation history and stay.
    received_report.refresh_from_db()
    assert received_report.reporter_id == other.pk
    assert received_report.target_account_id is None

    # The deleted reporter's own report stays usable for moderation: identity is
    # stripped, moderation metadata and the foreign target snapshot remain.
    reporter_report.refresh_from_db()
    assert reporter_report.reporter_id is None
    assert reporter_report.comment == ""
    assert reporter_report.reason == ContentReport.Reason.SPAM
    assert reporter_report.status == ContentReport.Status.TRIAGED
    assert reporter_report.moderator_note == "Triaged before deletion"
    assert reporter_report.target_snapshot == foreign_snapshot
    assert reporter_report.target_account_id == other.pk


@pytest.mark.django_db
def test_hard_delete_purges_sole_source_community_signals_for_cache_key():
    deleted = Account.objects.create(device_id="final-purge-sole-source")
    cache_key = geohash8(49.1951, 16.6068)
    external_cache_key = geohash8(49.1962, 16.6079)
    now = timezone.now()

    brand = BeerBrand.objects.create(key="purge-test-uneticky", name="Únětický ležák")
    product = BeerProduct.objects.create(
        key="purge-test-uneticky-10",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Únětický ležák 10°",
    )
    beers = [_beer("Únětický ležák 10°", 52)]

    community = PubCommunityData.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Sole Source", 49.1951, 16.6068),
        hours_json=_weekly_hours([["11:00", "23:00"]]),
        opening_hours_raw="Mo 11:00-23:00",
        beers=beers,
        hours_updated_at=now,
        beers_updated_at=now,
    )
    hours_log = PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Sole Source", 49.1951, 16.6068),
        kind=PubContributionLog.Kind.HOURS,
        payload=_weekly_hours([["11:00", "23:00"]]),
        client_id=uuid.uuid4(),
    )
    beers_log = PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Sole Source", 49.1951, 16.6068),
        kind=PubContributionLog.Kind.BEERS,
        payload=beers,
        client_id=uuid.uuid4(),
    )
    # The deleted drinker was also the only in-app source behind these rows:
    # drink-derived provenance must disappear with them, same as community.
    pub_brand = PubBeerBrand.objects.create(
        **_pub_identity(cache_key, "U Sole Source", 49.1951, 16.6068),
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        last_price_czk=52,
        last_volume_ml=500,
        source=PubBeerBrand.Source.DRINK,
        account=deleted,
    )
    pub_product = PubBeerProduct.objects.create(
        **_pub_identity(cache_key, "U Sole Source", 49.1951, 16.6068),
        brand=brand,
        product=product,
        brand_key=brand.key,
        brand_name=brand.name,
        product_key=product.key,
        product_name=product.name,
        last_price_czk=52,
        last_volume_ml=500,
        source=PubBeerProduct.Source.DRINK,
        account=deleted,
    )
    price_index = PubPriceIndex.objects.create(
        **_pub_identity(cache_key, "U Sole Source", 49.1951, 16.6068),
        city="Brno",
        external_id="mapy-sole",
        price_czk=52,
        volume_ml=500,
        observed_at=now,
        source=PubPriceIndex.Source.DRINK,
    )

    # Independently verified price data at a neighbouring pub whose key is
    # also affected by the purge must never be touched.
    PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(external_cache_key, "U Externího pramene", 49.1962, 16.6079),
        kind=PubContributionLog.Kind.HOURS,
        payload=_weekly_hours([["12:00", "22:00"]]),
        client_id=uuid.uuid4(),
    )
    external_price_index = PubPriceIndex.objects.create(
        **_pub_identity(external_cache_key, "U Externího pramene", 49.1962, 16.6079),
        city="Brno",
        external_id="mapy-external-sole",
        price_czk=48,
        volume_ml=500,
        observed_at=now - timedelta(days=3),
        source=PubPriceIndex.Source.EXTERNAL,
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()
    assert not PubCommunityData.objects.filter(pk=community.pk).exists()
    assert not PubContributionLog.objects.filter(pk=hours_log.pk).exists()
    assert not PubContributionLog.objects.filter(pk=beers_log.pk).exists()
    assert not PubBeerBrand.objects.filter(pk=pub_brand.pk).exists()
    assert not PubBeerProduct.objects.filter(pk=pub_product.pk).exists()
    assert not PubPriceIndex.objects.filter(pk=price_index.pk).exists()

    external_price_index.refresh_from_db()
    assert external_price_index.source == PubPriceIndex.Source.EXTERNAL
    assert external_price_index.price_czk == 48


@pytest.mark.django_db
def test_hard_delete_rebuilds_current_state_from_latest_surviving_contributor():
    deleted = Account.objects.create(device_id="final-purge-newest")
    survivor = Account.objects.create(device_id="final-purge-survivor")
    cache_key = geohash8(50.0870, 14.4208)
    now = timezone.now()

    survivor_brand = BeerBrand.objects.create(key="purge-test-starobrno", name="Starobrno")
    survivor_product = BeerProduct.objects.create(
        key="purge-test-starobrno-10",
        brand=survivor_brand,
        brand_key=survivor_brand.key,
        brand_name=survivor_brand.name,
        name="Starobrno 10°",
    )
    survivor_hours = _weekly_hours([["12:00", "22:00"]])
    survivor_beers = [_beer("Starobrno 10°", 45)]

    # Older, independent contribution history authored by the survivor.
    survivor_hours_log = PubContributionLog.objects.create(
        account=survivor,
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        kind=PubContributionLog.Kind.HOURS,
        payload=survivor_hours,
        client_id=uuid.uuid4(),
    )
    survivor_beers_log = PubContributionLog.objects.create(
        account=survivor,
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        kind=PubContributionLog.Kind.BEERS,
        payload=survivor_beers,
        client_id=uuid.uuid4(),
    )
    PubContributionLog.objects.filter(
        pk__in=[survivor_hours_log.pk, survivor_beers_log.pk]
    ).update(created_at=now - timedelta(days=30))

    # Newest contributions belong to the account being purged.
    deleted_hours = _weekly_hours([["15:00", "03:00"]])
    deleted_beers = [_beer("Únětický ležák 12°", 62)]
    deleted_brand = BeerBrand.objects.create(key="purge-test-purgovska", name="Purgovská")
    deleted_product = BeerProduct.objects.create(
        key="purge-test-purgovska-12",
        brand=deleted_brand,
        brand_key=deleted_brand.key,
        brand_name=deleted_brand.name,
        name="Purgovská 12°",
    )
    PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        kind=PubContributionLog.Kind.HOURS,
        payload=deleted_hours,
        client_id=uuid.uuid4(),
    )
    PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        kind=PubContributionLog.Kind.BEERS,
        payload=deleted_beers,
        client_id=uuid.uuid4(),
    )
    PubCommunityData.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        city="Praha",
        external_id="mapy-deleted-author",
        hours_json=deleted_hours,
        opening_hours_raw="Mo 15:00-03:00",
        beers=deleted_beers,
        historical_beers=[],
        hours_updated_at=now - timedelta(days=1),
        beers_updated_at=now - timedelta(days=1),
    )
    deleted_pub_brand = PubBeerBrand.objects.create(
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        brand=deleted_brand,
        brand_key=deleted_brand.key,
        brand_name=deleted_brand.name,
        last_price_czk=62,
        last_volume_ml=500,
        source=PubBeerBrand.Source.COMMUNITY,
        account=deleted,
    )
    deleted_pub_product = PubBeerProduct.objects.create(
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        brand=deleted_brand,
        product=deleted_product,
        brand_key=deleted_brand.key,
        brand_name=deleted_brand.name,
        product_key=deleted_product.key,
        product_name=deleted_product.name,
        last_price_czk=62,
        last_volume_ml=500,
        source=PubBeerProduct.Source.COMMUNITY,
        account=deleted,
    )
    PubPriceIndex.objects.create(
        **_pub_identity(cache_key, "U Survivorů", 50.0870, 14.4208),
        city="Praha",
        price_czk=62,
        volume_ml=500,
        observed_at=now - timedelta(days=1),
        source=PubPriceIndex.Source.COMMUNITY,
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()
    assert Account.objects.filter(pk=survivor.pk).exists()

    community = PubCommunityData.objects.get(cache_key=cache_key)
    assert community.account_id == survivor.pk
    assert community.hours_json == survivor_hours
    assert community.beers == survivor_beers

    # Identity fields the surviving logs cannot prove must not keep carrying
    # the deleted author's data through the rebuild.
    assert community.city in (None, "")
    assert community.external_id in (None, "")

    surviving_brand_keys = set(
        PubBeerBrand.objects.filter(cache_key=cache_key, active=True).values_list(
            "brand_key", flat=True
        )
    )
    assert surviving_brand_keys == {survivor_brand.key}
    assert not PubBeerBrand.objects.filter(pk=deleted_pub_brand.pk).exists()
    survivor_pub_brand = PubBeerBrand.objects.get(
        cache_key=cache_key, brand_key=survivor_brand.key
    )
    assert survivor_pub_brand.account_id == survivor.pk
    assert survivor_pub_brand.last_price_czk == 45

    surviving_product_keys = set(
        PubBeerProduct.objects.filter(cache_key=cache_key, active=True).values_list(
            "product_key", flat=True
        )
    )
    assert surviving_product_keys == {survivor_product.key}
    assert not PubBeerProduct.objects.filter(pk=deleted_pub_product.pk).exists()
    survivor_pub_product = PubBeerProduct.objects.get(
        cache_key=cache_key, product_key=survivor_product.key
    )
    assert survivor_pub_product.account_id == survivor.pk
    assert survivor_pub_product.last_price_czk == 45

    price_index = PubPriceIndex.objects.get(cache_key=cache_key)
    assert price_index.price_czk == 45


@pytest.mark.django_db
def test_hard_delete_newest_log_tiebreak_is_deterministic_by_id():
    deleted = Account.objects.create(device_id="final-purge-tie-deleted")
    hours_author = Account.objects.create(device_id="final-purge-tie-hours")
    beers_author = Account.objects.create(device_id="final-purge-tie-beers")
    cache_key = geohash8(49.2033, 16.6391)
    tied_at = timezone.now() - timedelta(days=5)

    # HOURS log is inserted first (lower id), BEERS log second (higher id);
    # both are then forced onto the exact same created_at timestamp. With the
    # timestamps tied, the later-inserted log must win — same ordering the
    # per-kind lookups already use.
    tie_hours = _weekly_hours([["16:00", "01:00"]])
    tie_beers = [_beer("Pegas Jacob", 55)]
    hours_log = PubContributionLog.objects.create(
        account=hours_author,
        **_pub_identity(cache_key, "U Dvojčat", 49.2033, 16.6391),
        kind=PubContributionLog.Kind.HOURS,
        payload=tie_hours,
        client_id=uuid.uuid4(),
    )
    beers_log = PubContributionLog.objects.create(
        account=beers_author,
        **_pub_identity(cache_key, "U Dvojčat", 49.2033, 16.6391),
        kind=PubContributionLog.Kind.BEERS,
        payload=tie_beers,
        client_id=uuid.uuid4(),
    )
    assert beers_log.id > hours_log.id
    PubContributionLog.objects.filter(
        pk__in=[hours_log.pk, beers_log.pk]
    ).update(created_at=tied_at)

    PubCommunityData.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Dvojčat", 49.2033, 16.6391),
        hours_json=_weekly_hours([["10:00", "20:00"]]),
        opening_hours_raw="Mo 10:00-20:00",
        beers=[_beer("Staropramen 10°", 40)],
        historical_beers=[],
        hours_updated_at=tied_at - timedelta(days=2),
        beers_updated_at=tied_at - timedelta(days=2),
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()

    community = PubCommunityData.objects.get(cache_key=cache_key)
    assert community.account_id == beers_author.pk
    assert community.hours_json == tie_hours
    assert community.beers == tie_beers


@pytest.mark.django_db
def test_hard_delete_keeps_survivor_drink_rows_even_without_surviving_logs():
    """A survivor's DRINK rows at the purged pub must survive the rebuild.

    Account B owns drink-derived brand/product/price rows for the pub but has
    no PubContributionLog (older provenance path). Deleting account A — whose
    only footprint here is one HOURS log — must not wipe B's rows just because
    no surviving log proves them.
    """
    deleted = Account.objects.create(device_id="final-purge-drink-deleted")
    survivor = Account.objects.create(device_id="final-purge-drink-survivor")
    cache_key = geohash8(50.0931, 14.4260)
    now = timezone.now()

    PubContributionLog.objects.create(
        account=deleted,
        **_pub_identity(cache_key, "U Přeživšího", 50.0931, 14.4260),
        kind=PubContributionLog.Kind.HOURS,
        payload=_weekly_hours([["11:00", "23:00"]]),
        client_id=uuid.uuid4(),
    )

    brand = BeerBrand.objects.create(key="purge-test-bernard", name="Bernard")
    product = BeerProduct.objects.create(
        key="purge-test-bernard-10",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Bernard 10°",
    )
    survivor_brand = PubBeerBrand.objects.create(
        **_pub_identity(cache_key, "U Přeživšího", 50.0931, 14.4260),
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        last_price_czk=48,
        last_volume_ml=500,
        source=PubBeerBrand.Source.DRINK,
        account=survivor,
    )
    survivor_product = PubBeerProduct.objects.create(
        **_pub_identity(cache_key, "U Přeživšího", 50.0931, 14.4260),
        brand=brand,
        product=product,
        brand_key=brand.key,
        brand_name=brand.name,
        product_key=product.key,
        product_name=product.name,
        last_price_czk=48,
        last_volume_ml=500,
        source=PubBeerProduct.Source.DRINK,
        account=survivor,
    )
    survivor_price = PubPriceIndex.objects.create(
        **_pub_identity(cache_key, "U Přeživšího", 50.0931, 14.4260),
        city="Praha",
        price_czk=48,
        volume_ml=500,
        observed_at=now,
        source=PubPriceIndex.Source.DRINK,
    )

    accounts.hard_delete(deleted)

    assert not Account.objects.filter(pk=deleted.pk).exists()
    # Author A's own rows are allowed to disappear.
    assert not PubContributionLog.objects.filter(account_id=deleted.pk).exists()

    # Survivor B's drink-derived rows stay owned, active, and unchanged.
    assert PubBeerBrand.objects.filter(
        pk=survivor_brand.pk,
        account_id=survivor.pk,
        active=True,
        last_price_czk=48,
    ).exists()
    assert PubBeerProduct.objects.filter(
        pk=survivor_product.pk,
        account_id=survivor.pk,
        active=True,
        last_price_czk=48,
    ).exists()
    assert PubPriceIndex.objects.filter(
        pk=survivor_price.pk,
        price_czk=48,
        source=PubPriceIndex.Source.DRINK,
    ).exists()

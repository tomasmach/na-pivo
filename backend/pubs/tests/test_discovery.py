from pubs.discovery import (
    CAMPSITE,
    PRIMARY_PUB,
    SEASONAL_STAND,
    SPORTS_VENUE,
    discovery_metadata,
)


def test_supported_secondary_categories_require_an_explicit_beer_signal():
    assert discovery_metadata(
        name="Letní stánek u vody",
        categories=["Stánky s občerstvením"],
        tags=[],
    ) == (SEASONAL_STAND, False)
    assert discovery_metadata(
        name="Letní výčep u vody",
        categories=["Stánky s občerstvením"],
        tags=[],
    ) == (SEASONAL_STAND, True)
    assert discovery_metadata(
        name="Kemp Lužnice",
        categories=["Kempy"],
        tags=["tocene-pivo"],
    ) == (CAMPSITE, True)
    assert discovery_metadata(
        name="Sportovní areál Pod Lesem",
        categories=["Sportovní areály", "Bary"],
        tags=[],
    ) == (SPORTS_VENUE, True)


def test_unrelated_categories_stay_in_the_primary_directory_bucket():
    assert discovery_metadata(
        name="U Zlatého lva",
        categories=["České restaurace"],
        tags=["tocene-pivo"],
    ) == (PRIMARY_PUB, True)

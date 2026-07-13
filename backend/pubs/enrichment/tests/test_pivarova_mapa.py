from __future__ import annotations

from unittest.mock import Mock

import pytest

from pubs.enrichment.pivarova_mapa import (
    PivarovaMapaClient,
    PivarovaMapaError,
    normalize_business,
)


def _detail(**changes):
    payload = {
        "id": "business-id",
        "slug": "u-fleka",
        "name": "U Fleka",
        "address": "Tulipánová 142, 252 43 Průhonice",
        "city": "Průhonice",
        "lat": 50.003867,
        "lng": 14.563204,
        "draftOfferType": "permanent",
        "cid": "18262486395013360148",
        "prices": [
            {
                "beer": {
                    "id": "beer-id",
                    "brand": "Velkopopovický Kozel",
                    "name": "Černý",
                    "brewery": "Plzeňský Prazdroj, a.s.",
                    "degree": "10",
                    "alcohol": 3.8,
                },
                "rawBeerName": "Kozel tmavý",
                "volumeL": 0.5,
                "priceCzk": 59.0,
                "verifiedAt": "2026-06-30T16:27:49.128803Z",
                "verificationMethod": "web_scrape",
            }
        ],
    }
    payload.update(changes)
    return payload


def test_normalize_business_preserves_provenance_and_exact_serving():
    row = normalize_business(_detail())

    assert row["source"] == "pivarova_mapa"
    assert row["source_url"] == "https://pivarovamapa.cz/podnik/u-fleka"
    assert row["name"] == "U Fleka"
    assert row["beers"] == [
        {
            "name": "Velkopopovický Kozel Černý",
            "price_czk": 59,
            "volume_ml": 500,
            "verified_at": "2026-06-30T16:27:49.128803Z",
            "verification_method": "web_scrape",
            "source_beer_id": "beer-id",
            "raw_name": "Kozel tmavý",
            "brand": "Velkopopovický Kozel",
            "brewery": "Plzeňský Prazdroj, a.s.",
            "degree": "10",
            "alcohol": 3.8,
        }
    ]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"prices": "wrong"}, "prices"),
        (
            {"prices": [{"beer": {"name": "Pivo"}, "volumeL": 0.5, "priceCzk": 0}]},
            "price",
        ),
        (
            {"prices": [{"beer": {"name": "Pivo"}, "volumeL": 0.3333, "priceCzk": 50}]},
            "volume",
        ),
    ],
)
def test_normalize_business_rejects_bad_source_data(change, message):
    with pytest.raises(PivarovaMapaError, match=message):
        normalize_business(_detail(**change))


def test_client_filters_hidden_and_duplicate_pins_then_rate_limits_details():
    session = Mock()
    pins = Mock()
    pins.raise_for_status.return_value = None
    pins.json.return_value = {
        "items": [
            {"slug": "first", "hiddenOnPublicMap": False},
            {"slug": "hidden", "hiddenOnPublicMap": True},
            {"slug": "first", "hiddenOnPublicMap": False},
            {"slug": "second", "hiddenOnPublicMap": False},
        ]
    }
    first = Mock()
    first.raise_for_status.return_value = None
    first.json.return_value = _detail(slug="first")
    second = Mock()
    second.raise_for_status.return_value = None
    second.json.return_value = _detail(slug="second")
    session.get.side_effect = [pins, first, second]
    session.headers = {}
    sleep = Mock()
    client = PivarovaMapaClient(session=session, delay_seconds=1.5, sleep=sleep)

    slugs = client.list_slugs()
    rows = list(client.export(slugs))

    assert slugs == ["first", "second"]
    assert [item.row["source_slug"] for item in rows] == ["first", "second"]
    sleep.assert_called_once_with(1.5)

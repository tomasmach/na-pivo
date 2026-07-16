from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.enrichment import GoogleAddressCandidate, geohash8
from pubs.models import UserAddedPub


def _pub(
    number: int,
    *,
    source: str = UserAddedPub.LocationSource.GOOGLE_GEOCODE,
    synced_days_ago: int = 26,
    place_id: str = "ChIJ-existing",
) -> UserAddedPub:
    return UserAddedPub.objects.create(
        client_id=f"aaaaaaaa-0000-0000-0000-{number:012d}",
        cache_key=geohash8(50.08, 14.42),
        name=f"Hospoda {number}",
        lat=50.08,
        lng=14.42,
        city="Praha",
        address="Testovací 12",
        active=True,
        location_source=source,
        google_place_id=place_id,
        location_synced_at=(
            None
            if source == UserAddedPub.LocationSource.USER_PIN
            else timezone.now() - timedelta(days=synced_days_ago)
        ),
    )


def _candidate(*, place_id: str = "ChIJ-refreshed") -> GoogleAddressCandidate:
    return GoogleAddressCandidate(
        lat=49.1951,
        lng=16.6068,
        address="Provider-owned address must not replace user data",
        city="Brno",
        result_type="establishment",
        place_id=place_id,
    )


def _mock_source(candidate: GoogleAddressCandidate) -> MagicMock:
    source = MagicMock()
    source.__enter__.return_value = source
    source.__exit__.return_value = None
    source.geocode_place_id.return_value = candidate
    source.geocode_address.return_value = candidate
    return source


@pytest.mark.django_db
def test_refreshes_only_stale_google_rows_and_prefers_place_id(settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = "test-key"
    stale = _pub(1)
    fresh = _pub(2, synced_days_ago=24)
    user_pin = _pub(
        3,
        source=UserAddedPub.LocationSource.USER_PIN,
        place_id="",
    )
    source = _mock_source(_candidate())

    with patch(
        "pubs.management.commands.refresh_google_pub_locations.GoogleGeocodingSource",
        return_value=source,
    ):
        call_command("refresh_google_pub_locations")

    stale.refresh_from_db()
    fresh.refresh_from_db()
    user_pin.refresh_from_db()
    source.geocode_place_id.assert_called_once_with("ChIJ-existing")
    source.geocode_address.assert_not_called()
    assert stale.lat == pytest.approx(49.1951)
    assert stale.lng == pytest.approx(16.6068)
    assert stale.cache_key == geohash8(49.1951, 16.6068)
    assert stale.google_place_id == "ChIJ-refreshed"
    assert stale.location_synced_at > timezone.now() - timedelta(minutes=1)
    assert stale.name == "Hospoda 1"
    assert stale.address == "Testovací 12"
    assert stale.city == "Praha"
    assert fresh.lat == 50.08
    assert user_pin.lat == 50.08
    assert user_pin.location_synced_at is None


@pytest.mark.django_db
def test_refresh_falls_back_to_address_and_respects_limit(settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = "test-key"
    oldest = _pub(1, synced_days_ago=29, place_id="")
    included = _pub(2, synced_days_ago=28, place_id="")
    excluded = _pub(3, synced_days_ago=27, place_id="")
    source = _mock_source(_candidate(place_id="ChIJ-new"))

    with patch(
        "pubs.management.commands.refresh_google_pub_locations.GoogleGeocodingSource",
        return_value=source,
    ):
        call_command("refresh_google_pub_locations", "--limit", "2")

    oldest.refresh_from_db()
    included.refresh_from_db()
    excluded.refresh_from_db()
    assert source.geocode_address.call_count == 2
    source.geocode_address.assert_called_with(address="Testovací 12", city="Praha")
    source.geocode_place_id.assert_not_called()
    assert oldest.google_place_id == "ChIJ-new"
    assert included.google_place_id == "ChIJ-new"
    assert excluded.google_place_id == ""
    assert excluded.lat == 50.08


@pytest.mark.django_db
def test_refresh_stops_gracefully_when_budget_is_exhausted(settings, capsys):
    settings.GOOGLE_MAPS_SERVER_API_KEY = "test-key"
    pub = _pub(1)
    original_synced_at = pub.location_synced_at

    with patch(
        "pubs.management.commands.refresh_google_pub_locations.reserve_external_api_request",
        return_value=False,
    ) as reserve:
        call_command("refresh_google_pub_locations")

    pub.refresh_from_db()
    reserve.assert_called_once_with(
        provider="google_maps",
        operation="billable",
        cap=settings.GOOGLE_MAPS_DAILY_CAP,
    )
    assert pub.location_synced_at == original_synced_at
    assert pub.lat == 50.08
    assert "Stopped after 0 refresh(es)" in capsys.readouterr().out

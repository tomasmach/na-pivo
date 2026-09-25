"""Exercise released-client retries through the real address resolver."""

from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.enrichment.google_geocoding import (
    GoogleAddressCandidate,
    GoogleGeocodingDailyCapExceededError,
    GoogleGeocodingUnavailableError,
)
from pubs.models import PubGeocodingMiss, UserAddedPub

GOOGLE_METHOD = "pubs.user_added_pub_geocoding.GoogleGeocodingSource.geocode_address"
CANDIDATE = GoogleAddressCandidate(
    lat=49.1951,
    lng=16.6068,
    address="Opravená 9",
    city="Brno",
    result_type="street_address",
    place_id="test-place",
)


@pytest.fixture
def client(settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = "test-key"
    client = APIClient()
    response = client.post(
        "/v1/account",
        {"device_id": "bbbbbbbb-1111-2222-3333-444444444444"},
        format="json",
    )
    assert response.status_code == 201
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['token']}")
    return client


def payload(**overrides):
    return {
        "client_id": "aaaaaaaa-1111-2222-3333-444444444444",
        "name": "Testovací hospoda",
        "lat": 50.08,
        "lng": 14.42,
        "address": "Nedohledatelná 12",
        "city": "Praha",
        **overrides,
    }


@pytest.mark.django_db
def test_repeated_legacy_post_keeps_write_retryable_without_repeating_google(client):
    with patch(GOOGLE_METHOD, return_value=None) as google:
        for _ in range(3):
            response = client.post("/v1/pubs", payload(), format="json")
            assert response.status_code == 503
            assert response.json()["code"] == "location_not_found"
        assert google.call_count == 1
    assert not UserAddedPub.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize("correction", [{"address": "Opravená 9"}, {"city": "Brno"}])
def test_corrected_address_is_looked_up_immediately_and_published_once(client, correction):
    with patch(GOOGLE_METHOD, side_effect=[None, CANDIDATE]) as google:
        assert client.post("/v1/pubs", payload(), format="json").status_code == 503
        corrected = payload(**correction)
        response = client.post("/v1/pubs", corrected, format="json")
        assert response.status_code == 201
        assert response.json()["lat"] == CANDIDATE.lat
        assert client.post("/v1/pubs", corrected, format="json").status_code == 200
        assert google.call_count == 2
    assert UserAddedPub.objects.count() == 1
    assert client.get("/v1/pubs").json()[0]["lat"] == CANDIDATE.lat


@pytest.mark.django_db
def test_expired_miss_retries_and_can_publish(client):
    with patch(GOOGLE_METHOD, side_effect=[None, CANDIDATE]) as google:
        assert client.post("/v1/pubs", payload(), format="json").status_code == 503
        miss = PubGeocodingMiss.objects.get()
        # Successful cache hits must not slide the one-hour deadline forward.
        assert client.post("/v1/pubs", payload(), format="json").status_code == 503
        assert PubGeocodingMiss.objects.get().expires_at == miss.expires_at
        assert timedelta(minutes=59) < miss.expires_at - timezone.now() <= timedelta(hours=1)
        with patch("pubs.user_added_pub_geocoding.timezone.now", return_value=miss.expires_at):
            response = client.post("/v1/pubs", payload(), format="json")
        assert response.status_code == 201
        assert google.call_count == 2
    assert UserAddedPub.objects.get().lat == CANDIDATE.lat


@pytest.mark.django_db
@pytest.mark.parametrize(
    "error",
    [GoogleGeocodingUnavailableError("timeout"), GoogleGeocodingDailyCapExceededError("cap")],
)
def test_provider_failure_does_not_cache_a_false_miss(client, error):
    with patch(GOOGLE_METHOD, side_effect=[error, CANDIDATE]) as google:
        response = client.post("/v1/pubs", payload(), format="json")
        assert response.status_code == 503
        assert response.json()["code"] == "geocoding_unavailable"
        assert not PubGeocodingMiss.objects.exists()
        assert client.post("/v1/pubs", payload(), format="json").status_code == 201
        assert google.call_count == 2


@pytest.mark.django_db
def test_miss_is_shared_across_accounts_and_ignores_name_and_device_gps(client, caplog):
    with patch(GOOGLE_METHOD, return_value=None) as google:
        assert client.post("/v1/pubs", payload(), format="json").status_code == 503
        second = APIClient()
        response = second.post(
            "/v1/account", {"device_id": "cccccccc-1111-2222-3333-444444444444"}, format="json"
        )
        second.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['token']}")
        response = second.post(
            "/v1/pubs",
            payload(name="Jiný název", lat=49.2, lng=16.6, address="  NEDOHLEDATELNÁ   12 "),
            format="json",
        )
        assert response.status_code == 503
        assert google.call_count == 1
    miss = PubGeocodingMiss.objects.get()
    assert len(miss.address_hash) == 64
    assert set(miss.__dict__) == {"_state", "address_hash", "expires_at"}
    assert "Nedohledatelná" not in caplog.text
    records = [r.observability for r in caplog.records if getattr(r, "event", "") == "pub_address_lookup"]
    assert records == [{"result": "no_match", "cached": False}, {"result": "no_match", "cached": True}]


@pytest.mark.django_db
def test_owner_edit_uses_same_miss_cache_without_changing_published_location(client):
    with patch(GOOGLE_METHOD, return_value=CANDIDATE):
        assert client.post("/v1/pubs", payload(address=CANDIDATE.address), format="json").status_code == 201
    with patch(GOOGLE_METHOD, return_value=None) as google:
        for _ in range(2):
            response = client.patch(
                f"/v1/pubs/{payload()['client_id']}",
                {"lat": 50.08, "lng": 14.42, "address": "Nedohledatelná 12", "city": "Praha"},
                format="json",
            )
            assert response.status_code == 503
        assert google.call_count == 1
    assert UserAddedPub.objects.get().lat == CANDIDATE.lat


@pytest.mark.django_db
def test_explicit_pin_bypasses_cached_miss(client):
    with patch(GOOGLE_METHOD, return_value=None) as google:
        assert client.post("/v1/pubs", payload(), format="json").status_code == 503
        response = client.post("/v1/pubs", payload(location_source="map_pin"), format="json")
        assert response.status_code == 201
        assert response.json()["lat"] == payload()["lat"]
        assert google.call_count == 1


@pytest.mark.django_db
def test_cleanup_removes_only_expired_misses_in_bounded_batches():
    now = timezone.now()
    PubGeocodingMiss.objects.bulk_create([
        PubGeocodingMiss(address_hash="a" * 64, expires_at=now - timedelta(seconds=1)),
        PubGeocodingMiss(address_hash="b" * 64, expires_at=now - timedelta(seconds=1)),
        PubGeocodingMiss(address_hash="c" * 64, expires_at=now + timedelta(hours=1)),
    ])
    call_command("prune_operational_data", batch_size=1, stdout=StringIO())
    assert PubGeocodingMiss.objects.filter(expires_at__lte=now).count() == 1
    assert PubGeocodingMiss.objects.filter(expires_at__gt=now).count() == 1

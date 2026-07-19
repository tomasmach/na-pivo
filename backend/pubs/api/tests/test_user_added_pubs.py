"""
Tests for POST /v1/pubs — community-added pubs missing from nearby search.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import GoogleGeocodingUnavailableError, geohash8
from pubs.models import Account, PubReport, UserAddedPub
from pubs.user_added_pub_geocoding import ResolvedPubLocation

_DEVICE_ID = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_CLIENT_ID = "9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d"
_NAME = "Hospoda U Komunity"
_LAT = 50.0812
_LNG = 14.4182
_KEY = geohash8(_LAT, _LNG)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _generous_throttle(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "account": "10000/min",
            "added_pubs": "10000/min",
        },
    }


def _register(client: APIClient, device_id: str = _DEVICE_ID) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(**overrides):
    data = {
        "client_id": _CLIENT_ID,
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "address": "Testovací 12",
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_add_pub_requires_account_token(client):
    resp = client.post("/v1/pubs", data=_payload(), format="json")

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
    assert UserAddedPub.objects.count() == 0


@pytest.mark.django_db
def test_add_pub_creates_live_row(client):
    token = _register(client)

    resp = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["cache_key"] == _KEY
    assert body["name"] == _NAME
    assert body["active"] is True

    pub = UserAddedPub.objects.get()
    assert pub.account == Account.objects.get(device_id=_DEVICE_ID)
    assert pub.client_id.hex == _CLIENT_ID.replace("-", "")
    assert pub.cache_key == _KEY
    assert pub.city == "Praha"
    assert pub.address == "Testovací 12"
    assert pub.location_source == UserAddedPub.LocationSource.USER_PIN
    assert pub.google_place_id == ""
    assert pub.location_synced_at is None
    assert "location_source" not in body


@pytest.mark.django_db
def test_add_pub_trusts_confirmed_client_coords_without_google(client):
    token = _register(client)

    with patch("pubs.api.views.resolve_user_added_pub_location") as resolver:
        resp = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    resolver.assert_not_called()
    pub = UserAddedPub.objects.get()
    assert pub.lat == _LAT
    assert pub.lng == _LNG
    assert pub.cache_key == _KEY
    assert pub.location_source == UserAddedPub.LocationSource.USER_PIN
    assert pub.google_place_id == ""
    assert pub.location_synced_at is None
    assert resp.json()["cache_key"] == _KEY


@pytest.mark.django_db
def test_add_pub_geocodes_only_when_coordinates_are_missing(client):
    token = _register(client)
    payload = _payload()
    payload.pop("lat")
    payload.pop("lng")
    resolved = ResolvedPubLocation(
        name=_NAME,
        lat=50.081,
        lng=14.421,
        city="Praha",
        address="Testovací 12",
        result_type="street_address",
        place_id="ChIJ-user-added-pub",
    )

    with patch(
        "pubs.api.views.resolve_user_added_pub_location",
        return_value=resolved,
    ) as resolver:
        resp = client.post("/v1/pubs", data=payload, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    resolver.assert_called_once_with(
        name=_NAME,
        address="Testovací 12",
        city="Praha",
        lat=None,
        lng=None,
    )
    pub = UserAddedPub.objects.get()
    assert pub.lat == resolved.lat
    assert pub.lng == resolved.lng
    assert pub.location_source == UserAddedPub.LocationSource.GOOGLE_GEOCODE
    assert pub.google_place_id == "ChIJ-user-added-pub"
    assert pub.location_synced_at is not None
    assert "location_source" not in resp.json()


@pytest.mark.django_db
def test_add_pub_returns_422_when_address_is_not_precise(client):
    token = _register(client)
    payload = _payload()
    payload.pop("lat")
    payload.pop("lng")

    with patch(
        "pubs.api.views.resolve_user_added_pub_location",
        return_value=None,
    ):
        resp = client.post("/v1/pubs", data=payload, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert resp.json()["code"] == "location_not_found"


@pytest.mark.django_db
def test_add_pub_returns_503_when_google_is_unavailable(client):
    token = _register(client)
    payload = _payload()
    payload.pop("lat")
    payload.pop("lng")

    with patch(
        "pubs.api.views.resolve_user_added_pub_location",
        side_effect=GoogleGeocodingUnavailableError("unavailable"),
    ):
        resp = client.post("/v1/pubs", data=payload, format="json", **_auth(token))

    assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert resp.json()["code"] == "geocoding_unavailable"


@pytest.mark.django_db
def test_add_pub_is_idempotent_on_account_client_id(client):
    token = _register(client)
    first = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED

    second = client.post(
        "/v1/pubs",
        data=_payload(name="Jiný název", city="Brno"),
        format="json",
        **_auth(token),
    )

    assert second.status_code == status.HTTP_200_OK
    assert UserAddedPub.objects.count() == 1
    assert UserAddedPub.objects.get().name == _NAME
    assert second.json()["name"] == _NAME


@pytest.mark.django_db
def test_add_pub_idempotent_retry_returns_before_paid_geocode(client):
    token = _register(client)
    first = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))
    assert first.status_code == status.HTTP_201_CREATED
    retry_payload = _payload()
    retry_payload.pop("lat")
    retry_payload.pop("lng")

    with patch("pubs.api.views.resolve_user_added_pub_location") as resolver:
        retry = client.post(
            "/v1/pubs",
            data=retry_payload,
            format="json",
            **_auth(token),
        )

    assert retry.status_code == status.HTTP_200_OK
    resolver.assert_not_called()


@pytest.mark.django_db
def test_two_different_pubs_same_cell_same_account_coexist(client):
    """Two different submissions (distinct client_id) from one account that land
    in the same geohash-8 cell must produce TWO rows — neither overwrites the
    other, even though they share a cache_key."""
    token = _register(client)

    first = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))
    second = client.post(
        "/v1/pubs",
        data=_payload(
            client_id="aaaaaaaa-0000-0000-0000-000000000099",
            name="Druhá hospoda ve stejné buňce",
        ),
        format="json",
        **_auth(token),
    )

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_201_CREATED
    assert UserAddedPub.objects.count() == 2
    assert UserAddedPub.objects.filter(active=True).count() == 2
    keys = {p.cache_key for p in UserAddedPub.objects.all()}
    assert keys == {_KEY}  # both in the same cell
    names = set(UserAddedPub.objects.values_list("name", flat=True))
    assert names == {_NAME, "Druhá hospoda ve stejné buňce"}


@pytest.mark.django_db
def test_cross_account_same_cell_does_not_overwrite(client):
    """Account B adding a pub in the same cell as account A must NOT overwrite
    A's row — a new row is created for B and A's row is untouched."""
    first_token = _register(client)
    second_token = _register(client, "11111111-2222-3333-4444-555555555555")
    account_a = Account.objects.get(device_id=_DEVICE_ID)

    client.post("/v1/pubs", data=_payload(), format="json", **_auth(first_token))
    row_a_before = UserAddedPub.objects.get()

    resp = client.post(
        "/v1/pubs",
        data=_payload(
            client_id="aaaaaaaa-0000-0000-0000-000000000001",
            name="Hospoda účtu B",
            address="Nová 1",
        ),
        format="json",
        **_auth(second_token),
    )

    assert resp.status_code == status.HTTP_201_CREATED
    assert UserAddedPub.objects.count() == 2

    # Account A's row is completely untouched.
    row_a_after = UserAddedPub.objects.get(pk=row_a_before.pk)
    assert row_a_after.account == account_a
    assert row_a_after.name == _NAME
    assert row_a_after.client_id == row_a_before.client_id
    assert row_a_after.address == "Testovací 12"

    # Account B's row is the new one.
    row_b = UserAddedPub.objects.exclude(pk=row_a_before.pk).get()
    assert row_b.name == "Hospoda účtu B"
    assert row_b.address == "Nová 1"


@pytest.mark.django_db
def test_add_pub_preserves_existing_reports_for_same_cell(client):
    token = _register(client)
    PubReport.objects.create(
        account=Account.objects.get(device_id=_DEVICE_ID),
        cache_key=_KEY,
        external_id="mapy:old",
        name="Starý report",
        lat=_LAT,
        lng=_LNG,
        reason=PubReport.Reason.NOT_PUB,
        active=True,
    )

    resp = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))

    assert resp.status_code == status.HTTP_201_CREATED
    assert PubReport.objects.get().active is True


@pytest.mark.django_db
def test_rename_user_added_pub_updates_own_pub_without_geocoding(client):
    token = _register(client)
    create = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))
    assert create.status_code == status.HTTP_201_CREATED

    resp = client.patch(
        f"/v1/pubs/{_CLIENT_ID}",
        data={"name": "Nový název hospody"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["client_id"] == _CLIENT_ID
    assert body["name"] == "Nový název hospody"
    assert body["lat"] == _LAT
    assert body["lng"] == _LNG
    pub = UserAddedPub.objects.get()
    assert pub.name == "Nový název hospody"
    assert pub.cache_key == _KEY


@pytest.mark.django_db
def test_rename_user_added_pub_returns_404_for_missing_or_foreign_pub(client):
    first_token = _register(client)
    second_token = _register(client, "11111111-2222-3333-4444-555555555555")
    create = client.post("/v1/pubs", data=_payload(), format="json", **_auth(first_token))
    assert create.status_code == status.HTTP_201_CREATED

    missing = client.patch(
        "/v1/pubs/aaaaaaaa-0000-0000-0000-000000000001",
        data={"name": "Neexistující hospoda"},
        format="json",
        **_auth(first_token),
    )
    foreign = client.patch(
        f"/v1/pubs/{_CLIENT_ID}",
        data={"name": "Cizí hospoda"},
        format="json",
        **_auth(second_token),
    )

    assert missing.status_code == status.HTTP_404_NOT_FOUND
    assert foreign.status_code == status.HTTP_404_NOT_FOUND
    assert UserAddedPub.objects.get().name == _NAME


@pytest.mark.django_db
def test_rename_user_added_pub_requires_account_token(client):
    resp = client.patch(
        f"/v1/pubs/{_CLIENT_ID}",
        data={"name": "Nový název hospody"},
        format="json",
    )

    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_list_user_added_pubs_only_returns_own_rows(client):
    first_token = _register(client)
    second_token = _register(client, "11111111-2222-3333-4444-555555555555")
    client.post("/v1/pubs", data=_payload(), format="json", **_auth(first_token))
    client.post(
        "/v1/pubs",
        data=_payload(
            client_id="aaaaaaaa-0000-0000-0000-000000000001",
            name="Cizí hospoda",
        ),
        format="json",
        **_auth(second_token),
    )

    resp = client.get("/v1/pubs", **_auth(first_token))

    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.json()) == 1
    assert resp.json()[0]["client_id"] == _CLIENT_ID


@pytest.mark.django_db
def test_owner_can_correct_verified_address_and_exact_pin(client, settings):
    settings.USER_ADDED_PUB_LOCATION_VERIFY_MAX_METERS = 500
    token = _register(client)
    create = client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))
    assert create.status_code == status.HTTP_201_CREATED
    exact_lat = 50.0820
    exact_lng = 14.4190
    resolved = ResolvedPubLocation(
        name=_NAME,
        lat=50.0821,
        lng=14.4191,
        city="Praha 1",
        address="Opravená 9",
        result_type="street_address",
        place_id="ChIJ-corrected-pub",
    )

    with patch(
        "pubs.api.views.resolve_user_added_pub_location",
        return_value=resolved,
    ) as resolver:
        resp = client.patch(
            f"/v1/pubs/{_CLIENT_ID}",
            data={
                "address": "Opravená 9",
                "city": "Praha",
                "lat": exact_lat,
                "lng": exact_lng,
            },
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_200_OK
    resolver.assert_called_once_with(
        name=_NAME,
        address="Opravená 9",
        city="Praha",
        lat=exact_lat,
        lng=exact_lng,
    )
    pub = UserAddedPub.objects.get()
    assert pub.lat == exact_lat
    assert pub.lng == exact_lng
    assert pub.cache_key == geohash8(exact_lat, exact_lng)
    assert pub.address == "Opravená 9"
    assert pub.city == "Praha 1"
    assert pub.google_place_id == "ChIJ-corrected-pub"
    assert pub.location_synced_at is not None


@pytest.mark.django_db
def test_location_correction_rejects_pin_far_from_verified_address(client, settings):
    settings.USER_ADDED_PUB_LOCATION_VERIFY_MAX_METERS = 500
    token = _register(client)
    client.post("/v1/pubs", data=_payload(), format="json", **_auth(token))
    resolved = ResolvedPubLocation(
        name=_NAME,
        lat=49.1951,
        lng=16.6068,
        city="Brno",
        address="Opravená 9",
        result_type="street_address",
    )

    with patch("pubs.api.views.resolve_user_added_pub_location", return_value=resolved):
        resp = client.patch(
            f"/v1/pubs/{_CLIENT_ID}",
            data={"address": "Opravená 9", "city": "Brno", "lat": _LAT, "lng": _LNG},
            format="json",
            **_auth(token),
        )

    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert resp.json()["code"] == "location_mismatch"
    pub = UserAddedPub.objects.get()
    assert pub.lat == _LAT
    assert pub.lng == _LNG
    assert pub.address == "Testovací 12"


@pytest.mark.django_db
def test_foreign_location_correction_is_hidden_and_does_not_geocode(client):
    owner_token = _register(client)
    foreign_token = _register(client, "11111111-2222-3333-4444-555555555555")
    client.post("/v1/pubs", data=_payload(), format="json", **_auth(owner_token))

    with patch("pubs.api.views.resolve_user_added_pub_location") as resolver:
        resp = client.patch(
            f"/v1/pubs/{_CLIENT_ID}",
            data={"address": "Cizí 1", "city": "Brno", "lat": 49.2, "lng": 16.6},
            format="json",
            **_auth(foreign_token),
        )

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    resolver.assert_not_called()
    assert UserAddedPub.objects.get().address == "Testovací 12"


@pytest.mark.django_db
def test_add_pub_validation(client):
    token = _register(client)

    bad_name = client.post("/v1/pubs", data=_payload(name="   "), format="json", **_auth(token))
    bad_lat = client.post("/v1/pubs", data=_payload(lat=999), format="json", **_auth(token))
    incomplete_location = _payload()
    incomplete_location.pop("lat")
    incomplete_location.pop("lng")
    incomplete_location.pop("city")
    missing_location = client.post(
        "/v1/pubs",
        data=incomplete_location,
        format="json",
        **_auth(token),
    )

    assert bad_name.status_code == status.HTTP_400_BAD_REQUEST
    assert bad_lat.status_code == status.HTTP_400_BAD_REQUEST
    assert missing_location.status_code == status.HTTP_400_BAD_REQUEST
    assert UserAddedPub.objects.count() == 0

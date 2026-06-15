"""
Tests for POST /v1/pubs — community-added pubs missing from nearby search.
"""

from __future__ import annotations

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import geohash8
from pubs.models import Account, PubReport, UserAddedPub

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
def test_add_pub_validation(client):
    token = _register(client)

    bad_name = client.post(
        "/v1/pubs", data=_payload(name="   "), format="json", **_auth(token)
    )
    bad_lat = client.post(
        "/v1/pubs", data=_payload(lat=999), format="json", **_auth(token)
    )

    assert bad_name.status_code == status.HTTP_400_BAD_REQUEST
    assert bad_lat.status_code == status.HTTP_400_BAD_REQUEST
    assert UserAddedPub.objects.count() == 0

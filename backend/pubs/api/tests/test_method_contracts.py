import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("patch", "/v1/drinks"),
        ("get", f"/v1/drinks/{uuid.uuid4()}"),
        ("delete", "/v1/beer-checkins"),
        ("get", f"/v1/beer-checkins/{uuid.uuid4()}"),
        ("delete", "/v1/nights"),
        ("post", f"/v1/nights/{uuid.uuid4()}"),
        ("delete", "/v1/pub-ratings"),
        ("get", "/v1/pub-ratings/u2fkbn1z"),
        ("delete", "/v1/pub-visits"),
        ("get", f"/v1/pub-visits/{uuid.uuid4()}"),
        ("patch", "/v1/pubs"),
        ("get", f"/v1/pubs/{uuid.uuid4()}"),
        ("delete", "/v1/pub-amenities/votes"),
        ("get", "/v1/pub-amenities/votes/u2fkbn1z/wifi"),
        ("delete", "/v1/friends/blocks"),
        ("get", f"/v1/friends/blocks/{uuid.uuid4()}"),
        ("delete", "/v1/beer-photos"),
        ("get", f"/v1/beer-photos/{uuid.uuid4()}"),
        ("delete", "/v1/friends/pub-activity"),
        ("post", f"/v1/friends/pub-activity/{uuid.uuid4()}"),
    ],
)
def test_collection_and_detail_routes_reject_wrong_methods_with_405(method, path):
    client = APIClient()
    account = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    ).json()

    response = client.generic(
        method,
        path,
        data={},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {account['token']}",
    )

    assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

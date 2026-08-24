import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.tests.test_community_events import _account, _auth, _create
from pubs.community_events import (
    CommunityEvent,
    CommunityEventMembership,
)


@pytest.mark.django_db
def test_active_hostless_event_is_not_visible_or_joinable():
    client = APIClient()

    host, host_token = _account("temporary-host")
    outsider, outsider_token = _account("outsider-active-hostless")

    response = _create(client, host_token, capacity=10)
    assert response.status_code == status.HTTP_201_CREATED
    event = CommunityEvent.objects.get(id=uuid.UUID(response.data["id"]))
    assert event.status == CommunityEvent.Status.ACTIVE

    event.host = None
    event.save(update_fields=["host", "updated_at"])
    event.refresh_from_db()
    assert event.host is None
    assert event.status == CommunityEvent.Status.ACTIVE

    detail_response = client.get(
        f"/v1/community-events/{event.id}", **_auth(outsider_token)
    )
    assert detail_response.status_code == status.HTTP_404_NOT_FOUND

    join_response = client.post(
        f"/v1/community-events/{event.id}/join",
        {"adults_confirmed": True},
        format="json",
        **_auth(outsider_token),
    )
    assert join_response.status_code == status.HTTP_404_NOT_FOUND
    assert join_response.data["code"] == "event_unavailable"

    assert not CommunityEventMembership.objects.filter(
        event=event, account=outsider
    ).exists()

import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs import accounts
from pubs.api.tests.test_community_events import _account, _auth, _create
from pubs.community_events import (
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
)
from pubs.models import ContentReport


@pytest.mark.django_db
def test_host_account_deletion_leaves_event_and_teams_usable():
    client = APIClient()

    host, host_token = _account("host")
    member, member_token = _account("member")
    outsider, outsider_token = _account("outsider")

    response = _create(client, host_token, capacity=10)
    assert response.status_code == status.HTTP_201_CREATED
    event = CommunityEvent.objects.get(id=uuid.UUID(response.data["id"]))

    membership = CommunityEventMembership.objects.create(
        event=event,
        account=member,
        status=CommunityEventMembership.Status.APPROVED,
    )

    team = CommunityEventTeam.objects.create(
        event=event,
        created_by=host,
        name="Host team",
        client_id=uuid.uuid4(),
    )
    team_membership = CommunityEventTeamMembership.objects.create(
        event=event,
        team=team,
        account=member,
        slot=1,
    )

    event_id = str(event.id)
    team_id = str(team.id)
    membership_id = membership.id
    team_membership_id = team_membership.id

    accounts.hard_delete(host)

    event.refresh_from_db()
    team.refresh_from_db()

    assert event.host is None
    assert event.status == CommunityEvent.Status.CANCELLED
    assert event.cancelled_at is not None
    assert team.created_by is None

    assert CommunityEvent.objects.filter(id=event_id).exists()
    assert CommunityEventTeam.objects.filter(id=team_id).exists()
    assert CommunityEventMembership.objects.filter(id=membership_id).exists()
    assert CommunityEventTeamMembership.objects.filter(id=team_membership_id).exists()

    list_response = client.get("/v1/community-events", **_auth(member_token))
    assert list_response.status_code == status.HTTP_200_OK
    joined_ids = [str(item["id"]) for item in list_response.data["joined"]]
    assert event_id in joined_ids

    detail_response = client.get(
        f"/v1/community-events/{event_id}", **_auth(member_token)
    )
    assert detail_response.status_code == status.HTTP_200_OK
    assert detail_response.data["host"] == {
        "id": "deleted",
        "nickname": None,
        "display_name": "Smazaný účet",
        "avatar_url": None,
    }
    assert detail_response.data["exact_address"] is None
    assert detail_response.data["status"] == "cancelled"

    teams_response = client.get(f"/v1/community-events/{event_id}/teams", **_auth(member_token))
    assert teams_response.status_code == status.HTTP_200_OK
    assert set(teams_response.json().keys()) >= {
        "max_team_size",
        "participant_count",
        "teams",
    }

    assert (
        client.get(f"/v1/community-events/{event_id}", **_auth(outsider_token)).status_code
        == status.HTTP_404_NOT_FOUND
    )

    join_response = client.post(
        f"/v1/community-events/{event_id}/join",
        {"adults_confirmed": True},
        format="json",
        **_auth(outsider_token),
    )
    assert join_response.status_code == status.HTTP_409_CONFLICT
    assert join_response.data["code"] == "event_not_open"

    create_team_response = client.post(
        f"/v1/community-events/{event_id}/teams",
        {
            "client_id": str(uuid.uuid4()),
            "name": "New team",
        },
        format="json",
        **_auth(member_token),
    )
    assert create_team_response.status_code == status.HTTP_409_CONFLICT
    assert create_team_response.data["code"] == "event_not_open"

    join_team_response = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        format="json",
        **_auth(member_token),
    )
    assert join_team_response.status_code == status.HTTP_409_CONFLICT
    assert join_team_response.data["code"] == "event_not_open"

    report_response = client.post(
        f"/v1/community-events/{event_id}/report",
        {"reason": "other", "comment": "test"},
        format="json",
        **_auth(member_token),
    )
    assert report_response.status_code == status.HTTP_404_NOT_FOUND
    assert ContentReport.objects.count() == 0


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

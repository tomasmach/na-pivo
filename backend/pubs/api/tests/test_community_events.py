from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import issue_token
from pubs.community_events import CommunityEvent, CommunityEventMembership
from pubs.models import Account, ContentReport, EmailCredential, FriendBlock


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _generous_throttle(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "community": "10000/min",
            "feedback": "10000/min",
        },
    }


def _account(nickname: str) -> tuple[Account, str]:
    account = Account.objects.create(
        device_id=f"community-event-{uuid.uuid4()}",
        nickname=nickname,
        is_public=True,
    )
    EmailCredential.objects.create(
        account=account,
        email=f"{uuid.uuid4()}@example.test",
        password=make_password("test-password"),
        email_verified=True,
    )
    return account, issue_token(account)


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(**overrides):
    start = timezone.now() + timedelta(hours=2)
    data = {
        "client_id": str(uuid.uuid4()),
        "title": "Pivo a deskovky",
        "description": "Komorní večer pro šest lidí.",
        "city": "Praha",
        "area_label": "Vinohrady",
        "exact_address": "Testovací 12, zvonek Novák",
        "lat": 50.0755,
        "lng": 14.4378,
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=4)).isoformat(),
        "capacity": 3,
        "adults_confirmed": True,
    }
    data.update(overrides)
    return data


def _create(client: APIClient, token: str, **overrides):
    return client.post(
        "/v1/community-events",
        data=_payload(**overrides),
        format="json",
        **_auth(token),
    )


@pytest.mark.django_db
def test_discovery_is_coarse_and_never_exposes_exact_location(client):
    _host, host_token = _account("host")
    _viewer, viewer_token = _account("viewer")
    created = _create(client, host_token)
    assert created.status_code == status.HTTP_201_CREATED
    assert created.json()["exact_address"] == "Testovací 12, zvonek Novák"

    response = client.post(
        "/v1/community-events/discover",
        data={"lat": 50.0750, "lng": 14.4380},
        format="json",
        **_auth(viewer_token),
    )
    assert response.status_code == status.HTTP_200_OK
    event = response.json()["nearby"][0]
    assert event["city"] == "Praha"
    assert event["area_label"] == "Vinohrady"
    assert event["distance_band"] == "under_1_km"
    assert event["exact_address"] is None
    assert "lat" not in event
    assert "lng" not in event
    assert "exact_address" not in event["host"]


@pytest.mark.django_db
def test_exact_address_unlocks_only_after_host_approval(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]

    joined = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"message": "Přinesu karty.", "adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )
    assert joined.status_code == status.HTTP_202_ACCEPTED
    request_id = joined.json()["request_id"]
    pending = client.get("/v1/community-events", **_auth(guest_token)).json()["joined"][0]
    assert pending["membership_status"] == "pending"
    assert pending["exact_address"] is None

    approved = client.post(
        f"/v1/community-events/{event_id}/requests/{request_id}/approve",
        **_auth(host_token),
    )
    assert approved.status_code == status.HTTP_200_OK
    visible = client.get("/v1/community-events", **_auth(guest_token)).json()["joined"][0]
    assert visible["membership_status"] == "approved"
    assert visible["exact_address"] == "Testovací 12, zvonek Novák"

    guest.ghost_mode = True
    guest.save(update_fields=["ghost_mode"])
    hidden_again = client.get("/v1/community-events", **_auth(guest_token)).json()["joined"][0]
    assert hidden_again["exact_address"] is None
    guest.ghost_mode = False
    guest.save(update_fields=["ghost_mode"])

    left = client.delete(f"/v1/community-events/{event_id}/join", **_auth(guest_token))
    assert left.json()["status"] == "left"
    assert client.get("/v1/community-events", **_auth(guest_token)).json()["joined"] == []


@pytest.mark.django_db
def test_capacity_is_locked_when_host_approves_requests(client):
    _host, host_token = _account("host")
    _one, one_token = _account("one")
    _two, two_token = _account("two")
    event_id = _create(client, host_token, capacity=2).json()["id"]
    first = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(one_token),
    ).json()["request_id"]
    second = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(two_token),
    ).json()["request_id"]
    assert (
        client.post(
            f"/v1/community-events/{event_id}/requests/{first}/approve",
            **_auth(host_token),
        ).status_code
        == 200
    )
    full = client.post(
        f"/v1/community-events/{event_id}/requests/{second}/approve",
        **_auth(host_token),
    )
    assert full.status_code == status.HTTP_409_CONFLICT
    assert full.json()["code"] == "capacity_full"


@pytest.mark.django_db
def test_host_rejects_and_cancels_event(client):
    _host, host_token = _account("host")
    _guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    request_id = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    ).json()["request_id"]
    rejected = client.post(
        f"/v1/community-events/{event_id}/requests/{request_id}/reject",
        **_auth(host_token),
    )
    assert rejected.json()["status"] == "rejected"
    cancelled = client.post(f"/v1/community-events/{event_id}/cancel", **_auth(host_token))
    assert cancelled.json()["status"] == "cancelled"
    assert CommunityEvent.objects.get().status == CommunityEvent.Status.CANCELLED


@pytest.mark.django_db
def test_block_and_ghost_mode_remove_event_from_discovery_and_join(client):
    host, host_token = _account("host")
    viewer, viewer_token = _account("viewer")
    event_id = _create(client, host_token).json()["id"]
    FriendBlock.objects.create(blocker=host, blocked=viewer)
    nearby = client.post(
        "/v1/community-events/discover",
        data={"lat": 50.0750, "lng": 14.4380},
        format="json",
        **_auth(viewer_token),
    ).json()["nearby"]
    assert nearby == []
    denied = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(viewer_token),
    )
    assert denied.status_code == status.HTTP_404_NOT_FOUND

    FriendBlock.objects.all().delete()
    host.ghost_mode = True
    host.save(update_fields=["ghost_mode"])
    nearby = client.post(
        "/v1/community-events/discover",
        data={"lat": 50.0750, "lng": 14.4380},
        format="json",
        **_auth(viewer_token),
    ).json()["nearby"]
    assert nearby == []


@pytest.mark.django_db
def test_report_uses_content_report_without_snapshotting_private_location(client):
    host, host_token = _account("host")
    _viewer, viewer_token = _account("viewer")
    event_id = _create(client, host_token).json()["id"]
    response = client.post(
        f"/v1/community-events/{event_id}/report",
        data={"reason": "other", "comment": "Podezřelý popis."},
        format="json",
        **_auth(viewer_token),
    )
    assert response.status_code == status.HTTP_201_CREATED
    report = ContentReport.objects.get()
    assert report.target_account == host
    assert report.target_snapshot["community_event_id"] == event_id
    assert "exact_address" not in report.target_snapshot
    assert "lat" not in report.target_snapshot
    assert "lng" not in report.target_snapshot


@pytest.mark.django_db
def test_create_requires_adult_confirmation_and_is_idempotent(client):
    _host, token = _account("host")
    client_id = str(uuid.uuid4())
    denied = _create(client, token, client_id=client_id, adults_confirmed=False)
    assert denied.status_code == status.HTTP_400_BAD_REQUEST
    first = _create(client, token, client_id=client_id)
    second = _create(client, token, client_id=client_id)
    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_200_OK
    assert CommunityEvent.objects.count() == 1
    assert CommunityEventMembership.objects.count() == 0

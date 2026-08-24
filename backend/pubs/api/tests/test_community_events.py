from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.db.models import QuerySet
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import issue_token
from pubs.api.community_event_views import _dashboard_payload
from pubs.api.ugc_consent import UGC_POLICY_HEADER
from pubs.community_events import (
    CommunityEvent,
    CommunityEventMembership,
    CommunityEventTeam,
    CommunityEventTeamMembership,
)
from pubs.models import Account, ContentReport, EmailCredential, FriendBlock


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _generous_throttle(settings):
    cache.clear()
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "community": "10000/min",
            "feedback": "10000/min",
        },
    }
    yield
    cache.clear()


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


def _create(client: APIClient, token: str, *, headers: dict | None = None, **overrides):
    return client.post(
        "/v1/community-events",
        data=_payload(**overrides),
        format="json",
        **_auth(token),
        **(headers or {}),
    )


def _join_and_approve(
    client: APIClient,
    event_id: str,
    host_token: str,
    guest_token: str,
) -> str:
    joined = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )
    assert joined.status_code == status.HTTP_202_ACCEPTED
    request_id = joined.json()["request_id"]
    approved = client.post(
        f"/v1/community-events/{event_id}/requests/{request_id}/approve",
        **_auth(host_token),
    )
    assert approved.status_code == status.HTTP_200_OK
    return request_id


def _create_team(
    client: APIClient,
    event_id: str,
    token: str,
    *,
    client_id: str | None = None,
    name: str = "Výčepní esa",
    headers: dict | None = None,
):
    return client.post(
        f"/v1/community-events/{event_id}/teams",
        data={"client_id": client_id or str(uuid.uuid4()), "name": name},
        format="json",
        **_auth(token),
        **(headers or {}),
    )


def _policy_header() -> dict[str, str]:
    return {
        "HTTP_" + UGC_POLICY_HEADER.replace("-", "_").upper(): settings.UGC_POLICY_VERSION
    }


def _accept_ugc(client: APIClient, token: str) -> None:
    accepted = client.put(
        "/v1/account/me/ugc-consent",
        data={"version": settings.UGC_POLICY_VERSION},
        format="json",
        **_auth(token),
    )
    assert accepted.status_code == status.HTTP_200_OK, accepted.content


def _record_write_locks(monkeypatch):
    lock_order: list[str] = []
    account_batches: list[list[int]] = []
    account_ordering: list[tuple[str, ...]] = []
    real_select_for_update = QuerySet.select_for_update
    real_order_by = QuerySet.order_by
    real_iter = QuerySet.__iter__

    def track_lock(queryset, *args, **kwargs):
        labels = {
            Account: "account",
            CommunityEvent: "event",
            CommunityEventTeam: "team",
            CommunityEventMembership: "event_membership",
            CommunityEventTeamMembership: "team_membership",
        }
        label = labels.get(queryset.model)
        if label is not None:
            lock_order.append(label)
        return real_select_for_update(queryset, *args, **kwargs)

    def track_ordering(queryset, *fields):
        if queryset.model is Account and queryset.query.select_for_update:
            account_ordering.append(fields)
        return real_order_by(queryset, *fields)

    def track_iter(queryset):
        if queryset.model is Account and queryset.query.select_for_update:
            rows = list(real_iter(queryset))
            account_batches.append([row.pk for row in rows])
            return iter(rows)
        return real_iter(queryset)

    monkeypatch.setattr(QuerySet, "select_for_update", track_lock)
    monkeypatch.setattr(QuerySet, "order_by", track_ordering)
    monkeypatch.setattr(QuerySet, "__iter__", track_iter)
    return lock_order, account_batches, account_ordering


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
def test_join_retry_preserves_approved_membership(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    joined = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"message": "Přinesu karty.", "adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )
    request_id = joined.json()["request_id"]
    approved = client.post(
        f"/v1/community-events/{event_id}/requests/{request_id}/approve",
        **_auth(host_token),
    )
    assert approved.status_code == status.HTTP_200_OK
    membership = CommunityEventMembership.objects.get(event_id=event_id, account=guest)
    decided_at = membership.decided_at

    retried = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"message": "Retry nesmí změnit žádost.", "adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )

    assert retried.status_code == status.HTTP_202_ACCEPTED
    assert retried.json() == {"request_id": request_id, "status": "approved"}
    membership.refresh_from_db()
    assert membership.status == CommunityEventMembership.Status.APPROVED
    assert membership.message == "Přinesu karty."
    assert membership.decided_at == decided_at


@pytest.mark.django_db
def test_join_retry_keeps_approved_team_member_consistent(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    request_id = _join_and_approve(client, event_id, host_token, guest_token)
    team_id = _create_team(client, event_id, host_token).json()["team"]["id"]
    joined_team = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    assert joined_team.status_code == status.HTTP_201_CREATED
    team_membership = CommunityEventTeamMembership.objects.get(
        event_id=event_id,
        account=guest,
    )

    retried = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )

    assert retried.status_code == status.HTTP_202_ACCEPTED
    assert retried.json() == {"request_id": request_id, "status": "approved"}
    assert CommunityEventMembership.objects.get(
        event_id=event_id,
        account=guest,
    ).status == CommunityEventMembership.Status.APPROVED
    team_membership.refresh_from_db()
    assert str(team_membership.team_id) == team_id
    roster = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(guest_token),
    ).json()
    assert roster["participant_count"] == 2
    assert roster["assigned_count"] == 2


@pytest.mark.django_db
def test_event_join_locks_accounts_before_event_and_membership(client, monkeypatch):
    _host, host_token = _account("host-lock-order")
    _guest, guest_token = _account("guest-lock-order")
    event_id = _create(client, host_token).json()["id"]
    lock_order: list[str] = []
    real_select_for_update = QuerySet.select_for_update

    def track_lock(queryset, *args, **kwargs):
        if queryset.model is Account:
            lock_order.append("account")
        elif queryset.model is CommunityEvent:
            lock_order.append("event")
        elif queryset.model is CommunityEventMembership:
            lock_order.append("membership")
        return real_select_for_update(queryset, *args, **kwargs)

    monkeypatch.setattr(QuerySet, "select_for_update", track_lock)

    response = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )

    assert response.status_code == status.HTTP_202_ACCEPTED
    assert lock_order == ["account", "event", "membership"]


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
def test_cancelled_event_hides_address_and_rejects_pending_approval(client):
    _host, host_token = _account("host")
    _approved_guest, approved_token = _account("approved")
    _pending_guest, pending_token = _account("pending")
    event_id = _create(client, host_token).json()["id"]
    approved_request_id = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(approved_token),
    ).json()["request_id"]
    pending_request_id = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(pending_token),
    ).json()["request_id"]
    assert (
        client.post(
            f"/v1/community-events/{event_id}/requests/{approved_request_id}/approve",
            **_auth(host_token),
        ).status_code
        == status.HTTP_200_OK
    )

    client.post(f"/v1/community-events/{event_id}/cancel", **_auth(host_token))

    denied = client.post(
        f"/v1/community-events/{event_id}/requests/{pending_request_id}/approve",
        **_auth(host_token),
    )
    assert denied.status_code == status.HTTP_409_CONFLICT
    assert denied.json()["code"] == "event_not_open"
    joined = client.get("/v1/community-events", **_auth(approved_token)).json()["joined"]
    assert joined[0]["status"] == "cancelled"
    assert joined[0]["exact_address"] is None


@pytest.mark.django_db
def test_ended_event_hides_address_and_rejects_pending_approval(client):
    _host, host_token = _account("host")
    _guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    request_id = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    ).json()["request_id"]
    CommunityEvent.objects.filter(pk=event_id).update(
        starts_at=timezone.now() - timedelta(hours=2),
        ends_at=timezone.now() - timedelta(hours=1),
    )

    denied = client.post(
        f"/v1/community-events/{event_id}/requests/{request_id}/approve",
        **_auth(host_token),
    )
    assert denied.status_code == status.HTTP_409_CONFLICT
    assert denied.json()["code"] == "event_not_open"
    joined = client.get("/v1/community-events", **_auth(guest_token)).json()["joined"]
    assert joined[0]["status"] == "ended"
    assert joined[0]["exact_address"] is None


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
def test_joined_events_and_host_requests_follow_account_privacy(client):
    host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
    )

    guest.ghost_mode = True
    guest.save(update_fields=["ghost_mode"])
    hosted = client.get("/v1/community-events", **_auth(host_token)).json()["hosted"]
    assert hosted[0]["join_requests"] == []
    guest.ghost_mode = False
    guest.save(update_fields=["ghost_mode"])

    FriendBlock.objects.create(blocker=guest, blocked=host)
    assert client.get("/v1/community-events", **_auth(guest_token)).json()["joined"] == []
    FriendBlock.objects.all().delete()

    host.ghost_mode = True
    host.save(update_fields=["ghost_mode"])
    assert client.get("/v1/community-events", **_auth(guest_token)).json()["joined"] == []
    host.ghost_mode = False
    host.status = Account.Status.PENDING_DELETION
    host.save(update_fields=["ghost_mode", "status"])
    assert client.get("/v1/community-events", **_auth(guest_token)).json()["joined"] == []


@pytest.mark.django_db
def test_dashboard_query_count_does_not_scale_with_events_or_members():
    viewer, _token = _account("viewer")
    for index in range(5):
        host, _host_token = _account(f"host-{index}")
        event = CommunityEvent.objects.create(
            host=host,
            client_id=uuid.uuid4(),
            title=f"Setkání {index}",
            city="Praha",
            area_label="Vinohrady",
            exact_address=f"Testovací {index}",
            lat=50.0755,
            lng=14.4378,
            starts_at=timezone.now() + timedelta(hours=2),
            ends_at=timezone.now() + timedelta(hours=6),
            capacity=10,
        )
        CommunityEventMembership.objects.create(
            event=event,
            account=viewer,
            status=CommunityEventMembership.Status.PENDING,
        )

    with CaptureQueriesContext(connection) as queries:
        payload = _dashboard_payload(viewer, 50.0750, 14.4380)

    assert len(payload["nearby"]) == 5
    assert len(payload["joined"]) == 5
    assert len(queries) <= 8


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
def test_report_locks_reporter_and_host_before_event(client, monkeypatch):
    host, host_token = _account("report-lock-host")
    reporter, reporter_token = _account("report-lock-reporter")
    event_id = _create(client, host_token).json()["id"]
    lock_order, account_batches, account_ordering = _record_write_locks(monkeypatch)

    response = client.post(
        f"/v1/community-events/{event_id}/report",
        data={"reason": "other"},
        format="json",
        **_auth(reporter_token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert lock_order[:2] == ["account", "event"]
    assert account_batches == [[host.pk, reporter.pk]]
    assert account_ordering == [("pk",)]


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


@pytest.mark.django_db
def test_event_create_rechecks_locked_account_after_soft_delete_race(
    client,
    monkeypatch,
):
    host, host_token = _account("create-delete-race")
    real_select_for_update = QuerySet.select_for_update
    state = {"injected": False}

    def delete_before_account_lock(queryset, *args, **kwargs):
        if queryset.model is Account and not state["injected"]:
            state["injected"] = True
            Account.objects.filter(pk=host.pk).update(
                status=Account.Status.PENDING_DELETION,
                deleted_at=timezone.now(),
            )
        return real_select_for_update(queryset, *args, **kwargs)

    monkeypatch.setattr(QuerySet, "select_for_update", delete_before_account_lock)

    response = _create(client, host_token)

    assert state["injected"] is True
    assert response.status_code == status.HTTP_409_CONFLICT
    assert response.json()["code"] == "account_inactive"
    assert not CommunityEvent.objects.exists()


@pytest.mark.django_db
def test_team_create_locks_request_and_host_before_event_team_and_seat(
    client,
    monkeypatch,
):
    host, host_token = _account("team-lock-host")
    creator, creator_token = _account("team-lock-creator")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    lock_order, account_batches, account_ordering = _record_write_locks(monkeypatch)

    response = _create_team(client, event_id, creator_token)

    assert response.status_code == status.HTTP_201_CREATED
    assert lock_order[:3] == ["account", "event", "team"]
    assert account_batches == [[host.pk, creator.pk]]
    assert account_ordering == [("pk",)]


@pytest.mark.django_db
def test_team_create_rechecks_host_after_soft_delete_race(client, monkeypatch):
    host, host_token = _account("team-delete-host")
    _creator, creator_token = _account("team-delete-maker")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    real_select_for_update = QuerySet.select_for_update
    state = {"injected": False}

    def delete_host_before_account_locks(queryset, *args, **kwargs):
        if queryset.model is Account and not state["injected"]:
            state["injected"] = True
            Account.objects.filter(pk=host.pk).update(
                status=Account.Status.PENDING_DELETION,
                deleted_at=timezone.now(),
            )
        return real_select_for_update(queryset, *args, **kwargs)

    monkeypatch.setattr(QuerySet, "select_for_update", delete_host_before_account_locks)

    response = _create_team(client, event_id, creator_token)

    assert state["injected"] is True
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["code"] == "event_not_found"
    assert not CommunityEventTeam.objects.exists()
    assert not CommunityEventTeamMembership.objects.exists()


@pytest.mark.django_db
def test_team_create_accepts_a_same_owner_retry_that_committed_before_the_account_lock(
    client,
    monkeypatch,
):
    host, host_token = _account("team-retry-host")
    creator, creator_token = _account("team-retry-creator")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    client_id = uuid.uuid4()
    real_select_for_update = QuerySet.select_for_update
    state = {"injected": False}

    def commit_first_copy_before_account_lock(queryset, *args, **kwargs):
        if queryset.model is Account and not state["injected"]:
            state["injected"] = True
            team = CommunityEventTeam.objects.create(
                event_id=event_id,
                created_by=creator,
                client_id=client_id,
                name="První doručená kopie",
            )
            CommunityEventTeamMembership.objects.create(
                event_id=event_id,
                team=team,
                account=creator,
                slot=1,
            )
        return real_select_for_update(queryset, *args, **kwargs)

    monkeypatch.setattr(QuerySet, "select_for_update", commit_first_copy_before_account_lock)

    replay = _create_team(
        client,
        event_id,
        creator_token,
        client_id=str(client_id),
        name="Pozdní retry nesmí přejmenovat",
    )

    assert state["injected"] is True
    assert replay.status_code == status.HTTP_200_OK
    assert replay.json()["created"] is False
    assert replay.json()["team"]["name"] == "První doručená kopie"
    assert CommunityEventTeam.objects.count() == 1
    assert CommunityEventTeamMembership.objects.filter(account=creator).count() == 1


@pytest.mark.django_db
def test_team_join_locks_request_host_and_creator_before_event_team_and_seat(
    client,
    monkeypatch,
):
    host, host_token = _account("join-lock-host")
    creator, creator_token = _account("join-lock-creator")
    joiner, joiner_token = _account("join-lock-joiner")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    _join_and_approve(client, event_id, host_token, joiner_token)
    team_id = _create_team(client, event_id, creator_token).json()["team"]["id"]
    lock_order, account_batches, account_ordering = _record_write_locks(monkeypatch)

    response = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(joiner_token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert lock_order[:3] == ["account", "event", "team"]
    assert account_batches == [[host.pk, creator.pk, joiner.pk]]
    assert account_ordering == [("pk",)]


@pytest.mark.django_db
def test_team_join_rechecks_creator_after_soft_delete_race(client, monkeypatch):
    _host, host_token = _account("join-delete-host")
    creator, creator_token = _account("join-delete-creator")
    joiner, joiner_token = _account("join-delete-joiner")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    _join_and_approve(client, event_id, host_token, joiner_token)
    team_id = _create_team(client, event_id, creator_token).json()["team"]["id"]
    real_select_for_update = QuerySet.select_for_update
    state = {"injected": False}

    def delete_creator_before_account_locks(queryset, *args, **kwargs):
        if queryset.model is Account and not state["injected"]:
            state["injected"] = True
            Account.objects.filter(pk=creator.pk).update(
                status=Account.Status.PENDING_DELETION,
                deleted_at=timezone.now(),
            )
        return real_select_for_update(queryset, *args, **kwargs)

    monkeypatch.setattr(QuerySet, "select_for_update", delete_creator_before_account_locks)

    response = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(joiner_token),
    )

    assert state["injected"] is True
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["code"] == "team_unavailable"
    assert not CommunityEventTeamMembership.objects.filter(
        event_id=event_id,
        account=joiner,
    ).exists()


@pytest.mark.django_db
def test_team_roster_is_private_to_host_and_approved_participants(client):
    _host, host_token = _account("host")
    _pending, pending_token = _account("pending")
    _stranger, stranger_token = _account("stranger")
    event_id = _create(client, host_token, capacity=10).json()["id"]

    created = _create_team(client, event_id, host_token)
    assert created.status_code == status.HTTP_201_CREATED
    assert created.json()["team_roster"]["participant_count"] == 1
    assert created.json()["team_roster"]["assigned_count"] == 1
    assert created.json()["team"]["member_count"] == 1

    public_detail = client.get(
        f"/v1/community-events/{event_id}",
        **_auth(stranger_token),
    )
    assert public_detail.status_code == status.HTTP_200_OK
    assert "team_roster" not in public_detail.json()

    request_id = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(pending_token),
    ).json()["request_id"]
    pending_detail = client.get(
        f"/v1/community-events/{event_id}",
        **_auth(pending_token),
    )
    assert "team_roster" not in pending_detail.json()
    denied = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(pending_token),
    )
    assert denied.status_code == status.HTTP_404_NOT_FOUND
    assert denied.json()["code"] == "event_not_found"

    assert (
        client.post(
            f"/v1/community-events/{event_id}/requests/{request_id}/approve",
            **_auth(host_token),
        ).status_code
        == status.HTTP_200_OK
    )
    member_detail = client.get(
        f"/v1/community-events/{event_id}",
        **_auth(pending_token),
    ).json()
    roster = member_detail["team_roster"]
    assert roster["max_team_size"] == 4
    assert roster["participant_count"] == 2
    assert roster["assigned_count"] == 1
    assert roster["unassigned_count"] == 1
    assert roster["teams"][0]["members"][0]["account"]["nickname"] == "host"


@pytest.mark.django_db
def test_team_create_join_and_leave_are_idempotent(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, guest_token)
    client_id = str(uuid.uuid4())

    first_create = _create_team(
        client,
        event_id,
        host_token,
        client_id=client_id,
    )
    replayed_create = _create_team(
        client,
        event_id,
        host_token,
        client_id=client_id,
        name="Retry nesmí přejmenovat",
    )
    assert first_create.status_code == status.HTTP_201_CREATED
    assert replayed_create.status_code == status.HTTP_200_OK
    assert first_create.json()["team"]["id"] == replayed_create.json()["team"]["id"]
    assert replayed_create.json()["team"]["name"] == "Výčepní esa"
    assert CommunityEventTeam.objects.count() == 1
    assert CommunityEventTeamMembership.objects.count() == 1
    team_id = first_create.json()["team"]["id"]

    first_join = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    replayed_join = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    assert first_join.status_code == status.HTTP_201_CREATED
    assert first_join.json()["joined"] is True
    assert replayed_join.status_code == status.HTTP_200_OK
    assert replayed_join.json()["joined"] is False
    assert CommunityEventTeamMembership.objects.count() == 2

    duplicate_team = _create_team(client, event_id, guest_token, name="Vedlejší stůl")
    assert duplicate_team.status_code == status.HTTP_409_CONFLICT
    assert duplicate_team.json()["code"] == "already_on_team"

    left = client.delete(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    replayed_leave = client.delete(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    assert left.status_code == status.HTTP_200_OK
    assert left.json()["left"] is True
    assert replayed_leave.json()["left"] is False

    rejoined = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    assert rejoined.status_code == status.HTTP_201_CREATED
    event_left = client.delete(
        f"/v1/community-events/{event_id}/join",
        **_auth(guest_token),
    )
    assert event_left.json()["status"] == "left"
    assert not CommunityEventTeamMembership.objects.filter(
        event_id=event_id,
        account=guest,
    ).exists()


@pytest.mark.django_db
def test_team_capacity_is_four_and_fifth_join_is_rejected(client):
    _host, host_token = _account("host")
    guests = [_account(f"guest-{index}") for index in range(4)]
    event_id = _create(client, host_token, capacity=10).json()["id"]
    for _guest, guest_token in guests:
        _join_and_approve(client, event_id, host_token, guest_token)
    team_id = _create_team(client, event_id, host_token).json()["team"]["id"]

    for _guest, guest_token in guests[:3]:
        response = client.post(
            f"/v1/community-events/{event_id}/teams/{team_id}/join",
            **_auth(guest_token),
        )
        assert response.status_code == status.HTTP_201_CREATED
    full = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guests[3][1]),
    )
    assert full.status_code == status.HTTP_409_CONFLICT
    assert full.json()["code"] == "team_full"
    assert CommunityEventTeamMembership.objects.filter(team_id=team_id).count() == 4
    assert set(
        CommunityEventTeamMembership.objects.filter(team_id=team_id).values_list("slot", flat=True)
    ) == {1, 2, 3, 4}


@pytest.mark.django_db
def test_team_join_respects_event_and_teammate_blocks(client):
    host, host_token = _account("host")
    teammate, teammate_token = _account("teammate")
    applicant, applicant_token = _account("applicant")
    blocked_by_host, blocked_by_host_token = _account("blocked-host")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    for token in (teammate_token, applicant_token, blocked_by_host_token):
        _join_and_approve(client, event_id, host_token, token)
    team_id = _create_team(client, event_id, host_token).json()["team"]["id"]
    assert (
        client.post(
            f"/v1/community-events/{event_id}/teams/{team_id}/join",
            **_auth(teammate_token),
        ).status_code
        == status.HTTP_201_CREATED
    )

    FriendBlock.objects.create(blocker=teammate, blocked=applicant)
    teammate_block = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(applicant_token),
    )
    assert teammate_block.status_code == status.HTTP_404_NOT_FOUND
    assert teammate_block.json()["code"] == "team_unavailable"

    FriendBlock.objects.create(blocker=host, blocked=blocked_by_host)
    host_block = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(blocked_by_host_token),
    )
    assert host_block.status_code == status.HTTP_404_NOT_FOUND
    assert host_block.json()["code"] == "event_not_found"


@pytest.mark.django_db
def test_team_db_constraints_close_capacity_and_cross_team_races(client):
    host, host_token = _account("host")
    account, _token = _account("member")
    other, _other_token = _account("other")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    event = CommunityEvent.objects.get(pk=event_id)
    first = CommunityEventTeam.objects.create(
        event=event,
        created_by=host,
        client_id=uuid.uuid4(),
        name="První",
    )
    second = CommunityEventTeam.objects.create(
        event=event,
        created_by=host,
        client_id=uuid.uuid4(),
        name="Druhý",
    )
    CommunityEventTeamMembership.objects.create(
        event=event,
        team=first,
        account=account,
        slot=1,
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        CommunityEventTeamMembership.objects.create(
            event=event,
            team=first,
            account=other,
            slot=1,
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        CommunityEventTeamMembership.objects.create(
            event=event,
            team=second,
            account=account,
            slot=1,
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        CommunityEventTeamMembership.objects.create(
            event=event,
            team=first,
            account=other,
            slot=5,
        )


@pytest.mark.django_db
def test_team_join_recovers_when_a_concurrent_insert_wins_a_slot(
    client,
    monkeypatch,
):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, guest_token)
    team_id = _create_team(client, event_id, host_token).json()["team"]["id"]
    real_create = CommunityEventTeamMembership.objects.create
    state = {"raised": False}

    def racing_create(*args, **kwargs):
        if not state["raised"]:
            state["raised"] = True
            raise IntegrityError("duplicate key value violates unique_event_team_slot")
        return real_create(*args, **kwargs)

    monkeypatch.setattr(CommunityEventTeamMembership.objects, "create", racing_create)
    response = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(guest_token),
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert state["raised"] is True
    assert CommunityEventTeamMembership.objects.get(account=guest).slot == 3


@pytest.mark.django_db
def test_team_creator_can_rename_and_event_host_can_delete(client):
    host, host_token = _account("host")
    _creator, creator_token = _account("creator")
    _outsider, outsider_token = _account("outsider")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    _join_and_approve(client, event_id, host_token, outsider_token)
    created = _create_team(client, event_id, creator_token)
    team_id = created.json()["team"]["id"]

    renamed = client.patch(
        f"/v1/community-events/{event_id}/teams/{team_id}",
        data={"name": "Pěna a říz"},
        format="json",
        **_auth(creator_token),
    )
    host_rename = client.patch(
        f"/v1/community-events/{event_id}/teams/{team_id}",
        data={"name": "Host nepřejmenovává"},
        format="json",
        **_auth(host_token),
    )
    outsider_delete = client.delete(
        f"/v1/community-events/{event_id}/teams/{team_id}",
        **_auth(outsider_token),
    )

    assert renamed.status_code == status.HTTP_200_OK
    assert renamed.json()["team"]["name"] == "Pěna a říz"
    assert host_rename.status_code == status.HTTP_404_NOT_FOUND
    assert outsider_delete.status_code == status.HTTP_404_NOT_FOUND

    deleted = client.delete(
        f"/v1/community-events/{event_id}/teams/{team_id}",
        **_auth(host_token),
    )
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert not CommunityEventTeam.objects.filter(pk=team_id).exists()
    assert not CommunityEventTeamMembership.objects.filter(team_id=team_id).exists()
    assert CommunityEvent.objects.filter(pk=event_id, host=host).exists()


@pytest.mark.django_db
def test_team_roster_hides_blocked_ghost_and_inactive_creators(client):
    _host, host_token = _account("host")
    creator, creator_token = _account("creator")
    viewer, viewer_token = _account("viewer")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    _join_and_approve(client, event_id, host_token, viewer_token)
    team_id = _create_team(client, event_id, creator_token).json()["team"]["id"]

    visible = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(viewer_token),
    )
    assert [team["id"] for team in visible.json()["teams"]] == [team_id]

    block = FriendBlock.objects.create(blocker=creator, blocked=viewer)
    blocked = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(viewer_token),
    )
    blocked_join = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(viewer_token),
    )
    assert blocked.json()["teams"] == []
    assert blocked_join.status_code == status.HTTP_404_NOT_FOUND
    block.delete()

    creator.ghost_mode = True
    creator.save(update_fields=["ghost_mode"])
    ghosted = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(viewer_token),
    )
    assert ghosted.json()["teams"] == []

    creator.ghost_mode = False
    creator.status = Account.Status.PENDING_DELETION
    creator.save(update_fields=["ghost_mode", "status"])
    inactive = client.get(
        f"/v1/community-events/{event_id}/teams",
        **_auth(viewer_token),
    )
    assert inactive.json()["teams"] == []


@pytest.mark.django_db
def test_hard_deleted_team_creator_preserves_team_with_anonymized_creator(client):
    _host, host_token = _account("host")
    creator, creator_token = _account("creator")
    _member, member_token = _account("member")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    _join_and_approve(client, event_id, host_token, member_token)
    team_id = _create_team(client, event_id, creator_token).json()["team"]["id"]
    joined = client.post(
        f"/v1/community-events/{event_id}/teams/{team_id}/join",
        **_auth(member_token),
    )
    assert joined.status_code == status.HTTP_201_CREATED

    creator.delete()

    team = CommunityEventTeam.objects.get(pk=team_id)
    assert team.created_by_id is None
    assert CommunityEventTeamMembership.objects.filter(team_id=team_id).exists()


# ---------------------------------------------------------------------------
# UGC consent gating (RED — writes are not gated yet)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_event_create_with_current_header_and_no_acceptance_returns_428(client):
    _host, token = _account("host")
    denied = _create(client, token, headers=_policy_header())
    assert denied.status_code == 428
    assert denied.json()["code"] == "ugc_consent_required"
    assert CommunityEvent.objects.count() == 0


@pytest.mark.django_db
def test_accepted_account_creates_event_with_current_header(client):
    _host, token = _account("host")
    _accept_ugc(client, token)
    created = _create(client, token, headers=_policy_header())
    assert created.status_code == status.HTTP_201_CREATED
    assert CommunityEvent.objects.count() == 1


@pytest.mark.django_db
def test_legacy_create_without_policy_header_still_succeeds(client):
    _host, token = _account("host")
    created = _create(client, token)
    assert created.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
def test_join_with_message_gated_by_current_header_without_acceptance(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    denied = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"message": "Přinesu karty.", "adults_confirmed": True},
        format="json",
        **_auth(guest_token),
        **_policy_header(),
    )
    assert denied.status_code == 428
    assert denied.json()["code"] == "ugc_consent_required"
    assert not CommunityEventMembership.objects.filter(account=guest).exists()


@pytest.mark.django_db
def test_join_with_blank_message_bypasses_gate(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    joined = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
        **_policy_header(),
    )
    assert joined.status_code == status.HTTP_202_ACCEPTED
    assert CommunityEventMembership.objects.filter(
        account=guest,
        status=CommunityEventMembership.Status.PENDING,
    ).exists()


@pytest.mark.django_db
def test_non_authored_state_actions_bypass_gate(client):
    _host, host_token = _account("host")
    guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    request_id = client.post(
        f"/v1/community-events/{event_id}/join",
        data={"adults_confirmed": True},
        format="json",
        **_auth(guest_token),
        **_policy_header(),
    ).json()["request_id"]
    assert (
        client.post(
            f"/v1/community-events/{event_id}/requests/{request_id}/approve",
            **{**_auth(host_token), **_policy_header()},
        ).status_code
        == status.HTTP_200_OK
    )
    team_id = _create_team(client, event_id, host_token).json()["team"]["id"]
    assert (
        client.post(
            f"/v1/community-events/{event_id}/teams/{team_id}/join",
            **{**_auth(guest_token), **_policy_header()},
        ).status_code
        == status.HTTP_201_CREATED
    )
    assert (
        client.post(
            f"/v1/community-events/{event_id}/report",
            data={"reason": "other"},
            format="json",
            **{**_auth(guest_token), **_policy_header()},
        ).status_code
        == status.HTTP_201_CREATED
    )
    left = client.delete(
        f"/v1/community-events/{event_id}/join",
        **{**_auth(guest_token), **_policy_header()},
    )
    assert left.json()["status"] == "left"
    cancelled = client.post(
        f"/v1/community-events/{event_id}/cancel",
        **{**_auth(host_token), **_policy_header()},
    )
    assert cancelled.json()["status"] == "cancelled"


@pytest.mark.django_db
def test_team_create_gated_until_acceptance_then_succeeds_with_header(client):
    _host, host_token = _account("host")
    _guest, guest_token = _account("guest")
    event_id = _create(client, host_token).json()["id"]
    _join_and_approve(client, event_id, host_token, guest_token)
    denied = _create_team(client, event_id, guest_token, headers=_policy_header())
    assert denied.status_code == 428
    assert denied.json()["code"] == "ugc_consent_required"
    assert CommunityEventTeam.objects.count() == 0

    _accept_ugc(client, guest_token)
    created = _create_team(client, event_id, guest_token, headers=_policy_header())
    assert created.status_code == status.HTTP_201_CREATED
    assert CommunityEventTeam.objects.count() == 1


@pytest.mark.django_db
def test_team_rename_gated_until_acceptance_then_succeeds_with_header(client):
    _host, host_token = _account("host")
    creator, creator_token = _account("creator")
    event_id = _create(client, host_token, capacity=10).json()["id"]
    _join_and_approve(client, event_id, host_token, creator_token)
    team_id = _create_team(client, event_id, creator_token).json()["team"]["id"]

    denied = client.patch(
        f"/v1/community-events/{event_id}/teams/{team_id}",
        data={"name": "Pěna a říz"},
        format="json",
        **_auth(creator_token),
        **_policy_header(),
    )
    assert denied.status_code == 428
    assert CommunityEventTeam.objects.get(pk=team_id).name == "Výčepní esa"

    _accept_ugc(client, creator_token)
    renamed = client.patch(
        f"/v1/community-events/{event_id}/teams/{team_id}",
        data={"name": "Pěna a říz"},
        format="json",
        **_auth(creator_token),
        **_policy_header(),
    )
    assert renamed.status_code == status.HTTP_200_OK
    assert renamed.json()["team"]["name"] == "Pěna a říz"

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.accounts import issue_token
from pubs.api.ugc_consent import UGC_POLICY_HEADER
from pubs.models import Account, EmailCredential
from pubs.pub_events import PubEvent


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _claimed_account() -> tuple[Account, str]:
    account = Account.objects.create(device_id=f"pub-event-{uuid.uuid4()}")
    EmailCredential.objects.create(
        account=account,
        email=f"{uuid.uuid4()}@example.test",
        password=make_password("test-password"),
        email_verified=True,
    )
    return account, issue_token(account)


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(now):
    return {
        "client_id": str(uuid.uuid4()),
        "name": "U Tří píp",
        "lat": 50.078914,
        "lng": 14.41699,
        "city": "Praha",
        "title": "Hospodský kvíz",
        "details": "Pět kol a sud pro vítěze.",
        "starts_at": (now - timedelta(hours=1)).isoformat(),
        "ends_at": (now + timedelta(hours=2)).isoformat(),
    }


@pytest.mark.django_db
def test_public_read_returns_only_active_verified_events():
    account, _ = _claimed_account()
    now = timezone.now()
    common = {
        "account": account,
        "cache_key": "u2fkbnhz",
        "name": "U Tří píp",
        "lat": 50.078914,
        "lng": 14.41699,
    }
    active = PubEvent.objects.create(
        **common,
        client_id=uuid.uuid4(),
        title="Aktivní kvíz",
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(hours=2),
        status=PubEvent.Status.VERIFIED,
    )
    PubEvent.objects.create(
        **common,
        client_id=uuid.uuid4(),
        title="Čeká na kontrolu",
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(hours=2),
    )
    PubEvent.objects.create(
        **common,
        client_id=uuid.uuid4(),
        title="Už skončila",
        starts_at=now - timedelta(hours=3),
        ends_at=now - timedelta(hours=1),
        status=PubEvent.Status.VERIFIED,
    )
    PubEvent.objects.create(
        **common,
        client_id=uuid.uuid4(),
        title="Teprve bude",
        starts_at=now + timedelta(hours=1),
        ends_at=now + timedelta(hours=3),
        status=PubEvent.Status.VERIFIED,
    )

    response = APIClient().get("/v1/pub-events?cache_key=u2fkbnhz")

    assert response.status_code == status.HTTP_200_OK
    assert response["Cache-Control"] == "public, max-age=60"
    assert response.json()["events"] == [
        {
            "id": str(active.id),
            "title": "Aktivní kvíz",
            "details": "",
            "starts_at": active.starts_at.isoformat(),
            "ends_at": active.ends_at.isoformat(),
            "verified_at": active.verified_at.isoformat(),
        }
    ]


@pytest.mark.django_db
def test_signed_in_suggestion_is_pending_idempotent_and_not_public():
    account, token = _claimed_account()
    client = APIClient()
    payload = _payload(timezone.now())

    created = client.post("/v1/pub-events", payload, format="json", **_auth(token))
    duplicate = client.post("/v1/pub-events", payload, format="json", **_auth(token))

    assert created.status_code == status.HTTP_201_CREATED
    assert duplicate.status_code == status.HTTP_200_OK
    assert created.json() == duplicate.json()
    assert created.json()["status"] == PubEvent.Status.PENDING
    assert PubEvent.objects.filter(account=account).count() == 1
    assert APIClient().get("/v1/pub-events?cache_key=u2fkbnhz").json()["events"] == []


@pytest.mark.django_db
def test_anonymous_device_account_cannot_suggest():
    client = APIClient()
    bootstrap = client.post(
        "/v1/account",
        {"device_id": str(uuid.uuid4())},
        format="json",
    )

    response = client.post(
        "/v1/pub-events",
        _payload(timezone.now()),
        format="json",
        **_auth(bootstrap.json()["token"]),
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["code"] == "claimed_account_required"
    assert PubEvent.objects.count() == 0


@pytest.mark.django_db
def test_suggestion_rejects_invalid_or_unbounded_time_window():
    _, token = _claimed_account()
    client = APIClient()
    now = timezone.now()
    invalid = _payload(now)
    invalid["ends_at"] = (now - timedelta(hours=2)).isoformat()
    too_long = _payload(now)
    too_long["starts_at"] = now.isoformat()
    too_long["ends_at"] = (now + timedelta(days=15)).isoformat()

    invalid_response = client.post("/v1/pub-events", invalid, format="json", **_auth(token))
    long_response = client.post("/v1/pub-events", too_long, format="json", **_auth(token))

    assert invalid_response.status_code == status.HTTP_400_BAD_REQUEST
    assert long_response.status_code == status.HTTP_400_BAD_REQUEST
    assert PubEvent.objects.count() == 0


# ---------------------------------------------------------------------------
# UGC consent gating (RED — writes are not gated yet)
# ---------------------------------------------------------------------------


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


@pytest.mark.django_db
def test_suggestion_with_current_header_and_no_acceptance_returns_428():
    _, token = _claimed_account()
    client = APIClient()

    denied = client.post(
        "/v1/pub-events",
        _payload(timezone.now()),
        format="json",
        **_auth(token),
        **_policy_header(),
    )

    assert denied.status_code == 428, denied.content
    assert denied.json()["code"] == "ugc_consent_required"
    assert PubEvent.objects.count() == 0


@pytest.mark.django_db
def test_accepted_account_suggests_with_current_header_and_public_read_unblocked():
    account, token = _claimed_account()
    client = APIClient()
    _accept_ugc(client, token)

    created = client.post(
        "/v1/pub-events",
        _payload(timezone.now()),
        format="json",
        **_auth(token),
        **_policy_header(),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    assert PubEvent.objects.filter(account=account).count() == 1

    read = client.get("/v1/pub-events?cache_key=u2fkbnhz", **_policy_header())
    assert read.status_code == status.HTTP_200_OK

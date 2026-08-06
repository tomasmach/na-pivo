from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from rest_framework.test import APIClient

from pubs.api.challenge_views import derive_challenges
from pubs.models import Account, DrinkLog, PubVisit


def _account() -> Account:
    return Account.objects.create(device_id=uuid.uuid4(), token_hash="x")


def _visit(account: Account, cache_key: str, at: datetime) -> None:
    PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="Hospoda",
        lat=50.0,
        lng=14.0,
        started_at=at,
        client_updated_at=at,
    )


def _beer(account: Account, brand: str, at: datetime, *, suspect: bool = False) -> None:
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2mqr8vd",
        name="Hospoda",
        lat=50.0,
        lng=14.0,
        drink_type=DrinkLog.DrinkType.BEER,
        beer_name=brand,
        beer_brand_key=brand.lower(),
        beer_brand_name=brand,
        price_czk=None,
        drank_at=at,
        is_suspect=suspect,
        suspect_reason="manual" if suspect else "",
    )


@pytest.mark.django_db
def test_challenges_are_derived_from_visits_and_non_suspect_beers():
    account = _account()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)  # Thursday
    _visit(account, "old", datetime(2026, 7, 3, 18, tzinfo=UTC))
    _visit(account, "old", datetime(2026, 8, 6, 18, tzinfo=UTC))
    _visit(account, "new-a", datetime(2026, 8, 13, 18, tzinfo=UTC))
    _visit(account, "new-b", datetime(2026, 8, 20, 18, tzinfo=UTC))
    _beer(account, "Old", datetime(2026, 7, 10, 18, tzinfo=UTC))
    _beer(account, "Old", datetime(2026, 8, 10, 18, tzinfo=UTC))
    _beer(account, "Fresh", datetime(2026, 8, 11, 18, tzinfo=UTC))
    _beer(account, "Ignored", datetime(2026, 8, 12, 18, tzinfo=UTC), suspect=True)

    rows = {row["id"]: row for row in derive_challenges(account, now=now)}

    assert rows["new-pubs-month"]["done"] == 2
    assert rows["thursday-streak"]["done"] == 3
    assert rows["new-breweries-month"]["done"] == 1
    assert rows["new-breweries-month"]["progress"] == pytest.approx(0.2)


@pytest.mark.django_db
def test_challenges_endpoint_requires_auth_and_returns_no_private_rows():
    client = APIClient()
    assert client.get("/v1/challenges").status_code == 401

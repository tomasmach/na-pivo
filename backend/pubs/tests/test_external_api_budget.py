"""Tests for the database-backed external API request budget."""

from __future__ import annotations

from functools import partial

import pytest

from pubs.external_api_budget import reserve_external_api_request
from pubs.models import ExternalApiDailyUsage

pytestmark = pytest.mark.django_db


def test_budget_allows_exactly_cap_reservations() -> None:
    reserve = partial(
        reserve_external_api_request,
        provider="google_maps",
        operation="billable",
        cap=2,
    )

    assert reserve() is True
    assert reserve() is True
    assert reserve() is False

    usage = ExternalApiDailyUsage.objects.get(
        provider="google_maps",
        operation="billable",
    )
    assert usage.request_count == 2


def test_places_and_geocoding_share_provider_operation_bucket() -> None:
    reserve_for_places = partial(
        reserve_external_api_request,
        provider="google_maps",
        operation="billable",
        cap=2,
    )
    reserve_for_geocoding = partial(
        reserve_external_api_request,
        provider="google_maps",
        operation="billable",
        cap=2,
    )

    assert reserve_for_places() is True
    assert reserve_for_geocoding() is True
    assert reserve_for_places() is False
    assert reserve_for_geocoding() is False

    assert ExternalApiDailyUsage.objects.count() == 1
    usage = ExternalApiDailyUsage.objects.get()
    assert usage.provider == "google_maps"
    assert usage.operation == "billable"
    assert usage.request_count == 2


@pytest.mark.parametrize("cap", [0, -1])
def test_non_positive_cap_fails_closed_without_creating_usage(cap: int) -> None:
    assert (
        reserve_external_api_request(
            provider="google_maps",
            operation="billable",
            cap=cap,
        )
        is False
    )
    assert not ExternalApiDailyUsage.objects.exists()

"""Tests for beer-brand suggestions and canonical matching."""

from __future__ import annotations

import pytest
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient

from pubs.beer_catalog import match_beer_brand, normalize_beer_payload
from pubs.models import BeerBrand


@pytest.fixture
def client():
    return APIClient()


@pytest.mark.django_db
def test_suggest_returns_ranked_canonical_brands(client):
    resp = client.get("/v1/beer-brands/suggest", {"q": "plz", "limit": 5})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["suggestions"][0] == {
        "slug": "pilsner-urquell",
        "name": "Pilsner Urquell",
    }


@pytest.mark.django_db
def test_suggest_matches_alias_without_diacritics(client):
    resp = client.get("/v1/beer-brands/suggest", {"q": "bazant"})

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["suggestions"]]
    assert "Zlatý Bažant" in names


@pytest.mark.django_db
def test_suggest_omits_inactive_brands(client):
    BeerBrand.objects.create(
        key="inactive-test",
        name="Inactive Test",
        aliases=["deadbeer"],
        rank=1,
        active=False,
    )

    resp = client.get("/v1/beer-brands/suggest", {"q": "deadbeer"})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["suggestions"] == []


@pytest.mark.django_db
def test_suggest_caps_limit(client):
    resp = client.get("/v1/beer-brands/suggest", {"q": "", "limit": 999})

    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert "limit" in resp.json()


@pytest.mark.django_db
def test_suggest_blank_query_returns_top_ranked_brands(client):
    resp = client.get("/v1/beer-brands/suggest", {"q": "", "limit": 3})

    assert resp.status_code == status.HTTP_200_OK
    assert [item["slug"] for item in resp.json()["suggestions"]] == [
        "pilsner-urquell",
        "gambrinus",
        "velkopopovicky-kozel",
    ]


@pytest.mark.django_db
def test_matching_is_accent_insensitive_but_menu_normalization_is_exact_only():
    assert match_beer_brand("plzen").brand.key == "pilsner-urquell"
    assert match_beer_brand("Kozel 11").brand.key == "velkopopovicky-kozel"

    # Exact shorthand is canonicalized in the public menu.
    assert normalize_beer_payload({"name": "Plzeň", "price_czk": 62}) == {
        "name": "Pilsner Urquell",
        "price_czk": 62,
        "volume_ml": None,
    }
    # A concrete beer variant stays a distinct menu row; it is only brand-indexed.
    assert normalize_beer_payload({"name": "Kozel 11", "price_czk": 49}) == {
        "name": "Kozel 11",
        "price_czk": 49,
        "volume_ml": None,
    }


def test_beer_brand_throttle_scope_is_configured():
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["beer_brands"]

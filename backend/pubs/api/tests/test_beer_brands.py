"""Tests for beer-brand suggestions and canonical matching."""

from __future__ import annotations

import pytest
from django.conf import settings
from rest_framework import status
from rest_framework.test import APIClient

from pubs.beer_catalog import match_beer, normalize_beer_payload
from pubs.models import BeerBrand, BeerProduct


@pytest.fixture
def client():
    return APIClient()


@pytest.mark.django_db
def test_suggest_returns_product_first_results_with_brand_metadata(client):
    resp = client.get("/v1/beer-brands/suggest", {"q": "kozel", "limit": 5})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["suggestions"][0] == {
        "slug": "velkopopovicky-kozel-10",
        "name": "Velkopopovický Kozel 10°",
        "kind": "product",
        "brand_slug": "velkopopovicky-kozel",
        "brand_name": "Velkopopovický Kozel",
    }


@pytest.mark.django_db
def test_suggest_matches_alias_without_diacritics(client):
    resp = client.get("/v1/beer-brands/suggest", {"q": "bazant"})

    assert resp.status_code == status.HTTP_200_OK
    names = [item["name"] for item in resp.json()["suggestions"]]
    assert "Zlatý Bažant 10°" in names


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
def test_suggest_omits_inactive_products(client):
    brand = BeerBrand.objects.get(key="pilsner-urquell")
    BeerProduct.objects.create(
        key="inactive-product",
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        name="Inactive Product",
        aliases=["deadproduct"],
        rank=1,
        active=False,
    )

    resp = client.get("/v1/beer-brands/suggest", {"q": "deadproduct"})

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
        "gambrinus-10",
        "gambrinus-11",
    ]


@pytest.mark.django_db
def test_matching_is_accent_insensitive_and_product_aware():
    assert match_beer("plzen").brand.key == "pilsner-urquell"
    kozel = match_beer("Kozel 11")
    assert kozel.brand.key == "velkopopovicky-kozel"
    assert kozel.product.key == "velkopopovicky-kozel-11"

    # Exact shorthand is canonicalized in the public menu.
    assert normalize_beer_payload({"name": "Plzeň", "price_czk": 62}) == {
        "name": "Pilsner Urquell",
        "price_czk": 62,
        "volume_ml": None,
    }
    # A concrete beer variant becomes the canonical product, not just the brand.
    assert normalize_beer_payload({"name": "Kozel 11", "price_czk": 49}) == {
        "name": "Velkopopovický Kozel 11°",
        "price_czk": 49,
        "volume_ml": None,
    }


def test_beer_brand_throttle_scope_is_configured():
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["beer_brands"]

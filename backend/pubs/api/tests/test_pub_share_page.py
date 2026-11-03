from __future__ import annotations

import pytest
from django.utils import timezone

from pubs.enrichment.matcher import geohash8
from pubs.models import Account, PubCommunityData, PubDirectory, PubHours, PubReport

LAT, LNG = 50.0857, 14.4186
KEY = geohash8(LAT, LNG)


def _directory(name="U Zlatého tygra", lat=LAT, lng=LNG, **extra):
    return PubDirectory.objects.create(
        name=name,
        lat=lat,
        lng=lng,
        city="Praha",
        country="CZ",
        source="test",
        refreshed_at=timezone.now(),
        **extra,
    )


@pytest.mark.django_db
def test_pub_page_shows_public_pub_data_and_opens_the_app(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _directory()
    PubCommunityData.objects.create(
        cache_key=KEY,
        name="U Zlatého tygra",
        lat=LAT,
        lng=LNG,
        hours_json={"mo": [["11:00", "23:00"]], "tu": [], "we": [], "th": [], "fr": [], "sa": [], "su": []},
        beers=[{"name": "Pilsner Urquell 12°", "price_czk": 59, "volume_ml": 500}],
    )
    PubHours.objects.create(cache_key=KEY, name="U Zlatého tygra", lat=LAT, lng=LNG, rating_value=4.6, rating_count=1200)

    response = client.get(f"/h/{KEY}")

    assert response.status_code == 200
    html = response.content.decode()
    assert "U Zlatého tygra" in html
    assert "Pilsner Urquell 12°" in html and "59 Kč" in html and "0,5 l" in html
    assert "11:00–23:00" in html and "Zavřeno" in html
    assert f'href="napivo://h/{KEY}?n=U+Zlat%C3%A9ho+tygra"' in html
    assert f'<link rel="canonical" href="https://na-pivo.cz/h/{KEY}?n=U+Zlat%C3%A9ho+tygra">' in html
    # The enrichment source's rating stays in the app, never on the public web.
    assert "4,6" not in html and "4.6" not in html and "1200" not in html
    assert "noindex" in html
    assert "script-src" not in response["Content-Security-Policy"]


@pytest.mark.django_db
def test_pub_page_name_hint_picks_the_shared_pub_in_a_busy_cell(client):
    _directory(name="Alfa")
    _directory(name="Beta")

    html = client.get(f"/h/{KEY}?n=beta").content.decode()

    assert "<h1>Beta</h1>" in html


@pytest.mark.django_db
def test_pub_page_without_data_says_so(client):
    _directory()

    html = client.get(f"/h/{KEY}").content.decode()

    assert "Co tu čepují, zatím nevím." in html


@pytest.mark.django_db
def test_pub_page_speaks_english(client):
    _directory()

    html = client.get(f"/h/{KEY}", HTTP_ACCEPT_LANGUAGE="en").content.decode()

    assert "On tap" in html and "Open in the app" in html and "Monday" not in html


@pytest.mark.django_db
@pytest.mark.parametrize("key", ["nope", "u2fkbnhu1", "aaaaaaaa"])
def test_pub_page_unknown_cell_is_404(client, key):
    response = client.get(f"/h/{key}")

    assert response.status_code == 404
    assert "Tuhle hospodu neznám." in response.content.decode()


@pytest.mark.django_db
def test_pub_page_hides_reported_and_not_a_pub_places(client):
    _directory(venue_kind=PubHours.VenueKind.NOT_PUB)
    assert client.get(f"/h/{KEY}").status_code == 404

    other_lat, other_lng = 50.0901, 14.4256
    other = _directory(name="Lokál", lat=other_lat, lng=other_lng)
    reporter = Account.objects.create()
    PubReport.objects.create(
        account=reporter, cache_key=other.cache_key, reason="closed", name="Lokál", lat=other_lat, lng=other_lng
    )
    assert client.get(f"/h/{other.cache_key}").status_code == 404


@pytest.mark.django_db
def test_pub_page_is_throttled(client, monkeypatch):
    from pubs.api.throttling import SharedScopedRateThrottle

    monkeypatch.setattr(
        SharedScopedRateThrottle, "THROTTLE_RATES", {**SharedScopedRateThrottle.THROTTLE_RATES, "pub_public": "2/min"}
    )
    _directory()

    statuses = [client.get(f"/h/{KEY}").status_code for _ in range(3)]

    assert statuses == [200, 200, 429]

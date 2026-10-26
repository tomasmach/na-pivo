from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.accounts import issue_token
from pubs.models import (
    Account,
    EmailCredential,
    PubAmenity,
    PubCommunityData,
    PubDirectory,
    PubEvent,
    PubHours,
    TourPublication,
    WebPub,
)
from pubs.tests.test_beer_pages import (  # noqa: F401  (catalog seeds the beers)
    BRATISLAVA,
    _drink,
    _pub,
    catalog,
)
from pubs.web_guide import _open_status
from pubs.web_pubs import save_web_pubs

pytestmark = pytest.mark.django_db
PRAGUE = ZoneInfo("Europe/Prague")


def _page(name: str) -> WebPub:
    return WebPub.objects.get(name=name)


def _amenity(cache_key: str, key: str, *, yes: bool = True, voters: int = 4) -> None:
    menu = PubCommunityData.objects.get(cache_key=cache_key)
    PubAmenity.objects.create(
        cache_key=cache_key, pub_identity_key=f"{cache_key}::x", amenity_key=key, name=menu.name, lat=menu.lat,
        lng=menu.lng, yes_count=voters if yes else 0, no_count=0 if yes else voters, distinct_voter_count=voters,
        status=PubAmenity.Status.YES if yes else PubAmenity.Status.NO, confidence=voters / (voters + 2),
    )


def _event(cache_key: str, title: str, *, starts_in: timedelta, status=PubEvent.Status.VERIFIED, hours: int = 3):
    menu = PubCommunityData.objects.get(cache_key=cache_key)
    author = Account.objects.create(device_id=f"web-event-{uuid.uuid4()}")
    starts = timezone.now() + starts_in
    return PubEvent.objects.create(
        account=author, client_id=uuid.uuid4(), cache_key=cache_key, name=menu.name, lat=menu.lat, lng=menu.lng,
        city=menu.city or "", title=title, starts_at=starts, ends_at=starts + timedelta(hours=hours), status=status,
        verified_at=timezone.now() if status == PubEvent.Status.VERIFIED else None,
    )


def test_pub_page_shows_what_people_wrote_and_nothing_from_firmy(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    key = _pub("U Kalicha", [("Testovar 11°", 52, 500), ("Kofola", 39, 500)], days_ago=3)
    menu = PubCommunityData.objects.get(cache_key=key)
    PubHours.objects.create(
        cache_key=key, name="U Kalicha", lat=menu.lat, lng=menu.lng, source="firmy", rating_value=4.7,
        rating_count=321, rating_label="výborné", opening_hours_raw="Mo-Su 10:00-22:00", has_garden=True,
    )
    _amenity(key, "game_darts")
    _amenity(key, "seating_garden", voters=1)
    save_web_pubs()

    response = client.get("/hospoda/praha/u-kalicha")

    assert response.status_code == 200
    html = response.content.decode()
    assert "<h1>U Kalicha</h1>" in html
    assert "Testovar 11°" in html and "52 Kč" in html
    assert "Šipky" in html
    # One vote is no agreement yet, and Firmy.cz's garden tag, hours and rating never reach the web.
    assert "Zahrádka" not in html
    assert "4,7" not in html and "321" not in html and "výborné" not in html and "10:00" not in html
    assert f"app-argument=napivo://pub?key={key}&amp;name=U%20Kalicha" in html
    assert "tiles.openfreemap.org" in response["Content-Security-Policy"]
    assert '<link rel="canonical" href="https://na-pivo.cz/hospoda/praha/u-kalicha">' in html


def test_only_confirmed_writes_outside_ghost_mode_give_a_pub_its_page(client):
    _pub("U Lípy", days_ago=400)
    hidden = _pub("Na Růžku", days_ago=400)
    _drink(hidden, days_ago=1, ghost_mode=True)
    _pub("Krčma", at=BRATISLAVA, country="sk", city="Bratislava", days_ago=2)

    save_web_pubs()

    assert not WebPub.objects.filter(listed=True).exists()
    assert client.get("/hospody/praha").status_code == 404


def test_a_pub_keeps_its_address_while_it_drops_out_and_comes_back(client):
    key = _pub("U Kalicha", days_ago=3)
    twin = _pub("U Kalicha", days_ago=5, city="Praha 5")
    save_web_pubs()
    slugs = {WebPub.objects.get(cache_key=key).slug, WebPub.objects.get(cache_key=twin).slug}
    assert slugs == {"u-kalicha", "u-kalicha-2"}

    PubCommunityData.objects.filter(cache_key=key).update(beers=[])
    save_web_pubs()
    page = WebPub.objects.get(cache_key=key)
    assert not page.listed
    assert client.get(f"/hospoda/praha/{page.slug}").status_code == 404

    PubCommunityData.objects.filter(cache_key=key).update(beers=[{"name": "Testovar 11°", "price_czk": 55, "volume_ml": 500}])
    save_web_pubs()
    again = WebPub.objects.get(cache_key=key)
    assert again.listed and again.slug == page.slug


def test_search_filters_by_amenity_price_and_beer_and_reloads_only_results(client):
    cheap = _pub("U Kalicha", [("Testovar 11°", 44, 500)], days_ago=3)
    _pub("Na Růžku", [("Testovar 12°", 49, 500)], days_ago=3)
    dear = _pub("Pod Věží", [("Testovar 11°", 62, 500)], days_ago=3)
    _amenity(cheap, "seating_garden")
    _amenity(dear, "seating_garden")
    save_web_pubs()

    def names(response):
        return [row["name"] for row in response.context["rows"]]

    assert names(client.get("/hospody/praha")) == ["U Kalicha", "Na Růžku", "Pod Věží"]
    assert names(client.get("/hospody/praha?vybaveni=zahradka")) == ["U Kalicha", "Pod Věží"]
    assert names(client.get("/hospody/praha?vybaveni=zahradka&do=45")) == ["U Kalicha"]
    assert names(client.get("/hospody/praha?pivo=testovar-12")) == ["Na Růžku"]
    # A garden guide is a search with the filter set, once enough pubs match.
    assert client.get("/hospody/praha/zahradka").status_code == 404

    partial = client.get("/hospody/praha?vybaveni=zahradka", HTTP_X_PARTIAL="1")
    assert partial.status_code == 200 and "X-Partial" in partial["Vary"]
    assert partial.content.decode().startswith('<div class="results"')
    # Nonsense in the address is ignored, never an error.
    assert client.get("/hospody/praha?do=abc&lat=999&vybaveni=nic&razeni=x&strana=-1&oblast=1,2").status_code == 200


def test_an_empty_search_offers_to_drop_the_filter_that_keeps_pubs_out(client):
    key = _pub("U Kalicha", [("Testovar 11°", 44, 500)], days_ago=3)
    _amenity(key, "seating_garden")
    save_web_pubs()

    response = client.get("/hospody/praha?vybaveni=zahradka&vybaveni=sipky")

    assert response.context["total"] == 0
    assert [item["url"] for item in response.context["relax"]] == ["?vybaveni=zahradka"]
    assert response.context["indexable"] is False


def test_the_search_box_opens_a_city_or_finds_a_pub_without_accents(client):
    _pub("U Lípy", days_ago=3, city="Brno")
    save_web_pubs()

    assert client.get("/hospody?q=brno").headers["Location"] == "/hospody/brno"
    response = client.get("/hospody?q=u lipy")
    assert [row["name"] for row in response.context["rows"]] == ["U Lípy"]


def test_events_page_lists_verified_events_until_they_end(client):
    key = _pub("U Kalicha", days_ago=3)
    brno = _pub("Na Růžku", days_ago=3, city="Brno")
    save_web_pubs()
    _event(key, "Hospodský kvíz", starts_in=timedelta(hours=2))
    _event(brno, "Narážíme sud", starts_in=timedelta(days=2))
    _event(key, "Čeká na ověření", starts_in=timedelta(days=1), status=PubEvent.Status.PENDING)
    _event(key, "Zamítnutá", starts_in=timedelta(days=1), status=PubEvent.Status.REJECTED)
    _event(key, "Skončila", starts_in=-timedelta(hours=5), hours=2)
    _event(key, "Za dva měsíce", starts_in=timedelta(days=60))

    html = client.get("/akce").content.decode()
    assert "Hospodský kvíz" in html and "Narážíme sud" in html
    assert '<a href="/hospoda/praha/u-kalicha">U Kalicha</a>' in html
    for hidden in ("Čeká na ověření", "Zamítnutá", "Skončila", "Za dva měsíce"):
        assert hidden not in html

    brno_html = client.get("/akce/brno").content.decode()
    assert "Narážíme sud" in brno_html and "Hospodský kvíz" not in brno_html
    assert client.get("/akce/plzen").status_code == 404
    # The pub page carries its own events.
    assert "Hospodský kvíz" in client.get("/hospoda/praha/u-kalicha").content.decode()


def _published_route(public: bool = True) -> TourPublication:
    names = ["U Zlatého tygra", "U Pinkasů", "U Černého vola"]
    rows = []
    for index, name in enumerate(names):
        rows.append(PubDirectory.objects.create(
            name=name, lat=50.08 + index / 200, lng=14.42, city="Praha 1", country="cz", source="test",
            refreshed_at=timezone.now(),
        ))
    author = Account.objects.create(device_id=str(uuid.uuid4()), nickname="trasar", is_public=True)
    EmailCredential.objects.create(account=author, email=f"{uuid.uuid4().hex}@example.com", password="x", email_verified=True)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(author)}")
    plan_id = str(uuid.uuid4())
    stops = [
        {"id": str(uuid.uuid4()), "pub_id": f"directory:{row.cache_key}:{row.name_key}", "cache_key": row.cache_key,
         "name": row.name, "address": "Tajná adresa 12", "lat": row.lat, "lon": row.lng, "challenge": ""}
        for row in rows
    ]
    saved = api.put(f"/v1/tours/{plan_id}", {
        "operation_id": str(uuid.uuid4()), "base_revision": 0, "title": "Staré Město", "scheduled_date": None,
        "scheduled_time": None, "timezone": "Europe/Prague", "stops": stops,
    }, format="json")
    published = api.put(f"/v1/tours/{plan_id}/publication", {"revision": saved.json()["tour"]["revision"], "accept_rules": True}, format="json")
    assert published.status_code in (200, 201), published.content
    if not public:
        Account.objects.filter(pk=author.pk).update(is_public=False)
    return TourPublication.objects.get(plan_id=plan_id)


def test_route_pages_show_public_routes_without_their_author(client):
    route = _published_route()

    listing = client.get("/trasy").content.decode()
    assert "Staré Město" in listing and "trasar" not in listing
    html = client.get(f"/trasy/{route.public_id}").content.decode()
    assert "U Pinkasů" in html and "trasar" not in html and "Tajná adresa" not in html
    assert f'href="/t/{route.token}"' in html

    TourPublication.objects.filter(pk=route.pk).update(status=TourPublication.Status.HIDDEN)
    assert client.get(f"/trasy/{route.public_id}").status_code == 404


def test_a_route_whose_author_went_private_is_gone(client):
    route = _published_route(public=False)

    assert client.get(f"/trasy/{route.public_id}").status_code == 404
    assert "Staré Město" not in client.get("/trasy").content.decode()


def test_sitemap_lists_pub_pages_in_both_languages(client, settings):
    settings.PUBLIC_WEB_ORIGIN = "https://na-pivo.cz"
    _pub("U Kalicha", days_ago=3)
    save_web_pubs()

    xml = client.get("/sitemap.xml").content.decode()

    assert "<loc>https://na-pivo.cz/hospoda/praha/u-kalicha</loc>" in xml
    assert "<loc>https://na-pivo.cz/en/pub/praha/u-kalicha</loc>" in xml


@pytest.mark.parametrize(
    ("at", "expected"),
    [
        (datetime(2026, 10, 30, 23, 30), "Otevřeno do 01:00"),  # Friday evening
        (datetime(2026, 10, 31, 0, 30), "Otevřeno do 01:00"),  # past midnight, still Friday's hours
        (datetime(2026, 10, 31, 11, 0), "Otevírá v 15:00"),
        (datetime(2026, 11, 1, 18, 0), "Dnes zavřeno"),  # Sunday
    ],
)
def test_open_status_follows_hours_past_midnight(at, expected):
    week = {day: [["15:00", "23:00"]] for day in ("mo", "tu", "we", "th")} | {
        "fr": [["15:00", "01:00"]], "sa": [["15:00", "01:00"]], "su": [],
    }

    assert _open_status(week, at.replace(tzinfo=PRAGUE)) == expected

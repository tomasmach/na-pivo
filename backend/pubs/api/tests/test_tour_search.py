import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.api.tests.test_tour_publications import (  # noqa: F401
    account_client,
    directory,
    plan_body,
    publish,
    save_plan,
)
from pubs.models import Account, FriendBlock, PubDirectory, TourPublication

pytestmark = pytest.mark.django_db

PRAGUE = {"lat": 50.08, "lon": 14.42}


def published(nickname, pubs=(0, 1), title="Pátek po Starém Městě", challenges=None, body=None):
    author = account_client(nickname=nickname)
    plan_id, revision = save_plan(author, body or plan_body(pubs=pubs, title=title, challenges=challenges))
    response = publish(author, plan_id, revision)
    assert response.status_code == 200, response.content
    return author, plan_id, response.json()["publication"]


def search(client=None, **body):
    return (client or APIClient()).post("/v1/tour-publications/search", body, format="json")


def titles(response):
    return [row["title"] for row in response.json()["results"]]


def brno_body(title="Brněnský okruh"):
    rows = [PubDirectory.objects.create(name=name, lat=49.19 + index / 100, lng=16.61, cache_key="", city="Brno",
                                        country="CZ", source="test", refreshed_at=timezone.now())
            for index, name in enumerate(["Pegas", "Lokál U Caipla"])]
    body = plan_body(title=title)
    body["stops"] = [{"id": str(uuid.uuid4()), "pub_id": f"directory:{row.cache_key}:{row.name_key}", "cache_key": row.cache_key,
                      "name": row.name, "address": "", "lat": row.lat, "lon": row.lng, "challenge": ""} for row in rows]
    return body


def test_nearby_tours_come_nearest_first_with_filters():
    published("prvni", pubs=(3, 2), title="Od Černého vola")
    published("druhy", pubs=(0, 1, 2, 3), title="Celé Staré Město", challenges={0: "Zeptej se na nejstarší pípu"})
    published("treti", title="Pátek u tygra")
    published("brnak", body=brno_body())
    response = search(**PRAGUE)
    assert response.status_code == 200
    data = response.json()
    assert data["nearby"] is True and data["next_page"] is None
    # Brno is 180 km away, outside the 25 km circle.
    assert titles(response) == ["Celé Staré Město", "Pátek u tygra", "Od Černého vola"]
    assert data["results"][0]["distance_m"] == 0
    assert set(data["results"][0]) == {"id", "token", "title", "city", "stop_count", "walk_m", "has_challenges",
                                       "people_count", "author", "distance_m"}
    assert titles(search(**PRAGUE, stops="4-5")) == ["Celé Staré Město"]
    assert titles(search(**PRAGUE, challenges=True)) == ["Celé Staré Město"]
    assert titles(search(**PRAGUE, stops="6-8")) == []


def test_text_finds_names_pubs_and_cities_without_diacritics():
    published("prvni", pubs=(3, 2), title="Od vola")
    _, _, popular = published("druhy", title="Pátek u tygra")
    TourPublication.objects.filter(public_id=popular["id"]).update(people_count=12, people_count_at=timezone.now())
    published("brnak", body=brno_body())
    assert titles(search(q="tygr")) == ["Pátek u tygra"]
    assert titles(search(q="cerneho")) == ["Od vola"]
    # Every word counts on its own, in any order.
    assert titles(search(q="praha tygr")) == ["Pátek u tygra"]
    # A city search reaches beyond the 25 km circle; without a position the most walked come first.
    assert titles(search(q="praha")) == ["Pátek u tygra", "Od vola"]
    TourPublication.objects.filter(public_id=popular["id"]).update(people_count=0)
    TourPublication.objects.filter(title="Od vola").update(people_count=5, people_count_at=timezone.now())
    # With a position the nearest come first, so "Kolem mě" still means what it says.
    assert titles(search(q="praha", **PRAGUE)) == ["Pátek u tygra", "Od vola"]
    assert titles(search(q="praha")) == ["Od vola", "Pátek u tygra"]
    assert titles(search(q="PEGAS", **PRAGUE)) == ["Brněnský okruh"]
    assert search(q="pegas", **PRAGUE).json()["results"][0]["distance_m"] > 150000


def test_with_nothing_close_it_says_so_and_offers_the_nearest():
    published("brnak", body=brno_body())
    data = search(**PRAGUE).json()
    assert data["nearby"] is False
    assert [row["title"] for row in data["results"]] == ["Brněnský okruh"]
    assert search(q="nic takoveho", **PRAGUE).json()["results"] == []


def test_the_nearby_circle_is_round():
    published("blizko", title="Blízko")
    # 20 km north and 20 km east: inside the square, about 28 km away, so outside the circle.
    corner = {"lat": 50.08 - 20 / 111.32, "lon": 14.42 - 20 / (111.32 * 0.642)}
    data = search(**corner).json()
    assert data["nearby"] is False
    assert search(lat=50.08 - 20 / 111.32, lon=14.42).json()["nearby"] is True


def test_hidden_withdrawn_and_blocked_authors_stay_out():
    author, plan_id, _ = published("stazena", title="Stažená")
    author.delete(f"/v1/tours/{plan_id}/publication")
    published("skryta", title="Skrytá")
    TourPublication.objects.filter(title="Skrytá").update(status=TourPublication.Status.HIDDEN)
    troll, _, _ = published("troll", title="Od trolla")
    viewer = account_client(nickname="divak")
    FriendBlock.objects.create(blocker=troll.account, blocked=viewer.account)
    published("soukroma", title="Soukromý autor")
    Account.objects.filter(nickname="soukroma").update(is_public=False)
    assert titles(search(**PRAGUE)) == ["Od trolla"]
    assert titles(search(viewer, **PRAGUE)) == []


def test_pages_and_bad_input():
    for index in range(21):
        published(f"autor{index}", title=f"Tour {index:02}")
    first = search(**PRAGUE).json()
    assert (len(first["results"]), first["next_page"]) == (20, 1)
    second = search(**PRAGUE, page=1).json()
    assert (len(second["results"]), second["next_page"]) == (1, None)
    assert search(**PRAGUE, page=10).status_code == 400
    assert search(lat=50.08).status_code == 400
    assert search(stops="9-12").status_code == 400
    # The position never travels in a URL.
    assert APIClient().get("/v1/tour-publications/search?lat=50.08&lon=14.42").status_code == 405

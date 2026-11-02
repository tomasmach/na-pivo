"""Piva tab: public reviews, national ranking, beer page, search and collection."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.conf import settings
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.ugc_consent import UGC_POLICY_HEADER
from pubs.beer_ranking import classify_styles, refresh_beer_ranking
from pubs.models import Account, BeerProduct, ContentReport, FriendBlock, Friendship

PUB = {"name": "U Zlatého tygra", "lat": 50.0876, "lng": 14.4214}


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str | None) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    account = Account.objects.get(public_id=resp.json()["id"])
    if nickname:
        account.nickname = nickname
        account.display_name = nickname.capitalize()
        account.save(update_fields=["nickname", "display_name"])
    return resp.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _friends(a: Account, b: Account) -> None:
    Friendship.objects.create(
        requester=a, recipient=b, status=Friendship.Status.ACCEPTED, responded_at=timezone.now()
    )


def _products(n: int) -> list[BeerProduct]:
    return list(
        BeerProduct.objects.filter(active=True, brand__active=True).order_by("rank", "key")[:n]
    )


def _checkin(client, token, product: BeerProduct, rating=None, **extra):
    payload = {
        "client_id": str(uuid.uuid4()),
        "beer_name": product.name,
        "brewery_name": product.brand_name,
        "rating": rating,
        "visibility": "private",
        "checked_in_at": timezone.now().isoformat(),
    }
    payload.update(extra)
    resp = client.post("/v1/beer-checkins", data=payload, format="json", **_auth(token))
    assert resp.status_code in (200, 201), resp.content
    return resp


def _drink(client, token, beer_name: str, **extra):
    payload = {
        "client_id": str(uuid.uuid4()),
        "city": "Praha",
        "external_id": "mapy:50.0876,14.4214",
        "beer": {"name": beer_name, "price_czk": 62, "volume_ml": 500},
        "drank_at": timezone.now().replace(microsecond=0).isoformat(),
        **PUB,
    }
    payload.update(extra)
    resp = client.post("/v1/drinks", data=payload, format="json", **_auth(token))
    assert resp.status_code in (200, 201), resp.content


def _rate_many(client, product: BeerProduct, ratings: list[float]) -> list[str]:
    tokens = []
    for index, rating in enumerate(ratings):
        token, _ = _register(client, f"r{index}{uuid.uuid4().hex[:10]}")
        _checkin(
            client,
            token,
            product,
            rating=str(rating),
            tags=["crisp"] if rating >= 4 else ["watery"],
        )
        tokens.append(token)
    return tokens


# --- visibility contract ---------------------------------------------------


@pytest.mark.django_db
def test_released_checkin_payloads_still_pass(client):
    token, account = _register(client, "stary")
    product = _products(1)[0]
    # A released client sends private or friends, or omits visibility altogether.
    _checkin(client, token, product, rating="4", visibility="friends")
    payload = {"client_id": str(uuid.uuid4()), "beer_name": "Domácí kvasnicák"}
    resp = client.post("/v1/beer-checkins", data=payload, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["visibility"] == "private"


@pytest.mark.django_db
def test_public_checkin_is_opt_in_and_needs_ugc_consent_from_new_clients(client):
    token, account = _register(client, "verejny")
    product = _products(1)[0]
    resp = _checkin(client, token, product, rating="5", visibility="public")
    assert resp.json()["visibility"] == "public"

    blocked = client.post(
        "/v1/beer-checkins",
        data={"client_id": str(uuid.uuid4()), "beer_name": product.name, "visibility": "public"},
        format="json",
        HTTP_X_NA_PIVO_UGC_POLICY_VERSION=settings.UGC_POLICY_VERSION,
        **_auth(token),
    )
    assert UGC_POLICY_HEADER == "X-Na-Pivo-UGC-Policy-Version"
    assert blocked.status_code == 428


@pytest.mark.django_db
def test_friends_see_public_checkins_in_feed_and_can_cheer_public_from_strangers(client):
    owner_token, owner = _register(client, "autor")
    friend_token, friend = _register(client, "kamos")
    stranger_token, _ = _register(client, "cizi")
    _friends(owner, friend)
    product = _products(1)[0]
    checkin = _checkin(
        client, owner_token, product, rating="4", visibility="public", note="Dobrý."
    ).json()

    feed = client.get("/v1/beer-checkins/feed", **_auth(friend_token)).json()["checkins"]
    assert [row["id"] for row in feed] == [checkin["id"]]

    cheer = client.post(
        f"/v1/beer-checkins/{checkin['id']}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(stranger_token),
    )
    assert cheer.status_code == status.HTTP_200_OK
    assert cheer.json()["reactions"]["cheers"] == 1

    party_only = _checkin(
        client, owner_token, product, rating="3", visibility="friends", note="Jen pro partu."
    ).json()
    refused = client.post(
        f"/v1/beer-checkins/{party_only['id']}/react",
        data={"reaction": "cheers"},
        format="json",
        **_auth(stranger_token),
    )
    assert refused.status_code == status.HTTP_403_FORBIDDEN


# --- ranking ---------------------------------------------------------------


@pytest.mark.django_db
def test_ranking_orders_beers_counts_each_rater_once_and_reports_early(client):
    best, worst = _products(2)
    _rate_many(client, best, [5, 5, 4])
    tokens = _rate_many(client, worst, [2, 1, 2])
    # The same person changing their mind counts with the latest rating only.
    _checkin(client, tokens[0], worst, rating="5")
    _checkin(client, tokens[0], worst, rating="1")
    assert refresh_beer_ranking() == 2
    assert refresh_beer_ranking() is None

    token, _ = _register(client, "ctenar")
    body = client.get("/v1/beers/ranking", **_auth(token)).json()
    assert body["early"] is True
    assert [item["product_key"] for item in body["items"]] == [best.key, worst.key]
    top = body["items"][0]
    assert top["rank"] == 1 and top["position"] == 1 and top["rating_count"] == 3
    assert top["rating_avg"] == pytest.approx(4.67, abs=0.01)
    assert top["stars"][0] == pytest.approx(0.667, abs=0.001)
    assert top["top_tag"] == "crisp"
    assert top["move"] is None

    bottom = client.get("/v1/beers/ranking?order=bottom", **_auth(token)).json()["items"]
    assert bottom[0]["product_key"] == worst.key
    assert bottom[0]["rating_avg"] == pytest.approx(1.33, abs=0.01)
    assert bottom[0]["top_tag"] == "watery"

    assert client.get("/v1/beers/ranking?style=cider", **_auth(token)).status_code == 400
    page = client.get("/v1/beers/ranking?limit=1", **_auth(token)).json()
    assert len(page["items"]) == 1 and page["next_cursor"] == "1"
    second = client.get("/v1/beers/ranking?limit=1&cursor=1", **_auth(token)).json()
    assert second["items"][0]["position"] == 2 and second["next_cursor"] is None


@pytest.mark.django_db
def test_ranking_move_compares_with_last_week(client):
    first, second = _products(2)
    _rate_many(client, first, [5, 5, 5])
    tokens = _rate_many(client, second, [3, 3, 3])
    refresh_beer_ranking(force=True)
    for token in tokens:
        _checkin(client, token, second, rating="5")
    _rate_many(client, first, [1, 1, 1])
    refresh_beer_ranking(timezone.now() + timedelta(days=7), force=True)

    token, _ = _register(client, "tyden")
    items = client.get("/v1/beers/ranking", **_auth(token)).json()["items"]
    assert [(item["product_key"], item["move"]) for item in items] == [
        (second.key, 1),
        (first.key, -1),
    ]


@pytest.mark.django_db
def test_refresh_command_runs_once_an_hour(client):
    from io import StringIO

    out = StringIO()
    call_command("refresh_beer_ranking", stdout=out)
    call_command("refresh_beer_ranking", stdout=out)
    assert "ranked=0" in out.getvalue()


def test_style_buckets():
    assert classify_styles("Gambrinus Originál 10°", []) == ["ten"]
    assert classify_styles("Pilsner Urquell", ["světlý ležák"]) == ["lager"]
    assert classify_styles("Kozel Černý", []) == ["dark"]
    assert classify_styles("Matuška Raptor", ["IPA"]) == ["craft"]


# --- beer page ---------------------------------------------------------------


@pytest.mark.django_db
def test_beer_detail_keeps_old_fields_and_adds_global_numbers(client):
    product = _products(1)[0]
    tokens = _rate_many(client, product, [5, 4, 4])
    _drink(client, tokens[0], product.name)
    refresh_beer_ranking(force=True)

    token, _ = _register(client, "detail")
    old = client.get(
        "/v1/beers/detail",
        {"beer_name": product.name, "brewery_name": product.brand_name},
        **_auth(token),
    )
    assert old.status_code == 200
    for key in ("my_count", "party_count", "my_history", "recent_checkins", "my_tags"):
        assert key in old.json()

    body = client.get(
        "/v1/beers/detail", {"product": product.key, "lat": 50.0877, "lng": 14.4215}, **_auth(token)
    ).json()
    assert body["beer_name"] == product.name
    assert body["product_key"] == product.key
    assert body["global_rating"] == pytest.approx(4.33, abs=0.01)
    assert body["global_rating_count"] == 3
    assert body["national_rank"] == 1
    assert body["tag_shares"] == {"crisp": 100}
    assert body["drunk_total"] == 1 and body["drinkers"] == 1 and body["drunk_week"] == 1
    assert body["pubs_pouring"] == 1
    assert body["nearest_pub"]["name"] == PUB["name"]
    assert body["nearest_pub"]["distance_m"] < 50
    assert body["photo_count"] == 0

    missing = client.get("/v1/beers/detail", {"product": "no-such-beer"}, **_auth(token))
    assert missing.status_code == 400

    # By key, my check-in counts even when I typed no brewery.
    _checkin(client, token, product, rating="2", brewery_name="")
    mine = client.get("/v1/beers/detail", {"product": product.key}, **_auth(token)).json()
    assert [row["rating"] for row in mine["my_history"]] == ["2.0"]


# --- reviews ---------------------------------------------------------------


@pytest.mark.django_db
def test_reviews_show_public_and_party_check_ins_only(client):
    product = _products(1)[0]
    viewer_token, viewer = _register(client, "ja")
    friend_token, friend = _register(client, "parta")
    stranger_token, stranger = _register(client, "cizinec")
    nameless_token, _ = _register(client, None)
    hidden_token, hidden = _register(client, "blokovany")
    _friends(viewer, friend)
    FriendBlock.objects.create(blocker=viewer, blocked=hidden)

    public = _checkin(
        client, stranger_token, product, rating="3", visibility="public", note="Na čepu jiný."
    ).json()
    party = _checkin(
        client, friend_token, product, rating="5", visibility="friends", note="Pecka."
    ).json()
    _checkin(
        client,
        stranger_token,
        product,
        rating="1",
        visibility="friends",
        note="Jen pro moji partu.",
    )
    _checkin(client, stranger_token, product, rating="2", visibility="private", note="Jen pro mě.")
    _checkin(
        client, nameless_token, product, rating="4", visibility="public", note="Bez přezdívky."
    )
    _checkin(client, hidden_token, product, rating="4", visibility="public", note="Blokovaný.")
    _checkin(client, viewer_token, product, rating="4", visibility="public", note="Moje.")

    body = client.get("/v1/beers/reviews", {"product": product.key}, **_auth(viewer_token)).json()
    assert body["total"] == 2
    assert {item["id"] for item in body["items"]} == {public["id"], party["id"]}
    by_id = {item["id"]: item for item in body["items"]}
    assert by_id[party["id"]]["in_party"] is True
    assert by_id[public["id"]]["in_party"] is False
    assert by_id[public["id"]]["author"]["nickname"] == "cizinec"
    assert len(by_id[public["id"]]["day"]) == 10  # a day, never the hour

    only_party = client.get(
        "/v1/beers/reviews", {"product": product.key, "filter": "party"}, **_auth(viewer_token)
    )
    assert [item["id"] for item in only_party.json()["items"]] == [party["id"]]
    by_name = client.get(
        "/v1/beers/reviews",
        {"beer_name": product.name, "brewery_name": product.brand_name},
        **_auth(viewer_token),
    )
    assert by_name.json()["total"] == 2

    stranger.ghost_mode = True
    stranger.save(update_fields=["ghost_mode"])
    assert (
        client.get("/v1/beers/reviews", {"product": product.key}, **_auth(viewer_token)).json()[
            "total"
        ]
        == 1
    )
    assert client.get("/v1/beers/reviews", **_auth(viewer_token)).status_code == 400


@pytest.mark.django_db
def test_report_a_review_the_reporter_can_see(client):
    product = _products(1)[0]
    reporter_token, _ = _register(client, "hlasic")
    author_token, author = _register(client, "pisalek")
    public = _checkin(
        client, author_token, product, rating="1", visibility="public", note="Hnus."
    ).json()
    private = _checkin(
        client, author_token, product, rating="1", visibility="private", note="Tajné."
    ).json()

    def report(checkin_id):
        return client.post(
            "/v1/content-reports",
            data={
                "target_account_id": str(author.public_id),
                "reason": "other",
                "checkin_id": checkin_id,
            },
            format="json",
            **_auth(reporter_token),
        )

    created = report(public["id"])
    assert created.status_code == status.HTTP_201_CREATED, created.content
    report_row = ContentReport.objects.get()
    assert report_row.target_snapshot["checkin"]["note"] == "Hnus."
    assert report(private["id"]).status_code == status.HTTP_404_NOT_FOUND


# --- search and collection ---------------------------------------------------


@pytest.mark.django_db
def test_search_returns_catalogue_beers_with_their_rating(client):
    product = _products(1)[0]
    _rate_many(client, product, [4, 4, 5])
    refresh_beer_ranking(force=True)
    token, _ = _register(client, "hledac")

    empty = client.get("/v1/beers/search", **_auth(token)).json()["items"]
    assert empty[0]["product_key"] == product.key
    found = client.get("/v1/beers/search", {"q": product.name}, **_auth(token)).json()["items"]
    hit = next(item for item in found if item["product_key"] == product.key)
    assert hit["rating_count"] == 3
    assert hit["rating_avg"] == pytest.approx(4.33, abs=0.01)


@pytest.mark.django_db
def test_collection_counts_my_beers_taster_and_where_i_disagree(client):
    first, second, third = _products(3)
    _rate_many(client, first, [5, 5, 5])
    _rate_many(client, second, [4, 4, 4])
    refresh_beer_ranking(force=True)

    token, _ = _register(client, "sberatel")
    _drink(client, token, first.name)
    _drink(client, token, first.name)
    _drink(client, token, third.name)
    _checkin(client, token, first, rating="2")

    body = client.get("/v1/beers/collection", **_auth(token)).json()
    assert body["drunk_total"] == 3
    assert body["distinct_beers"] == 2
    assert body["breweries"] >= 1
    assert body["taster"] == {
        "level": 1,
        "tier": 10,
        "target": 2,
        "have": 1,
        "missing": {"product_key": second.key, "name": second.name, "nearest_distance_m": None},
    }
    assert body["against"] == [
        {"product_key": first.key, "name": first.name, "rating_avg": 5.0, "my_rating": 2.0}
    ]
    assert body["unrated"] == [
        {"product_key": third.key, "name": third.name, "brand_name": third.brand_name, "count": 1}
    ]


@pytest.mark.django_db
def test_beer_watch_list_says_where_the_beer_pours_within_radius(client):
    product = _products(1)[0]
    token, _ = _register(client, "hlidac")
    _drink(client, token, product.name)
    assert client.post(
        "/v1/beer-watches", {"beer_name": product.name}, format="json", **_auth(token)
    ).status_code in (
        200,
        201,
    )
    no_location = client.get("/v1/beer-watches", **_auth(token)).json()["watches"][0]
    assert no_location["nearest"] is None

    state = client.patch(
        "/v1/beer-watches/settings", {"lat": 50.0876, "lng": 14.4214}, format="json", **_auth(token)
    ).json()
    nearest = state["watches"][0]["nearest"]
    assert nearest["pub_name"] == PUB["name"]
    assert nearest["distance_m"] <= 3000


@pytest.mark.django_db
def test_beer_detail_and_reviews_show_only_photos_the_viewer_may_see(client, tmp_path, settings):
    import io

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    settings.MEDIA_ROOT = str(tmp_path / "media")
    product = _products(1)[0]
    viewer_token, _ = _register(client, "divak")
    author_token, _ = _register(client, "fotograf")

    def upload(visibility: str) -> None:
        buf = io.BytesIO()
        Image.new("RGB", (300, 200), (200, 150, 40)).save(buf, format="JPEG")
        resp = client.post(
            "/v1/beer-photos",
            data={
                "client_id": str(uuid.uuid4()),
                "caption": "",
                "visibility": visibility,
                "beer_name": product.name,
                "image": SimpleUploadedFile("beer.jpg", buf.getvalue(), content_type="image/jpeg"),
            },
            format="multipart",
            **_auth(author_token),
        )
        assert resp.status_code == 201, resp.content

    review = _checkin(
        client, author_token, product, rating="4", visibility="public", note="Hezká pěna."
    ).json()

    upload("private")
    detail = client.get("/v1/beers/detail", {"product": product.key}, **_auth(viewer_token)).json()
    assert detail["photo_count"] == 0
    reviews = client.get(
        "/v1/beers/reviews", {"product": product.key}, **_auth(viewer_token)
    ).json()
    assert reviews["items"][0]["photo_url"] is None
    with_photo = client.get(
        "/v1/beers/reviews", {"product": product.key, "filter": "photo"}, **_auth(viewer_token)
    ).json()
    assert with_photo["total"] == 0

    upload("public")
    detail = client.get("/v1/beers/detail", {"product": product.key}, **_auth(viewer_token)).json()
    assert detail["photo_count"] == 1
    with_photo = client.get(
        "/v1/beers/reviews", {"product": product.key, "filter": "photo"}, **_auth(viewer_token)
    ).json()
    assert [item["id"] for item in with_photo["items"]] == [review["id"]]
    assert with_photo["items"][0]["photo_url"].startswith("http")


@pytest.mark.django_db
def test_regional_ranking_counts_where_the_beer_was_rated_and_drunk(client):
    from pubs.enrichment.matcher import geohash8

    prague = geohash8(50.0876, 14.4214)
    brno = geohash8(49.1951, 16.6068)
    pilsner, kozel = _products(2)

    def rate(product: BeerProduct, rating: str, cell: str) -> None:
        token, _ = _register(client, f"k{uuid.uuid4().hex[:10]}")
        _checkin(client, token, product, rating=rating, pub_cache_key=cell)

    for rating in ("5", "5", "4"):
        rate(pilsner, rating, brno)
    for rating in ("3", "3", "3"):
        rate(kozel, rating, brno)
    for rating in ("2", "2", "2"):
        rate(pilsner, rating, prague)
    token, _ = _register(client, "pije")
    _drink(client, token, pilsner.name)
    refresh_beer_ranking(force=True)

    south = client.get("/v1/beers/ranking", {"region": "CZ064"}, **_auth(token)).json()
    assert [item["product_key"] for item in south["items"]] == [pilsner.key, kozel.key]
    assert south["items"][0]["rating_avg"] == pytest.approx(4.67, abs=0.01)
    assert south["items"][0]["rating_count"] == 3
    assert south["items"][0]["move"] is None

    capital = client.get("/v1/beers/ranking", {"region": "CZ010"}, **_auth(token)).json()
    assert [item["product_key"] for item in capital["items"]] == [pilsner.key]
    assert capital["items"][0]["rating_avg"] == 2
    assert capital["items"][0]["drunk_total"] == 1

    # Without a region the ranking stays national, as released clients read it.
    national = client.get("/v1/beers/ranking", **_auth(token)).json()
    assert {item["product_key"] for item in national["items"]} == {pilsner.key, kozel.key}
    assert (
        next(i for i in national["items"] if i["product_key"] == pilsner.key)["rating_count"] == 6
    )

    bad = client.get("/v1/beers/ranking", {"region": "SK010"}, **_auth(token))
    assert bad.status_code == 400

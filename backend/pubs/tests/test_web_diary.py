"""Web diary: pages read DrinkLog like the app, writes go through the app's own /v1/ endpoints."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from django.test import Client
from rest_framework.test import APIClient

from pubs.api.stats import compute_my_stats
from pubs.models import Account, DrinkLog, PubVisit
from pubs.web import diary as d
from pubs.web.badges import BADGES

pytestmark = pytest.mark.django_db

PRAGUE = ZoneInfo("Europe/Prague")
PASSWORD = "Pivo-je-zivot-12"
PUB = {"name": "U Pinkasů", "lat": 50.0832, "lng": 14.4237, "city": "Praha"}
REPO = Path(__file__).resolve().parents[3]


def _web(email: str = "stamgast@example.com") -> tuple[Client, Account, str]:
    """A signed-in browser (CSRF enforced) and the account behind it."""

    client = Client(enforce_csrf_checks=True)
    client.get("/registrace")
    csrf = client.cookies["csrftoken"].value
    response = client.post(
        "/registrace",
        {"display_name": "Tomáš", "email": email, "password": PASSWORD, "csrfmiddlewaretoken": csrf},
    )
    assert response.status_code == 302, response.content
    account = Account.objects.get(email_credential__email=email)
    return client, account, client.cookies["csrftoken"].value


def _bearer(email: str) -> str:
    response = APIClient().post("/v1/auth/login", {"email": email, "password": PASSWORD}, format="json")
    return response.json()["token"]


def _drink(client, at: datetime, *, csrf: str | None = None, token: str | None = None, pub: bool = True, **body):
    payload = {"client_id": str(uuid.uuid4()), "beer": {"name": "Domácí ležák 11°", "price_czk": 59, "volume_ml": 500},
               "drank_at": at.isoformat(), **(PUB if pub else {}), **body}
    headers = {"HTTP_X_CSRFTOKEN": csrf} if csrf else {}
    if token:
        headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client.post("/v1/drinks", payload, content_type="application/json", **headers)


def _local(day_offset: int, hour: int, minute: int = 0) -> datetime:
    today = d.today()
    day = today - timedelta(days=day_offset)
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=PRAGUE)


def test_diary_pages_need_sign_in():
    for path in ("/denik", "/denik/zapsat", "/denik/vecer/2026-10-24", "/profil", "/en/diary"):
        response = Client().get(path)
        assert response.status_code == 302 and response["Location"].startswith(("/prihlaseni?next=", "/en/login?next="))


def test_web_logs_a_beer_through_v1_drinks_once_with_csrf_and_xp():
    client, account, csrf = _web()
    at = _local(2, 20)
    assert _drink(client, at).status_code == 403  # no CSRF token

    payload_id = str(uuid.uuid4())
    first = _drink(client, at, csrf=csrf, client_id=payload_id)
    assert first.status_code == 201 and first.json()["duplicate"] is False
    xp = first.json()["pivar"]["xp"]
    assert first.json()["pivar"]["xp_awarded"] > 0

    # A double submit or retry re-sends the same client_id: no second beer, no second XP.
    again = _drink(client, at, csrf=csrf, client_id=payload_id)
    assert again.status_code == 200 and again.json()["duplicate"] is True
    assert again.json()["pivar"]["xp"] == xp
    assert DrinkLog.objects.filter(account=account).count() == 1


def test_released_bearer_payloads_are_unchanged_and_bearer_wins_over_the_session():
    client, web_account, _csrf = _web("web@example.com")
    _web("app@example.com")
    app_token = _bearer("app@example.com")
    # The released app's body: no place_context, no drank_at, bearer only.
    released = {"client_id": str(uuid.uuid4()), **PUB, "beer": {"name": "Hořký kocour 12°", "price_czk": 52, "volume_ml": 500}}
    response = APIClient().post("/v1/drinks", released, format="json", HTTP_AUTHORIZATION=f"Bearer {app_token}")
    assert response.status_code == 201
    # A request carrying both lands on the bearer account and skips the session's CSRF check.
    both = client.post("/v1/drinks", {**released, "client_id": str(uuid.uuid4())}, content_type="application/json",
                       HTTP_AUTHORIZATION=f"Bearer {app_token}")
    assert both.status_code == 201
    assert DrinkLog.objects.filter(account=web_account).count() == 0
    assert DrinkLog.objects.filter(account__email_credential__email="app@example.com").count() == 2


def test_web_session_upserts_and_deletes_a_visit_like_the_app():
    client, account, csrf = _web()
    started = _local(3, 19)
    visit_id = str(uuid.uuid4())
    body = {"client_id": visit_id, **PUB, "started_at": started.isoformat(), "ended_at": (started + timedelta(hours=1)).isoformat(),
            "closed_at": (started + timedelta(hours=1)).isoformat(), "updated_at": datetime.now(PRAGUE).isoformat()}
    assert client.post("/v1/pub-visits", body, content_type="application/json").status_code == 403
    assert client.post("/v1/pub-visits", body, content_type="application/json", HTTP_X_CSRFTOKEN=csrf).status_code == 201
    assert PubVisit.objects.filter(account=account, client_id=visit_id).exists()
    gone = client.delete(f"/v1/pub-visits/{visit_id}", {"updated_at": datetime.now(PRAGUE).isoformat()},
                         content_type="application/json", HTTP_X_CSRFTOKEN=csrf)
    assert gone.status_code == 200 and not PubVisit.objects.filter(account=account, client_id=visit_id).exists()


def test_pending_deletion_ends_web_writes():
    client, account, csrf = _web()
    token = _bearer("stamgast@example.com")
    assert APIClient().delete("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {token}").status_code == 204
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert _drink(client, _local(1, 20), csrf=csrf).status_code in (401, 403)
    assert DrinkLog.objects.filter(account=account).count() == 0


def test_diary_groups_a_night_by_the_drinking_day(django_assert_max_num_queries):
    client, account, csrf = _web()
    # 23:30 and 01:30 belong to one night: the drinking day rolls at 04:00, as in the app.
    late, after_midnight = _local(5, 23, 30), _local(4, 1, 30)
    assert _drink(client, late, csrf=csrf).status_code == 201
    assert _drink(client, after_midnight, csrf=csrf, beer={"name": "Hořký kocour 12°", "price_czk": 52, "volume_ml": 500}).status_code == 201
    assert _drink(client, _local(4, 20), csrf=csrf, pub=False, place_context="private").status_code == 201

    day = d.drinking_day(late)
    with django_assert_max_num_queries(12):
        page = client.get(f"/denik?obdobi=mesic&den={day.isoformat()}")
    assert page.status_code == 200
    rows = page.context["nights"]
    assert [row["beers"] for row in rows[:2]] == [1, 2]
    assert rows[1]["url"] == f"/denik/vecer/{day.isoformat()}" and rows[1]["meta"] == "U Pinkasů"

    detail = client.get(f"/denik/vecer/{day.isoformat()}")
    html = detail.content.decode()
    assert detail.status_code == 200 and "Hořký kocour 12°" in html and "Domácí ležák 11°" in html
    assert [x["time"] for x in detail.context["drinks"]] == ["23:30", "01:30"]
    assert detail["Cache-Control"] == "private, no-store" and detail["X-Robots-Tag"] == "noindex, nofollow"

    stats = compute_my_stats(account)
    nights = d.nights_of(d.load_drinks(account))
    assert len(nights) == stats["total_nights"] and sum(n.beers for n in nights) == stats["total_beers"]


def test_a_night_of_another_account_is_not_shown():
    other, _account, other_csrf = _web("jiny@example.com")
    at = _local(2, 20)
    assert _drink(other, at, csrf=other_csrf).status_code == 201
    mine, _me, _csrf = _web("ja@example.com")
    response = mine.get(f"/denik/vecer/{d.drinking_day(at).isoformat()}")
    assert response.status_code == 404 and "U Pinkasů" not in response.content.decode()


def test_log_page_offers_recent_pubs_and_the_visit_to_append_to():
    client, account, csrf = _web()
    at = _local(1, 19)
    assert _drink(client, at, csrf=csrf).status_code == 201
    visit_id = str(uuid.uuid4())
    client.post("/v1/pub-visits", {"client_id": visit_id, **PUB, "started_at": at.isoformat(), "updated_at": at.isoformat()},
                content_type="application/json", HTTP_X_CSRFTOKEN=csrf)
    page = client.get(f"/denik/zapsat?den={d.drinking_day(at).isoformat()}")
    data = page.context["data"]
    assert page.context["heading"] == "Dopsat večer"
    assert data["pubs"][0]["name"] == "U Pinkasů" and data["beer"]["name"] == "Domácí ležák 11°"
    assert data["visits"] == [{"client_id": visit_id, "key": data["pubs"][0]["key"], "day": d.drinking_day(at).isoformat(),
                               "started_at": data["visits"][0]["started_at"], "ended_at": None}]


def test_profile_matches_the_apps_stats_and_badges():
    client, account, csrf = _web()
    for offset, hour in ((10, 19), (10, 20), (3, 21)):
        assert _drink(client, _local(offset, hour), csrf=csrf).status_code == 201
    page = client.get("/profil")
    assert page.status_code == 200
    stats = compute_my_stats(account)
    values = [s["value"] for s in page.context["stats"]]
    assert page.context["headline"]["value"] == str(stats["total_beers"])
    assert values[:2] == [str(stats["distinct_pubs"]), str(stats["total_evenings"])]
    assert "Čárkař I" in [b["name"] for b in page.context["badges"]]
    assert client.get("/en/profile").status_code == 200


def test_badge_tiers_match_the_app():
    model = (REPO / "src/profile/badgeModel.ts").read_text()
    consts = dict(re.findall(r"const (\w+_SLOTS) = (\d+);", model))
    app = {
        key: tuple(int(consts.get(x.strip(), x)) for x in tiers.split(","))
        for key, tiers in re.findall(r"key: '(\w+)',\s*group: '\w+',\s*tiers: \[([^\]]+)\]", model)
    }
    party = re.search(r"PARTY_TIERS = \[([^\]]+)\]", (REPO / "src/newlook/screens/profil/profilModel.ts").read_text())
    app["partyEvenings"] = tuple(int(x) for x in party.group(1).split(","))
    assert len(app) == len(BADGES)
    assert {b.key: b.tiers for b in BADGES} == app


def test_log_page_preselects_the_pub_a_pub_page_links_to():
    from django.utils import timezone

    from pubs.models import PubDirectory

    kalich = PubDirectory.objects.create(name="U Kalicha", lat=50.0753, lng=14.4251, city="Praha 2", country="cz",
                                         source="test", refreshed_at=timezone.now())
    PubDirectory.objects.create(name="Kalich II", lat=50.0753, lng=14.4251, city="Praha 2", country="cz",
                                source="test", refreshed_at=timezone.now())
    client, _, _ = _web()

    linked = client.get(f"/denik/zapsat?hospoda={kalich.cache_key}&n=U%20Kalicha").context["data"]["pubs"][0]
    assert (linked["key"], linked["name"], linked["linked"]) == (kalich.cache_key, "U Kalicha", True)
    assert (linked["lat"], linked["lng"]) == (50.0753, 14.4251)
    # Two pubs share the cell: the name picks the other one.
    assert client.get(f"/denik/zapsat?hospoda={kalich.cache_key}&n=Kalich%20II").context["data"]["pubs"][0]["name"] == "Kalich II"
    for bad in ("zzzzzzzz", "nonsense", ""):
        assert client.get(f"/en/diary/log?hospoda={bad}").context["data"]["pubs"] == []


def test_night_goes_up_on_the_taproom_from_the_web_like_from_the_app():
    client, me, csrf = _web()
    friend, friend_account, _ = _web("kamos@example.com")
    for account, nick in ((me, "tomas"), (friend_account, "kamos")):
        account.nickname = nick
        account.save(update_fields=["nickname"])
    token = _bearer("kamos@example.com")
    assert APIClient().post("/v1/friends/requests", {"nickname": "tomas"}, format="json",
                            HTTP_AUTHORIZATION=f"Bearer {token}").status_code == 201
    request_id = client.get("/v1/friends").json()["incoming_requests"][0]["id"]
    assert client.post(f"/v1/friends/requests/{request_id}/accept", content_type="application/json",
                       HTTP_X_CSRFTOKEN=csrf).status_code == 200
    for minute in (0, 40, 95):
        assert _drink(client, _local(1, 19, 0) + timedelta(minutes=minute), csrf=csrf).status_code == 201
    day = d.drinking_day(_local(1, 19))

    page = client.get(f"/denik/vecer/{day.isoformat()}")
    publish = page.context["publish"]
    payload = publish["night"]
    assert publish["published"] is None and "Vyvěsit na Výčep" in page.content.decode()
    assert payload == {
        "client_id": f"night-{day.isoformat()}", "drinking_day": day.isoformat(),
        "started_at": payload["started_at"], "ended_at": payload["ended_at"], "beer_count": 3, "wine_count": 0,
        "soft_drink_count": 0, "shot_count": 0, "pub_names": ["U Pinkasů"], "city": "Praha", "duration_minutes": 95,
    }

    body = {**payload, "visibility": "friends", "updated_at": datetime.now(PRAGUE).isoformat()}
    assert client.post("/v1/nights", body, content_type="application/json").status_code == 403
    assert client.post("/v1/nights", body, content_type="application/json", HTTP_X_CSRFTOKEN=csrf).status_code == 201
    feed = friend.get("/v1/nights/feed?scope=friends").json()["nights"]
    assert [(n["author"]["nickname"], n["beer_count"], n["visibility"]) for n in feed] == [("tomas", 3, "friends")]
    assert "Visí na Výčepu partě" in client.get(f"/denik/vecer/{day.isoformat()}").content.decode()

    assert client.delete(f"/v1/nights/{payload['client_id']}", HTTP_X_CSRFTOKEN=csrf).status_code in (200, 204)
    assert friend.get("/v1/nights/feed?scope=friends").json()["nights"] == []


def test_released_app_still_publishes_a_night_with_its_bearer_token():
    _, me, csrf = _web()
    token = _bearer("stamgast@example.com")
    day = d.drinking_day(_local(1, 19)).isoformat()
    body = {"client_id": f"night-{day}", "drinking_day": day, "started_at": _local(1, 19).isoformat(),
            "ended_at": _local(1, 21).isoformat(), "beer_count": 2, "wine_count": 0, "soft_drink_count": 0,
            "shot_count": 0, "pub_names": ["U Pinkasů"], "visibility": "friends", "updated_at": _local(1, 21).isoformat()}
    response = APIClient().post("/v1/nights", body, format="json", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert response.status_code == 201 and response.json()["night"]["beer_count"] == 2


def test_beers_logged_in_one_go_have_no_time_at_the_table():
    client, _, csrf = _web()
    for second in (0, 20):
        assert _drink(client, _local(1, 19) + timedelta(seconds=second), csrf=csrf).status_code == 201
    page = client.get(f"/denik/vecer/{d.drinking_day(_local(1, 19)).isoformat()}")
    assert [stat["label"] for stat in page.context["stats"]] == ["piva", "útrata", "hospoda"]
    assert "duration_minutes" not in page.context["publish"]["night"]

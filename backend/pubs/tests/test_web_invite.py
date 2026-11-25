"""Guest link of a plan: people without an account answer Jdu / Možná / Nejdu.

What hurts most if it breaks, first: a home address must never reach the link,
released apps must read the same plan payload, one browser keeps one answer;
then limits, honest closed states and the host's view in the app.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone
from rest_framework.test import APIClient

from pubs import accounts
from pubs.api.throttling import SharedScopedRateThrottle
from pubs.api.views import PRAGUE_TZ
from pubs.models import (
    Account,
    FriendNotification,
    FriendPlanGuest,
    FriendPubActivity,
    Friendship,
)
from pubs.plan_guests import clean_guest_name
from pubs.web import invite_views

pytestmark = pytest.mark.django_db

ADDRESS = "Bořivojova 54, Praha 3"
RELEASED_ACTIVITY_KEYS = {
    "id", "account", "cache_key", "name", "city", "external_id", "message", "kind", "scheduled_for",
    "started_at", "expires_at", "active", "responses", "my_response", "reactions", "my_reaction",
    "created_at", "updated_at",
}
RELEASED_PEOPLE_KEYS = {"going", "maybe", "cant", "maybe_count", "cant_count", "silent"}


def _account(api: APIClient, display: str, nickname: str) -> tuple[str, Account]:
    response = api.post("/v1/account", {"device_id": str(uuid.uuid4())}, format="json")
    token = response.json()["token"]
    api.patch("/v1/account/me", {"display_name": display, "nickname": nickname}, format="json",
              HTTP_AUTHORIZATION=f"Bearer {token}")
    return token, Account.objects.get(public_id=response.json()["id"])


def _auth(token: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def party():
    api = APIClient()
    host = _account(api, "Marek Dvořák", "marek")
    jana = _account(api, "Jana Malá", "jana")
    petra = _account(api, "Petra Krátká", "petra")
    for _token, friend in (jana, petra):
        Friendship.objects.create(requester=host[1], recipient=friend, status=Friendship.Status.ACCEPTED)
    return {"api": api, "host": host, "jana": jana, "petra": petra}


def _plan(party, **extra) -> dict:
    body = {
        "client_id": str(uuid.uuid4()),
        "place_kind": "pub",
        "name": "Lokál Dlouhááá",
        "lat": 50.0904,
        "lng": 14.4271,
        "city": "Praha 1",
        "message": "Držím stůl u okna.",
        "scheduled_for": (timezone.now() + timedelta(days=2)).isoformat(),
        **extra,
    }
    body = {key: value for key, value in body.items() if value is not None}
    response = party["api"].post("/v1/friends/pub-activity", body, format="json", **_auth(party["host"][0]))
    assert response.status_code == 201, response.content
    return response.json()


def _path(invite_url: str) -> str:
    return invite_url.split("na-pivo.cz", 1)[-1]


def _answer(client: Client, path: str, name: str = "Ondra", response: str = "going"):
    return client.post(path, {"name": name, "response": response})


def test_host_gets_a_link_and_a_home_address_never_reaches_it(party):
    plan = _plan(party, place_kind="home", name="U @marek doma", address=ADDRESS, lat=None, lng=None)
    assert plan["invite_url"].startswith("https://na-pivo.cz/pozvanka/")
    invitee = party["api"].get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(party["jana"][0])).json()
    assert invitee["invite_url"] is None
    assert invitee["address"] == ADDRESS  # invitees keep reading it in the app

    path = _path(plan["invite_url"])
    page = Client().get(path)
    html = page.content.decode()
    assert page.status_code == 200
    assert "U @marek doma" in html and "Marek tě zve na pivo" in html
    assert "Bořivojova" not in html and "Navigovat" not in html
    calendar = Client().get(f"{path}/kalendar.ics").content.decode()
    assert "Bořivojova" not in calendar and "LOCATION:U @marek doma" in calendar
    assert page.headers["Referrer-Policy"] == "no-referrer"
    assert "noindex" in page.headers["X-Robots-Tag"]


def test_link_is_the_same_on_every_read_and_unguessable(party):
    plan = _plan(party)
    again = party["api"].get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(party["host"][0])).json()
    assert again["invite_url"] == plan["invite_url"]
    token = plan["invite_url"].rsplit("/", 1)[-1]
    assert len(token) >= 24
    assert FriendPubActivity.objects.get(public_id=plan["id"]).guest_token_hash != token
    other = "y" if token.endswith("x") else "x"
    assert Client().get(f"/pozvanka/{token[:-1]}{other}").status_code == 404


def test_guest_sees_who_goes_like_an_invitee(party):
    plan = _plan(party)
    party["api"].post(f"/v1/friends/pub-activity/{plan['id']}/respond", {"response": "going"},
                      format="json", **_auth(party["jana"][0]))
    party["api"].post(f"/v1/friends/pub-activity/{plan['id']}/respond", {"response": "maybe"},
                      format="json", **_auth(party["petra"][0]))
    html = Client().get(_path(plan["invite_url"])).content.decode()
    assert "Marek a Jana jdou, 1 možná" in html
    assert "Petra" not in html  # a maybe is a count, as invitees see it
    # The list under the count accounts for every maybe, without a name.
    assert "2 jdou · 1 možná" in html
    assert '<span class="iv-who__name">1 další</span>' in html
    assert "Dvořák" not in html and "@jana" not in html


def test_one_browser_keeps_one_answer_and_the_host_hears_once(party):
    plan = _plan(party)
    path = _path(plan["invite_url"])
    browser = Client()
    browser.get(path)
    assert _answer(browser, path).status_code == 303
    assert _answer(browser, path, name="Ondra K.", response="maybe").status_code == 303
    assert _answer(browser, path, name="Ondra K.", response="going").status_code == 303
    guest = FriendPlanGuest.objects.get()
    assert (guest.name, guest.response) == ("Ondra K.", "going")
    pushes = FriendNotification.objects.filter(recipient=party["host"][1], kind="friend_rsvp")
    assert sorted(n.title for n in pushes) == ["Host Ondra K. už jde za tebou", "Host Ondra už jde za tebou"]

    assert _answer(Client(), path, name="Lucka").status_code == 303
    assert FriendPlanGuest.objects.count() == 2
    page = browser.get(path).content.decode()
    assert "Platí. Marek s tebou počítá." in page and "Změnit odpověď" in page


def test_host_and_invitees_see_guests_in_the_app_without_changing_released_fields(party):
    # Tonight, so the released dashboard lists it in its "plans" slice.
    now = timezone.now()
    midnight = timezone.localtime(now, PRAGUE_TZ).replace(hour=23, minute=59, second=0, microsecond=0)
    plan = _plan(party, scheduled_for=min(now + timedelta(minutes=30), midnight).isoformat())
    path = _path(plan["invite_url"])
    _answer(Client(), path, name="Ondra")
    _answer(Client(), path, name="Lucka", response="maybe")

    host = party["api"].get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(party["host"][0])).json()
    assert [(g["name"], g["response"]) for g in host["people"]["guests"]] == [("Ondra", "going"), ("Lucka", "maybe")]
    assert set(host["people"]) == RELEASED_PEOPLE_KEYS | {"guests"}
    # The released roster counts friends only, exactly as before.
    assert host["responses"]["going"] == 0 and host["responses"]["maybe"] == 0

    invitee = party["api"].get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(party["jana"][0])).json()
    assert [g["name"] for g in invitee["people"]["guests"]] == ["Ondra"]

    rsvp = party["api"].post(f"/v1/friends/pub-activity/{plan['id']}/respond", {"response": "going"},
                             format="json", **_auth(party["jana"][0])).json()
    assert set(rsvp) == RELEASED_ACTIVITY_KEYS
    dashboard = party["api"].get("/v1/friends", **_auth(party["jana"][0])).json()
    released_plan = next(row for row in dashboard["plans"] if row["id"] == plan["id"])
    assert "guests" not in released_plan and "invite_url" not in released_plan


@pytest.mark.parametrize(
    "raw",
    ["", " a ", "https://spam.cz", "www.pivo.cz", "pivo.cz", "@marek", "admin", "x" * 31, "1234"],
)
def test_guest_name_rules_reject(raw):
    with pytest.raises(ValueError):
        clean_guest_name(raw)


def test_guest_name_rules_keep_a_normal_name():
    assert clean_guest_name("  Ondra   K.​ ") == "Ondra K."
    assert clean_guest_name("J.Novák") == "J.Novák"


def test_bad_name_shows_the_form_again(party):
    path = _path(_plan(party)["invite_url"])
    page = _answer(Client(), path, name="https://spam.cz")
    assert page.status_code == 400
    assert "Jméno nesmí obsahovat odkaz ani adresu." in page.content.decode()
    assert not FriendPlanGuest.objects.exists()


def test_guest_cap_and_network_limit(party, monkeypatch):
    path = _path(_plan(party)["invite_url"])
    monkeypatch.setattr(invite_views, "MAX_GUESTS", 1)
    assert _answer(Client(), path, name="Ondra").status_code == 303
    assert _answer(Client(), path, name="Lucka").status_code == 400
    assert FriendPlanGuest.objects.count() == 1

    monkeypatch.setitem(SharedScopedRateThrottle.THROTTLE_RATES, "plan_guest", "1/hour")
    browser = Client()
    assert _answer(browser, path, name="Ondra", response="maybe").status_code in (303, 400)
    blocked = _answer(browser, path, name="Ondra", response="cant")
    assert blocked.status_code == 400
    assert "Moc odpovědí za sebou" in blocked.content.decode()


def test_closed_plans_say_so_honestly(party):
    cancelled = _plan(party)
    party["api"].delete(f"/v1/friends/pub-activity/{cancelled['id']}", **_auth(party["host"][0]))
    page = Client().get(_path(cancelled["invite_url"]))
    assert page.status_code == 410 and "Tenhle plán se zrušil" in page.content.decode()

    ended = _plan(party)
    FriendPubActivity.objects.filter(public_id=ended["id"]).update(expires_at=timezone.now() - timedelta(minutes=1))
    page = Client().get(_path(ended["invite_url"]))
    assert page.status_code == 410 and "Tenhle večer už skončil" in page.content.decode()
    assert _answer(Client(), _path(ended["invite_url"])).status_code == 410

    assert Client().get("/pozvanka/neexistuje1234567890").status_code == 404


def test_page_query_count_stays_flat(party, django_assert_max_num_queries):
    plan = _plan(party)
    path = _path(plan["invite_url"])
    for name in ("Ondra", "Lucka", "Pepa", "Kuba"):
        _answer(Client(), path, name=name)
    with django_assert_max_num_queries(12):
        assert Client().get(path).status_code == 200


def test_share_image_and_english_page(party):
    plan = _plan(party, name="Hostinec U Zlatého tygra a jeho velmi dlouhé jméno")
    path = _path(plan["invite_url"])
    image = Client().get(f"{path}/og.png")
    assert image.status_code == 200 and image.content[:8] == b"\x89PNG\r\n\x1a\n"
    english = Client().get(path.replace("/pozvanka/", "/en/invite/"))
    assert english.status_code == 200
    assert "og.png" in english.content.decode()


def test_guests_follow_the_plan_on_merge_and_go_with_the_account(party):
    plan = _plan(party)
    path = _path(plan["invite_url"])
    _answer(Client(), path, name="Ondra")
    source = FriendPubActivity.objects.get(public_id=plan["id"])
    target = FriendPubActivity.objects.create(
        account=party["host"][1], client_id=uuid.uuid4(), cache_key="", name="Jinde", lat=50, lng=14,
        started_at=timezone.now(), expires_at=timezone.now() + timedelta(hours=3),
    )
    accounts._merge_friend_activity_tree(source, target)
    assert list(FriendPlanGuest.objects.values_list("activity_id", flat=True)) == [target.pk]

    accounts.hard_delete(party["host"][1])
    assert not FriendPlanGuest.objects.exists()


def test_plan_invite_tokens_stay_out_of_the_request_log():
    from pubs.privacy import redact_party_codes

    for path in ("/pozvanka/b7vvMjB9X1Cg", "/en/invite/b7vv-MjB9_X1/og.png", "/pozvanka/b7vvMjB9X1Cg/kalendar.ics"):
        assert "b7vv" not in redact_party_codes(path)

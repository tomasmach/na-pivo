"""New-look Parta: plans v2, plan detail, reminders, pings, home evenings.

What hurts most if it breaks, first: a released client's plan payload must keep
working and keep its one-plan meaning; a home address must never leak beyond
the invitees; then the new flows themselves.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    DrinkLog,
    FriendBlock,
    FriendHomeCheckin,
    FriendNotification,
    FriendPubActivity,
    Friendship,
    PubVisit,
)

LAT, LNG = 50.0876, 14.4214
ADDRESS = "Bořivojova 54, Praha 3"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=resp.json()["id"])
    account.nickname = nickname
    account.save(update_fields=["nickname"])
    return resp.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _befriend(a: Account, b: Account) -> None:
    Friendship.objects.create(requester=a, recipient=b, status=Friendship.Status.ACCEPTED)


@pytest.fixture
def party(client):
    host_token, host = _register(client, "klara")
    guest_token, guest = _register(client, "jirka")
    other_token, other = _register(client, "petra")
    _befriend(host, guest)
    _befriend(host, other)
    _befriend(guest, other)
    return {
        "host": (host_token, host),
        "guest": (guest_token, guest),
        "other": (other_token, other),
    }


def _home_plan(client, token, *, days=3, recipients=None, client_id=None, scheduled=True):
    body = {
        "client_id": client_id or str(uuid.uuid4()),
        "place_kind": "home",
        "name": "U @klara doma",
        "address": ADDRESS,
        "message": "Vařím guláš.",
    }
    if scheduled:
        body["scheduled_for"] = (timezone.now() + timedelta(days=days)).isoformat()
    if recipients is not None:
        body["recipient_ids"] = [str(r.public_id) for r in recipients]
    return client.post("/v1/friends/pub-activity", data=body, format="json", **_auth(token))


@pytest.mark.django_db
def test_released_plan_payload_still_creates_one_todays_plan(client, party):
    token, host = party["host"]
    guest_token, _ = party["guest"]
    soon = (timezone.now() + timedelta(hours=2)).isoformat()
    legacy = {
        "client_id": str(uuid.uuid4()),
        "name": "U Zlatého tygra",
        "lat": LAT,
        "lng": LNG,
        "city": "Praha",
        "external_id": "",
        "message": "",
        "scheduled_for": soon,
    }
    resp = client.post("/v1/friends/pub-activity", data=legacy, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["kind"] == "plan"
    # A second released plan replaces the first, exactly as before.
    resp2 = client.post(
        "/v1/friends/pub-activity",
        data={**legacy, "client_id": str(uuid.uuid4()), "name": "Lokál"},
        format="json",
        **_auth(token),
    )
    assert resp2.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)
    assert FriendPubActivity.objects.filter(account=host, active=True, kind="plan").count() == 1
    dashboard = client.get("/v1/friends", **_auth(guest_token)).json()
    assert [plan["name"] for plan in dashboard["plans"]] == ["Lokál"]


@pytest.mark.django_db
def test_released_plan_does_not_replace_a_new_look_plan(client, party):
    token, host = party["host"]
    assert _home_plan(client, token).status_code == status.HTTP_201_CREATED
    legacy = {
        "client_id": str(uuid.uuid4()),
        "name": "U Zlatého tygra",
        "lat": LAT,
        "lng": LNG,
        "scheduled_for": (timezone.now() + timedelta(hours=2)).isoformat(),
    }
    assert client.post("/v1/friends/pub-activity", data=legacy, format="json", **_auth(token)).status_code == 201
    names = set(FriendPubActivity.objects.filter(account=host, active=True).values_list("name", flat=True))
    assert names == {"U @klara doma", "U Zlatého tygra"}


@pytest.mark.django_db
def test_home_plan_days_ahead_and_several_plans(client, party):
    token, host = party["host"]
    guest_token, _ = party["guest"]
    first = _home_plan(client, token, days=5)
    second = _home_plan(client, token, days=9)
    assert first.status_code == second.status_code == status.HTTP_201_CREATED
    assert first.json()["place_kind"] == "home"
    assert first.json()["address"] == ADDRESS
    assert first.json()["lat"] is None
    assert first.json()["cache_key"] == ""

    plans = client.get("/v1/friends/plans", **_auth(guest_token)).json()["plans"]
    assert [p["id"] for p in plans] == [first.json()["id"], second.json()["id"]]
    assert plans[0]["address"] == ADDRESS
    # Not today, so released clients do not see it yet.
    assert client.get("/v1/friends", **_auth(guest_token)).json()["plans"] == []
    # The invitees were told, without the address.
    note = FriendNotification.objects.filter(recipient=party["guest"][1]).first()
    assert note is not None and ADDRESS not in note.body and "U @klara doma" in note.body


@pytest.mark.django_db
def test_plan_beyond_two_weeks_is_rejected(client, party):
    token, _ = party["host"]
    resp = _home_plan(client, token, days=15)
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "invalid_schedule"


@pytest.mark.django_db
def test_pub_plan_needs_coordinates(client, party):
    token, _ = party["host"]
    resp = client.post(
        "/v1/friends/pub-activity",
        data={"client_id": str(uuid.uuid4()), "place_kind": "pub", "name": "Lokál"},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_create_retry_with_same_client_id_is_idempotent(client, party):
    token, host = party["host"]
    client_id = str(uuid.uuid4())
    assert _home_plan(client, token, client_id=client_id).status_code == 201
    assert _home_plan(client, token, client_id=client_id).status_code == 200
    assert FriendPubActivity.objects.filter(account=host).count() == 1
    assert FriendNotification.objects.filter(kind="friend_plan").count() == 2  # two invitees, once


@pytest.mark.django_db
def test_targeted_plan_and_its_address_stay_with_invitees(client, party):
    token, _ = party["host"]
    _, guest = party["guest"]
    other_token, _ = party["other"]
    plan = _home_plan(client, token, recipients=[guest]).json()
    assert client.get("/v1/friends/plans", **_auth(other_token)).json()["plans"] == []
    detail = client.get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(other_token))
    assert detail.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_detail_people_owner_sees_silent_invitee_sees_who_goes(client, party):
    token, _ = party["host"]
    guest_token, guest = party["guest"]
    other_token, other = party["other"]
    plan = _home_plan(client, token).json()
    client.post(
        f"/v1/friends/pub-activity/{plan['id']}/respond",
        data={"response": "maybe"},
        format="json",
        **_auth(guest_token),
    )
    owner_view = client.get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(token)).json()
    assert [p["nickname"] for p in owner_view["people"]["maybe"]] == ["jirka"]
    assert [p["nickname"] for p in owner_view["people"]["silent"]] == ["petra"]
    assert owner_view["invitee_count"] == 2
    invitee_view = client.get(f"/v1/friends/pub-activity/{plan['id']}", **_auth(other_token)).json()
    assert invitee_view["people"]["maybe"] == []
    assert invitee_view["people"]["maybe_count"] == 1
    assert invitee_view["people"]["silent"] == []


@pytest.mark.django_db
def test_remind_pushes_silent_once_per_hour(client, party):
    token, _ = party["host"]
    guest_token, _ = party["guest"]
    _, other = party["other"]
    plan = _home_plan(client, token).json()
    client.post(
        f"/v1/friends/pub-activity/{plan['id']}/respond",
        data={"response": "going"},
        format="json",
        **_auth(guest_token),
    )
    resp = client.post(f"/v1/friends/pub-activity/{plan['id']}/remind", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json() == {"reminded": 1}
    assert FriendNotification.objects.filter(recipient=other, kind="friend_plan").count() == 2
    again = client.post(f"/v1/friends/pub-activity/{plan['id']}/remind", **_auth(token))
    assert again.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert again.json()["code"] == "remind_too_soon"
    # Only the host can remind.
    other_resp = client.post(f"/v1/friends/pub-activity/{plan['id']}/remind", **_auth(guest_token))
    assert other_resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_patch_edits_owner_plan_and_tells_invitees(client, party):
    token, _ = party["host"]
    guest_token, guest = party["guest"]
    plan = _home_plan(client, token).json()
    new_time = (timezone.now() + timedelta(days=4)).replace(microsecond=0)
    resp = client.patch(
        f"/v1/friends/pub-activity/{plan['id']}",
        data={"scheduled_for": new_time.isoformat(), "message": "Přines chipsy."},
        format="json",
        **_auth(token),
    )
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["message"] == "Přines chipsy."
    assert body["address"] == ADDRESS  # untouched by a partial edit
    assert body["place_kind"] == "home"
    assert FriendNotification.objects.filter(recipient=guest, title="Změna plánu").exists()
    forbidden = client.patch(
        f"/v1/friends/pub-activity/{plan['id']}",
        data={"message": "x"},
        format="json",
        **_auth(guest_token),
    )
    assert forbidden.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_cancel_new_look_plan_tells_invitees(client, party):
    token, _ = party["host"]
    _, guest = party["guest"]
    plan = _home_plan(client, token).json()
    resp = client.delete(f"/v1/friends/pub-activity/{plan['id']}", **_auth(token))
    assert resp.json() == {"ended": True}
    assert FriendNotification.objects.filter(recipient=guest, title="Plán se ruší").exists()


@pytest.mark.django_db
def test_ping_friend_once_per_half_hour(client, party):
    token, _ = party["host"]
    _, guest = party["guest"]
    resp = client.post(f"/v1/friends/{guest.public_id}/ping", data={}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED
    assert FriendNotification.objects.filter(recipient=guest, kind="friend_ping").count() == 1
    again = client.post(f"/v1/friends/{guest.public_id}/ping", data={}, format="json", **_auth(token))
    assert again.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_ping_respects_friendship_blocks_and_ghost(client, party):
    token, host = party["host"]
    stranger_token, stranger = _register(client, "cizinec")
    assert (
        client.post(f"/v1/friends/{stranger.public_id}/ping", data={}, format="json", **_auth(token)).status_code
        == status.HTTP_404_NOT_FOUND
    )
    _, guest = party["guest"]
    FriendBlock.objects.create(blocker=guest, blocked=host)
    assert (
        client.post(f"/v1/friends/{guest.public_id}/ping", data={}, format="json", **_auth(token)).status_code
        == status.HTTP_404_NOT_FOUND
    )
    _, other = party["other"]
    host.ghost_mode = True
    host.save(update_fields=["ghost_mode"])
    resp = client.post(f"/v1/friends/{other.public_id}/ping", data={}, format="json", **_auth(token))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert not FriendNotification.objects.filter(kind="friend_ping").exists()


@pytest.mark.django_db
def test_home_evening_checkin_and_what_outsiders_see(client, party):
    token, host = party["host"]
    guest_token, guest = party["guest"]
    other_token, _ = party["other"]
    # Only Jirka is invited; Petra is a friend of both but outside the evening.
    evening = _home_plan(client, token, recipients=[guest], scheduled=False).json()
    assert evening["kind"] == "live"
    client_id = str(uuid.uuid4())
    first = client.post(
        f"/v1/friends/pub-activity/{evening['id']}/checkin",
        data={"client_id": client_id},
        format="json",
        **_auth(guest_token),
    )
    assert first.status_code == status.HTTP_201_CREATED
    assert [p["nickname"] for p in first.json()["present"]] == ["klara", "jirka"]
    retry = client.post(
        f"/v1/friends/pub-activity/{evening['id']}/checkin",
        data={"client_id": client_id},
        format="json",
        **_auth(guest_token),
    )
    assert retry.status_code == status.HTTP_200_OK
    assert FriendHomeCheckin.objects.filter(account=guest).count() == 1

    live = client.get("/v1/friends/live", **_auth(other_token)).json()
    rows = {row["account"]["nickname"]: row for row in live["home_presence"]}
    assert set(rows) == {"klara", "jirka"}
    assert all(row["place"] == "home" and row["activity_id"] is None for row in rows.values())
    raw = str(live)
    assert ADDRESS not in raw and "U @klara doma" not in raw
    dashboard = client.get("/v1/friends", **_auth(other_token)).json()
    assert ADDRESS not in str(dashboard)

    # An invited viewer can open the evening from the row.
    host_live = client.get("/v1/friends/live", **_auth(token)).json()
    assert host_live["home_presence"][0]["activity_id"] == evening["id"]

    left = client.delete(f"/v1/friends/pub-activity/{evening['id']}/checkin", **_auth(guest_token))
    assert left.json() == {"left": True}
    assert client.delete(f"/v1/friends/pub-activity/{evening['id']}/checkin", **_auth(guest_token)).json() == {
        "left": False
    }
    other_checkin = client.post(
        f"/v1/friends/pub-activity/{evening['id']}/checkin",
        data={"client_id": str(uuid.uuid4())},
        format="json",
        **_auth(other_token),
    )
    assert other_checkin.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_home_presence_respects_ghost_and_sharing(client, party):
    token, host = party["host"]
    guest_token, _ = party["guest"]
    _home_plan(client, token, scheduled=False)
    host.share_drinks_with_parta = False
    host.save(update_fields=["share_drinks_with_parta"])
    assert client.get("/v1/friends/live", **_auth(guest_token)).json()["home_presence"] == []


@pytest.mark.django_db
def test_checkin_too_early(client, party):
    token, _ = party["host"]
    guest_token, _ = party["guest"]
    plan = _home_plan(client, token, days=2).json()
    resp = client.post(
        f"/v1/friends/pub-activity/{plan['id']}/checkin",
        data={"client_id": str(uuid.uuid4())},
        format="json",
        **_auth(guest_token),
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert resp.json()["code"] == "too_early"


def _beer(account, drank_at, cache_key="u2fkbn1z"):
    DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Zlatého tygra",
        lat=LAT,
        lng=LNG,
        beer_name="Plzeň",
        drink_type=DrinkLog.DrinkType.BEER,
        drank_at=drank_at,
    )


@pytest.mark.django_db
def test_duel_month_window_and_recent_together_beers(client, party):
    token, host = party["host"]
    _, guest = party["guest"]
    evening = timezone.now() - timedelta(hours=1)
    for account in (host, guest):
        PubVisit.objects.create(
            account=account,
            client_id=uuid.uuid4(),
            cache_key="u2fkbn1z",
            name="U Zlatého tygra",
            lat=LAT,
            lng=LNG,
            started_at=evening,
            client_updated_at=evening,
        )
    _beer(host, evening)
    _beer(host, evening + timedelta(minutes=20))
    _beer(guest, evening)

    duel = client.get(f"/v1/friends/{guest.public_id}/duel?window=month", **_auth(token)).json()
    assert duel["window"] == "month"
    assert duel["me"]["beers"] == 2 and duel["them"]["beers"] == 1

    profile = client.get(f"/v1/friends/{guest.public_id}", **_auth(token)).json()
    assert profile["recent_together"][0]["beers"] == 2


@pytest.mark.django_db
def test_month_period_on_boards(client, party):
    token, _ = party["host"]
    board = client.get("/v1/leaderboards?category=beers&period=month", **_auth(token))
    assert board.status_code == status.HTTP_200_OK
    assert board.json()["period"] == "month"
    pubs = client.get("/v1/pubs/beer-board?period=month", **_auth(token))
    assert pubs.status_code == status.HTTP_200_OK
    assert pubs.json()["period"] == "month"
    assert pubs.json()["period_start"].endswith("-01")


@pytest.mark.django_db
def test_public_profile_page_only_for_public_accounts(client, party):
    _, host = party["host"]
    page = client.get("/u/klara")
    assert page.status_code == status.HTTP_200_OK
    assert b"@klara" in page.content
    assert page.headers["X-Robots-Tag"] == "noindex, nofollow"
    host.is_public = False
    host.save(update_fields=["is_public"])
    assert client.get("/u/klara").status_code == status.HTTP_404_NOT_FOUND

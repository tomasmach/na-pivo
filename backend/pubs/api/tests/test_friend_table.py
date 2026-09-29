from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db.models import F
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, FriendBlock, Friendship, PubVisit

_URL = "/v1/friends/table"
_CACHE_KEY = "u2fkbfvz"
_OTHER_CACHE_KEY = "u2fkbn1z"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, nickname: str | None) -> tuple[str, Account]:
    response = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=response.json()["id"])
    account.nickname = nickname
    account.display_name = (nickname or "").capitalize()
    account.save(update_fields=["nickname", "display_name"])
    return response.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _sit(
    account: Account,
    *,
    cache_key: str = _CACHE_KEY,
    minutes_ago: int = 30,
    started_minutes_ago: int | None = None,
    closed: bool = False,
) -> PubVisit:
    now = timezone.now()
    started_at = now - timedelta(minutes=minutes_ago if started_minutes_ago is None else started_minutes_ago)
    visit = PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="U Tygra",
        lat=50.08,
        lng=14.42,
        started_at=started_at,
        closed_at=now if closed else None,
        client_updated_at=started_at,
    )
    # created_at is auto_now_add; the server-side clock is what the 15 min rule reads.
    PubVisit.objects.filter(pk=visit.pk).update(created_at=now - timedelta(minutes=minutes_ago))
    return visit


def _show(account: Account, minutes: int = 10) -> None:
    Account.objects.filter(pk=account.pk).update(
        table_visible_until=timezone.now() + timedelta(minutes=minutes)
    )


def _names(response) -> list[str]:
    return [person["nickname"] for person in response.json()["people"]]


@pytest.fixture
def table(client):
    """Caller ``me`` and a visible stranger ``bara`` sitting at the same pub."""

    me_token, me = _register(client, "me")
    bara_token, bara = _register(client, "bara")
    _sit(me)
    _sit(bara)
    _show(bara)
    return me_token, me, bara_token, bara


@pytest.mark.django_db
def test_requires_token(client):
    assert client.get(_URL).status_code == status.HTTP_401_UNAUTHORIZED
    assert client.post(_URL).status_code == status.HTTP_401_UNAUTHORIZED
    assert client.delete(_URL).status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_post_sets_visibility_and_lists_people_without_location(client, table):
    me_token, me, _bara_token, bara = table

    response = client.post(_URL, **_auth(me_token))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["eligible"] is True
    assert body["reason"] is None
    assert body["visible_until"] is not None
    assert set(body) == {"eligible", "reason", "visible_until", "people"}
    assert body["people"] == [
        {
            "id": str(bara.public_id),
            "nickname": "bara",
            "display_name": "Bara",
            "avatar_url": None,
            "is_public": True,
            "friendship_status": "none",
        }
    ]
    me.refresh_from_db()
    assert me.table_visible_until is not None
    assert me.table_visible_until > timezone.now() + timedelta(minutes=9)


@pytest.mark.django_db
def test_get_does_not_write_and_hides_table_until_caller_is_visible(client, table):
    me_token, me, _bara_token, _bara = table

    response = client.get(_URL, **_auth(me_token))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"eligible": True, "reason": None, "visible_until": None, "people": []}
    me.refresh_from_db()
    assert me.table_visible_until is None


@pytest.mark.django_db
def test_delete_clears_visibility(client, table):
    me_token, me, _bara_token, _bara = table
    client.post(_URL, **_auth(me_token))

    response = client.delete(_URL, **_auth(me_token))

    assert response.status_code == status.HTTP_204_NO_CONTENT
    me.refresh_from_db()
    assert me.table_visible_until is None
    assert client.get(_URL, **_auth(me_token)).json()["people"] == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("setup", "reason"),
    [
        (lambda me: Account.objects.filter(pk=me.pk).update(nickname=None), "no_nickname"),
        (lambda me: Account.objects.filter(pk=me.pk).update(is_public=False), "private"),
        (lambda me: Account.objects.filter(pk=me.pk).update(ghost_mode=True), "ghost"),
        (lambda me: PubVisit.objects.filter(account=me).update(closed_at=timezone.now()), "no_visit"),
        (
            lambda me: PubVisit.objects.filter(account=me).update(created_at=timezone.now()),
            "too_soon",
        ),
    ],
)
def test_ineligible_caller_is_not_made_visible(client, table, setup, reason):
    me_token, me, _bara_token, _bara = table
    setup(me)

    response = client.post(_URL, **_auth(me_token))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body.pop("available_at", None) is not None if reason == "too_soon" else True
    assert body == {
        "eligible": False,
        "reason": reason,
        "visible_until": None,
        "people": [],
    }
    me.refresh_from_db()
    assert me.table_visible_until is None


@pytest.mark.django_db
def test_too_soon_uses_server_created_at_not_backdated_started_at(client):
    me_token, me = _register(client, "me")
    _sit(me, minutes_ago=2, started_minutes_ago=90)

    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "too_soon"


@pytest.mark.django_db
def test_too_soon_says_when_the_table_opens(client):
    me_token, me = _register(client, "me")
    visit = _sit(me, minutes_ago=4)

    body = client.post(_URL, **_auth(me_token)).json()

    visit.refresh_from_db()
    expected = visit.created_at + timedelta(minutes=15)
    assert body["reason"] == "too_soon"
    assert abs(timezone.datetime.fromisoformat(body["available_at"]) - expected) < timedelta(seconds=1)


def _visit_body(client_id: str, *, lat: float, lng: float, at) -> dict:
    return {
        "client_id": client_id,
        "name": "Hospoda",
        "lat": lat,
        "lng": lng,
        "city": "Praha",
        "external_id": "",
        "started_at": at.isoformat(),
        "ended_at": None,
        "updated_at": at.isoformat(),
    }


@pytest.mark.django_db
def test_moving_an_old_visit_to_another_pub_restarts_the_clock(client):
    me_token, me = _register(client, "me")
    client_id = str(uuid.uuid4())
    started = timezone.now() - timedelta(minutes=40)
    created = client.post(
        "/v1/pub-visits",
        data=_visit_body(client_id, lat=50.0853, lng=14.4187, at=started),
        format="json",
        **_auth(me_token),
    )
    assert created.status_code == status.HTTP_201_CREATED
    PubVisit.objects.filter(account=me).update(created_at=timezone.now() - timedelta(minutes=30))
    assert client.post(_URL, **_auth(me_token)).json()["eligible"] is True

    moved = client.post(
        "/v1/pub-visits",
        data={
            **_visit_body(client_id, lat=49.1951, lng=16.6068, at=started),
            "updated_at": timezone.now().isoformat(),
        },
        format="json",
        **_auth(me_token),
    )

    assert moved.status_code == status.HTTP_200_OK
    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "too_soon"


@pytest.mark.django_db
def test_resuming_a_closed_visit_restarts_the_clock(client):
    me_token, me = _register(client, "me")
    client_id = str(uuid.uuid4())
    started = timezone.now() - timedelta(minutes=40)
    body = _visit_body(client_id, lat=50.0853, lng=14.4187, at=started)
    closed = client.post(
        "/v1/pub-visits",
        data={**body, "closed_at": timezone.now().isoformat()},
        format="json",
        **_auth(me_token),
    )
    assert closed.status_code == status.HTTP_201_CREATED
    PubVisit.objects.filter(account=me).update(created_at=timezone.now() - timedelta(hours=3))

    resumed = client.post(
        "/v1/pub-visits",
        data={
            **body,
            "ended_at": timezone.now().isoformat(),
            "updated_at": timezone.now().isoformat(),
            "closed_at": None,
        },
        format="json",
        **_auth(me_token),
    )

    assert resumed.status_code == status.HTTP_200_OK
    assert PubVisit.objects.get(account=me).closed_at is None
    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "too_soon"


@pytest.mark.django_db
def test_moving_next_door_in_the_same_cell_restarts_the_clock(client):
    me_token, me = _register(client, "me")
    client_id = str(uuid.uuid4())
    started = timezone.now() - timedelta(minutes=40)
    body = _visit_body(client_id, lat=50.0853, lng=14.4187, at=started)
    assert client.post("/v1/pub-visits", data=body, format="json", **_auth(me_token)).status_code == 201
    PubVisit.objects.filter(account=me).update(created_at=timezone.now() - timedelta(hours=1))

    moved = client.post(
        "/v1/pub-visits",
        data={**body, "name": "Vedle", "updated_at": timezone.now().isoformat()},
        format="json",
        **_auth(me_token),
    )

    assert moved.status_code == status.HTTP_200_OK
    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "too_soon"


@pytest.mark.django_db
def test_a_late_past_visit_does_not_hide_the_table(client, table):
    me_token, _me, _bara_token, _bara = table
    started = timezone.now() - timedelta(days=2)
    late = client.post(
        "/v1/pub-visits",
        data={
            **_visit_body(str(uuid.uuid4()), lat=49.1951, lng=16.6068, at=started),
            "ended_at": (started + timedelta(hours=2)).isoformat(),
            "closed_at": (started + timedelta(hours=2)).isoformat(),
        },
        format="json",
        **_auth(me_token),
    )

    assert late.status_code == status.HTTP_201_CREATED
    assert client.post(_URL, **_auth(me_token)).json()["eligible"] is True


@pytest.mark.django_db
def test_touching_an_older_planted_visit_does_not_move_me_to_its_pub(client, table):
    me_token, me, _bara_token, _bara = table
    # I planted a visit in another pub earlier; my newest visit on the server
    # is at Bára's pub. Bumping the planted one's client timestamps must not
    # move me there.
    planted = _sit(me, cache_key=_OTHER_CACHE_KEY, minutes_ago=60)
    PubVisit.objects.filter(pk=planted.pk).update(ended_at=timezone.now())
    _token, stranger = _register(client, "stranger")
    _sit(stranger, cache_key=_OTHER_CACHE_KEY)
    _show(stranger)

    assert _names(client.post(_URL, **_auth(me_token))) == ["bara"]


@pytest.fixture
def planted(client):
    """Me with an old visit at Bára's pub and a newer one elsewhere, both old enough."""

    me_token, me = _register(client, "me")
    _sit(me, minutes_ago=60)
    newest = _sit(me, cache_key=_OTHER_CACHE_KEY, minutes_ago=30)
    _token, bara = _register(client, "bara")
    _sit(bara)
    _show(bara)
    return me_token, me, newest


@pytest.mark.django_db
def test_closing_the_newest_visit_does_not_fall_back_to_an_older_pub(client, planted):
    me_token, _me, newest = planted
    PubVisit.objects.filter(pk=newest.pk).update(closed_at=timezone.now())

    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "no_visit"


@pytest.mark.django_db
def test_backdating_the_newest_visit_does_not_fall_back_to_an_older_pub(client, planted):
    me_token, _me, newest = planted
    PubVisit.objects.filter(pk=newest.pk).update(started_at=timezone.now() - timedelta(hours=5))

    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "no_visit"


@pytest.mark.django_db
def test_deleting_the_newest_visit_restarts_the_clock(client, planted):
    me_token, _me, newest = planted
    deleted = client.delete(f"/v1/pub-visits/{newest.client_id}", **_auth(me_token))
    assert deleted.status_code == status.HTTP_200_OK
    assert deleted.json() == {"deleted": True}

    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "too_soon"


@pytest.mark.django_db
def test_deleting_the_newest_visit_falls_back_to_the_next_newest_only(client):
    me_token, me = _register(client, "me")
    _token, bara = _register(client, "bara")
    _sit(bara, minutes_ago=120)
    _show(bara)
    # Created first but resumed later: the next newest after the planted one.
    _sit(me, minutes_ago=60)
    _sit(me, cache_key=_OTHER_CACHE_KEY, minutes_ago=90)
    accidental = _sit(me, cache_key="u2fkbn1y", minutes_ago=30)

    client.delete(f"/v1/pub-visits/{accidental.client_id}", **_auth(me_token))
    PubVisit.objects.filter(account=me).update(created_at=F("created_at") - timedelta(minutes=20))

    assert _names(client.post(_URL, **_auth(me_token))) == ["bara"]


@pytest.mark.django_db
def test_deleting_an_older_visit_keeps_the_clock_of_the_current_one(client, planted):
    me_token, me, _newest = planted
    older = PubVisit.objects.get(account=me, cache_key=_CACHE_KEY)
    deleted = client.delete(f"/v1/pub-visits/{older.client_id}", **_auth(me_token))
    assert deleted.json() == {"deleted": True}

    assert client.post(_URL, **_auth(me_token)).json()["eligible"] is True


@pytest.mark.django_db
@pytest.mark.parametrize(
    "hide_newest",
    [
        pytest.param({"closed_at": timezone.now()}, id="closed"),
        pytest.param({"started_at": timezone.now() - timedelta(hours=5)}, id="out_of_window"),
    ],
)
def test_candidate_is_pinned_to_their_newest_visit(client, table, hide_newest):
    me_token, _me, _bara_token, bara = table
    elsewhere = _sit(bara, cache_key=_OTHER_CACHE_KEY, minutes_ago=20)
    PubVisit.objects.filter(pk=elsewhere.pk).update(**hide_newest)

    assert client.post(_URL, **_auth(me_token)).json()["people"] == []


@pytest.mark.django_db
def test_merging_accounts_restarts_the_clock_of_open_visits(client):
    from pubs import accounts

    me_token, me = _register(client, "me")
    _sit(me, minutes_ago=60)
    _token, anonymous = _register(client, None)
    _sit(anonymous, cache_key=_OTHER_CACHE_KEY, minutes_ago=30)

    accounts._merge_anonymous_account(anonymous, me)

    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "too_soon"


@pytest.mark.django_db
def test_no_visit_when_the_caller_has_none(client):
    me_token, _me = _register(client, "me")

    assert client.post(_URL, **_auth(me_token)).json()["reason"] == "no_visit"


def _hide_account(field: str, value):
    return lambda other, me: Account.objects.filter(pk=other.pk).update(**{field: value})


@pytest.mark.django_db
@pytest.mark.parametrize(
    "exclude",
    [
        pytest.param(_hide_account("ghost_mode", True), id="ghost"),
        pytest.param(_hide_account("is_public", False), id="private"),
        pytest.param(_hide_account("nickname", None), id="no_nickname"),
        pytest.param(_hide_account("status", Account.Status.PENDING_DELETION), id="deleting"),
        pytest.param(_hide_account("table_visible_until", None), id="not_visible"),
        pytest.param(
            _hide_account("table_visible_until", timezone.now() - timedelta(minutes=1)),
            id="visibility_expired",
        ),
        pytest.param(
            lambda other, me: FriendBlock.objects.create(blocker=me, blocked=other),
            id="blocked_by_me",
        ),
        pytest.param(
            lambda other, me: FriendBlock.objects.create(blocker=other, blocked=me),
            id="blocked_me",
        ),
        pytest.param(
            lambda other, me: Friendship.objects.create(
                requester=other, recipient=me, status=Friendship.Status.ACCEPTED
            ),
            id="already_friends",
        ),
        pytest.param(
            lambda other, me: Friendship.objects.create(
                requester=me,
                recipient=other,
                status=Friendship.Status.DECLINED,
                responded_at=timezone.now() - timedelta(days=1),
            ),
            id="declined_me_recently",
        ),
        pytest.param(
            lambda other, me: PubVisit.objects.filter(account=other).update(
                closed_at=timezone.now()
            ),
            id="closed_visit",
        ),
        pytest.param(
            lambda other, me: PubVisit.objects.filter(account=other).update(
                started_at=timezone.now() - timedelta(hours=5)
            ),
            id="stale_visit",
        ),
        pytest.param(
            lambda other, me: PubVisit.objects.filter(account=other).update(
                cache_key=_OTHER_CACHE_KEY
            ),
            id="other_pub",
        ),
        pytest.param(
            lambda other, me: _sit(other, cache_key=_OTHER_CACHE_KEY, minutes_ago=20),
            id="moved_to_other_pub",
        ),
        pytest.param(
            lambda other, me: PubVisit.objects.filter(account=other).update(
                created_at=timezone.now() - timedelta(minutes=5),
                started_at=timezone.now() - timedelta(hours=1),
            ),
            id="under_15_min_despite_backdated_start",
        ),
    ],
)
def test_candidate_exclusions(client, table, exclude):
    me_token, me, _bara_token, bara = table
    exclude(bara, me)

    response = client.post(_URL, **_auth(me_token))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["eligible"] is True
    assert response.json()["people"] == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("mine", "theirs", "listed"),
    [
        pytest.param(("U Tygra", "mapy:111"), ("U Tygra", "mapy:111"), True, id="same_id"),
        pytest.param(("U Tygra", "mapy:111"), ("Vinárna", "mapy:222"), False, id="neighbour_ids"),
        pytest.param(("U Tygra", "mapy:111"), ("U tygra ", ""), True, id="same_name_no_id"),
        pytest.param(("U Tygra", ""), ("Vinárna", ""), False, id="neighbour_names"),
        pytest.param(("U Tygra", "mapy:50.08,14.42"), ("U Tygra", "mapy:111"), True, id="coordinate_id"),
    ],
)
def test_neighbours_in_one_cell_are_not_one_table(client, table, mine, theirs, listed):
    me_token, me, _bara_token, bara = table
    PubVisit.objects.filter(account=me).update(name=mine[0], external_id=mine[1])
    PubVisit.objects.filter(account=bara).update(name=theirs[0], external_id=theirs[1])

    assert _names(client.post(_URL, **_auth(me_token))) == (["bara"] if listed else [])


@pytest.mark.django_db
def test_old_decline_no_longer_hides_them(client, table):
    me_token, me, _bara_token, bara = table
    Friendship.objects.create(
        requester=me,
        recipient=bara,
        status=Friendship.Status.DECLINED,
        responded_at=timezone.now() - timedelta(days=60),
    )

    assert _names(client.post(_URL, **_auth(me_token))) == ["bara"]


@pytest.mark.django_db
def test_people_are_capped(client, table):
    me_token, _me, _bara_token, _bara = table
    for index in range(25):
        _token, other = _register(client, f"host{index}")
        _sit(other)
        _show(other)

    assert len(client.post(_URL, **_auth(me_token)).json()["people"]) == 20


@pytest.mark.django_db
def test_full_flow_request_and_reverse_request_makes_friends(client, table):
    me_token, me, bara_token, bara = table
    client.post(_URL, **_auth(bara_token))

    seen_by_me = client.post(_URL, **_auth(me_token)).json()["people"]
    assert [(p["nickname"], p["friendship_status"]) for p in seen_by_me] == [("bara", "none")]

    request = client.post(
        "/v1/friends/requests",
        data={"target_account_id": seen_by_me[0]["id"]},
        format="json",
        **_auth(me_token),
    )
    assert request.status_code == status.HTTP_201_CREATED
    assert [p["friendship_status"] for p in client.get(_URL, **_auth(me_token)).json()["people"]] == [
        "outgoing"
    ]

    seen_by_bara = client.get(_URL, **_auth(bara_token)).json()["people"]
    assert [(p["nickname"], p["friendship_status"]) for p in seen_by_bara] == [("me", "incoming")]

    reverse = client.post(
        "/v1/friends/requests",
        data={"target_account_id": seen_by_bara[0]["id"]},
        format="json",
        **_auth(bara_token),
    )
    assert reverse.status_code == status.HTTP_200_OK
    assert Friendship.objects.get(requester=me, recipient=bara).status == Friendship.Status.ACCEPTED
    assert client.get(_URL, **_auth(bara_token)).json()["people"] == []
    assert client.get(_URL, **_auth(me_token)).json()["people"] == []


@pytest.mark.django_db
def test_export_includes_table_visibility(client, table):
    me_token, _me, _bara_token, _bara = table
    client.post(_URL, **_auth(me_token))
    from pubs.api.views import _export_account_data

    me = Account.objects.get(nickname="me")
    assert _export_account_data(me)["settings"]["table_visible_until"] is not None

"""
Shared games inside a party evening.

What these tests are actually protecting:

  - the score is a SUM of events, so two phones tapping at once cannot lose a
    point the way a stored total would;
  - a retry never double-counts, because a pub is exactly where the signal drops
    halfway through a request;
  - `since` is the only catch-up mechanism, so a reconnect and a first load run
    the same code path;
  - a game key this server has never heard of is still playable — the catalogue
    ships with the app and must not need a deploy to grow;
  - nobody outside the table can read or write any of it.
"""

from __future__ import annotations

import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import Account, Friendship


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _generous_throttle(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            **settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"],
            "account": "10000/min",
            "friends": "10000/min",
        },
    }


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    response = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    account = Account.objects.get(public_id=response.json()["id"])
    account.nickname = nickname
    account.save(update_fields=["nickname"])
    return response.json()["token"], account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _friend(left: Account, right: Account) -> None:
    Friendship.objects.create(requester=left, recipient=right, status=Friendship.Status.ACCEPTED)


def _table(client: APIClient) -> tuple[str, Account, str, Account, str]:
    """A host, a friend who joined, and the join code they share."""
    host_token, host = _register(client, "host")
    guest_token, guest = _register(client, "guest")
    _friend(host, guest)
    code = "PRAH24"
    assert (
        client.post(
            "/v1/party-evenings",
            data={"client_id": str(uuid.uuid4()), "join_code": code, "pub_name": "U Fleků"},
            format="json",
            **_auth(host_token),
        ).status_code
        == status.HTTP_201_CREATED
    )
    assert (
        client.post(
            f"/v1/party-evenings/{code}/join", format="json", **_auth(guest_token)
        ).status_code
        == status.HTTP_200_OK
    )
    return host_token, host, guest_token, guest, code


def _start_game(client: APIClient, token: str, code: str, **overrides):
    payload = {
        "client_id": str(uuid.uuid4()),
        "catalog_key": "quiz",
        "name": "Pub kvíz",
        "scoring": "points",
        **overrides,
    }
    return client.post(
        f"/v1/party-evenings/{code}/games", data=payload, format="json", **_auth(token)
    )


def _send(client: APIClient, token: str, code: str, game_id: str, events: list[dict]):
    return client.post(
        f"/v1/party-evenings/{code}/games/{game_id}/events",
        data={"events": events},
        format="json",
        **_auth(token),
    )


@pytest.mark.django_db
def test_both_phones_see_the_same_score_and_simultaneous_taps_both_land(client):
    host_token, host, guest_token, guest, code = _table(client)
    game = _start_game(client, host_token, code).json()

    # Both phones score the guest at the same moment, neither having seen the
    # other's event. As a stored total one of these would vanish.
    _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )
    _send(
        client,
        guest_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )

    for token in (host_token, guest_token):
        body = client.get(f"/v1/party-evenings/{code}/games", **_auth(token)).json()
        total = sum(
            event["delta"]
            for event in body["events"]
            if event["subject"] and event["subject"]["nickname"] == "guest"
        )
        assert total == 2


@pytest.mark.django_db
def test_a_retried_event_does_not_double_count(client):
    host_token, host, _guest_token, guest, code = _table(client)
    game = _start_game(client, host_token, code).json()
    event = {
        "client_id": str(uuid.uuid4()),
        "kind": "score",
        "subject_id": str(guest.public_id),
        "delta": 1,
    }

    first = _send(client, host_token, code, game["id"], [event])
    second = _send(client, host_token, code, game["id"], [event])

    assert first.status_code == status.HTTP_201_CREATED
    # Accepted, but nothing written — the phone never saw our first answer.
    assert second.json()["accepted"] == []
    body = client.get(f"/v1/party-evenings/{code}/games", **_auth(host_token)).json()
    assert sum(item["delta"] for item in body["events"]) == 1


@pytest.mark.django_db
def test_since_returns_only_what_is_new(client):
    host_token, _host, _guest_token, guest, code = _table(client)
    game = _start_game(client, host_token, code).json()
    _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )

    first = client.get(f"/v1/party-evenings/{code}/games", **_auth(host_token)).json()
    cursor = first["cursor"]
    assert len(first["events"]) == 1

    # Nothing happened since: an empty catch-up, and the cursor holds.
    quiet = client.get(
        f"/v1/party-evenings/{code}/games?since={cursor}", **_auth(host_token)
    ).json()
    assert quiet["events"] == []
    assert quiet["cursor"] == cursor

    _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )
    after = client.get(
        f"/v1/party-evenings/{code}/games?since={cursor}", **_auth(host_token)
    ).json()
    assert len(after["events"]) == 1
    assert after["cursor"] > cursor


@pytest.mark.django_db
def test_a_game_this_server_has_never_heard_of_is_still_playable(client):
    host_token, _host, _guest_token, _guest, code = _table(client)

    response = _start_game(
        client,
        host_token,
        code,
        catalog_key="hra-z-pristi-verze",
        name="Hra z příští verze",
        scoring="drinks",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["name"] == "Hra z příští verze"
    assert response.json()["scoring"] == "drinks"


@pytest.mark.django_db
def test_finishing_stamps_the_game_and_is_visible_to_the_table(client):
    host_token, _host, guest_token, _guest, code = _table(client)
    game = _start_game(client, host_token, code).json()

    _send(
        client, host_token, code, game["id"], [{"client_id": str(uuid.uuid4()), "kind": "finish"}]
    )

    body = client.get(f"/v1/party-evenings/{code}/games", **_auth(guest_token)).json()
    assert body["games"][0]["ended_at"] is not None
    assert body["events"][-1]["kind"] == "finish"


@pytest.mark.django_db
def test_a_stranger_can_neither_read_nor_write_the_table_s_games(client):
    host_token, _host, _guest_token, guest, code = _table(client)
    game = _start_game(client, host_token, code).json()
    stranger_token, _stranger = _register(client, "cizi")

    read = client.get(f"/v1/party-evenings/{code}/games", **_auth(stranger_token))
    write = _send(
        client,
        stranger_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )

    assert read.status_code == status.HTTP_404_NOT_FOUND
    assert write.status_code in {status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT}


@pytest.mark.django_db
def test_starting_the_same_game_twice_from_one_client_id_is_one_game(client):
    host_token, _host, _guest_token, _guest, code = _table(client)
    client_id = str(uuid.uuid4())

    first = _start_game(client, host_token, code, client_id=client_id)
    second = _start_game(client, host_token, code, client_id=client_id)

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_200_OK
    assert first.json()["id"] == second.json()["id"]
    body = client.get(f"/v1/party-evenings/{code}/games", **_auth(host_token)).json()
    assert len(body["games"]) == 1


@pytest.mark.django_db(transaction=True)
async def test_the_stream_delivers_an_event_that_lands_after_it_opened(monkeypatch):
    """
    The one thing worth proving about SSE: a point tapped AFTER the connection
    opened arrives on it, without the client asking again.

    Everything else about the stream (auth, membership, the cursor) is the same
    code the JSON catch-up runs, and is covered above.
    """
    from asgiref.sync import sync_to_async
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    host_token, _host, _guest_token, guest, code = setup
    game = (
        await sync_to_async(_start_game, thread_sensitive=True)(sync_client, host_token, code)
    ).json()

    # Keep the test quick: one tick, and a stream that gives up almost at once.
    # Via monkeypatch, so a shortened stream does not leak into other tests.
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.05)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 2)

    async_client = AsyncClient()
    response = await async_client.get(
        f"/v1/party-evenings/{code}/games/stream",
        headers={"authorization": f"Bearer {host_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    assert response["Content-Type"] == "text/event-stream"

    stream = response.streaming_content
    assert b"event: open" in await anext(stream)

    # Now something happens. The open stream has to carry it.
    await sync_to_async(_send, thread_sensitive=True)(
        sync_client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )

    seen = b""
    async for chunk in stream:
        seen += chunk
        if b"event: game_event" in seen:
            break
    assert b"event: game_event" in seen
    assert b'"delta": 1' in seen


@pytest.mark.django_db
def test_an_answer_carries_its_own_detail(client):
    """
    A quiz answer is a question and a choice, not a number.

    The server stores the payload without reading it: the rules live in the app,
    and a server that parses game payloads is a server that needs deploying every
    time a game changes.
    """
    host_token, _host, guest_token, _guest, code = _table(client)
    game = _start_game(client, host_token, code, catalog_key="quiz", name="Pub kvíz").json()

    sent = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": {"questionId": "q-plzen", "option": 0},
            }
        ],
    )

    assert sent.status_code == status.HTTP_201_CREATED
    body = client.get(f"/v1/party-evenings/{code}/games", **_auth(guest_token)).json()
    answer = [event for event in body["events"] if event["kind"] == "answer"][0]
    assert answer["payload"] == {"questionId": "q-plzen", "option": 0}
    assert answer["account"]["nickname"] == "host"

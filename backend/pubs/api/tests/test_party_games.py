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

from pubs.models import Account, AuthToken, FriendBlock, Friendship


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
def test_connected_phone_discovers_new_game_before_any_gameplay(client):
    host_token, _host, guest_token, _guest, code = _table(client)

    before = client.get(
        f"/v1/party-evenings/{code}/games", **_auth(guest_token)
    ).json()
    assert before == {"cursor": 0, "games": [], "events": []}

    payload = {
        "client_id": str(uuid.uuid4()),
        "catalog_key": "quiz",
        "name": "Pub kvíz",
        "scoring": "points",
    }
    created = client.post(
        f"/v1/party-evenings/{code}/games",
        data=payload,
        format="json",
        **_auth(host_token),
    )
    assert created.status_code == status.HTTP_201_CREATED

    catch_up = client.get(
        f"/v1/party-evenings/{code}/games?since={before['cursor']}",
        **_auth(guest_token),
    ).json()
    assert [game["id"] for game in catch_up["games"]] == [created.json()["id"]]
    assert [event["kind"] for event in catch_up["events"]] == ["start"]
    assert catch_up["events"][0]["game_id"] == created.json()["id"]
    assert catch_up["cursor"] > before["cursor"]

    retried = client.post(
        f"/v1/party-evenings/{code}/games",
        data=payload,
        format="json",
        **_auth(host_token),
    )
    assert retried.status_code == status.HTTP_200_OK
    assert retried.json()["id"] == created.json()["id"]

    quiet = client.get(
        f"/v1/party-evenings/{code}/games?since={catch_up['cursor']}",
        **_auth(guest_token),
    ).json()
    assert quiet["games"] == []
    assert quiet["events"] == []


@pytest.mark.django_db
def test_game_is_shared_when_placed_and_first_lobby_binds_the_roster(client):
    host_token, host, guest_token, guest, code = _table(client)
    observer_token, observer = _register(client, "observer")
    assert (
        client.post(
            f"/v1/party-evenings/{code}/join",
            format="json",
            **_auth(observer_token),
        ).status_code
        == status.HTTP_200_OK
    )

    placed = _start_game(client, host_token, code, roster_ids=[])

    assert placed.status_code == status.HTTP_201_CREATED
    assert placed.json()["roster"] == []
    discovered = client.get(
        f"/v1/party-evenings/{code}/games",
        **_auth(guest_token),
    ).json()
    assert [game["id"] for game in discovered["games"]] == [placed.json()["id"]]
    assert [event["kind"] for event in discovered["events"]] == ["start"]

    chosen_ids = [str(guest.public_id), str(host.public_id)]
    first_lobby = _start_game(
        client,
        guest_token,
        code,
        roster_ids=chosen_ids,
    )
    losing_lobby = _start_game(
        client,
        host_token,
        code,
        roster_ids=[str(host.public_id), str(observer.public_id)],
    )
    placement_retry = _start_game(client, host_token, code, roster_ids=[])

    assert first_lobby.status_code == status.HTTP_200_OK
    assert [row["id"] for row in first_lobby.json()["roster"]] == chosen_ids
    assert losing_lobby.status_code == status.HTTP_200_OK
    assert losing_lobby.json()["roster"] == first_lobby.json()["roster"]
    assert placement_retry.status_code == status.HTTP_200_OK
    assert placement_retry.json()["roster"] == first_lobby.json()["roster"]


@pytest.mark.django_db
def test_lobby_rejects_a_single_player_but_accepts_pending_placement(client):
    host_token, host, _guest_token, _guest, code = _table(client)

    placed = _start_game(client, host_token, code, roster_ids=[])
    one_player = _start_game(
        client,
        host_token,
        code,
        roster_ids=[str(host.public_id)],
    )

    assert placed.status_code == status.HTTP_201_CREATED
    assert one_player.status_code == status.HTTP_400_BAD_REQUEST
    assert "aspoň dva" in str(one_player.json())


@pytest.mark.django_db
def test_quiz_roster_is_one_server_snapshot_across_phones_and_membership_changes(client):
    host_token, host, guest_token, guest, code = _table(client)
    observer_token, observer = _register(client, "observer")
    assert (
        client.post(
            f"/v1/party-evenings/{code}/join",
            format="json",
            **_auth(observer_token),
        ).status_code
        == status.HTTP_200_OK
    )
    roster_ids = [str(guest.public_id), str(host.public_id)]

    first = _start_game(
        client,
        host_token,
        code,
        roster_ids=roster_ids,
    )
    second = _start_game(
        client,
        guest_token,
        code,
        roster_ids=[str(host.public_id), str(observer.public_id)],
    )

    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_200_OK
    assert second.json()["id"] == first.json()["id"]
    assert [row["id"] for row in first.json()["roster"]] == roster_ids
    assert second.json()["roster"] == first.json()["roster"]

    # An active member who sat this one out may watch it, but cannot become a
    # quiz entrant or score themselves by joining after the lobby snapshot.
    excluded_answer = _send(
        client,
        observer_token,
        code,
        first.json()["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": {"questionId": "q-plzen", "option": 1},
            },
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(observer.public_id),
                "delta": 1,
            },
        ],
    )
    assert excluded_answer.status_code == status.HTTP_200_OK
    assert excluded_answer.json()["accepted"] == []

    # Leaving changes table membership, not a game already in progress. The
    # host can still finish its scoreboard against the original entrant.
    assert (
        client.delete(
            f"/v1/party-evenings/{code}/join",
            **_auth(guest_token),
        ).status_code
        == status.HTTP_200_OK
    )
    score_departed = _send(
        client,
        host_token,
        code,
        first.json()["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )
    assert score_departed.status_code == status.HTTP_201_CREATED
    current = client.get(
        f"/v1/party-evenings/{code}/games",
        **_auth(host_token),
    ).json()["games"][0]
    assert [row["id"] for row in current["roster"]] == roster_ids


@pytest.mark.django_db
def test_released_start_without_roster_gets_a_canonical_active_member_snapshot(client):
    host_token, host, guest_token, guest, code = _table(client)

    game = _start_game(client, host_token, code)

    assert game.status_code == status.HTTP_201_CREATED
    expected = [str(host.public_id), str(guest.public_id)]
    assert [row["id"] for row in game.json()["roster"]] == expected
    assert [
        row["id"]
        for row in client.get(
            f"/v1/party-evenings/{code}/games",
            **_auth(guest_token),
        ).json()["games"][0]["roster"]
    ] == expected


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
def test_game_actions_are_append_only_correlated_and_visible_after_reconnect(client):
    host_token, _host, guest_token, _guest, code = _table(client)
    game = _start_game(client, host_token, code).json()
    assert isinstance(game["seed"], int)
    assert game["seed"] > 0

    first_id = str(uuid.uuid4())
    second_id = str(uuid.uuid4())
    sent = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": first_id,
                "kind": "action",
                "payload": {"type": "prompt_next"},
            },
            {
                "client_id": second_id,
                "kind": "action",
                "payload": {"type": "dice_roll", "playerId": "host", "dice": [6, 4]},
            },
        ],
    )
    retried = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": first_id,
                "kind": "action",
                "payload": {"type": "prompt_next"},
            }
        ],
    )

    assert sent.status_code == status.HTTP_201_CREATED
    assert [event["client_id"] for event in sent.json()["accepted"]] == [first_id, second_id]
    assert retried.status_code == status.HTTP_200_OK
    assert retried.json()["accepted"] == []

    caught_up = client.get(
        f"/v1/party-evenings/{code}/games?since=0",
        **_auth(guest_token),
    ).json()
    actions = [event for event in caught_up["events"] if event["kind"] == "action"]
    assert [event["client_id"] for event in actions] == [first_id, second_id]
    assert [event["payload"]["type"] for event in actions] == ["prompt_next", "dice_roll"]


@pytest.mark.django_db
def test_member_outside_frozen_roster_cannot_append_game_action(client):
    host_token, host, _guest_token, guest, code = _table(client)
    observer_token, _observer = _register(client, "observer")
    assert (
        client.post(
            f"/v1/party-evenings/{code}/join",
            format="json",
            **_auth(observer_token),
        ).status_code
        == status.HTTP_200_OK
    )
    game = _start_game(
        client,
        host_token,
        code,
        roster_ids=[str(host.public_id), str(guest.public_id)],
    ).json()

    rejected = _send(
        client,
        observer_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "action",
                "payload": {"type": "pick", "playerId": str(host.public_id)},
            }
        ],
    )

    assert rejected.status_code == status.HTTP_200_OK
    assert rejected.json()["accepted"] == []


@pytest.mark.django_db
def test_pending_lobby_cannot_receive_gameplay_actions(client):
    host_token, _host, _guest_token, _guest, code = _table(client)
    game = _start_game(client, host_token, code, roster_ids=[]).json()

    rejected = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "action",
                "payload": {"type": "prompt_next"},
            }
        ],
    )

    assert rejected.status_code == status.HTTP_200_OK
    assert rejected.json()["accepted"] == []


@pytest.mark.django_db
def test_game_event_payload_rejects_oversized_and_deep_json(client):
    host_token, _host, _guest_token, _guest, code = _table(client)
    game = _start_game(client, host_token, code).json()

    oversized = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": {"answer": "x" * 1_000_000},
            }
        ],
    )
    nested_value: dict = {"answer": "ok"}
    for _ in range(7):
        nested_value = {"nested": nested_value}
    too_deep = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": nested_value,
            }
        ],
    )
    too_wide = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": {"answers": list(range(65))},
            }
        ],
    )
    too_many_items = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": {
                    f"group-{group}": [{"value": item} for item in range(64)]
                    for group in range(5)
                },
            }
        ],
    )
    too_many_bytes = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "answer",
                "payload": {f"field-{index}": "🍺" * 1_500 for index in range(12)},
            }
        ],
    )

    assert oversized.status_code == status.HTTP_400_BAD_REQUEST
    assert too_deep.status_code == status.HTTP_400_BAD_REQUEST
    assert too_wide.status_code == status.HTTP_400_BAD_REQUEST
    assert too_many_items.status_code == status.HTTP_400_BAD_REQUEST
    assert too_many_bytes.status_code == status.HTTP_400_BAD_REQUEST
    assert "payload" in str(oversized.json()).lower()
    assert "zanořen" in str(too_deep.json())
    assert "Pole" in str(too_wide.json())
    assert "moc položek" in str(too_many_items.json())
    assert "moc velký" in str(too_many_bytes.json())


@pytest.mark.django_db
def test_game_event_batch_has_an_aggregate_payload_budget(client):
    host_token, _host, _guest_token, _guest, code = _table(client)
    game = _start_game(client, host_token, code).json()
    events = [
        {
            "client_id": str(uuid.uuid4()),
            "kind": "answer",
            "payload": {f"field-{index}": "x" * 500 for index in range(12)},
        }
        for _ in range(11)
    ]

    response = _send(client, host_token, code, game["id"], events)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "dohromady" in str(response.json())


@pytest.mark.django_db
def test_game_and_evening_event_caps_keep_retries_idempotent(client, monkeypatch):
    from pubs.api import party_views

    host_token, _host, _guest_token, guest, code = _table(client)
    first_game = _start_game(client, host_token, code).json()
    first_events = [
        {
            "client_id": str(uuid.uuid4()),
            "kind": "score",
            "subject_id": str(guest.public_id),
            "delta": 1,
        }
        for _ in range(2)
    ]
    monkeypatch.setattr(party_views, "PARTY_GAME_EVENT_MAX_PER_GAME", 2)
    monkeypatch.setattr(party_views, "PARTY_GAME_EVENT_MAX_PER_EVENING", 10)
    assert _send(client, host_token, code, first_game["id"], first_events).status_code == 201
    # A lowered deployment cap must still acknowledge an idempotent retry of a
    # row that already exists above the new ceiling.
    monkeypatch.setattr(party_views, "PARTY_GAME_EVENT_MAX_PER_GAME", 1)

    game_limit = _send(
        client,
        host_token,
        code,
        first_game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )
    retry = _send(client, host_token, code, first_game["id"], [first_events[0]])
    assert game_limit.status_code == status.HTTP_409_CONFLICT
    assert game_limit.json()["code"] == "game_event_limit_reached"
    assert retry.status_code == status.HTTP_200_OK

    second_game = _start_game(
        client,
        host_token,
        code,
        catalog_key="dice-duel",
        name="Kostkový duel",
    ).json()
    monkeypatch.setattr(party_views, "PARTY_GAME_EVENT_MAX_PER_GAME", 10)
    monkeypatch.setattr(party_views, "PARTY_GAME_EVENT_MAX_PER_EVENING", 2)
    evening_limit = _send(
        client,
        host_token,
        code,
        second_game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(guest.public_id),
                "delta": 1,
            }
        ],
    )
    assert evening_limit.status_code == status.HTTP_409_CONFLICT
    assert evening_limit.json()["code"] == "evening_event_limit_reached"


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
    assert [event["kind"] for event in first["events"]] == ["start", "score"]

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
def test_games_hide_blocked_non_host_profiles_as_authors_subjects_and_starters(client):
    host_token, host, observer_token, observer, code = _table(client)
    hidden_token, hidden = _register(client, "hidden")
    assert client.post(f"/v1/party-evenings/{code}/join", **_auth(hidden_token)).status_code == 200
    visible_game = _start_game(client, host_token, code).json()
    hidden_client_id = str(uuid.uuid4())
    hidden_game = _start_game(
        client,
        hidden_token,
        code,
        client_id=hidden_client_id,
        catalog_key="hidden-game",
        name="Skrytá hra",
    ).json()

    assert (
        _send(
            client,
            hidden_token,
            code,
            visible_game["id"],
            [
                {
                    "client_id": str(uuid.uuid4()),
                    "kind": "score",
                    "subject_id": str(host.public_id),
                    "delta": 1,
                }
            ],
        ).status_code
        == 201
    )
    assert (
        _send(
            client,
            host_token,
            code,
            visible_game["id"],
            [
                {
                    "client_id": str(uuid.uuid4()),
                    "kind": "score",
                    "subject_id": str(hidden.public_id),
                    "delta": 1,
                },
                {
                    "client_id": str(uuid.uuid4()),
                    "kind": "score",
                    "subject_id": str(host.public_id),
                    "delta": 1,
                },
            ],
        ).status_code
        == 201
    )

    FriendBlock.objects.create(blocker=observer, blocked=hidden)

    observer_body = client.get(
        f"/v1/party-evenings/{code}/games",
        **_auth(observer_token),
    ).json()
    assert [game["id"] for game in observer_body["games"]] == [visible_game["id"]]
    gameplay = [event for event in observer_body["events"] if event["kind"] != "start"]
    assert len(gameplay) == 1
    assert gameplay[0]["account"]["id"] == str(host.public_id)
    assert gameplay[0]["subject"]["id"] == str(host.public_id)
    assert str(hidden.public_id) not in str(observer_body)
    assert hidden_game["id"] not in str(observer_body)
    hidden_retry = _start_game(
        client,
        observer_token,
        code,
        client_id=hidden_client_id,
        catalog_key="hidden-game",
        name="Skrytá hra",
    )
    assert hidden_retry.status_code == status.HTTP_404_NOT_FOUND
    assert hidden_retry.json()["code"] == "game_not_found"

    # A block between two guests narrows visibility, but does not eject either
    # guest from the host's table. The host, who blocked nobody, still sees all.
    host_body = client.get(f"/v1/party-evenings/{code}/games", **_auth(host_token)).json()
    assert {game["id"] for game in host_body["games"]} == {
        visible_game["id"],
        hidden_game["id"],
    }
    assert len(host_body["events"]) == 5
    assert sum(event["kind"] == "start" for event in host_body["events"]) == 2


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


@pytest.mark.django_db
def test_two_phones_reuse_the_catalog_game_even_after_it_finished(client):
    host_token, _host, guest_token, _guest, code = _table(client)

    first = _start_game(client, host_token, code, client_id=str(uuid.uuid4()))
    second = _start_game(client, guest_token, code, client_id=str(uuid.uuid4()))
    assert first.status_code == status.HTTP_201_CREATED
    assert second.status_code == status.HTTP_200_OK
    assert second.json()["id"] == first.json()["id"]

    finished = _send(
        client,
        host_token,
        code,
        first.json()["id"],
        [{"client_id": str(uuid.uuid4()), "kind": "finish"}],
    )
    assert finished.status_code == status.HTTP_201_CREATED
    reopened = _start_game(client, guest_token, code, client_id=str(uuid.uuid4()))
    assert reopened.status_code == status.HTTP_200_OK
    assert reopened.json()["id"] == first.json()["id"]

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
    cursor = (
        await sync_to_async(sync_client.get, thread_sensitive=True)(
            f"/v1/party-evenings/{code}/games",
            **_auth(host_token),
        )
    ).json()["cursor"]

    # Keep the test quick: one tick, and a stream that gives up almost at once.
    # Via monkeypatch, so a shortened stream does not leak into other tests.
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.05)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 2)

    async_client = AsyncClient()
    response = await async_client.get(
        f"/v1/party-evenings/{code}/games/stream?since={cursor}",
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


@pytest.mark.django_db(transaction=True)
async def test_stream_filters_events_from_a_blocked_non_host_member(monkeypatch):
    from asgiref.sync import sync_to_async
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    host_token, host, observer_token, observer, code = setup
    hidden_token, hidden = await sync_to_async(_register, thread_sensitive=True)(
        sync_client, "hidden"
    )
    await sync_to_async(sync_client.post, thread_sensitive=True)(
        f"/v1/party-evenings/{code}/join",
        **_auth(hidden_token),
    )
    game = (
        await sync_to_async(_start_game, thread_sensitive=True)(sync_client, host_token, code)
    ).json()
    visible_event = {
        "client_id": str(uuid.uuid4()),
        "kind": "score",
        "subject_id": str(host.public_id),
        "delta": 1,
    }
    hidden_event = {**visible_event, "client_id": str(uuid.uuid4()), "delta": 2}
    await sync_to_async(_send, thread_sensitive=True)(
        sync_client,
        host_token,
        code,
        game["id"],
        [visible_event],
    )
    await sync_to_async(_send, thread_sensitive=True)(
        sync_client,
        hidden_token,
        code,
        game["id"],
        [hidden_event],
    )
    await sync_to_async(FriendBlock.objects.create, thread_sensitive=True)(
        blocker=observer,
        blocked=hidden,
    )
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.01)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 0.06)

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream",
        headers={"authorization": f"Bearer {observer_token}"},
    )
    stream = response.streaming_content
    assert b"event: open" in await anext(stream)
    seen = b""
    async for chunk in stream:
        seen += chunk

    assert seen.count(b"event: game_event") == 2
    assert b'"kind": "start"' in seen
    assert b'"delta": 1' in seen
    assert str(hidden.public_id).encode() not in seen
    assert hidden.nickname.encode() not in seen


@pytest.mark.parametrize("revocation", ["leave", "block", "ghost", "token"])
@pytest.mark.django_db(transaction=True)
async def test_stream_revalidates_access_and_closes_after_revocation(monkeypatch, revocation):
    from asgiref.sync import sync_to_async
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    _host_token, host, guest_token, guest, code = setup
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.01)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 2)

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    stream = response.streaming_content
    assert b"event: open" in await anext(stream)

    def revoke_access():
        if revocation == "leave":
            result = sync_client.delete(
                f"/v1/party-evenings/{code}/join",
                **_auth(guest_token),
            )
            assert result.status_code == status.HTTP_200_OK
        elif revocation == "block":
            FriendBlock.objects.create(blocker=host, blocked=guest)
        elif revocation == "ghost":
            Account.objects.filter(pk=guest.pk).update(ghost_mode=True)
        else:
            AuthToken.objects.filter(account=guest).delete()

    await sync_to_async(revoke_access, thread_sensitive=True)()

    with pytest.raises(StopAsyncIteration):
        await anext(stream)


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

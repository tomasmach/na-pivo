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
from datetime import timedelta

import pytest
from asgiref.sync import sync_to_async
from django.db import IntegrityError, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from pubs.models import Account, AuthToken, FriendBlock, Friendship, PartyGame, PartyGameEvent


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


@pytest.fixture
async def _close_stream_database_connection():
    """Close the persistent thread-sensitive connection before DB teardown."""

    yield
    await sync_to_async(connections.close_all, thread_sensitive=True)()


@pytest.fixture
def _restore_latest_schema():
    yield
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


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
def test_selecting_another_game_finishes_the_previous_game_for_every_phone(client):
    host_token, _host, guest_token, _guest, code = _table(client)
    quiz = _start_game(client, host_token, code).json()
    before_switch = client.get(
        f"/v1/party-evenings/{code}/games",
        **_auth(guest_token),
    ).json()

    dice = _start_game(
        client,
        host_token,
        code,
        catalog_key="dice",
        name="Kostky",
        scoring="drinks",
    )

    assert dice.status_code == status.HTTP_201_CREATED
    active_games = PartyGame.objects.filter(evening__join_code=code, ended_at__isnull=True)
    assert list(active_games.values_list("public_id", flat=True)) == [
        uuid.UUID(dice.json()["id"])
    ]

    caught_up = client.get(
        f"/v1/party-evenings/{code}/games?since={before_switch['cursor']}",
        **_auth(guest_token),
    ).json()
    assert [game["id"] for game in caught_up["games"]] == [quiz["id"], dice.json()["id"]]
    assert [game["ended_at"] is None for game in caught_up["games"]] == [False, True]
    assert [event["kind"] for event in caught_up["events"]] == ["finish", "start"]
    assert [event["game_id"] for event in caught_up["events"]] == [
        quiz["id"],
        dice.json()["id"],
    ]

    stale_phone = _send(
        client,
        guest_token,
        code,
        quiz["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "action",
                "payload": {"type": "answer", "option": 2},
            }
        ],
    )
    assert stale_phone.status_code == status.HTTP_200_OK
    assert stale_phone.json()["accepted"] == []

    retry = _start_game(
        client,
        host_token,
        code,
        catalog_key="dice",
        name="Kostky",
        scoring="drinks",
    )
    assert retry.status_code == status.HTTP_200_OK
    assert PartyGameEvent.objects.filter(game__public_id=quiz["id"], kind="finish").count() == 1


@pytest.mark.django_db(transaction=True)
def test_database_rejects_two_unfinished_games_for_one_evening(client):
    host_token, host, _guest_token, _guest, code = _table(client)
    _start_game(client, host_token, code)
    evening = PartyGame.objects.get(evening__join_code=code).evening

    with pytest.raises(IntegrityError), transaction.atomic():
        PartyGame.objects.create(
            evening=evening,
            client_id=uuid.uuid4(),
            started_by=host,
            catalog_key="dice",
            name="Kostky",
            scoring=PartyGame.Scoring.DRINKS,
        )


@pytest.mark.django_db(transaction=True)
def test_migration_keeps_the_latest_active_game_and_publishes_finish_events(
    _restore_latest_schema,
):
    app_label = "pubs"
    executor = MigrationExecutor(connection)
    executor.migrate([(app_label, "0117_backend_release_review")])
    executor.loader.build_graph()
    old_apps = executor.loader.project_state(
        [(app_label, "0117_backend_release_review")]
    ).apps
    HistoricalAccount = old_apps.get_model(app_label, "Account")
    HistoricalEvening = old_apps.get_model(app_label, "PartyEvening")
    HistoricalGame = old_apps.get_model(app_label, "PartyGame")

    account = HistoricalAccount.objects.create(device_id="duplicate-active-games")
    evening = HistoricalEvening.objects.create(
        client_id=uuid.uuid4(),
        join_code="MIGR24",
        host_id=account.pk,
        pub_name="U Fleků",
    )
    latest_started_at = timezone.now()
    older = HistoricalGame.objects.create(
        client_id=uuid.uuid4(),
        evening_id=evening.pk,
        started_by_id=account.pk,
        catalog_key="quiz",
        name="Pub kvíz",
        scoring="points",
        started_at=latest_started_at - timedelta(minutes=1),
    )
    latest = HistoricalGame.objects.create(
        client_id=uuid.uuid4(),
        evening_id=evening.pk,
        started_by_id=account.pk,
        catalog_key="dice",
        name="Kostky",
        scoring="drinks",
        started_at=latest_started_at,
    )

    executor.migrate([(app_label, "0118_unique_active_party_game")])
    executor.loader.build_graph()
    migrated_apps = executor.loader.project_state(
        [(app_label, "0118_unique_active_party_game")]
    ).apps
    MigratedGame = migrated_apps.get_model(app_label, "PartyGame")
    MigratedEvent = migrated_apps.get_model(app_label, "PartyGameEvent")

    assert MigratedGame.objects.get(pk=older.pk).ended_at == latest_started_at
    assert MigratedGame.objects.get(pk=latest.pk).ended_at is None
    finish = MigratedEvent.objects.get(game_id=older.pk, kind="finish")
    assert finish.account_id == account.pk
    assert finish.created_at == latest_started_at


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
    cursor_before_roster = discovered["cursor"]

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

    roster_catch_up = client.get(
        f"/v1/party-evenings/{code}/games?since={cursor_before_roster}",
        **_auth(observer_token),
    ).json()
    assert roster_catch_up["cursor"] > cursor_before_roster
    assert [game["id"] for game in roster_catch_up["games"]] == [placed.json()["id"]]
    assert [row["id"] for row in roster_catch_up["games"][0]["roster"]] == chosen_ids
    assert [event["kind"] for event in roster_catch_up["events"]] == ["start"]

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
def test_first_finish_is_canonical_and_future_or_post_finish_events_cannot_mutate_game(client):
    host_token, _host, _guest_token, guest, code = _table(client)
    game = _start_game(client, host_token, code).json()
    first_finish_id = str(uuid.uuid4())

    finished = _send(
        client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": first_finish_id,
                "kind": "finish",
                "created_at": "2999-01-01T00:00:00Z",
            }
        ],
    )
    assert finished.status_code == status.HTTP_201_CREATED
    stored = PartyGame.objects.get(public_id=game["id"])
    assert stored.ended_at <= timezone.now() + timedelta(minutes=11)

    retry = _send(
        client,
        host_token,
        code,
        game["id"],
        [{"client_id": first_finish_id, "kind": "finish"}],
    )
    post_finish = _send(
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
            },
            {"client_id": str(uuid.uuid4()), "kind": "finish"},
        ],
    )
    assert retry.status_code == status.HTTP_200_OK
    assert retry.json()["accepted"] == []
    assert post_finish.status_code == status.HTTP_200_OK
    assert post_finish.json()["accepted"] == []
    assert PartyGameEvent.objects.filter(game=stored, kind="finish").count() == 1
    assert PartyGameEvent.objects.filter(game=stored, kind="score").count() == 0


@pytest.mark.django_db
def test_legacy_single_player_roster_stays_open_until_two_players_bind_it(client):
    host_token, host = _register(client, "host")
    guest_token, guest = _register(client, "guest")
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

    placed = _start_game(client, host_token, code)
    assert placed.status_code == status.HTTP_201_CREATED
    assert placed.json()["roster"] == []
    assert client.post(f"/v1/party-evenings/{code}/join", **_auth(guest_token)).status_code == 200

    bound = _start_game(
        client,
        guest_token,
        code,
        roster_ids=[str(host.public_id), str(guest.public_id)],
    )
    assert bound.status_code == status.HTTP_200_OK
    assert {row["id"] for row in bound.json()["roster"]} == {
        str(host.public_id),
        str(guest.public_id),
    }


@pytest.mark.django_db
def test_stream_event_probe_is_one_indexed_query_and_returns_plain_cursor(client):
    from pubs.api import party_views
    from pubs.models import PartyEvening

    host_token, _host, _guest_token, _guest, code = _table(client)
    evening = PartyEvening.objects.get(join_code=code)

    baseline = (
        PartyGameEvent.objects.filter(game__evening=evening)
        .order_by("-id")
        .values_list("id", flat=True)
        .first()
        or 0
    )

    with CaptureQueriesContext(connection) as quiet:
        quiet_cursor = party_views._probe_stream_event_cursor(evening.id, baseline)

    assert quiet_cursor is None
    assert len(quiet) <= 1

    response = _start_game(client, host_token, code)
    assert response.status_code == status.HTTP_201_CREATED

    with CaptureQueriesContext(connection) as detected:
        detected_cursor = party_views._probe_stream_event_cursor(evening.id, baseline)

    assert type(detected_cursor) is int
    assert detected_cursor > baseline
    assert len(detected) <= 1

    for query in detected:
        sql = query["sql"].lower()
        assert "id" in sql
        assert ">" in sql
        assert "order by" in sql
        assert "desc" in sql
        assert "limit 1" in sql


@pytest.mark.django_db
def test_stream_tick_reauthorizes_in_four_queries(client):
    from pubs.api import party_views

    host_token, _host, _guest_token, _guest, code = _table(client)
    request = APIRequestFactory().get(
        f"/v1/party-evenings/{code}/games/stream",
        HTTP_AUTHORIZATION=f"Bearer {host_token}",
    )

    with CaptureQueriesContext(connection) as captured:
        events = party_views._stream_game_events(request, code, 0)

    assert events == []
    assert len(captured) <= 4


def test_stream_slots_bound_each_account_and_process(monkeypatch):
    from pubs.api import party_views

    monkeypatch.setattr(party_views, "PARTY_STREAM_MAX_CONNECTIONS_PER_ACCOUNT", 2)
    monkeypatch.setattr(party_views, "PARTY_STREAM_MAX_CONNECTIONS_PER_PROCESS", 2)
    party_views._stream_connection_counts.clear()
    party_views._stream_connection_total = 0
    try:
        assert party_views._acquire_stream_slot(42) is True
        assert party_views._acquire_stream_slot(42) is True
        assert party_views._acquire_stream_slot(42) is False
        assert party_views._acquire_stream_slot(43) is False
    finally:
        party_views._release_stream_slot(42)
        party_views._release_stream_slot(42)


def test_stream_release_process_cap_is_32():
    from pubs.api import party_views

    assert party_views.PARTY_STREAM_MAX_CONNECTIONS_PER_PROCESS == 32
    assert party_views.PARTY_STREAM_MAX_CONNECTIONS_PER_ACCOUNT == 3


def test_stream_db_executor_has_eight_workers():
    from pubs.api import party_views

    assert party_views._stream_db_executor._max_workers == 8


@pytest.mark.asyncio
async def test_run_stream_db_closes_connections_before_and_after_call(monkeypatch):
    from pubs.api import party_views

    events = []

    def fake_close_old_connections():
        events.append("close")

    monkeypatch.setattr(party_views, "close_old_connections", fake_close_old_connections)

    def success():
        events.append("call")
        return {"ok": True}

    result = await party_views._run_stream_db(success)
    assert result == {"ok": True}
    assert events == ["close", "call", "close"]

    events.clear()

    def failing():
        events.append("call")
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        await party_views._run_stream_db(failing)
    assert events == ["close", "call", "close"]


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
    hidden_client_id = str(uuid.uuid4())
    hidden_game = _start_game(
        client,
        hidden_token,
        code,
        client_id=hidden_client_id,
        catalog_key="hidden-game",
        name="Skrytá hra",
    ).json()

    FriendBlock.objects.create(blocker=observer, blocked=hidden)

    observer_body = client.get(
        f"/v1/party-evenings/{code}/games",
        **_auth(observer_token),
    ).json()
    assert [game["id"] for game in observer_body["games"]] == [visible_game["id"]]
    assert observer_body["games"][0]["ended_at"] is not None
    finishes = [event for event in observer_body["events"] if event["kind"] == "finish"]
    assert len(finishes) == 1
    assert finishes[0]["account"]["id"] == str(host.public_id)
    gameplay = [
        event
        for event in observer_body["events"]
        if event["kind"] not in {"start", "finish"}
    ]
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
    assert len(host_body["events"]) == 6
    assert sum(event["kind"] == "start" for event in host_body["events"]) == 2
    assert sum(event["kind"] == "finish" for event in host_body["events"]) == 1


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
async def test_stream_signals_when_first_lobby_binds_an_existing_game_roster(
    monkeypatch,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    host_token, host, guest_token, guest, code = setup
    placed = await sync_to_async(_start_game, thread_sensitive=True)(
        sync_client,
        host_token,
        code,
        roster_ids=[],
    )
    cursor = (
        await sync_to_async(sync_client.get, thread_sensitive=True)(
            f"/v1/party-evenings/{code}/games",
            **_auth(guest_token),
        )
    ).json()["cursor"]

    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.05)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 2)

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream?since={cursor}",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    stream = response.streaming_content
    assert b"event: open" in await anext(stream)

    bound = await sync_to_async(_start_game, thread_sensitive=True)(
        sync_client,
        guest_token,
        code,
        roster_ids=[str(guest.public_id), str(host.public_id)],
    )
    assert bound.status_code == status.HTTP_200_OK
    assert bound.json()["id"] == placed.json()["id"]

    seen = b""
    async for chunk in stream:
        seen += chunk
        if b"event: game_event" in seen:
            break

    assert b"event: game_event" in seen
    assert b'"kind": "start"' in seen
    assert placed.json()["id"].encode() in seen


@pytest.mark.django_db(transaction=True)
async def test_the_stream_delivers_an_event_that_lands_after_it_opened(
    monkeypatch,
    _close_stream_database_connection,
):
    """
    The one thing worth proving about SSE: a point tapped AFTER the connection
    opened arrives on it, without the client asking again.

    Everything else about the stream (auth, membership, the cursor) is the same
    code the JSON catch-up runs, and is covered above.
    """
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
async def test_stream_filters_events_from_a_blocked_non_host_member(
    monkeypatch,
    _close_stream_database_connection,
):
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


@pytest.mark.django_db(transaction=True)
async def test_quiet_stream_tick_uses_only_probe_before_heartbeat(
    monkeypatch,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    _host_token, _host, guest_token, _guest, code = setup
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 600)
    monkeypatch.setattr(party_views, "_HEARTBEAT_SECONDS", 15.0)

    probe_calls = 0
    full_calls = 0

    def fake_probe(*args):
        nonlocal probe_calls
        probe_calls += 1
        return None

    def fake_full(*args):
        nonlocal full_calls
        full_calls += 1
        return []

    monkeypatch.setattr(party_views, "_probe_stream_event_cursor", fake_probe)
    monkeypatch.setattr(party_views, "_stream_game_events", fake_full)

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    stream = response.streaming_content
    assert b"event: open" in await anext(stream)

    class TickDoneError(Exception):
        pass

    async def finish_tick(_delay):
        raise TickDoneError

    monkeypatch.setattr(party_views.asyncio, "sleep", finish_tick)

    try:
        with pytest.raises(TickDoneError):
            await anext(stream)
    finally:
        await stream.aclose()

    assert probe_calls == 1
    assert full_calls == 0


@pytest.mark.django_db(transaction=True)
async def test_quiet_stream_reauthorizes_at_heartbeat(
    monkeypatch,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    _host_token, _host, guest_token, _guest, code = setup
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 600)
    assert party_views._HEARTBEAT_SECONDS == 15.0
    monkeypatch.setattr(party_views, "_HEARTBEAT_SECONDS", 0)

    probe_calls = 0
    full_calls = 0

    def fake_probe(*args):
        nonlocal probe_calls
        probe_calls += 1
        return None

    def fake_full(*args):
        nonlocal full_calls
        full_calls += 1
        return []

    monkeypatch.setattr(party_views, "_probe_stream_event_cursor", fake_probe)
    monkeypatch.setattr(party_views, "_stream_game_events", fake_full)

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    stream = response.streaming_content
    assert b"event: open" in await anext(stream)

    class TickDoneError(Exception):
        pass

    async def finish_tick(_delay):
        raise TickDoneError

    monkeypatch.setattr(party_views.asyncio, "sleep", finish_tick)

    try:
        beat = await anext(stream)
        assert beat == b": beat\n\n"
        with pytest.raises(TickDoneError):
            await anext(stream)
    finally:
        await stream.aclose()

    assert probe_calls == 1
    assert full_calls == 1


@pytest.mark.django_db(transaction=True)
async def test_stream_advances_raw_probe_cursor_without_advancing_wire_cursor(
    monkeypatch,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    _host_token, _host, guest_token, _guest, code = setup
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 600)
    monkeypatch.setattr(party_views, "_HEARTBEAT_SECONDS", 15.0)
    probe_inputs: list[int] = []
    full_calls = 0
    sleep_calls = 0

    def fake_probe(_evening_id, probe_cursor):
        probe_inputs.append(probe_cursor)
        return 77 if len(probe_inputs) == 1 else None

    def fake_full(*_args):
        nonlocal full_calls
        full_calls += 1
        return []

    async def finish_after_two_ticks(_delay):
        nonlocal sleep_calls
        sleep_calls += 1
        if sleep_calls == 2:
            party_views._STREAM_SECONDS = -1

    monkeypatch.setattr(party_views, "_probe_stream_event_cursor", fake_probe)
    monkeypatch.setattr(party_views, "_stream_game_events", fake_full)
    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream?since=41",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    stream = response.streaming_content
    opened = await anext(stream)
    assert b"event: open" in opened
    assert b"cursor" in opened and b"41" in opened
    monkeypatch.setattr(party_views.asyncio, "sleep", finish_after_two_ticks)
    try:
        reconnect = await anext(stream)
    finally:
        await stream.aclose()
    assert b"event: reconnect" in reconnect
    assert b"cursor" in reconnect and b"41" in reconnect
    assert probe_inputs == [41, 77]
    assert full_calls == 1


@pytest.mark.django_db(transaction=True)
async def test_stream_drains_full_event_batch_on_next_tick(
    monkeypatch,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    _host_token, _host, guest_token, _guest, code = setup
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 600)
    monkeypatch.setattr(party_views, "_HEARTBEAT_SECONDS", 15.0)
    probe_inputs: list[int] = []
    full_inputs: list[int] = []
    sleep_calls = 0

    def fake_probe(_evening_id, probe_cursor):
        probe_inputs.append(probe_cursor)
        return 999 if probe_cursor < 999 else None

    def fake_full(_request, _code, wire_cursor):
        full_inputs.append(wire_cursor)
        if len(full_inputs) == 1:
            return [(event_id, {"kind": "score"}) for event_id in range(42, 242)]
        return []

    async def finish_after_two_ticks(_delay):
        nonlocal sleep_calls
        sleep_calls += 1
        if sleep_calls == 2:
            party_views._STREAM_SECONDS = -1

    monkeypatch.setattr(party_views, "_probe_stream_event_cursor", fake_probe)
    monkeypatch.setattr(party_views, "_stream_game_events", fake_full)
    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream?since=41",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    stream = response.streaming_content
    opened = await anext(stream)
    assert b"event: open" in opened
    monkeypatch.setattr(party_views.asyncio, "sleep", finish_after_two_ticks)
    chunks = []
    try:
        async for chunk in stream:
            chunks.append(chunk)
    finally:
        await stream.aclose()
    seen = b"".join(chunks)
    assert probe_inputs[:2] == [41, 241]
    assert full_inputs == [41, 241]
    assert seen.count(b"event: game_event") == 200
    assert b"event: reconnect" in seen
    assert b"\"cursor\": 241" in seen


@pytest.mark.parametrize("revocation", ["token", "block"])
@pytest.mark.django_db(transaction=True)
async def test_stream_reauthenticates_after_probe_before_emitting_new_event(
    monkeypatch,
    revocation,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    host_token, host, guest_token, guest, code = setup
    game_response = await sync_to_async(_start_game, thread_sensitive=True)(sync_client, host_token, code)
    assert game_response.status_code == status.HTTP_201_CREATED
    game = game_response.json()
    cursor = (
        await sync_to_async(sync_client.get, thread_sensitive=True)(
            f"/v1/party-evenings/{code}/games",
            **_auth(guest_token),
        )
    ).json()["cursor"]

    real_probe = party_views._probe_stream_event_cursor
    real_full = party_views._stream_game_events
    order: list[str] = []

    def tracked_probe(*args, **kwargs):
        order.append("probe")
        return real_probe(*args, **kwargs)

    def tracked_full(*args, **kwargs):
        order.append("reauth")
        return real_full(*args, **kwargs)

    monkeypatch.setattr(party_views, "_probe_stream_event_cursor", tracked_probe)
    monkeypatch.setattr(party_views, "_stream_game_events", tracked_full)
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.01)
    monkeypatch.setattr(party_views, "_STREAM_SECONDS", 2)

    response = await AsyncClient().get(
        f"/v1/party-evenings/{code}/games/stream?since={cursor}",
        headers={"authorization": f"Bearer {guest_token}"},
    )
    assert response.status_code == status.HTTP_200_OK
    stream = response.streaming_content
    assert b"event: open" in await anext(stream)

    def revoke_access():
        if revocation == "token":
            AuthToken.objects.filter(account=guest).delete()
        else:
            FriendBlock.objects.create(blocker=host, blocked=guest)

    await sync_to_async(revoke_access, thread_sensitive=True)()

    sent = await sync_to_async(_send, thread_sensitive=True)(
        sync_client,
        host_token,
        code,
        game["id"],
        [
            {
                "client_id": str(uuid.uuid4()),
                "kind": "score",
                "subject_id": str(host.public_id),
                "delta": 1,
            }
        ],
    )
    assert sent.status_code == status.HTTP_201_CREATED

    try:
        with pytest.raises(StopAsyncIteration):
            await anext(stream)
    finally:
        await stream.aclose()

    assert order[-2:] == ["probe", "reauth"]


@pytest.mark.parametrize("revocation", ["leave", "block", "ghost", "token"])
@pytest.mark.django_db(transaction=True)
async def test_stream_revalidates_access_and_closes_after_revocation(
    monkeypatch,
    revocation,
    _close_stream_database_connection,
):
    from django.test import AsyncClient

    from pubs.api import party_views

    sync_client = APIClient()
    setup = await sync_to_async(_table, thread_sensitive=True)(sync_client)
    _host_token, host, guest_token, guest, code = setup
    monkeypatch.setattr(party_views, "_TICK_SECONDS", 0.01)
    monkeypatch.setattr(party_views, "_HEARTBEAT_SECONDS", 0)
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

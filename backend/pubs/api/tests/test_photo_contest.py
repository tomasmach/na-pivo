"""Tests for the FotoPivař photo contest (/v1/photo-contest + worker close).

Round windows are pure functions of (now, PHOTO_CONTEST_EPOCH), so determinism
is tested by injecting instants instead of freezing the clock. Photo uploads go
through a tmp MEDIA_ROOT like in test_beer_photos.py.
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    AccountUsageStats,
    FriendBlock,
    PhotoContest,
    PhotoContestEntry,
    PhotoContestVote,
)
from pubs.photo_contest import CONTEST_PERIOD, current_period_bounds


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def tmp_media(tmp_path, settings):
    media_root = tmp_path / "media"
    media_root.mkdir()
    settings.MEDIA_ROOT = str(media_root)
    return media_root


def _register(client: APIClient, nickname: str) -> tuple[str, Account]:
    resp = client.post("/v1/account", data={"device_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    token = resp.json()["token"]
    account = Account.objects.get(public_id=resp.json()["id"])
    account.nickname = nickname
    account.display_name = nickname.capitalize()
    account.is_public = True
    account.save(update_fields=["nickname", "display_name", "is_public"])
    return token, account


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _jpeg_bytes(size: tuple[int, int] = (400, 300), color=(210, 160, 40)) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _upload_photo(client: APIClient, token: str, **overrides) -> str:
    """Upload one photo through the API and return its exposed id."""
    data = {
        "client_id": str(uuid.uuid4()),
        "caption": "Soutěžní pivo",
        "pub_name": "U Zlatého tygra",
        "pub_city": "Praha",
        "visibility": "friends",
    }
    data.update(overrides)
    data["image"] = SimpleUploadedFile("beer.jpg", _jpeg_bytes(), content_type="image/jpeg")
    resp = client.post("/v1/beer-photos", data=data, format="multipart", **_auth(token))
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    return resp.json()["photo"]["id"]


def _enter(client: APIClient, token: str, photo_id: str):
    return client.post(
        "/v1/photo-contest/entries",
        data={"photo_id": photo_id},
        format="json",
        **_auth(token),
    )


def _vote(client: APIClient, token: str, entry_id: str):
    return client.post(
        "/v1/photo-contest/vote",
        data={"entry_id": entry_id},
        format="json",
        **_auth(token),
    )


def _shift_contest_to_past(contest: PhotoContest) -> PhotoContest:
    """Rewind the current round so its window has already ended."""
    PhotoContest.objects.filter(pk=contest.pk).update(
        period_start=contest.period_start - CONTEST_PERIOD,
        period_end=timezone.now() - timedelta(hours=1),
    )
    contest.refresh_from_db()
    return contest


# ---------------------------------------------------------------------------
# Round windows
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_period_bounds_are_deterministic(settings):
    settings.PHOTO_CONTEST_EPOCH = "2026-01-05"

    start, end = current_period_bounds(datetime(2026, 7, 10, 12, 0, tzinfo=UTC))

    assert start == datetime(2026, 7, 6, 0, 0, tzinfo=UTC)
    assert end == datetime(2026, 7, 20, 0, 0, tzinfo=UTC)
    # Window boundaries: the start instant belongs to the window, the end
    # instant to the next one.
    assert current_period_bounds(start)[0] == start
    assert current_period_bounds(end)[0] == end
    # Every instant of one window maps to the identical row-defining start.
    assert current_period_bounds(start + timedelta(days=13, hours=23))[0] == start


@pytest.mark.django_db
def test_get_contest_lazily_creates_single_deterministic_row(client):
    token, _account = _register(client, "janek")
    expected_start, expected_end = current_period_bounds()

    first = client.get("/v1/photo-contest", **_auth(token))
    second = client.get("/v1/photo-contest", **_auth(token))

    assert first.status_code == status.HTTP_200_OK, first.content
    assert second.status_code == status.HTTP_200_OK, second.content
    assert PhotoContest.objects.count() == 1
    contest = PhotoContest.objects.get()
    assert contest.period_start == expected_start
    assert contest.period_end == expected_end
    assert contest.status == PhotoContest.Status.OPEN
    body = first.json()
    assert body["contest"]["id"] == str(contest.public_id)
    assert body["contest"]["status"] == "open"
    assert body["entries"] == []
    assert body["my_entry_id"] is None
    assert body["my_entry_photo_id"] is None
    assert body["my_vote_entry_id"] is None
    assert body["last_results"] is None


# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_enter_requires_nickname(client):
    token, account = _register(client, "janek")
    photo_id = _upload_photo(client, token)
    account.nickname = None
    account.save(update_fields=["nickname"])

    resp = _enter(client, token, photo_id)

    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "nickname_required"
    assert PhotoContestEntry.objects.count() == 0


@pytest.mark.django_db
def test_enter_rejects_other_users_photo(client):
    token_owner, _owner = _register(client, "janek")
    token_other, _other = _register(client, "petr")
    photo_id = _upload_photo(client, token_owner)

    resp = _enter(client, token_other, photo_id)

    assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.content
    assert resp.json()["code"] == "photo_not_found"
    assert PhotoContestEntry.objects.count() == 0


@pytest.mark.django_db
def test_enter_replaces_existing_entry_and_drops_its_votes(client):
    token_a, _a = _register(client, "janek")
    token_b, _b = _register(client, "petr")
    photo_one = _upload_photo(client, token_a, caption="první")
    photo_two = _upload_photo(client, token_a, caption="druhá")

    first = _enter(client, token_a, photo_one)
    assert first.status_code == status.HTTP_201_CREATED, first.content
    first_entry_id = first.json()["entry"]["id"]
    voted = _vote(client, token_b, first_entry_id)
    assert voted.status_code == status.HTTP_200_OK, voted.content
    assert voted.json()["votes"] == 1

    second = _enter(client, token_a, photo_two)

    assert second.status_code == status.HTTP_201_CREATED, second.content
    assert PhotoContestEntry.objects.count() == 1
    entry = PhotoContestEntry.objects.get()
    assert str(entry.photo.public_id) == photo_two
    assert second.json()["entry"]["id"] != first_entry_id
    assert second.json()["entry"]["votes"] == 0
    # The replaced entry's votes are gone with it.
    assert PhotoContestVote.objects.count() == 0

    # Entering marks the photo as in the current round in the diary list.
    photos = client.get("/v1/beer-photos", **_auth(token_a)).json()["photos"]
    assert {p["caption"]: p["in_contest"] for p in photos} == {"první": False, "druhá": True}


@pytest.mark.django_db
def test_withdraw_entry_is_idempotent_204(client):
    token, _account = _register(client, "janek")
    photo_id = _upload_photo(client, token)
    assert _enter(client, token, photo_id).status_code == status.HTTP_201_CREATED

    first = client.delete("/v1/photo-contest/entries", **_auth(token))
    second = client.delete("/v1/photo-contest/entries", **_auth(token))

    assert first.status_code == status.HTTP_204_NO_CONTENT
    assert second.status_code == status.HTTP_204_NO_CONTENT
    assert PhotoContestEntry.objects.count() == 0


# ---------------------------------------------------------------------------
# Votes
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_vote_upserts_moves_blocks_own_and_clears(client):
    token_a, _a = _register(client, "janek")
    token_b, _b = _register(client, "petr")
    token_c, _c = _register(client, "karel")
    entry_a = _enter(client, token_a, _upload_photo(client, token_a)).json()["entry"]["id"]
    entry_b = _enter(client, token_b, _upload_photo(client, token_b)).json()["entry"]["id"]

    first = _vote(client, token_c, entry_a)
    repeat = _vote(client, token_c, entry_a)
    moved = _vote(client, token_c, entry_b)
    own = _vote(client, token_a, entry_a)
    unknown = _vote(client, token_c, str(uuid.uuid4()))

    assert first.status_code == status.HTTP_200_OK, first.content
    assert first.json() == {"entry_id": entry_a, "votes": 1}
    # Re-voting the same entry is an upsert, never a second row.
    assert repeat.status_code == status.HTTP_200_OK, repeat.content
    assert repeat.json() == {"entry_id": entry_a, "votes": 1}
    # Voting elsewhere MOVES the single vote.
    assert moved.status_code == status.HTTP_200_OK, moved.content
    assert moved.json() == {"entry_id": entry_b, "votes": 1}
    assert PhotoContestVote.objects.count() == 1
    assert own.status_code == status.HTTP_400_BAD_REQUEST, own.content
    assert own.json()["code"] == "cannot_vote_own"
    assert unknown.status_code == status.HTTP_404_NOT_FOUND, unknown.content
    assert unknown.json()["code"] == "entry_not_found"

    cleared = client.delete("/v1/photo-contest/vote", **_auth(token_c))
    again = client.delete("/v1/photo-contest/vote", **_auth(token_c))

    assert cleared.status_code == status.HTTP_204_NO_CONTENT
    assert again.status_code == status.HTTP_204_NO_CONTENT
    assert PhotoContestVote.objects.count() == 0


@pytest.mark.django_db
def test_vote_rejects_blocked_or_inactive_author_entries(client):
    token_a, a = _register(client, "janek")
    token_b, b = _register(client, "petr")
    token_voter, voter = _register(client, "karel")
    entry_a = _enter(client, token_a, _upload_photo(client, token_a)).json()["entry"]["id"]
    entry_b = _enter(client, token_b, _upload_photo(client, token_b)).json()["entry"]["id"]
    # A blocks the voter (block gating is bidirectional) …
    FriendBlock.objects.create(blocker=a, blocked=voter)
    # … and B's account is no longer active.
    b.status = Account.Status.PENDING_DELETION
    b.save(update_fields=["status"])

    blocked_vote = _vote(client, token_voter, entry_a)
    inactive_vote = _vote(client, token_voter, entry_b)

    # Entries the read path hides are unvotable with the same opaque not-found.
    assert blocked_vote.status_code == status.HTTP_404_NOT_FOUND, blocked_vote.content
    assert blocked_vote.json()["code"] == "entry_not_found"
    assert inactive_vote.status_code == status.HTTP_404_NOT_FOUND, inactive_vote.content
    assert inactive_vote.json()["code"] == "entry_not_found"
    assert PhotoContestVote.objects.count() == 0


# ---------------------------------------------------------------------------
# GET wire shape
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_contest_wire_shape_votes_and_blocked_exclusion(client):
    token_a, a = _register(client, "janek")
    token_b, b = _register(client, "petr")
    token_blocked, blocked = _register(client, "blokovany")
    # A private photo is still shown to contest viewers once entered (opt-in).
    photo_a = _upload_photo(client, token_a, caption="moje", visibility="private")
    entry_a = _enter(client, token_a, photo_a).json()["entry"]["id"]
    entry_b = _enter(client, token_b, _upload_photo(client, token_b)).json()["entry"]["id"]
    _enter(client, token_blocked, _upload_photo(client, token_blocked))
    FriendBlock.objects.create(blocker=a, blocked=blocked)
    assert _vote(client, token_b, entry_a).status_code == status.HTTP_200_OK
    assert _vote(client, token_a, entry_b).status_code == status.HTTP_200_OK

    resp = client.get("/v1/photo-contest", **_auth(token_a))

    assert resp.status_code == status.HTTP_200_OK, resp.content
    body = resp.json()
    assert set(body.keys()) == {
        "contest",
        "entries",
        "my_entry_id",
        "my_entry_photo_id",
        "my_vote_entry_id",
        "last_results",
    }
    # Blocked accounts' entries are hidden (bidirectional block).
    assert [e["id"] for e in body["entries"]] == [entry_b, entry_a]
    assert body["my_entry_id"] == entry_a
    assert body["my_entry_photo_id"] == photo_a
    assert body["my_vote_entry_id"] == entry_b

    mine = body["entries"][1]
    assert set(mine.keys()) == {
        "id",
        "account",
        "photo_id",
        "image_url",
        "caption",
        "pub_name",
        "pub_city",
        "votes",
        "my_vote",
        "is_mine",
        "created_at",
    }
    assert mine["photo_id"] == photo_a
    assert mine["account"]["public_id"] == str(a.public_id)
    assert mine["account"]["nickname"] == "janek"
    assert mine["account"]["display_name"] == "Janek"
    assert mine["account"]["avatar_url"] is None
    assert mine["caption"] == "moje"
    assert mine["votes"] == 1
    assert mine["my_vote"] is False
    assert mine["is_mine"] is True
    theirs = body["entries"][0]
    assert theirs["my_vote"] is True
    assert theirs["is_mine"] is False

    # The blocked party doesn't see A's entry either.
    mirrored = client.get("/v1/photo-contest", **_auth(token_blocked)).json()
    assert str(a.public_id) not in [e["account"]["public_id"] for e in mirrored["entries"]]


@pytest.mark.django_db
def test_contest_get_query_count_is_bounded(client, django_assert_max_num_queries):
    tokens = []
    for i in range(5):
        token, _account = _register(client, f"pivar{i}")
        tokens.append(token)
        entry = _enter(client, token, _upload_photo(client, token))
        assert entry.status_code == status.HTTP_201_CREATED
    viewer_token, _viewer = _register(client, "divak")

    # Entries + votes come from ONE annotated queryset — the total stays flat
    # no matter how many entries the round has (no per-entry N+1).
    with django_assert_max_num_queries(16):
        resp = client.get("/v1/photo-contest", **_auth(viewer_token))
    assert resp.status_code == status.HTTP_200_OK
    assert len(resp.json()["entries"]) == 5


# ---------------------------------------------------------------------------
# Closing (advance_photo_contests)
# ---------------------------------------------------------------------------


def _stats(account: Account) -> tuple[int, int]:
    row = AccountUsageStats.objects.filter(account=account).first()
    if row is None:
        return 0, 0
    return row.mapper_xp, row.photo_contest_wins_count


def _add_votes(contest: PhotoContest, entry: PhotoContestEntry, count: int) -> None:
    for _ in range(count):
        voter = Account.objects.create(device_id=str(uuid.uuid4()))
        PhotoContestVote.objects.create(contest=contest, entry=entry, voter=voter)


@pytest.mark.django_db
def test_advance_closes_ranks_awards_and_is_idempotent(client):
    token_win, win = _register(client, "vitez")
    token_second, second = _register(client, "druhy")
    token_third, third = _register(client, "treti")
    token_fourth, fourth = _register(client, "ctvrty")
    for token in (token_win, token_second, token_third, token_fourth):
        assert _enter(client, token, _upload_photo(client, token)).status_code == 201

    contest = PhotoContest.objects.get()
    entries = {e.account_id: e for e in contest.entries.all()}
    _add_votes(contest, entries[win.pk], 3)
    _add_votes(contest, entries[second.pk], 2)
    _add_votes(contest, entries[third.pk], 2)
    # Tiebreak between the two 2-vote entries: the EARLIER entry wins rank 2.
    base = timezone.now()
    PhotoContestEntry.objects.filter(pk=entries[third.pk].pk).update(
        created_at=base - timedelta(days=2)
    )
    PhotoContestEntry.objects.filter(pk=entries[second.pk].pk).update(
        created_at=base - timedelta(days=1)
    )
    _shift_contest_to_past(contest)

    call_command("advance_photo_contests")

    contest.refresh_from_db()
    assert contest.status == PhotoContest.Status.CLOSED
    assert contest.closed_at is not None
    ranked = {e.account_id: (e.final_rank, e.final_votes) for e in contest.entries.all()}
    assert ranked[win.pk] == (1, 3)
    assert ranked[third.pk] == (2, 2)  # earlier created_at wins the tie
    assert ranked[second.pk] == (3, 2)
    assert ranked[fourth.pk] == (None, None)
    assert _stats(win) == (100, 1)
    assert _stats(third) == (50, 0)
    assert _stats(second) == (25, 0)
    assert _stats(fourth) == (0, 0)
    # The next open round exists and is the real current window.
    next_round = PhotoContest.objects.get(status=PhotoContest.Status.OPEN)
    assert next_round.period_start == current_period_bounds()[0]

    # A second run changes nothing (idempotent under repeated worker ticks).
    call_command("advance_photo_contests")
    assert _stats(win) == (100, 1)
    assert _stats(third) == (50, 0)
    assert PhotoContest.objects.filter(status=PhotoContest.Status.OPEN).count() == 1

    # The winner's profile unlocks the FotoPivař badge.
    me = client.get("/v1/account/me", **_auth(token_win))
    assert me.status_code == status.HTTP_200_OK, me.content
    assert me.json()["achievements"]["foto_pivar"] is True
    loser_me = client.get("/v1/account/me", **_auth(token_fourth))
    assert loser_me.json()["achievements"]["foto_pivar"] is False

    # And GET /v1/photo-contest now reports the closed round as last_results.
    results = client.get("/v1/photo-contest", **_auth(token_win)).json()["last_results"]
    assert results["contest"]["id"] == str(contest.public_id)
    assert [(w["rank"], w["votes"]) for w in results["winners"]] == [(1, 3), (2, 2), (3, 2)]
    assert results["winners"][0]["account"]["nickname"] == "vitez"
    assert results["winners"][0]["image_url"].endswith(".webp")


@pytest.mark.django_db
def test_deleting_winner_photo_keeps_win_counter(client):
    token_win, win = _register(client, "vitez")
    photo_id = _upload_photo(client, token_win)
    assert _enter(client, token_win, photo_id).status_code == 201
    contest = PhotoContest.objects.get()
    _add_votes(contest, contest.entries.get(), 2)
    _shift_contest_to_past(contest)
    call_command("advance_photo_contests")
    assert _stats(win) == (100, 1)

    deleted = client.delete(f"/v1/beer-photos/{photo_id}", **_auth(token_win))

    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    # The entry row cascades away with the photo, but the win is durable.
    assert PhotoContestEntry.objects.count() == 0
    assert _stats(win) == (100, 1)
    me = client.get("/v1/account/me", **_auth(token_win))
    assert me.json()["achievements"]["foto_pivar"] is True


@pytest.mark.django_db
def test_advance_zero_vote_round_has_no_winners_or_xp(client):
    token, account = _register(client, "osamely")
    assert _enter(client, token, _upload_photo(client, token)).status_code == 201
    contest = PhotoContest.objects.get()
    _shift_contest_to_past(contest)

    call_command("advance_photo_contests")

    contest.refresh_from_db()
    assert contest.status == PhotoContest.Status.CLOSED
    # A zero-vote entry never ranks: a lone entrant cannot farm the badge + XP
    # just by being the only one who showed up.
    entry = contest.entries.get()
    assert (entry.final_rank, entry.final_votes) == (None, None)
    assert _stats(account) == (0, 0)
    me = client.get("/v1/account/me", **_auth(token))
    assert me.json()["achievements"]["foto_pivar"] is False
    results = client.get("/v1/photo-contest", **_auth(token)).json()["last_results"]
    assert results["contest"]["id"] == str(contest.public_id)
    assert results["winners"] == []


@pytest.mark.django_db
def test_last_results_hide_blocked_and_inactive_winners(client):
    token_first, first = _register(client, "prvni")
    token_second, second = _register(client, "druhy")
    token_third, third = _register(client, "treti")
    token_viewer, viewer = _register(client, "divak")
    for token in (token_first, token_second, token_third):
        assert _enter(client, token, _upload_photo(client, token)).status_code == 201
    contest = PhotoContest.objects.get()
    entries = {e.account_id: e for e in contest.entries.all()}
    _add_votes(contest, entries[first.pk], 3)
    _add_votes(contest, entries[second.pk], 2)
    _add_votes(contest, entries[third.pk], 1)
    _shift_contest_to_past(contest)
    call_command("advance_photo_contests")

    # After closing, the viewer blocks the rank-2 winner and the rank-3 winner
    # soft-deletes their account.
    FriendBlock.objects.create(blocker=viewer, blocked=second)
    third.status = Account.Status.PENDING_DELETION
    third.save(update_fields=["status"])

    results = client.get("/v1/photo-contest", **_auth(token_viewer)).json()["last_results"]

    # Stamped ranks/XP stay untouched; only the viewer's results view filters.
    assert [(w["rank"], w["account"]["nickname"]) for w in results["winners"]] == [(1, "prvni")]
    assert _stats(second) == (50, 0)
    assert _stats(third) == (25, 0)
    # An unrelated viewer still sees the blocked winner (block is per-pair).
    other = client.get("/v1/photo-contest", **_auth(token_first)).json()["last_results"]
    assert [w["rank"] for w in other["winners"]] == [1, 2]

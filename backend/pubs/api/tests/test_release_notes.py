"""
Tests for the "what's new" release-notes endpoint (ReleaseNotesView).

GET /v1/release-notes?version=<app-version> returns the published note for that
version (title + ordered highlight items), or 404 when none exists. It is
unauthenticated — the app calls it on launch right after an update.

All tests use pytest-django with APIClient.
"""

from __future__ import annotations

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import ReleaseNote, ReleaseNoteItem


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _isolate_release_notes(db):
    # Data migrations (e.g. 0043_release_note_1_2_0) seed published notes — some
    # at versions these tests also author — into the test database. Start each
    # test from an empty table so authoring "1.2.0" does not hit the unique
    # version constraint on the migration-seeded row.
    ReleaseNote.objects.all().delete()


def _make_note(version: str, *, published: bool = True, title: str = "Co je nového") -> ReleaseNote:
    note = ReleaseNote.objects.create(version=version, title=title, is_published=published)
    # Insert out of declaration order to prove ordering is by `order`, not PK.
    ReleaseNoteItem.objects.create(release_note=note, icon="🗺️", text="Druhá novinka", order=2)
    ReleaseNoteItem.objects.create(release_note=note, icon="🍺", text="První novinka", order=1)
    return note


# ---------------------------------------------------------------------------
# GET /v1/release-notes — published note
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_returns_published_note_for_version(client):
    _make_note("1.2.0")

    resp = client.get("/v1/release-notes", {"version": "1.2.0"})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["version"] == "1.2.0"
    assert body["title"] == "Co je nového"
    # Items come back ordered by `order`, not by insertion / PK.
    assert [it["text"] for it in body["items"]] == ["První novinka", "Druhá novinka"]
    assert body["items"][0]["icon"] == "🍺"


@pytest.mark.django_db
def test_publishing_stamps_published_at(client):
    note = _make_note("1.2.0")
    assert note.published_at is not None


# ---------------------------------------------------------------------------
# 404 cases — draft, unknown version
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_draft_note_is_not_returned(client):
    _make_note("1.2.0", published=False)

    resp = client.get("/v1/release-notes", {"version": "1.2.0"})

    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_unknown_version_returns_404(client):
    _make_note("1.2.0")

    resp = client.get("/v1/release-notes", {"version": "9.9.9"})

    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_newer_version_note_is_not_returned_for_older_version(client):
    _make_note("1.1.1")

    resp = client.get("/v1/release-notes", {"version": "1.1.0"})

    assert resp.status_code == status.HTTP_404_NOT_FOUND


# ---------------------------------------------------------------------------
# GET /v1/release-notes (no version) — full changelog collection
#
# NOTE: data migrations seed real notes (1.1.2, 1.1.3), so the test DB is never
# empty. These tests assert membership against that baseline using high, unique
# version strings, never an exact full list.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_version_returns_all_published_notes(client):
    _make_note("9.0.0")
    _make_note("9.1.0")

    resp = client.get("/v1/release-notes")

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    versions = {note["version"] for note in body["notes"]}
    assert {"9.0.0", "9.1.0"} <= versions
    # Each note keeps the full single-note shape (title + ordered items).
    by_version = {note["version"]: note for note in body["notes"]}
    mine = by_version["9.0.0"]
    assert set(mine.keys()) == {"version", "title", "items"}
    assert [it["text"] for it in mine["items"]] == ["První novinka", "Druhá novinka"]


@pytest.mark.django_db
def test_blank_version_param_returns_full_list(client):
    """A blank/whitespace version is treated as "no version" → the collection."""
    _make_note("9.2.0")

    resp = client.get("/v1/release-notes", {"version": "   "})

    assert resp.status_code == status.HTTP_200_OK
    assert "9.2.0" in {note["version"] for note in resp.json()["notes"]}


@pytest.mark.django_db
def test_list_excludes_draft_notes(client):
    _make_note("9.0.0", published=True)
    _make_note("9.1.0", published=False)

    resp = client.get("/v1/release-notes")

    assert resp.status_code == status.HTTP_200_OK
    versions = {note["version"] for note in resp.json()["notes"]}
    assert "9.0.0" in versions
    assert "9.1.0" not in versions


@pytest.mark.django_db
def test_list_is_ordered_newest_first(client):
    """Ordering follows ReleaseNote.Meta (-created_at): the most recently created
    note appears before an earlier one."""
    _make_note("9.0.0")
    _make_note("9.1.0")

    resp = client.get("/v1/release-notes")

    versions = [note["version"] for note in resp.json()["notes"]]
    assert versions.index("9.1.0") < versions.index("9.0.0")


# ---------------------------------------------------------------------------
# Public access — no auth required
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_endpoint_is_public(client):
    """No Authorization header is needed — the app calls this before/without an account."""
    _make_note("1.2.0")

    resp = client.get("/v1/release-notes", {"version": "1.2.0"})

    assert resp.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_note_without_items_still_serializes(client):
    """A published note with no highlight rows returns an empty items list (not 500)."""
    ReleaseNote.objects.create(version="1.2.0", is_published=True)

    resp = client.get("/v1/release-notes", {"version": "1.2.0"})

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["items"] == []

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


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_missing_version_param_returns_400(client):
    resp = client.get("/v1/release-notes")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_blank_version_param_returns_400(client):
    resp = client.get("/v1/release-notes", {"version": "   "})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


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

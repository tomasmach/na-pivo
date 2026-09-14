import uuid
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
from django.contrib import admin

from pubs.enrichment import geohash8
from pubs.models import Account, PublishedNight, PublishedNightComment, UserAddedPub


def _make_comment(account: Account, *, client_id: str) -> PublishedNightComment:
    comment_client_id = uuid.uuid5(uuid.NAMESPACE_URL, client_id)
    assert str(comment_client_id) != client_id
    drinking_day = date(2026, 7, 21) + timedelta(days=int(comment_client_id) % 30)
    night = PublishedNight.objects.create(
        account=account,
        client_id=client_id,
        drinking_day=drinking_day,
        started_at=datetime(drinking_day.year, drinking_day.month, drinking_day.day, 18, tzinfo=UTC),
        ended_at=datetime(drinking_day.year, drinking_day.month, drinking_day.day, 22, tzinfo=UTC),
        beer_count=1,
        wine_count=0,
        soft_drink_count=0,
        shot_count=0,
        pub_names=[],
        city="",
        duration_minutes=240,
        visibility="public",
        updated_at=datetime(drinking_day.year, drinking_day.month, drinking_day.day, 22, tzinfo=UTC),
    )
    comment_client_id = uuid.uuid5(uuid.NAMESPACE_URL, client_id)
    assert str(comment_client_id) != client_id
    return PublishedNightComment.objects.create(
        night=night,
        account=account,
        client_id=comment_client_id,
        body="Nazdar u stolu.",
    )


@pytest.mark.django_db
def test_published_night_comment_is_registered_with_remove_action():
    model_admin = admin.site._registry[PublishedNightComment]

    assert "remove_comments" in model_admin.actions


@pytest.mark.django_db
def test_remove_comments_action_soft_removes_only_selected_comments():
    author = Account.objects.create(device_id="comment-admin-moderation")
    kept = _make_comment(author, client_id="kept-night")
    untouched = _make_comment(author, client_id="untouched-night")

    model_admin = admin.site._registry[PublishedNightComment]
    model_admin.remove_comments(
        None,
        PublishedNightComment.objects.filter(pk=kept.pk),
    )

    kept.refresh_from_db()
    untouched.refresh_from_db()
    assert kept.is_removed is True
    assert untouched.is_removed is False


@pytest.mark.django_db
def test_remove_comments_action_bumps_updated_at_only_for_selected_rows():
    """Soft removal must advance updated_at exactly like the API delete does,
    with one shared timestamp across the bulk update; untouched rows stay put."""
    author = Account.objects.create(device_id="comment-admin-updated-at")
    first_removed = _make_comment(author, client_id="removed-one")
    second_removed = _make_comment(author, client_id="removed-two")
    untouched = _make_comment(author, client_id="untouched-night")
    frozen = datetime(2026, 8, 1, 12, tzinfo=UTC)
    PublishedNightComment.objects.update(updated_at=frozen)

    model_admin = admin.site._registry[PublishedNightComment]
    model_admin.remove_comments(
        None,
        PublishedNightComment.objects.filter(pk__in=[first_removed.pk, second_removed.pk]),
    )

    first_removed.refresh_from_db()
    second_removed.refresh_from_db()
    untouched.refresh_from_db()
    assert first_removed.is_removed is True
    assert second_removed.is_removed is True
    assert first_removed.updated_at > frozen
    assert second_removed.updated_at > frozen
    # One shared timestamp for the whole bulk update.
    assert first_removed.updated_at == second_removed.updated_at
    assert untouched.is_removed is False
    assert untouched.updated_at == frozen


@pytest.mark.django_db
def test_user_added_pub_admin_recomputes_cache_key_after_coordinate_edit():
    pub = UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key=geohash8(50.0812, 14.4182),
        name="Hospoda U Komunity",
        lat=50.0812,
        lng=14.4182,
    )
    pub.lat = 49.1951
    pub.lng = 16.6068
    form = SimpleNamespace(changed_data=["lat", "lng"])

    admin.site._registry[UserAddedPub].save_model(None, pub, form, change=True)

    pub.refresh_from_db()
    assert pub.cache_key == geohash8(49.1951, 16.6068)

import uuid

import pytest
from django.contrib.auth.models import Permission, User
from django.core.cache import cache
from django.test import Client
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.tests.test_nights import _auth, _publish, _register
from pubs.api.tests.test_pub_events import _claimed_account
from pubs.api.tests.test_pub_events import _payload as _event_payload
from pubs.models import ContentReport, FeedbackReport, PublishedNight, PublishedNightComment
from pubs.pub_events import PubEvent

QUEUE = "/admin/fronta/"


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def admin_client():
    client = Client()
    client.force_login(User.objects.create_superuser("mach", "mach@example.com", "x"))
    return client


def _feedback(api, token, message, category="bug"):
    response = api.post(
        "/v1/feedback",
        data={"client_id": str(uuid.uuid4()), "category": category, "message": message, "app_version": "2.4.1", "platform": "ios"},
        format="json",
        **_auth(token),
    )
    assert response.status_code == status.HTTP_201_CREATED, response.content
    return FeedbackReport.objects.get(pk=response.json()["id"])


def _reported_comment(api):
    owner_token, _ = _register(api, "autor")
    commenter_token, commenter = _register(api, "hulvat")
    reporter_token, _ = _register(api, "hlidac")
    night = _publish(api, owner_token, visibility="public").json()["night"]
    created = api.post(
        f"/v1/nights/{night['id']}/comments",
        data={"client_id": str(uuid.uuid4()), "body": "Jsi úplně mimo, vole."},
        format="json",
        **_auth(commenter_token),
    )
    assert created.status_code == status.HTTP_201_CREATED, created.content
    comment_id = created.json()["comment"]["id"]
    reported = api.post(
        "/v1/content-reports",
        data={"target_account_id": str(commenter.public_id), "reason": ContentReport.Reason.OTHER, "comment_id": comment_id},
        format="json",
        **_auth(reporter_token),
    )
    assert reported.status_code == status.HTTP_201_CREATED, reported.content
    return ContentReport.objects.get(pk=reported.json()["id"]), PublishedNightComment.objects.get(public_id=comment_id)


@pytest.mark.django_db
def test_queue_shows_waiting_feedback_and_resolving_removes_it(api, admin_client):
    token, author = _register(api, "klara")
    waiting = _feedback(api, token, "Po aktualizaci mi zmizel večer")

    page = admin_client.get(QUEUE).content.decode()

    assert "Po aktualizaci mi zmizel večer" in page
    assert "@klara" in page
    assert str(author.public_id) not in page

    response = admin_client.post(QUEUE, {"item": f"feedback:{waiting.pk}", "action": "resolve"})

    assert response.status_code == 302
    waiting.refresh_from_db()
    assert waiting.status == FeedbackReport.Status.RESOLVED
    assert "Po aktualizaci mi zmizel večer" not in admin_client.get(QUEUE).content.decode()


@pytest.mark.django_db
def test_hiding_a_reported_comment_from_the_queue_hides_it_and_settles_the_report(api, admin_client):
    report, comment = _reported_comment(api)

    page = admin_client.get(QUEUE).content.decode()
    assert "Komentář od @hulvat" in page
    assert "Jsi úplně mimo, vole." in page

    admin_client.post(QUEUE, {"item": f"report:{report.pk}", "action": "remove_comment"})

    comment.refresh_from_db()
    report.refresh_from_db()
    assert comment.is_removed is True
    assert report.status == ContentReport.Status.ACTIONED
    assert "Komentář od @hulvat" not in admin_client.get(QUEUE).content.decode()


@pytest.mark.django_db
def test_keeping_reported_content_dismisses_the_report_and_leaves_the_comment(api, admin_client):
    report, comment = _reported_comment(api)

    admin_client.post(QUEUE, {"item": f"report:{report.pk}", "action": "dismiss"})

    comment.refresh_from_db()
    report.refresh_from_db()
    assert comment.is_removed is False
    assert report.status == ContentReport.Status.DISMISSED


@pytest.mark.django_db
def test_pending_pub_event_can_be_verified_from_the_queue(api, admin_client):
    _, token = _claimed_account()
    created = api.post("/v1/pub-events", _event_payload(timezone.now()), format="json", **_auth(token))
    assert created.status_code == status.HTTP_201_CREATED, created.content
    event = PubEvent.objects.get()

    assert "Hospodský kvíz" in admin_client.get(f"{QUEUE}?typ=event").content.decode()

    admin_client.post(QUEUE, {"item": f"event:{event.pk}", "action": "verify"})

    event.refresh_from_db()
    assert event.status == PubEvent.Status.VERIFIED
    assert event.verified_at is not None
    assert [row["title"] for row in api.get(f"/v1/pub-events?cache_key={event.cache_key}").json()["events"]] == ["Hospodský kvíz"]


@pytest.mark.django_db
def test_staff_who_may_only_view_feedback_see_it_without_buttons_and_cannot_resolve(api):
    token, _ = _register(api, "klara")
    waiting = _feedback(api, token, "Soukromá zpráva")
    report, _ = _reported_comment(api)
    staff = User.objects.create_user("staff", "staff@example.com", "x", is_staff=True)
    staff.user_permissions.add(Permission.objects.get(codename="view_feedbackreport"))
    client = Client()
    client.force_login(staff)

    page = client.get(QUEUE).content.decode()

    assert "Soukromá zpráva" in page
    assert "Vyřízeno" not in page
    assert "Komentář od @hulvat" not in page

    client.post(QUEUE, {"item": f"feedback:{waiting.pk}", "action": "resolve"})
    client.post(QUEUE, {"item": f"report:{report.pk}", "action": "dismiss"})

    waiting.refresh_from_db()
    report.refresh_from_db()
    assert waiting.status == FeedbackReport.Status.NEW
    assert report.status == ContentReport.Status.NEW


@pytest.mark.django_db
def test_a_broken_queue_form_shows_a_warning_instead_of_failing(admin_client):
    response = admin_client.post(QUEUE, {"item": "report:abc", "action": "dismiss"}, follow=True)

    assert response.status_code == 200
    assert "Tohle už někdo vyřídil" in response.content.decode()


@pytest.mark.django_db
def test_account_profile_shows_activity_and_lists_show_no_identifiers(api, admin_client):
    token, account = _register(api, "klara")
    _publish(api, token, visibility="public", pub_names=["U Zlatého tygra"])
    _feedback(api, token, "Mapa se nenačte")

    profile = admin_client.get(f"/admin/pubs/account/{account.pk}/change/").content.decode()

    assert "Poslední aktivita" in profile
    assert "U Zlatého tygra" in profile
    assert "Mapa se nenačte" in profile

    for url in ("/admin/pubs/account/", "/admin/pubs/publishednight/", "/admin/pubs/feedbackreport/"):
        page = admin_client.get(url).content.decode()
        assert "@klara" in page, url
        assert str(account.public_id) not in page, url
        assert account.device_id not in page, url


@pytest.mark.django_db
def test_admin_speaks_czech_even_for_an_english_browser(admin_client):
    page = admin_client.get("/admin/pubs/publishednight/", HTTP_ACCEPT_LANGUAGE="en-US").content.decode()

    assert "Hledat…" in page
    assert "Type to search" not in page
    assert "Published nights" not in page


@pytest.mark.django_db
def test_night_detail_only_lets_the_admin_hide_the_night(api, admin_client):
    token, _ = _register(api, "klara")
    _publish(api, token, visibility="public", pub_names=["U Zlatého tygra"])
    night = PublishedNight.objects.get()
    url = f"/admin/pubs/publishednight/{night.pk}/change/"

    page = admin_client.get(url).content.decode()
    assert "U Zlatého tygra" in page
    assert "\\u00e9" not in page

    admin_client.post(url, {"is_removed": "on", "beer_count": 99, "pub_names": '["Jinde"]'})

    night.refresh_from_db()
    assert night.is_removed is True
    assert night.beer_count != 99
    assert night.pub_names == ["U Zlatého tygra"]

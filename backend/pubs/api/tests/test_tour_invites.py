"""Parta invites to a tour: who may invite whom, what the invitee sees, and the push."""

import uuid
from datetime import date, timedelta

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.accounts import _merge_anonymous_account, issue_token
from pubs.api.tour_invite_views import MyTourInviteListView, MyTourInviteView, TourInvitesView
from pubs.models import (
    Account,
    FriendBlock,
    FriendNotification,
    Friendship,
    PushDevice,
    TourInvite,
    TourPlan,
    TourShare,
)

pytestmark = pytest.mark.django_db


class _Expo:
    def raise_for_status(self):
        return None

    def json(self):
        return {"data": []}


@pytest.fixture(autouse=True)
def _sync_push(settings):
    settings.FRIEND_PUSH_ASYNC = False
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def pushes(monkeypatch):
    sent = []

    def post(url, *, json, timeout):
        sent.extend(json)
        return _Expo()

    monkeypatch.setattr("pubs.api.views.requests.post", post)
    return sent


def person(nickname, locale="cs"):
    account = Account.objects.create(device_id=str(uuid.uuid4()), nickname=nickname, display_name=nickname.title(),
                                     locale=locale, quiet_hours_enabled=False)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account)}")
    client.account = account
    PushDevice.objects.create(account=account, push_token=f"ExponentPushToken[{nickname}]", platform=PushDevice.Platform.IOS,
                              permission_status=PushDevice.PermissionStatus.GRANTED, enabled=True, locale=locale)
    return client


def befriend(a, b):
    Friendship.objects.create(requester=a.account, recipient=b.account, status=Friendship.Status.ACCEPTED, responded_at=timezone.now())


def tour(owner, *, shared=True, **fields):
    plan_id = str(uuid.uuid4())
    body = {"operation_id": str(uuid.uuid4()), "base_revision": 0, "title": "Vinohrady", "timezone": "Europe/Prague",
            "scheduled_date": None, "scheduled_time": None,
            "stops": [{"id": str(uuid.uuid4()), "pub_id": f"pub-{i}", "cache_key": f"u2fk{i}", "name": f"Hospoda {i}",
                       "address": "Praha", "lat": 50.07 + i / 1000, "lon": 14.44} for i in range(2)], **fields}
    assert owner.put(f"/v1/tours/{plan_id}", body, format="json").status_code == 201
    if shared:
        response = owner.post(f"/v1/tours/{plan_id}/share", {"operation_id": str(uuid.uuid4())}, format="json")
        assert response.status_code == 200
        return plan_id, response.json()["share"]["url"].rsplit("/", 1)[1]
    return plan_id, None


def invite(owner, plan_id, *friends):
    return owner.post(f"/v1/tours/{plan_id}/invites", {"recipient_ids": [str(f.account.public_id) for f in friends]}, format="json")


def test_every_invite_endpoint_needs_a_signed_in_account():
    anonymous = APIClient()
    plan_id = uuid.uuid4()
    assert anonymous.get(f"/v1/tours/{plan_id}/invites").status_code == 401
    assert anonymous.post(f"/v1/tours/{plan_id}/invites", {"recipient_ids": [str(uuid.uuid4())]}, format="json").status_code == 401
    assert anonymous.get(f"/v1/tour-invites/{plan_id}").status_code == 401
    assert anonymous.get("/v1/tour-invites").status_code == 401
    assert anonymous.put(f"/v1/tour-invites/{plan_id}", {"status": "going"}, format="json").status_code == 401


def test_throttle_scopes_are_set_per_method(settings):
    rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    for view, method, scope in ((TourInvitesView, "GET", "tour_invite_read"), (TourInvitesView, "POST", "tour_invite"),
                                (MyTourInviteView, "GET", "tour_invite_read"), (MyTourInviteView, "PUT", "tour_rsvp"),
                                (MyTourInviteListView, "GET", "tour_invite_read")):
        instance = view()
        instance.request = type("Request", (), {"method": method})()
        instance.get_throttles()
        assert instance.throttle_scope == scope
        assert rates[scope]


def test_owner_invites_friends_once_and_they_get_a_push_in_their_language(pushes, django_capture_on_commit_callbacks):
    owner, petr, jana = person("janek"), person("petr"), person("jana", locale="en")
    befriend(owner, petr)
    befriend(jana, owner)
    plan_id, token = tour(owner, scheduled_date=str(date(2026, 10, 2)), scheduled_time="19:00")

    with django_capture_on_commit_callbacks(execute=True):
        response = invite(owner, plan_id, petr, jana)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["invited"] == 2
    assert {row["account"]["nickname"]: row["status"] for row in body["invites"]} == {"petr": "invited", "jana": "invited"}

    by_token = {message["to"]: message for message in pushes}
    czech, english = by_token["ExponentPushToken[petr]"], by_token["ExponentPushToken[jana]"]
    assert czech["data"] == {"kind": "friend_tour_invite", "plan_id": plan_id, "tour_token": token}
    assert czech["title"] == "Pozvánka na tour"
    assert czech["body"] == "@janek tě zve na tour „Vinohrady“, pá 2. 10. v 19:00. Jdeš?"
    assert english["body"] == "@janek is inviting you on the tour “Vinohrady”, Fri 2 Oct at 19:00. You in?"
    notes = FriendNotification.objects.filter(kind=FriendNotification.Kind.FRIEND_TOUR_INVITE)
    assert sorted(notes.values_list("recipient__nickname", flat=True)) == ["jana", "petr"]

    # A retry from the offline queue, or a second tap, invites nobody twice.
    pushes.clear()
    with django_capture_on_commit_callbacks(execute=True):
        again = invite(owner, plan_id, petr, jana)
    assert again.status_code == 200
    assert again.json()["invited"] == 0
    assert pushes == []
    assert TourInvite.objects.filter(plan_id=plan_id).count() == 2
    assert notes.count() == 2


def test_only_accepted_friends_can_be_invited(pushes, django_capture_on_commit_callbacks):
    owner, friend, stranger, asked = person("janek"), person("petr"), person("cizi"), person("ceka")
    befriend(owner, friend)
    Friendship.objects.create(requester=owner.account, recipient=asked.account, status=Friendship.Status.PENDING)
    plan_id, _ = tour(owner)

    refused = invite(owner, plan_id, stranger, asked)
    assert refused.status_code == 400
    assert refused.json()["error"] == "not_friends"
    assert not TourInvite.objects.exists()

    with django_capture_on_commit_callbacks(execute=True):
        mixed = invite(owner, plan_id, friend, stranger)
    assert mixed.status_code == 201
    assert list(TourInvite.objects.values_list("invitee__nickname", flat=True)) == ["petr"]
    assert [message["to"] for message in pushes] == ["ExponentPushToken[petr]"]


def test_someone_elses_tour_and_a_tour_without_a_link_invite_nobody():
    owner, friend, other = person("janek"), person("petr"), person("jana")
    befriend(owner, friend)
    befriend(other, friend)
    plan_id, _ = tour(owner)
    assert invite(other, plan_id, friend).status_code == 404
    assert other.get(f"/v1/tours/{plan_id}/invites").status_code == 404

    unshared, _ = tour(owner, shared=False)
    response = invite(owner, unshared, friend)
    assert response.status_code == 409
    assert response.json()["error"] == "share_required"
    assert owner.delete(f"/v1/tours/{plan_id}/share").status_code == 204
    assert invite(owner, plan_id, friend).json()["error"] == "share_required"
    assert not TourInvite.objects.exists()


def test_invisible_mode_sends_no_invite(pushes, django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr")
    befriend(owner, friend)
    plan_id, _ = tour(owner)
    Account.objects.filter(pk=owner.account.pk).update(ghost_mode=True)
    with django_capture_on_commit_callbacks(execute=True):
        response = invite(owner, plan_id, friend)
    assert response.status_code == 409
    assert response.json()["error"] == "ghost_mode"
    assert not TourInvite.objects.exists()
    assert not FriendNotification.objects.exists()
    assert pushes == []


def test_invitee_answers_and_the_owner_sees_who_goes(django_capture_on_commit_callbacks):
    owner, petr, jana, outsider = person("janek"), person("petr"), person("jana"), person("cizi")
    befriend(owner, petr)
    befriend(owner, jana)
    plan_id, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, petr, jana)

    mine = petr.get(f"/v1/tour-invites/{plan_id}")
    assert mine.status_code == 200
    assert mine.json()["status"] == "invited"
    assert mine.json()["inviter"]["nickname"] == "janek"
    assert outsider.get(f"/v1/tour-invites/{plan_id}").status_code == 404
    assert outsider.put(f"/v1/tour-invites/{plan_id}", {"status": "going"}, format="json").status_code == 404
    assert petr.put(f"/v1/tour-invites/{plan_id}", {"status": "maybe"}, format="json").status_code == 400

    going = petr.put(f"/v1/tour-invites/{plan_id}", {"status": "going"}, format="json")
    assert going.status_code == 200
    assert going.json()["status"] == "going"
    assert jana.put(f"/v1/tour-invites/{plan_id}", {"status": "declined"}, format="json").json()["status"] == "declined"
    roster = {row["account"]["nickname"]: row["status"] for row in owner.get(f"/v1/tours/{plan_id}/invites").json()["invites"]}
    assert roster == {"petr": "going", "jana": "declined"}

    # A change of mind is the same request.
    assert jana.put(f"/v1/tour-invites/{plan_id}", {"status": "going"}, format="json").json()["status"] == "going"
    assert TourInvite.objects.get(plan_id=plan_id, invitee=jana.account).status == "going"
    # Nobody else reads the roster.
    assert petr.get(f"/v1/tours/{plan_id}/invites").status_code == 404


def test_a_block_hides_the_invite_both_ways(django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr")
    befriend(owner, friend)
    plan_id, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
    FriendBlock.objects.create(blocker=friend.account, blocked=owner.account)
    assert owner.get(f"/v1/tours/{plan_id}/invites").json()["invites"] == []
    assert friend.get(f"/v1/tour-invites/{plan_id}").status_code == 404


def test_deleting_the_tour_ends_its_invites(django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr")
    befriend(owner, friend)
    plan_id, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
    assert owner.delete(f"/v1/tours/{plan_id}").status_code == 204
    assert not TourInvite.objects.exists()
    assert friend.get(f"/v1/tour-invites/{plan_id}").status_code == 404


def test_claiming_an_account_keeps_one_answer_per_tour(django_capture_on_commit_callbacks):
    from django.db import transaction

    owner, anonymous, claimed = person("janek"), person("anon"), person("petr")
    befriend(owner, anonymous)
    befriend(owner, claimed)
    first, _ = tour(owner)
    second, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, first, anonymous, claimed)
        invite(owner, second, anonymous)
    claimed.put(f"/v1/tour-invites/{first}", {"status": "going"}, format="json")
    with transaction.atomic():
        _merge_anonymous_account(Account.objects.get(pk=anonymous.account.pk), Account.objects.get(pk=claimed.account.pk))
    rows = dict(TourInvite.objects.filter(invitee=claimed.account).values_list("plan_id", "status"))
    assert rows == {uuid.UUID(first): "going", uuid.UUID(second): "invited"}
    assert not TourInvite.objects.filter(invitee=anonymous.account).exists()


def test_invite_without_a_meetup_time_reads_plainly(pushes, django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr")
    befriend(owner, friend)
    plan_id, _ = tour(owner)
    TourPlan.objects.filter(pk=plan_id).update(scheduled_date=None, scheduled_time=None)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
    assert pushes[0]["body"] == "@janek tě zve na tour „Vinohrady“. Jdeš?"


def test_date_only_invite(pushes, django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr", locale="en")
    befriend(owner, friend)
    plan_id, _ = tour(owner)
    TourPlan.objects.filter(pk=plan_id).update(scheduled_date=date(2026, 10, 3), scheduled_time=None)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
    assert pushes[0]["body"] == "@janek is inviting you on the tour “Vinohrady”, Sat 3 Oct. You in?"


def test_an_invitee_lists_open_invites_without_the_push(django_capture_on_commit_callbacks):
    owner, friend, other = person("janek"), person("petr"), person("jana")
    befriend(owner, friend)
    befriend(other, friend)
    plan_id, token = tour(owner, scheduled_date=str(date(2026, 10, 2)), scheduled_time="19:00")
    gone_id, _ = tour(other)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
        invite(other, gone_id, friend)
    # A tour whose link was revoked no longer opens, so it is not listed.
    assert other.delete(f"/v1/tours/{gone_id}/share").status_code == 204

    response = friend.get("/v1/tour-invites")
    assert response.status_code == 200
    assert response.json() == {"invites": [{
        "plan_id": plan_id, "status": "invited", "token": token, "title": "Vinohrady",
        "scheduled_date": "2026-10-02", "scheduled_time": "19:00", "timezone": "Europe/Prague", "first_pub": "Hospoda 0",
        "inviter": response.json()["invites"][0]["inviter"], "invited_at": response.json()["invites"][0]["invited_at"], "responded_at": None,
    }]}
    assert response.json()["invites"][0]["inviter"]["nickname"] == "janek"
    assert owner.get("/v1/tour-invites").json() == {"invites": []}

    friend.put(f"/v1/tour-invites/{plan_id}", {"status": "going"}, format="json")
    assert friend.get("/v1/tour-invites").json()["invites"][0]["status"] == "going"
    FriendBlock.objects.create(blocker=owner.account, blocked=friend.account)
    assert friend.get("/v1/tour-invites").json() == {"invites": []}


def test_a_new_link_makes_an_invite_sendable_again(pushes, django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr")
    befriend(owner, friend)
    plan_id, old_token = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
    rotated = owner.post(f"/v1/tours/{plan_id}/share", {"operation_id": str(uuid.uuid4()), "rotate": True}, format="json")
    new_token = rotated.json()["share"]["url"].rsplit("/", 1)[1]
    assert new_token != old_token
    roster = owner.get(f"/v1/tours/{plan_id}/invites").json()["invites"]
    assert roster[0]["stale"] is True

    pushes.clear()
    with django_capture_on_commit_callbacks(execute=True):
        again = invite(owner, plan_id, friend)
    assert again.status_code == 201
    assert again.json()["invited"] == 1
    assert again.json()["invites"][0]["stale"] is False
    assert [message["data"]["tour_token"] for message in pushes] == [new_token]
    assert TourInvite.objects.filter(plan_id=plan_id).count() == 1
    # The same link again is still a no-op.
    pushes.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert invite(owner, plan_id, friend).json()["invited"] == 0
    assert pushes == []


def test_the_list_never_hands_a_new_link_to_someone_not_invited_again(django_capture_on_commit_callbacks):
    owner, petr, jana = person("janek"), person("petr"), person("jana")
    befriend(owner, petr)
    befriend(owner, jana)
    plan_id, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, petr, jana)
    owner.post(f"/v1/tours/{plan_id}/share", {"operation_id": str(uuid.uuid4()), "rotate": True}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, petr)
    new_token = owner.get(f"/v1/tours/{plan_id}").json()["share"]["url"].rsplit("/", 1)[1]
    assert [row["token"] for row in petr.get("/v1/tour-invites").json()["invites"]] == [new_token]
    assert jana.get("/v1/tour-invites").json() == {"invites": []}


def test_unusable_invites_do_not_crowd_out_usable_ones(django_capture_on_commit_callbacks):
    friend = person("petr")
    owners = [person(f"autor{i}") for i in range(3)]
    usable = None
    for index, owner in enumerate(owners):
        befriend(owner, friend)
        plan_id, _ = tour(owner)
        with django_capture_on_commit_callbacks(execute=True):
            invite(owner, plan_id, friend)
        if index == 0:
            usable = plan_id
    # Newer invites whose link went away or whose owner is blocked take no room from the older, working one.
    owners[1].delete(f"/v1/tours/{TourInvite.objects.filter(plan__owner=owners[1].account).get().plan_id}/share")
    FriendBlock.objects.create(blocker=friend.account, blocked=owners[2].account)
    import pubs.api.tour_invite_views as views
    original, views.INVITES_PER_TOUR = views.INVITES_PER_TOUR, 1
    try:
        assert [row["plan_id"] for row in friend.get("/v1/tour-invites").json()["invites"]] == [usable]
    finally:
        views.INVITES_PER_TOUR = original


def test_the_roster_hides_a_friend_who_blocked_the_owner(django_capture_on_commit_callbacks):
    owner, petr, jana = person("janek"), person("petr"), person("jana")
    befriend(owner, petr)
    befriend(owner, jana)
    plan_id, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, petr, jana)
    FriendBlock.objects.create(blocker=jana.account, blocked=owner.account)
    roster = owner.get(f"/v1/tours/{plan_id}/invites").json()
    assert [row["account"]["nickname"] for row in roster["invites"]] == ["petr"]


def test_an_owner_in_invisible_mode_shows_no_invites(django_capture_on_commit_callbacks):
    owner, friend = person("janek"), person("petr")
    befriend(owner, friend)
    plan_id, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, plan_id, friend)
    assert len(friend.get("/v1/tour-invites").json()["invites"]) == 1
    Account.objects.filter(pk=owner.account.pk).update(ghost_mode=True)
    assert friend.get("/v1/tour-invites").json() == {"invites": []}
    assert friend.get(f"/v1/tour-invites/{plan_id}").status_code == 404
    assert friend.put(f"/v1/tour-invites/{plan_id}", {"status": "going"}, format="json").status_code == 404
    Account.objects.filter(pk=owner.account.pk).update(ghost_mode=False)
    assert friend.get(f"/v1/tour-invites/{plan_id}").status_code == 200


def test_invites_go_two_weeks_after_their_link_stopped_working(django_capture_on_commit_callbacks):
    owner, petr, jana = person("janek"), person("petr"), person("jana")
    befriend(owner, petr)
    befriend(owner, jana)
    dead, _ = tour(owner)
    fresh, _ = tour(owner)
    with django_capture_on_commit_callbacks(execute=True):
        invite(owner, dead, petr)
        invite(owner, fresh, jana)
    TourShare.objects.filter(plan_id=dead).update(revoked_at=timezone.now() - timedelta(days=15))
    # Revoked only yesterday: a new link may still come and keep who goes.
    TourShare.objects.filter(plan_id=fresh).update(revoked_at=timezone.now() - timedelta(days=1))
    call_command("prune_friend_data")
    assert list(TourInvite.objects.values_list("plan_id", flat=True)) == [uuid.UUID(fresh)]

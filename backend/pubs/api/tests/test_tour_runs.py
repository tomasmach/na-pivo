import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from pubs.api.tests.test_tour_publications import (  # noqa: F401
    account_client,
    directory,
    plan_body,
    public_read,
    publish,
    save_plan,
)
from pubs.models import Account, FriendBlock, Friendship, TourPublication, TourRunMember

pytestmark = pytest.mark.django_db


def public_tour(nickname="autor"):
    author = account_client(nickname=nickname)
    plan_id, revision = save_plan(author, plan_body())
    publication = publish(author, plan_id, revision).json()["publication"]
    return author, plan_id, publication


def register(client, run_id, publication, ended=False):
    return client.put(f"/v1/tour-runs/{run_id}", {"publication_id": publication["id"], "ended": ended}, format="json")


def member(client, run_id, state, publication=None):
    body = {"state": state, **({"publication_id": publication["id"]} if publication else {})}
    return client.put(f"/v1/tour-runs/{run_id}/me", body, format="json")


def walked_long_enough():
    TourRunMember.objects.update(joined_at=timezone.now() - timedelta(minutes=31))


def test_organizer_registers_a_run_and_the_party_joins_through_its_code():
    _, _, publication = public_tour()
    organizer, friend = account_client(nickname="vojta", trusted=True), account_client(nickname="pepa", trusted=True)
    run_id = str(uuid.uuid4())
    assert register(account_client(nickname=None), run_id, publication).json()["error"] == "sign_in_required"
    assert member(friend, run_id, "joined").status_code == 404  # the organizer's registration is still queued
    assert register(organizer, run_id, publication).status_code == 200
    roster = member(friend, run_id, "joined").json()
    assert [m["nickname"] for m in roster["members"]] == ["vojta", "pepa"]
    assert set(roster["members"][0]) == {"id", "nickname", "display_name", "avatar_url", "left", "completed"}
    # Walking together is not a friendship; that stays an explicit choice.
    assert not Friendship.objects.exists()
    preview = account_client(nickname="honza").get(f"/v1/tour-runs/{run_id}/preview").json()
    assert (preview["organizer"]["nickname"], preview["going"]) == ("vojta", 2)
    assert account_client(nickname="cizi").get(f"/v1/tour-runs/{run_id}").status_code == 404
    assert register(friend, run_id, publication).json()["error"] == "run_taken"

    register(organizer, run_id, publication, ended=True)
    late = member(account_client(nickname="pozde"), run_id, "joined").json()
    # Someone outside the party learns nothing about who went.
    assert late == {"joined": False, "reason": "closed"}
    assert member(friend, run_id, "left").status_code == 200
    assert member(friend, run_id, "joined").json() == {"joined": False, "reason": "closed"}
    assert account_client(nickname="honza2").get(f"/v1/tour-runs/{run_id}/preview").status_code == 404


def test_blocked_people_cannot_join_each_others_run():
    _, _, publication = public_tour()
    organizer, other = account_client(nickname="vojta"), account_client(nickname="troll")
    FriendBlock.objects.create(blocker=organizer.account, blocked=other.account)
    run_id = str(uuid.uuid4())
    register(organizer, run_id, publication)
    assert member(other, run_id, "joined").json()["error"] == "blocked"
    assert other.get(f"/v1/tour-runs/{run_id}/preview").status_code == 404


def test_a_join_names_its_tour_so_a_mismatched_link_joins_nothing():
    _, _, publication = public_tour()
    _, _, other_tour = public_tour("jina_autorka")
    organizer, friend = account_client(nickname="vojta"), account_client(nickname="pepa")
    run_id = str(uuid.uuid4())
    register(organizer, run_id, publication)
    assert member(friend, run_id, "joined", other_tour).json()["error"] == "wrong_tour"
    assert friend.get(f"/v1/tour-runs/{run_id}/preview?publication={other_tour['id']}").status_code == 404
    assert friend.get(f"/v1/tour-runs/{run_id}/preview?publication={publication['id']}").status_code == 200
    assert member(friend, run_id, "joined", publication).json()["joined"] is True
    # Only the walker learns their own completion.
    assert member(organizer, run_id, "completed").json()["me"]["completed"] is True
    assert [m["completed"] for m in friend.get(f"/v1/tour-runs/{run_id}").json()["members"]] == [False, False]


def test_only_trusted_walkers_count_once_after_thirty_minutes():
    _, _, publication = public_tour()
    organizer, friend = account_client(nickname="vojta", trusted=True), account_client(nickname="pepa", trusted=True)
    newcomer, ghost = account_client(nickname="novacek"), account_client(nickname="duch", trusted=True)
    Account.objects.filter(pk=ghost.account.pk).update(ghost_mode=True)
    run_id = str(uuid.uuid4())
    register(organizer, run_id, publication)
    for client in (friend, newcomer, ghost):
        member(client, run_id, "joined")
    assert member(friend, run_id, "completed").json()["counted"] is True
    assert member(newcomer, run_id, "completed").json()["counted"] is False
    assert member(ghost, run_id, "completed").json()["counted"] is False
    member(organizer, run_id, "completed")
    # Nobody counts before walking half an hour with the party.
    assert public_read(publication["token"]).json()["public"]["people_count"] == 0
    walked_long_enough()
    TourPublication.objects.update(people_count_at=None)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 2

    # Walking the same tour again the next weekend adds no new person.
    again = str(uuid.uuid4())
    register(organizer, again, publication)
    member(organizer, again, "completed")
    walked_long_enough()
    TourPublication.objects.update(people_count_at=None)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 2


def test_daily_completion_cap_and_leaving_keeps_an_earned_count():
    walker = account_client(nickname="pepa", trusted=True)
    results = []
    for index in range(4):
        author = account_client(nickname=f"autor{index}")
        plan_id, revision = save_plan(author, plan_body(pubs=(index % 4, (index + 1) % 4)))
        publication = publish(author, plan_id, revision).json()["publication"]
        run_id = str(uuid.uuid4())
        register(walker, run_id, publication)
        results.append(member(walker, run_id, "completed").json()["counted"])
    assert results == [True, True, True, False]
    assert member(walker, run_id, "left").json()["me"]["left"] is True


def test_a_new_route_counts_walkers_from_then_on():
    author, plan_id, publication = public_tour()
    walker = account_client(nickname="pepa", trusted=True)
    run_id = str(uuid.uuid4())
    register(walker, run_id, publication)
    member(walker, run_id, "completed")
    walked_long_enough()
    TourPublication.objects.update(people_count_at=None)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 1
    late = account_client(nickname="honza", trusted=True)
    old_run = str(uuid.uuid4())
    register(late, old_run, publication)
    plan_id, revision = save_plan(author, plan_body(pubs=(0, 2), revision=1), plan_id)
    publish(author, plan_id, revision)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 0
    # Finishing the old route after the change still does not count for the new one.
    assert member(late, old_run, "completed").json()["counted"] is False
    walked_long_enough()
    TourPublication.objects.update(people_count_at=None)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 0


def test_roster_disappears_a_day_after_the_run_ends():
    _, _, publication = public_tour()
    organizer = account_client(nickname="vojta")
    run_id = str(uuid.uuid4())
    register(organizer, run_id, publication, ended=True)
    assert organizer.get(f"/v1/tour-runs/{run_id}").status_code == 200
    from pubs.models import TourRun
    TourRun.objects.update(ended_at=timezone.now() - timedelta(hours=25))
    assert organizer.get(f"/v1/tour-runs/{run_id}").status_code == 404


def test_the_preview_hides_people_who_blocked_each_other():
    _, _, publication = public_tour()
    organizer, alice, bob = account_client(nickname="vojta"), account_client(nickname="alice"), account_client(nickname="bob")
    FriendBlock.objects.create(blocker=alice.account, blocked=bob.account)
    run_id = str(uuid.uuid4())
    register(organizer, run_id, publication)
    member(alice, run_id, "joined")
    preview = bob.get(f"/v1/tour-runs/{run_id}/preview").json()
    assert ([m["nickname"] for m in preview["members"]], preview["going"]) == (["vojta"], 1)
    assert [m["nickname"] for m in member(bob, run_id, "joined").json()["members"]] == ["vojta", "bob"]


def test_taking_back_a_completion_removes_the_walker_from_the_number():
    _, _, publication = public_tour()
    walker = account_client(nickname="pepa", trusted=True)
    run_id = str(uuid.uuid4())
    register(walker, run_id, publication)
    member(walker, run_id, "completed")
    walked_long_enough()
    TourPublication.objects.update(people_count_at=None)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 1
    taken_back = member(walker, run_id, "uncounted").json()
    assert (taken_back["counted"], taken_back["me"]["completed"], taken_back["people_count"]) == (False, False, 0)


def test_a_deleted_organizer_keeps_the_rest_of_the_party_counted():
    _, _, publication = public_tour()
    organizer, friend = account_client(nickname="vojta", trusted=True), account_client(nickname="pepa", trusted=True)
    run_id = str(uuid.uuid4())
    register(organizer, run_id, publication)
    member(friend, run_id, "joined")
    member(friend, run_id, "completed")
    Account.objects.filter(pk=organizer.account.pk).delete()
    walked_long_enough()
    TourPublication.objects.update(people_count_at=None)
    assert public_read(publication["token"]).json()["public"]["people_count"] == 1
    assert friend.get(f"/v1/tour-runs/{run_id}").json()["organizer_id"] is None
    assert account_client(nickname="honza").get(f"/v1/tour-runs/{run_id}/preview").status_code == 404

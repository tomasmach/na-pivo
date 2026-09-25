import uuid
from datetime import timedelta

import pytest
from django.test import Client, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.accounts import issue_token, schedule_deletion
from pubs.admin import TourPublicationAdmin
from pubs.models import Account, EmailCredential, PubDirectory, TourPublication
from pubs.tour_moderation import rejected_text

pytestmark = pytest.mark.django_db

PUBS = ["U Zlatého tygra", "U Pinkasů", "Lokál Dlouhááá", "U Černého vola"]


@pytest.fixture(autouse=True)
def directory():
    for index, name in enumerate(PUBS):
        PubDirectory.objects.create(name=name, lat=50.08 + index / 100, lng=14.42, cache_key="", city="Praha",
                                    country="CZ", source="test", refreshed_at=timezone.now())


def account_client(nickname="pivni_vlk", claimed=True, public=True, trusted=False):
    account = Account.objects.create(device_id=str(uuid.uuid4()), nickname=nickname, is_public=public)
    if claimed:
        EmailCredential.objects.create(account=account, email=f"{uuid.uuid4().hex}@example.com", password="x", email_verified=True)
    if trusted:
        Account.objects.filter(pk=account.pk).update(quorum_trusted_at=timezone.now() - timedelta(days=2))
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account)}")
    client.account = account
    return client


def plan_body(pubs=(0, 1), title="Pátek po Starém Městě", revision=0, challenges=None, **extra):
    stops = []
    for position, index in enumerate(pubs):
        row = PubDirectory.objects.get(name=PUBS[index])
        stops.append({"id": str(uuid.uuid4()), "pub_id": f"directory:{row.cache_key}:{row.name_key}", "cache_key": row.cache_key,
                      "name": row.name.upper(), "address": "Moje tajná adresa 12", "lat": row.lat, "lon": row.lng,
                      "challenge": (challenges or {}).get(position, "")})
    return {"operation_id": str(uuid.uuid4()), "base_revision": revision, "title": title, "scheduled_date": None,
            "scheduled_time": None, "timezone": "Europe/Prague", "stops": stops, **extra}


def save_plan(client, body, plan_id=None):
    plan_id = plan_id or str(uuid.uuid4())
    response = client.put(f"/v1/tours/{plan_id}", body, format="json")
    assert response.status_code in (200, 201), response.content
    return plan_id, response.json()["tour"]["revision"]


def publish(client, plan_id, revision, accept_rules=True):
    return client.put(f"/v1/tours/{plan_id}/publication", {"revision": revision, "accept_rules": accept_rules}, format="json")


def public_read(token):
    return APIClient().get(f"/v1/tour-shares/{token}")


def test_publishing_needs_a_signed_in_public_profile_with_nickname_and_rules():
    for client, code in ((account_client(nickname="anonym", claimed=False), "sign_in_required"),
                         (account_client(nickname=None), "nickname_required"),
                         (account_client(nickname="skryty", public=False), "profile_private")):
        plan_id, revision = save_plan(client, plan_body())
        assert publish(client, plan_id, revision).json()["error"] == code
    client = account_client()
    plan_id, revision = save_plan(client, plan_body())
    assert publish(client, plan_id, revision, accept_rules=False).json()["error"] == "rules_required"
    assert publish(client, plan_id, revision + 1).status_code == 409
    response = publish(client, plan_id, revision)
    assert response.status_code == 200, response.content
    assert response.json()["publication"]["status"] == "active"
    assert client.get("/v1/tours").json()["tours"][0]["publication"]["url"].endswith(response.json()["publication"]["token"])


def test_public_copy_hides_meetup_uses_directory_names_and_stays_frozen():
    client = account_client()
    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    plan_id, revision = save_plan(client, plan_body(challenges={1: "Zjisti, od kdy se tu čepuje Prazdroj"},
                                                    scheduled_date=tomorrow, scheduled_time="18:00"))
    token = publish(client, plan_id, revision).json()["publication"]["token"]
    data = public_read(token).json()
    assert data["expires_at"] is None
    assert data["tour"]["scheduled_date"] is None and data["tour"]["scheduled_time"] is None
    assert [s["name"] for s in data["tour"]["stops"]] == ["U Zlatého tygra", "U Pinkasů"]
    assert {s["address"] for s in data["tour"]["stops"]} == {"Praha"}
    assert data["tour"]["stops"][1]["challenge"] == "Zjisti, od kdy se tu čepuje Prazdroj"
    assert data["public"]["author"]["nickname"] == "pivni_vlk"
    assert data["tour"]["id"] == data["public"]["id"] != plan_id

    # Editing the plan or its party link never reaches the public copy until it is published again.
    save_plan(client, plan_body(title="Tajná rozlučka", revision=revision), plan_id)
    assert public_read(token).json()["tour"]["title"] == "Pátek po Starém Městě"
    republished = publish(client, plan_id, revision + 1)
    assert republished.json()["publication"]["revision"] == 2
    assert public_read(token).json()["tour"]["title"] == "Tajná rozlučka"


def test_unknown_pubs_and_drinking_dares_stay_private():
    client = account_client()
    body = plan_body()
    body["stops"][1].update(name="Moje garáž", cache_key="u2aaaaaa", pub_id="garaz")
    plan_id, revision = save_plan(client, body)
    assert publish(client, plan_id, revision).json() | {"detail": ""} == {"error": "unknown_pub", "stop": 1, "detail": ""}
    plan_id, revision = save_plan(client, plan_body(title="Kdo dřív vypije 5 piv"))
    assert publish(client, plan_id, revision).json()["field"] == "title"
    plan_id, revision = save_plan(client, plan_body(challenges={0: "Vypij to na EX"}))
    rejected = publish(client, plan_id, revision).json()
    assert (rejected["error"], rejected["field"], rejected["stop"]) == ("text_rejected", "challenge", 0)
    assert not TourPublication.objects.exists()


def test_new_route_starts_its_count_again():
    client = account_client()
    plan_id, revision = save_plan(client, plan_body())
    publish(client, plan_id, revision)
    TourPublication.objects.update(people_count=7)
    plan_id, revision = save_plan(client, plan_body(title="Jiný název", revision=revision), plan_id)
    publish(client, plan_id, revision)
    assert TourPublication.objects.get().people_count == 7
    plan_id, revision = save_plan(client, plan_body(pubs=(0, 2), revision=revision), plan_id)
    publish(client, plan_id, revision)
    assert TourPublication.objects.get().people_count == 0


def test_unpublish_private_profile_deleted_plan_and_account_close_the_link():
    client = account_client()
    plan_id, revision = save_plan(client, plan_body())
    token = publish(client, plan_id, revision).json()["publication"]["token"]
    assert client.delete(f"/v1/tours/{plan_id}/publication").status_code == 204
    assert public_read(token).status_code == 404
    assert publish(client, plan_id, revision).status_code == 200
    Account.objects.filter(pk=client.account.pk).update(is_public=False)
    assert public_read(token).status_code == 404
    Account.objects.filter(pk=client.account.pk).update(is_public=True)
    assert public_read(token).status_code == 200
    schedule_deletion(Account.objects.get(pk=client.account.pk))
    assert public_read(token).status_code == 404
    assert TourPublication.objects.get().status == TourPublication.Status.UNPUBLISHED


def test_only_a_trusted_quorum_hides_a_reported_tour_until_an_admin_restores_it():
    author = account_client()
    plan_id, revision = save_plan(author, plan_body())
    publication = publish(author, plan_id, revision).json()["publication"]
    report = {"reason": "inappropriate_tour"}
    assert author.post(f"/v1/tour-publications/{publication['id']}/report", report, format="json").status_code == 400
    for _ in range(3):
        assert account_client(nickname=None).post(f"/v1/tour-publications/{publication['id']}/report", report, format="json").json() == {"hidden": False}
    assert public_read(publication["token"]).status_code == 200
    results = [account_client(nickname=None, trusted=True).post(f"/v1/tour-publications/{publication['id']}/report", report, format="json").json()
               for _ in range(3)]
    assert results[-1] == {"hidden": True}
    assert public_read(publication["token"]).status_code == 404
    assert publish(author, plan_id, revision).json()["error"] == "publication_hidden"
    TourPublicationAdmin.restore_publications(None, None, TourPublication.objects.all())
    assert public_read(publication["token"]).status_code == 200


@override_settings(TOUR_PUBLICATION_LIMIT=1)
def test_publication_limit_with_an_exempt_seeding_account():
    client = account_client()
    first_id, first_revision = save_plan(client, plan_body())
    assert publish(client, first_id, first_revision).status_code == 200
    second_id, second_revision = save_plan(client, plan_body(pubs=(2, 3)))
    assert publish(client, second_id, second_revision).json()["error"] == "publication_limit"
    assert publish(client, first_id, first_revision).status_code == 200
    with override_settings(TOUR_PUBLICATION_LIMIT_EXEMPT={str(client.account.public_id)}):
        assert publish(client, second_id, second_revision).status_code == 200


def test_author_profile_lists_public_tours_and_web_page_names_the_author():
    author = account_client()
    plan_id, revision = save_plan(author, plan_body())
    token = publish(author, plan_id, revision).json()["publication"]["token"]
    profile = account_client(nickname="host").get(f"/v1/friends/{author.account.public_id}").json()
    assert [(t["title"], t["stop_count"], t["token"]) for t in profile["public_tours"]] == [("Pátek po Starém Městě", 2, token)]
    page = Client().get(f"/t/{token}").content.decode()
    assert "Veřejná tour od pivni_vlk" in page
    assert "Sraz:" not in page


@pytest.mark.parametrize(("text", "blocked"), [
    ("Objednej si pivo, které nikdo z party neměl", False),
    ("Zjisti, od kterého roku se tu čepuje Prazdroj", False),
    ("Dej si 12° a popiš ho jedním slovem", False),
    ("Vypijte to na ex", True),
    ("Kdo dřív dopije, platí", True),
    ("Každý 3 panáky", True),
    ("Kdo víc vypije", True),
    ("Kdo víc ví o historii hospody", False),
    ("Napiš mi na 777 123 456", True),
    ("Více na www.example.cz", True),
])
def test_text_rules(text, blocked):
    assert rejected_text(text) is blocked


def test_public_pins_come_from_the_pub_and_a_restore_settles_old_reports():
    author = account_client()
    body = plan_body()
    body["stops"][0].update(lat=49.0, lon=16.0)
    plan_id, revision = save_plan(author, body)
    publication = publish(author, plan_id, revision).json()["publication"]
    first = public_read(publication["token"]).json()["tour"]["stops"][0]
    row = PubDirectory.objects.get(name=PUBS[0])
    assert (first["lat"], first["lon"]) == (row.lat, row.lng)
    report = {"reason": "inappropriate_tour"}
    for _ in range(3):
        account_client(nickname=None, trusted=True).post(f"/v1/tour-publications/{publication['id']}/report", report, format="json")
    assert public_read(publication["token"]).status_code == 404
    TourPublicationAdmin.restore_publications(None, None, TourPublication.objects.all())
    assert account_client(nickname=None).post(f"/v1/tour-publications/{publication['id']}/report", report, format="json").json() == {"hidden": False}
    assert public_read(publication["token"]).status_code == 200


def test_admin_hide_leaves_a_withdrawn_tour_withdrawn():
    author = account_client()
    plan_id, revision = save_plan(author, plan_body())
    token = publish(author, plan_id, revision).json()["publication"]["token"]
    author.delete(f"/v1/tours/{plan_id}/publication")
    TourPublicationAdmin.hide_publications(None, None, TourPublication.objects.all())
    TourPublicationAdmin.restore_publications(None, None, TourPublication.objects.all())
    assert public_read(token).status_code == 404

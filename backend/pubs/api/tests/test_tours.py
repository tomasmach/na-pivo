import uuid
from datetime import date, timedelta

import pytest
from django.db import transaction
from django.test import Client, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from pubs.accounts import _merge_anonymous_account, issue_token, schedule_deletion
from pubs.api.tour_views import PlanSerializer
from pubs.api.views import _export_account_data
from pubs.models import Account, PubDirectory, PubHours, TourPlan, TourShare
from pubs.privacy import redact_party_codes
from pubs.tours import share_token

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    account = Account.objects.create(device_id=str(uuid.uuid4()))
    result = APIClient()
    result.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account)}")
    result.account = account
    return result


def payload(**kwargs):
    return {
        "operation_id": str(uuid.uuid4()), "base_revision": 0, "title": "Páteční tour",
        "scheduled_date": None, "scheduled_time": None, "timezone": "Europe/Prague",
        "stops": [{"id": str(uuid.uuid4()), "pub_id": f"pub-{i}", "cache_key": f"u2fk{i}",
                   "name": f"Hospoda {i}", "address": "Praha", "lat": 50.08 + i / 1000, "lon": 14.42}
                  for i in range(2)], **kwargs,
    }


def publish(client, body=None):
    plan_id = str(uuid.uuid4())
    body = body or payload()
    response = client.put(f"/v1/tours/{plan_id}", body, format="json")
    assert response.status_code == 201, response.content
    return plan_id, body


def share(client, plan_id, **kwargs):
    body = {"operation_id": str(uuid.uuid4()), **kwargs}
    response = client.post(f"/v1/tours/{plan_id}/share", body, format="json")
    assert response.status_code == 200, response.content
    return response.json()["share"]["url"].rsplit("/", 1)[1], body


def test_revision_replay_conflict_delete(client):
    plan_id, body = publish(client)
    assert client.put(f"/v1/tours/{plan_id}", body, format="json").json()["tour"]["revision"] == 1
    update = {**body, "operation_id": str(uuid.uuid4()), "base_revision": 1, "title": "Nový název"}
    assert client.put(f"/v1/tours/{plan_id}", update, format="json").json()["tour"]["revision"] == 2
    assert client.put(f"/v1/tours/{plan_id}", body, format="json").status_code == 409
    update["operation_id"] = str(uuid.uuid4())
    assert client.put(f"/v1/tours/{plan_id}", update, format="json").status_code == 409
    assert len(client.get("/v1/tours").json()["tours"]) == 1
    assert client.delete(f"/v1/tours/{plan_id}").status_code == 204
    assert client.delete(f"/v1/tours/{plan_id}").status_code == 204
    assert client.put(f"/v1/tours/{plan_id}", body, format="json").status_code == 409
    assert client.get("/v1/tours").json()["tours"] == []


def test_share_retry_recovery_rotation_revoke(client):
    plan_id, _ = publish(client)
    token, operation = share(client, plan_id)
    assert client.post(f"/v1/tours/{plan_id}/share", operation, format="json").json()["share"]["url"].endswith(token)
    assert client.get(f"/v1/tours/{plan_id}").json()["share"]["url"].endswith(token)
    rotated, _ = share(client, plan_id, rotate=True)
    assert rotated != token
    assert client.post(f"/v1/tours/{plan_id}/share", operation, format="json").status_code == 409
    assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 404
    assert client.delete(f"/v1/tours/{plan_id}/share").status_code == 204
    assert APIClient().get(f"/v1/tour-shares/{rotated}").status_code == 404
    assert client.post(f"/v1/tours/{plan_id}/share", operation, format="json").status_code == 409
    restored, _ = share(client, plan_id)
    assert restored not in (token, rotated)


def test_isolation_whitelist_web_headers_escaping(client):
    plan_id, _ = publish(client, payload(title="<script>bad()</script>"))
    outsider = APIClient()
    outsider.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(Account.objects.create(device_id=str(uuid.uuid4())))}")
    assert outsider.get(f"/v1/tours/{plan_id}").status_code == 404
    assert outsider.put(f"/v1/tours/{plan_id}", payload(), format="json").status_code == 404
    assert outsider.get("/v1/tours").json()["tours"] == []
    assert APIClient().get("/v1/tours").status_code == 401
    token, _ = share(client, plan_id)
    public = APIClient().get(f"/v1/tour-shares/{token}")
    assert set(public.json()) == {"tour", "expires_at"}
    assert set(public.json()["tour"]) == {"id", "title", "scheduled_date", "scheduled_time", "timezone", "revision", "created_at", "updated_at", "stops"}
    page = Client().get(f"/t/{token}")
    assert page.status_code == 200
    assert b"<script>bad()" not in page.content
    assert b"&lt;script&gt;bad()" in page.content
    for response in (public, page):
        assert response["Referrer-Policy"] == "no-referrer"
        assert response["X-Robots-Tag"] == "noindex, nofollow"
        assert "no-store" in response["Cache-Control"]
    assert Client().get("/t/not-valid").status_code == 404


def test_expiry_never_shortens(client):
    plan_id, body = publish(client)
    token, _ = share(client, plan_id)
    initial = TourShare.objects.get(plan_id=plan_id).expires_at
    update = {**body, "operation_id": str(uuid.uuid4()), "base_revision": 1,
              "scheduled_date": (timezone.localdate() + timedelta(days=80)).isoformat()}
    assert client.put(f"/v1/tours/{plan_id}", update, format="json").status_code == 200
    extended = TourShare.objects.get(plan_id=plan_id).expires_at
    assert extended > initial + timedelta(days=50)
    update.update(operation_id=str(uuid.uuid4()), base_revision=2, scheduled_date=None)
    assert client.put(f"/v1/tours/{plan_id}", update, format="json").status_code == 200
    assert TourShare.objects.get(plan_id=plan_id).expires_at == extended
    TourShare.objects.filter(plan_id=plan_id).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 404
    assert Client().get(f"/t/{token}").status_code == 404


def test_validation_dates_dst(client, monkeypatch):
    body = payload()
    body["stops"][1]["pub_id"] = body["stops"][0]["pub_id"]
    assert client.put(f"/v1/tours/{uuid.uuid4()}", body, format="json").status_code == 400
    for args in ({"stops": []}, {"scheduled_time": "19:00"}, {"timezone": "bad"}):
        assert client.put(f"/v1/tours/{uuid.uuid4()}", payload(**args), format="json").status_code == 400
    monkeypatch.setattr("pubs.api.tour_views.timezone.localdate", lambda **_: date(2026, 3, 1))
    assert not PlanSerializer(data=payload(scheduled_date="2026-03-29", scheduled_time="02:30")).is_valid()
    midnight = PlanSerializer(data=payload(scheduled_date="2026-03-29", scheduled_time="00:30"))
    assert midnight.is_valid(), midnight.errors
    assert not PlanSerializer(data=payload(scheduled_date="2026-09-01")).is_valid()


def test_merge_export_and_deletion(client):
    plan_id, _ = publish(client)
    token, _ = share(client, plan_id)
    target = Account.objects.create(device_id=str(uuid.uuid4()))
    with transaction.atomic():
        _merge_anonymous_account(client.account, target)
    assert TourPlan.objects.get(pk=plan_id).owner_id == target.pk
    assert _export_account_data(target)["tours"][0]["id"] == plan_id
    assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 200
    schedule_deletion(target)
    assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 404
    assert TourShare.objects.get(plan_id=plan_id).revoked_at is not None


def test_changed_operation_conflicts_and_token_redaction(client):
    plan_id, body = publish(client)
    body["title"] = "Different"
    assert client.put(f"/v1/tours/{plan_id}", body, format="json").status_code == 409
    token, _ = share(client, plan_id)
    row = TourShare.objects.get(plan_id=plan_id)
    assert row.token_hash != token
    assert share_token(row) == token
    for path in [f"/t/{token}", f"/v1/tour-shares/{token}", f"%2Ft%2F{token}"]:
        assert token not in redact_party_codes(path)


@pytest.mark.parametrize("query", ["Jelena Praha", "Jelena, Praha"])
def test_directory_name_city_area_search(query):
    PubDirectory.objects.create(name="U Jelena", lat=50.08, lng=14.42, cache_key="u2fkb", city="Praha", country="CZ", source="test", refreshed_at=timezone.now(), venue_kind=PubHours.VenueKind.PUB)
    result = APIClient().get("/v1/pubs/search", {"q": query})
    assert result.status_code == 200, result.content
    assert result.json()["items"][0]["name"] == "U Jelena"
    assert result.json()["items"][0]["cache_key"] == PubDirectory.objects.get().cache_key
    assert APIClient().get("/v1/pubs/search", {"q": "", "lat": 50.08, "lon": 14.42}).json()["items"]
    assert APIClient().get("/v1/pubs/search", {"q": "Jelena", "lat": 49, "lon": 16}).json()["items"] == []
    assert APIClient().get("/v1/pubs/search", {"q": ""}).status_code == 400


def test_nearby_search_keeps_nearest_pub_beyond_alphabetical_candidate_limit():
    common = {"city": "Praha", "country": "CZ", "source": "test",
              "refreshed_at": timezone.now(), "venue_kind": PubHours.VenueKind.PUB}
    PubDirectory.objects.bulk_create([
        PubDirectory(name=f"A pub {i}", name_key=f"a pub {i}", cache_key=f"test{i}",
                     lat=50.10, lng=14.42, **common)
        for i in range(400)
    ])
    PubDirectory.objects.create(name="Z nearest pub", lat=50.08001, lng=14.42, **common)

    response = APIClient().get("/v1/pubs/search", {"lat": 50.08, "lon": 14.42})

    assert response.status_code == 200
    assert len(response.json()["items"]) == 40
    assert response.json()["items"][0]["name"] == "Z nearest pub"


def test_owner_list_loads_shares_once_and_keeps_inactive_links_private(client):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    active_id, _ = publish(client)
    active_token, _ = share(client, active_id)
    revoked_id, _ = publish(client)
    share(client, revoked_id)
    TourShare.objects.filter(plan_id=revoked_id).update(revoked_at=timezone.now())
    expired_id, _ = publish(client)
    share(client, expired_id)
    TourShare.objects.filter(plan_id=expired_id).update(expires_at=timezone.now() - timedelta(seconds=1))
    unshared_id, _ = publish(client)

    with CaptureQueriesContext(connection) as queries:
        response = client.get("/v1/tours")

    assert response.status_code == 200
    tours = {item["tour"]["id"]: item for item in response.json()["tours"]}
    assert len(tours) == 4
    assert tours[active_id]["share"]["url"].endswith(active_token)
    assert all(tours[plan_id]["share"] is None for plan_id in (revoked_id, expired_id, unshared_id))
    assert all(len(item["tour"]["stops"]) == 2 for item in tours.values())
    assert sum('"pubs_tourshare"' in query["sql"].lower() for query in queries.captured_queries) == 1


def test_shared_throttle_api_web(client, monkeypatch):
    from pubs.api.throttling import SharedScopedRateThrottle
    from pubs.models import ApiRateLimitBucket
    plan_id, _ = publish(client)
    token, _ = share(client, plan_id)
    monkeypatch.setattr(SharedScopedRateThrottle, "get_rate", lambda self: "2/min")
    ApiRateLimitBucket.objects.filter(scope="tour_public").delete()
    assert Client().get(f"/t/{token}").status_code == 200
    assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 200
    assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 429


def test_aasa_additive():
    with override_settings(APPLE_TEAM_ID="TEAM"):
        data = Client().get("/.well-known/apple-app-site-association").json()
    assert {item["/"] for item in data["applinks"]["details"][0]["components"]} >= {"/p/*", "/party/*", "/t/*"}


def test_secret_rotation_requires_new_link(client):
    plan_id, _ = publish(client)
    token, _ = share(client, plan_id)
    with override_settings(SECRET_KEY="new-test-secret"):
        assert APIClient().get(f"/v1/tour-shares/{token}").status_code == 404
        assert client.get(f"/v1/tours/{plan_id}").json()["share"] is None
        replacement, _ = share(client, plan_id)
        assert replacement != token
        assert APIClient().get(f"/v1/tour-shares/{replacement}").status_code == 200


def test_stop_constraints(client):
    from django.db import IntegrityError

    from pubs.models import TourStop
    plan_id, _ = publish(client)
    first = TourStop.objects.filter(plan_id=plan_id).first()
    common = {"plan_id": plan_id, "name": "Other", "address": "", "lat": 50, "lon": 14}
    for duplicate in (
        {"client_id": first.client_id, "position": 5, "pub_id": "other"},
        {"client_id": uuid.uuid4(), "position": first.position, "pub_id": "other"},
        {"client_id": uuid.uuid4(), "position": 5, "pub_id": first.pub_id},
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            TourStop.objects.create(**common, **duplicate)


def test_export_prefetches_tours_and_stops_without_serialization_queries(client):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    from pubs.api.views import _load_export_account

    plan_id, _ = publish(client)
    deleted_id, _ = publish(client)
    assert client.delete(f"/v1/tours/{deleted_id}").status_code == 204
    loaded = _load_export_account(client.account)
    with CaptureQueriesContext(connection) as queries:
        exported = _export_account_data(loaded)
    assert [tour["id"] for tour in exported["tours"]] == [plan_id]
    assert len(exported["tours"][0]["stops"]) == 2
    assert not any('"pubs_tour' in query["sql"].lower() for query in queries.captured_queries)

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.contrib import admin
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from pubs import pub_reach
from pubs.enrichment.matcher import geohash8
from pubs.models import Account, PubDirectory, PubHours, PubReachDaily, PubReachVisitor

pytestmark = pytest.mark.django_db

TIGER = geohash8(50.0875, 14.4213)
FLEK = geohash8(50.0786, 14.4170)
BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"


def _account(device: int) -> tuple[Account, APIClient]:
    client = APIClient()
    response = client.post("/v1/account", data={"device_id": f"3f8b1c2e-4d5a-6789-0abc-def0123456{device:02d}"}, format="json")
    assert response.status_code == 201
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['token']}")
    return Account.objects.get(pk=Account.objects.latest("pk").pk), client


def _send(client: APIClient, *events: dict) -> dict:
    response = client.post("/v1/pub-reach", data={"events": list(events)}, format="json")
    assert response.status_code == 202, response.content
    return response.json()


def _ago(days: int) -> str:
    return (timezone.now() - timedelta(days=days)).isoformat()


def _counts(**filters) -> dict:
    return {
        (row.channel, row.metric, row.source): (row.count, row.visitors)
        for row in PubReachDaily.objects.filter(**filters)
    }


def test_app_batch_counts_events_and_each_account_once_a_day():
    _, client = _account(1)
    today = pub_reach.reach_day(timezone.now())

    _send(
        client,
        {"type": "map_impression", "pub": TIGER},
        {"type": "map_impression", "pub": TIGER},
        {"type": "detail_view", "pub": TIGER},
        {"type": "navigation", "pub": TIGER},
    )
    _send(client, {"type": "map_impression", "pub": TIGER})

    assert _counts(cache_key=TIGER, day=today) == {
        ("app", "map_impression", ""): (3, 1),
        ("app", "detail_view", ""): (1, 1),
        ("app", "navigation", ""): (1, 1),
    }


def test_distinct_people_over_a_range_count_a_returning_account_once():
    _, first = _account(1)
    _, second = _account(2)
    _send(first, {"type": "map_impression", "pub": TIGER, "at": _ago(1)})
    _send(first, {"type": "map_impression", "pub": TIGER})
    _send(second, {"type": "map_impression", "pub": TIGER}, {"type": "detail_view", "pub": TIGER})
    today = pub_reach.reach_day(timezone.now())

    report = pub_reach.pub_report(TIGER, today - timedelta(days=6), today, today)

    app = {row["metric"]: row for row in report["app"]}
    assert app["map_impression"]["count"] == 3
    # Daily distinct visitors add up to 3; the same person on two days is one.
    assert sum(row.get("app_map_impression_visitors", 0) for row in report["days"]) == 3
    assert app["map_impression"]["visitors"] == 2
    assert app["detail_view"]["visitors"] == 1
    assert report["app_visitors_any"] == 2
    assert report["visitors_complete"] is True


def test_bad_events_are_skipped_without_losing_the_batch():
    _, client = _account(1)

    body = _send(
        client,
        {"type": "map_impression", "pub": TIGER},
        {"type": "map_impression", "pub": "not-a-key"},
        {"type": "teleport", "pub": TIGER},
        {"type": "detail_view", "pub": TIGER, "at": _ago(5)},
        {"type": "detail_view", "pub": FLEK, "at": (timezone.now() + timedelta(days=3)).isoformat()},
        "junk",
    )

    assert body == {"accepted": 2}
    today = pub_reach.reach_day(timezone.now())
    assert set(PubReachDaily.objects.filter(day=today).values_list("cache_key", "metric")) == {
        (TIGER, "map_impression"),
        (FLEK, "detail_view"),
    }


def test_a_batch_that_is_not_a_list_or_too_long_is_rejected():
    _, client = _account(1)

    assert client.post("/v1/pub-reach", data={"events": "x"}, format="json").status_code == 400
    too_many = [{"type": "map_impression", "pub": TIGER}] * 501
    assert client.post("/v1/pub-reach", data={"events": too_many}, format="json").status_code == 400
    assert PubReachDaily.objects.count() == 0


def test_without_a_token_the_counts_grow_but_nobody_is_kept():
    _send(APIClient(), {"type": "map_impression", "pub": TIGER})

    assert PubReachDaily.objects.get().count == 1
    assert PubReachDaily.objects.get().visitors == 0
    assert PubReachVisitor.objects.count() == 0


def test_an_account_being_deleted_records_nothing_and_deletion_forgets_it():
    account, client = _account(1)
    _send(client, {"type": "detail_view", "pub": TIGER})
    other, other_client = _account(2)
    _send(other_client, {"type": "detail_view", "pub": TIGER})

    # The token was checked before deletion started; the batch then waits for the account lock.
    client.force_authenticate(user=account)
    Account.objects.filter(pk=account.pk).update(status=Account.Status.PENDING_DELETION)
    assert _send(client, {"type": "detail_view", "pub": FLEK}) == {"accepted": 0}
    pub_reach.forget_account(account.pk)

    assert not PubReachDaily.objects.filter(cache_key=FLEK).exists()
    assert list(PubReachVisitor.objects.values_list("visitor", flat=True)) == [pub_reach.visitor_id(other.pk)]
    assert PubReachDaily.objects.get(cache_key=TIGER).count == 2


def _beacon(client, body, user_agent=BROWSER):
    return client.post("/web/reach", data=json.dumps(body), content_type="application/json", HTTP_USER_AGENT=user_agent)


@pytest.mark.parametrize(
    ("referrer", "source"),
    [
        ("https://www.google.com", "google"),
        ("https://www.google.cz", "google"),
        ("android-app://com.google.android.googlequicksearchbox", "google"),
        ("https://search.seznam.cz", "seznam"),
        ("https://duckduckgo.com", "other_search"),
        ("", "direct"),
        ("https://na-pivo.cz", "internal"),
        ("https://www.facebook.com", "social"),
        ("https://l.instagram.com", "social"),
        ("https://chatgpt.com", "ai"),
        ("https://gemini.google.com", "ai"),
        ("https://www.pivnici.cz", "link"),
    ],
)
def test_web_counts_a_page_view_with_where_it_came_from(client, referrer, source):
    response = _beacon(client, {"pub": TIGER, "type": "detail_view", "ref": referrer})

    assert response.status_code == 204
    assert _counts(cache_key=TIGER) == {("web", "detail_view", source): (1, 0)}


def test_web_ignores_bots_and_garbage(client):
    _beacon(client, {"pub": TIGER, "type": "detail_view"}, user_agent="Mozilla/5.0 (compatible; Googlebot/2.1)")
    _beacon(client, {"pub": TIGER, "type": "detail_view"}, user_agent="")
    _beacon(client, {"pub": TIGER, "type": "map_impression"})
    _beacon(client, {"pub": "../etc", "type": "detail_view"})
    client.post("/web/reach", data="{", content_type="application/json", HTTP_USER_AGENT=BROWSER)
    assert client.get("/web/reach").status_code == 405

    assert PubReachDaily.objects.count() == 0


def test_web_navigation_taps_are_counted(client):
    _beacon(client, {"pub": TIGER, "type": "detail_view", "ref": "https://www.google.com"})
    _beacon(client, {"pub": TIGER, "type": "navigation", "ref": "https://www.google.com"})

    assert _counts(cache_key=TIGER) == {
        ("web", "detail_view", "google"): (1, 0),
        ("web", "navigation", "google"): (1, 0),
    }


def test_pub_page_marks_itself_and_its_navigation_for_counting(client):
    pub = PubDirectory.objects.create(
        name="U Zlatého tygra", lat=50.0875, lng=14.4213, city="Praha 1", country="cz", source="test",
        refreshed_at=timezone.now(), venue_kind=PubHours.VenueKind.PUB,
    )

    html = client.get(f"/hospoda/u-zlateho-tygra-{pub.cache_key}").content.decode()

    assert f'data-reach-pub="{pub.cache_key}"' in html
    assert 'data-reach="navigation"' in html


def test_admin_report_shows_one_pub_apart_for_app_and_web(client):
    PubHours.objects.create(cache_key=TIGER, name="U Zlatého tygra", lat=50.0875, lng=14.4213)
    _, app = _account(1)
    _send(app, {"type": "map_impression", "pub": TIGER}, {"type": "navigation", "pub": TIGER})
    _beacon(client, {"pub": TIGER, "type": "detail_view", "ref": "https://www.google.com"})
    model_admin = admin.site._registry[PubReachDaily]
    staff = User.objects.create_superuser("mach", "mach@example.com", "x")

    def view(**params):
        request = RequestFactory().get("/admin/pubs/pubreachdaily/report/", params)
        request.user = staff
        response = model_admin.report_view(request)
        return response.context_data, response.render().content.decode()

    flek = PubDirectory.objects.create(
        name="U Fleků", lat=50.0786, lng=14.4170, city="Praha 1", country="cz", source="test",
        refreshed_at=timezone.now(), venue_kind=PubHours.VenueKind.PUB,
    )
    _send(app, {"type": "map_impression", "pub": flek.cache_key})

    top, _ = view()
    assert [(row["cache_key"], row["name"]) for row in top["top"]] == [(TIGER, "U Zlatého tygra"), (flek.cache_key, "U Fleků")]
    assert view(pub="fleků")[0]["chosen"] == {"cache_key": flek.cache_key, "name": "U Fleků"}

    context, html = view(pub="tygra", days="30")
    assert context["chosen"]["cache_key"] == TIGER
    assert {row["metric"]: (row["count"], row["visitors"]) for row in context["report"]["app"]} == {
        "map_impression": (1, 1),
        "detail_view": (0, 0),
        "navigation": (1, 1),
    }
    assert {row["metric"]: row["count"] for row in context["report"]["web"]} == {"detail_view": 1, "navigation": 0}
    assert context["report"]["web_sources"] == [{"source": "Google", "views": 1, "navigation": 0}]
    assert "U Zlatého tygra" in html


def test_pruning_drops_old_visitors_and_keeps_the_counts(settings):
    settings.PUB_REACH_VISITOR_RETENTION_DAYS = 30
    today = pub_reach.reach_day(timezone.now())
    old = today - timedelta(days=31)
    pub_reach.record([pub_reach.ReachEvent(TIGER, old, "detail_view")], pub_reach.APP, visitor=1)
    pub_reach.record([pub_reach.ReachEvent(TIGER, today, "detail_view")], pub_reach.APP, visitor=1)

    call_command("prune_operational_data")

    assert list(PubReachVisitor.objects.values_list("day", flat=True)) == [today]
    assert PubReachDaily.objects.count() == 2
    report = pub_reach.pub_report(TIGER, old, today, today)
    assert report["visitors_complete"] is False


def test_hard_deleting_an_account_forgets_the_pubs_it_reached():
    from pubs.accounts import hard_delete

    account, client = _account(1)
    _send(client, {"type": "detail_view", "pub": TIGER})

    hard_delete(account)

    assert PubReachVisitor.objects.count() == 0
    assert PubReachDaily.objects.get().count == 1


def test_merging_accounts_counts_the_person_once_and_deleting_the_target_forgets_both():
    from django.db import transaction

    from pubs import accounts

    source, source_client = _account(1)
    target, target_client = _account(2)
    _send(source_client, {"type": "detail_view", "pub": TIGER}, {"type": "detail_view", "pub": FLEK})
    _send(target_client, {"type": "detail_view", "pub": TIGER})
    today = pub_reach.reach_day(timezone.now())

    with transaction.atomic():
        accounts._merge_anonymous_account(source, target)

    report = pub_reach.pub_report(TIGER, today, today, today)
    assert {row["metric"]: (row["count"], row["visitors"]) for row in report["app"]}["detail_view"] == (2, 1)
    assert PubReachDaily.objects.get(cache_key=TIGER).visitors == 1
    assert set(PubReachVisitor.objects.values_list("visitor", flat=True)) == {pub_reach.visitor_id(target.pk)}

    accounts.hard_delete(target)

    assert PubReachVisitor.objects.count() == 0

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from django.contrib import admin
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import RequestFactory, override_settings
from django.utils import timezone

from pubs import pub_reach, search_console
from pubs.models import SearchConsoleDaily, WebStatsDaily

pytestmark = pytest.mark.django_db

IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"
MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"


def _beacon(client, body, user_agent=IPHONE):
    return client.post("/web/stats", data=json.dumps(body), content_type="application/json", HTTP_USER_AGENT=user_agent)


def _rows() -> list[tuple]:
    return sorted(
        WebStatsDaily.objects.values_list(
            "page", "path", "lang", "metric", "source", "referrer", "campaign", "device", "count"
        )
    )


def test_counts_a_view_with_page_source_campaign_and_device(client):
    view = {"path": "/hospoda/u2fkbkb2", "type": "view", "ref": "https://www.google.cz", "utm": "Instagram-Bio"}
    assert _beacon(client, view).status_code == 204
    _beacon(client, view)
    _beacon(client, {"path": "/en/prices", "type": "view", "ref": "https://l.instagram.com"}, user_agent=ANDROID)
    _beacon(client, {"path": "/", "type": "store_ios", "ref": "https://na-pivo.cz"}, user_agent=MAC)

    assert _rows() == [
        ("beer-prices", "", "en", "view", "social", "instagram.com", "", "android", 1),
        ("home", "", "cs", "store_ios", "internal", "", "", "desktop", 1),
        ("web-pub", "/hospoda/u2fkbkb2", "cs", "view", "google", "", "instagram-bio", "ios", 2),
    ]
    assert WebStatsDaily.objects.get(page="home").day == pub_reach.reach_day(timezone.now())


def test_keeps_no_address_of_private_pages(client):
    _beacon(client, {"path": "/pozvanka/tajny-token-123", "type": "view"})
    _beacon(client, {"path": "/u/mach", "type": "view"})
    _beacon(client, {"path": "/hospoda/nic-tu-neni", "type": "view", "missing": True})
    _beacon(client, {"path": "/tohle/neexistuje", "type": "view"})

    assert [(page, path) for page, path, *_ in _rows()] == [
        ("not_found", ""), ("public-profile", ""), ("web-plan-invite", ""),
    ]
    assert WebStatsDaily.objects.get(page="not_found").count == 2


def test_ignores_bots_garbage_and_non_pages(client):
    _beacon(client, {"path": "/", "type": "view"}, user_agent="Mozilla/5.0 (compatible; Googlebot/2.1)")
    _beacon(client, {"path": "/", "type": "view"}, user_agent="")
    _beacon(client, {"path": "/", "type": "click"})
    _beacon(client, {"path": "https://evil.example/", "type": "view"})
    _beacon(client, {"path": "/admin/", "type": "view"})
    _beacon(client, {"path": "/v1/account", "type": "view"})
    _beacon(client, {"path": "/", "type": "view", "utm": "<script>"})
    client.post("/web/stats", data="{", content_type="application/json", HTTP_USER_AGENT=IPHONE)

    assert client.get("/web/stats").status_code == 405
    assert [(page, campaign) for page, _, _, _, _, _, campaign, *_ in _rows()] == [("home", "")]


def test_every_web_page_loads_the_counting_script(client):
    home = client.get("/").content.decode()
    missing = client.get("/tohle/neexistuje")

    assert "/web/stats.js" in home and "data-stats-missing" not in home
    assert missing.status_code == 404 and "data-stats-missing" in missing.content.decode()


class FakeGoogle:
    def __init__(self, days: list[date]):
        self.days = days
        self.calls: list[dict] = []

    def post(self, url, json, timeout):  # noqa: A002, ARG002
        self.calls.append(json)
        dims = json["dimensions"]
        rows = []
        for day in self.days:
            if dims == ["date"]:
                rows.append({"keys": [day.isoformat()], "clicks": 3, "impressions": 100, "position": 8.0})
            elif dims == ["date", "query"]:
                rows.append({"keys": [day.isoformat(), "ceny piva praha"], "clicks": 2, "impressions": 40, "position": 4.0})
            else:
                rows.append({"keys": [day.isoformat(), "https://na-pivo.cz/ceny"], "clicks": 2, "impressions": 60, "position": 5.5})
        return type("Response", (), {"raise_for_status": lambda self: None, "json": lambda self: {"rows": rows}})()


def test_search_console_copies_history_then_replaces_only_recent_days():
    today = date(2026, 11, 14)
    old, recent = today - timedelta(days=200), today - timedelta(days=3)

    first = FakeGoogle([old, recent])
    assert search_console.sync(first, today) == 6
    assert first.calls[0]["startDate"] == (today - timedelta(days=search_console.HISTORY_DAYS)).isoformat()

    second = FakeGoogle([recent])
    search_console.sync(second, today)
    assert second.calls[0]["startDate"] == (today - timedelta(days=search_console.REFRESH_DAYS)).isoformat()
    assert SearchConsoleDaily.objects.filter(day=old).count() == 3
    assert SearchConsoleDaily.objects.filter(day=recent).count() == 3


def test_search_console_command_is_quiet_until_configured_and_waits_six_hours(monkeypatch):
    call_command("sync_search_console")
    assert not SearchConsoleDaily.objects.exists()

    fake = FakeGoogle([timezone.localdate() - timedelta(days=3)])
    monkeypatch.setattr(search_console, "session", lambda: fake)
    with override_settings(SEARCH_CONSOLE_SERVICE_ACCOUNT='{"type": "service_account"}'):
        call_command("sync_search_console")
        call_command("sync_search_console")
        assert len(fake.calls) == 3
        call_command("sync_search_console", "--force")
        assert len(fake.calls) == 6


def test_admin_report_adds_up_the_web_and_google(client):
    today = pub_reach.reach_day(timezone.now())
    _beacon(client, {"path": "/hospoda/u2fkbkb2", "type": "view", "ref": "https://www.google.com"})
    _beacon(client, {"path": "/hospoda/u2fkbkb2", "type": "store_ios", "ref": "https://www.google.com"})
    _beacon(client, {"path": "/ceny", "type": "view", "ref": "https://na-pivo.cz"}, user_agent=ANDROID)
    _beacon(client, {"path": "/ceny", "type": "store_android", "ref": "https://na-pivo.cz"}, user_agent=ANDROID)
    _beacon(client, {"path": "/", "type": "view", "ref": "https://lm.facebook.com", "utm": "pivnici"}, user_agent=MAC)
    WebStatsDaily.objects.filter(day=today).update(day=today - timedelta(days=1))
    _beacon(client, {"path": "/", "type": "view"})
    for back in (8, 12):
        WebStatsDaily.objects.create(
            day=today - timedelta(days=back), page="home", lang="cs", metric="view", source="google", device="ios", count=2
        )
    search_console.sync(FakeGoogle([today - timedelta(days=n) for n in (3, 4, 10)]), today)

    def view(**params):
        request = RequestFactory().get("/admin/pubs/webstatsdaily/", params)
        request.user = User.objects.get_or_create(username="mach", is_staff=True, is_superuser=True)[0]
        response = admin.site._registry[WebStatsDaily].changelist_view(request)
        return response.context_data["report"], response.render().content.decode()

    report, html = view(days="7")
    web = {row["label"]: (row["now"], row["before"], row["change"]) for row in report["web"]["rows"]}
    assert report["web"]["now"] == (today - timedelta(days=6), today - timedelta(days=1))
    assert web["Otevření stránek"] == (3, 4, -25)
    assert web["Příchody na web"] == (2, 4, -50)
    assert web["Příchody z Googlu"] == (1, 4, -75)
    assert web["Klepnutí na App Store"] == (1, 0, None)
    assert web["Klepnutí do storu na 100 příchodů"] == (100.0, 0.0, None)

    google = {row["label"]: (row["now"], row["before"], row["change"]) for row in report["google"]["rows"]}
    assert report["google"]["now"] == (today - timedelta(days=6), today - timedelta(days=3))
    assert report["google"]["before"] == (today - timedelta(days=10), today - timedelta(days=7))
    assert google["Ukázáno ve výsledcích Googlu"] == (200, 100, 100)
    assert google["Průměrná pozice"] == (8.0, 8.0, None)

    assert report["sources"][-1]["label"] == "Proklik uvnitř webu"
    assert [(row["key"], row["views"]) for row in report["referrers"]] == [("facebook.com", 1)]
    assert [(row["key"], row["views"]) for row in report["campaigns"]] == [("pivnici", 1)]
    assert [(row["key"], row["views"], row["store"]) for row in report["paths"]] == [("/hospoda/u2fkbkb2", 1, 1)]
    assert report["queries"][0]["key"] == "ceny piva praha"
    assert report["search_pages"][0]["path"] == "/ceny"
    assert [row["start"] for row in report["periods"]][:2] == [today, today - timedelta(days=1)]
    assert "Web analytika" in html and "ceny piva praha" in html
    assert html.count("<h2>Po dnech</h2>") == 1

    report, _ = view(days="30")
    assert report["web"]["before"] is None
    assert report["periods"][-1]["web"] is None and report["periods"][-1]["g_impressions"] is None

    report, html = view(days="120")
    assert report["weekly"] and "<h2>Po týdnech</h2>" in html
    assert sum(row["web"]["views"] for row in report["periods"] if row["web"]) == 8

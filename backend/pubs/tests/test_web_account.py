"""Signed-in web pages read and write through the app's /v1/ endpoints."""

from __future__ import annotations

import uuid

import pytest
from django.test import Client
from rest_framework.test import APIClient

import pubs.emailer as emailer
from pubs import accounts
from pubs.enrichment.google_geocoding import GoogleAddressCandidate, GoogleGeocodingSource
from pubs.models import Account, AccountExportJob, AuthToken, BeerCheckIn, UserAddedPub
from pubs.web.account_views import _rating_entry

pytestmark = pytest.mark.django_db

PASSWORD = "Pivo-je-zivot-12"
PAGES = ["/piva", "/moje-hospody", "/moje-hospody/pridat", "/parta", "/vycep", "/nastaveni"]
EN_PAGES = ["/en/my-beers", "/en/my-pubs", "/en/my-pubs/add", "/en/crew", "/en/taproom", "/en/settings"]


@pytest.fixture(autouse=True)
def no_emails(monkeypatch):
    for name in ("send_verification_email", "send_account_deletion_scheduled_email", "send_account_deleted_email"):
        monkeypatch.setattr(emailer, name, lambda *a, **kw: True)


def _member(email: str, nickname: str) -> tuple[Account, str]:
    account, token = accounts.register_email(
        accounts.new_registration_account(), email=email, password=PASSWORD, display_name=nickname
    )
    account.nickname = nickname
    account.save(update_fields=["nickname"])
    return account, token


def _bearer(token: str) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def _web(email: str) -> Client:
    client = Client(enforce_csrf_checks=True)
    client.get("/prihlaseni")
    signed_in = client.post(
        "/prihlaseni", {"email": email, "password": PASSWORD, "csrfmiddlewaretoken": client.cookies["csrftoken"].value}
    )
    assert signed_in.status_code == 302
    return client


def _csrf(client: Client) -> dict:
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


def _checkin(token: str, **extra) -> dict:
    body = {
        "client_id": str(uuid.uuid4()), "beer_name": "Pilsner Urquell", "brewery_name": "Pilsner Urquell",
        "rating": 4, "tags": ["crisp"], "note": "Na hladinku.", "visibility": "private", **extra,
    }
    response = _bearer(token).post("/v1/beer-checkins", body, format="json")
    assert response.status_code == 201, response.content
    return response.json()


@pytest.mark.parametrize("path", PAGES + EN_PAGES)
def test_pages_need_sign_in(path):
    response = Client().get(path)
    assert response.status_code == 302 and response["Location"].startswith(("/prihlaseni?next=", "/en/login?next="))


def test_pages_render_real_data_within_a_query_budget(django_assert_max_num_queries):
    me, my_token = _member("tomas@example.com", "tomas")
    friend, friend_token = _member("klara@example.com", "klara")
    _member("vlk@example.com", "vlk")
    request = _bearer(friend_token).post("/v1/friends/requests", {"nickname": "tomas"}, format="json")
    assert request.status_code == 201
    _checkin(my_token)
    client = _web("tomas@example.com")

    expected = {
        "/piva": "Pilsner Urquell",
        "/piva?pivo=pilsner-urquell": "Tvoje známka",
        "/parta": "klara chce do party",
        "/nastaveni": "tomas@example.com",
        "/moje-hospody": "Tady zatím hospody nemám",
        "/vycep": "Výčep je zatím prázdný",
        "/parta?hledat=vl": "@vlk",
    }
    for path, text in expected.items():
        # Measured 13 to 43 queries per page; the API views behind them stay bounded.
        with django_assert_max_num_queries(50):
            response = client.get(path)
        assert response.status_code == 200, path
        assert text in response.content.decode(), path
        assert response["Cache-Control"] == "private, no-store"
        assert response["X-Robots-Tag"] == "noindex, nofollow"
    for path in EN_PAGES:
        assert client.get(path).status_code == 200, path


READS = [
    "/v1/beers/ranking", "/v1/beers/search?q=pi", "/v1/beers/collection", "/v1/beers/detail?beer_name=Pilsner%20Urquell",
    "/v1/beers/photos?beer_name=Pilsner%20Urquell", "/v1/beer-checkins", "/v1/pubs", "/v1/pub-visits", "/v1/pub-favorites",
    "/v1/friends", "/v1/friends/invite", "/v1/friends/search?q=kl", "/v1/friends/settings", "/v1/nights/feed",
    "/v1/nights/summary", "/v1/account/me",
]


@pytest.mark.parametrize("path", READS)
def test_endpoints_the_web_reads_answer_the_session_and_still_the_bearer(path):
    _, token = _member("tomas@example.com", "tomas")
    assert _bearer(token).get(path).status_code == 200
    assert _web("tomas@example.com").get(path).status_code == 200
    assert Client().get(path).status_code == 401


def test_session_writes_need_csrf_while_the_released_bearer_payload_is_unchanged():
    me, token = _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")
    body = {"client_id": str(uuid.uuid4()), "beer_name": "Kozel 11", "rating": 3, "visibility": "private"}

    assert client.post("/v1/beer-checkins", body, content_type="application/json").status_code == 403
    saved = client.post("/v1/beer-checkins", body, content_type="application/json", **_csrf(client))
    assert saved.status_code == 201
    # A payload exactly as released app versions send it, with no cookie and no CSRF token.
    released = _checkin(token, beer_name="Bernard 12", visibility="friends")
    assert released["visibility"] == "friends"
    assert BeerCheckIn.objects.filter(account=me).count() == 2


def test_rating_from_the_web_rewrites_my_newest_checkin_like_the_app():
    _, token = _member("tomas@example.com", "tomas")
    older = _checkin(token, checked_in_at="2026-10-01T18:00:00Z", rating=None, note="")
    newer = _checkin(token, checked_in_at="2026-10-20T18:00:00Z", rating=5, tags=["one_more"], visibility="friends")
    history = sorted([older, newer], key=lambda row: row["checked_in_at"], reverse=True)

    entry = _rating_entry("Pilsner Urquell", "Pilsner Urquell", history)
    assert entry["base"]["client_id"] == newer["client_id"]
    assert (entry["rating"], entry["tags"], entry["visibility"]) == (5, ["one_more"], "friends")
    assert _rating_entry("Nové pivo", "", [])["visibility"] == "private"

    client = _web("tomas@example.com")
    again = client.post(
        "/v1/beer-checkins", {**entry["base"], "rating": 2}, content_type="application/json", **_csrf(client)
    )
    assert again.status_code in (200, 201)
    assert BeerCheckIn.objects.filter(client_id=newer["client_id"]).get().rating == 2
    assert BeerCheckIn.objects.count() == 2


def test_shared_content_from_the_web_asks_for_the_ugc_rules_first(settings):
    me, _ = _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")
    header = {"HTTP_X_NA_PIVO_UGC_POLICY_VERSION": settings.UGC_POLICY_VERSION, **_csrf(client)}
    body = {"client_id": str(uuid.uuid4()), "beer_name": "Kozel 11", "rating": 4, "visibility": "public"}

    blocked = client.post("/v1/beer-checkins", body, content_type="application/json", **header)
    assert blocked.status_code == 428 and blocked.json()["code"] == "ugc_consent_required"
    consent = client.put(
        "/v1/account/me/ugc-consent", {"version": settings.UGC_POLICY_VERSION}, content_type="application/json", **_csrf(client)
    )
    assert consent.status_code == 200
    assert client.post("/v1/beer-checkins", body, content_type="application/json", **header).status_code == 201


def test_accepting_a_friend_request_on_the_web():
    _, my_token = _member("tomas@example.com", "tomas")
    _, friend_token = _member("klara@example.com", "klara")
    request_id = _bearer(friend_token).post("/v1/friends/requests", {"nickname": "tomas"}, format="json").json()["id"]
    client = _web("tomas@example.com")

    accepted = client.post(f"/v1/friends/requests/{request_id}/accept", content_type="application/json", **_csrf(client))
    assert accepted.status_code == 200
    assert [f["nickname"] for f in _bearer(friend_token).get("/v1/friends").json()["friends"]] == ["tomas"]
    page = client.get("/parta").content.decode()
    assert "chce do party" not in page and "klara" in page


def test_profile_privacy_and_export_from_the_web(monkeypatch, settings):
    settings.ACCOUNT_EXPORT_ASYNC = True
    me, token = _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")

    nick = client.patch("/v1/account/me", {"nickname": "tomas_pivar"}, content_type="application/json", **_csrf(client))
    assert nick.status_code == 200 and nick.json()["nickname"] == "tomas_pivar"
    taken = client.patch("/v1/account/me", {"nickname": "x"}, content_type="application/json", **_csrf(client))
    assert taken.status_code == 400 and taken.json()["code"].startswith("nickname_")
    share = client.patch(
        "/v1/friends/settings", {"share_drinks_with_parta": False}, content_type="application/json", **_csrf(client)
    )
    assert share.status_code == 200
    me.refresh_from_db()
    assert me.nickname == "tomas_pivar" and me.share_drinks_with_parta is False

    accounts.request_email_verification(me, link_base="https://example.com/v")
    me.email_credential.email_verified = True
    me.email_credential.save(update_fields=["email_verified"])
    assert client.post("/v1/account/export", content_type="application/json", **_csrf(client)).status_code == 202
    assert AccountExportJob.objects.filter(account=me).count() == 1
    download = client.get("/v1/account/export")
    assert download.status_code == 200 and "attachment" in download["Content-Disposition"]


def test_logout_everywhere_needs_post_and_csrf_and_signs_out_the_app_too():
    _, token = _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")

    assert client.get("/odhlasit-vsude").status_code == 405
    assert client.post("/odhlasit-vsude").status_code == 403
    done = client.post("/odhlasit-vsude", {"csrfmiddlewaretoken": client.cookies["csrftoken"].value})
    assert done.status_code == 302 and done["Location"] == "/"
    assert client.get("/nastaveni").status_code == 302
    assert _bearer(token).get("/v1/account/me").status_code == 401
    assert not AuthToken.objects.exists()


def test_deleting_the_account_from_the_web_uses_the_app_flow_and_grace_period():
    me, token = _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")

    deleted = client.delete("/v1/account/me", HTTP_X_ACCOUNT_DELETION_OPERATION_ID=str(uuid.uuid4()), **_csrf(client))
    assert deleted.status_code == 204
    me.refresh_from_db()
    assert me.status == Account.Status.PENDING_DELETION
    assert client.get("/nastaveni").status_code == 302
    landing = client.get("/ucet-smazan")
    assert landing.status_code == 200 and "14" in landing.content.decode()
    assert _bearer(token).get("/v1/account/me").status_code == 401


def test_adding_a_pub_from_the_web(monkeypatch, settings):
    settings.GOOGLE_MAPS_SERVER_API_KEY = "test-only"
    monkeypatch.setattr(
        GoogleGeocodingSource, "geocode_address",
        lambda self, *, address, city: GoogleAddressCandidate(50.0831, 14.4508, "Jičínská 12", "Praha", "street_address", "p1"),
    )
    _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")

    looked_up = client.post(
        "/v1/pubs/geocode", {"query": "Jičínská 12, Praha", "address_lookup": True}, content_type="application/json"
    )
    item = looked_up.json()["items"][0]
    assert item["precise"] is True and item["type"] == "regional.address"
    added = client.post(
        "/v1/pubs",
        {"client_id": str(uuid.uuid4()), "name": "U Komunity", "lat": 50.0831, "lng": 14.4508, "city": "Praha", "address": "Jičínská 12"},
        content_type="application/json",
        **_csrf(client),
    )
    assert added.status_code == 201, added.content
    pub = UserAddedPub.objects.get()
    page = client.get(f"/moje-hospody?hospoda={pub.cache_key}").content.decode()
    # Before the hourly catalogue knows it, the pub I added is on my map with its address.
    assert "U Komunity" in page and "Jičínská 12" in page and "Přidal jsi ji ty" in page


def test_beer_without_global_numbers_says_so_instead_of_zeros():
    _, token = _member("tomas@example.com", "tomas")
    _checkin(token)
    html = _web("tomas@example.com").get("/piva?pivo=pilsner-urquell").content.decode()
    # The hourly ranking job has not counted the beer yet: no "0 vypito" and no lone dash for the rating.
    assert "Celkovou známku zatím nemá." in html
    assert "vypito v Na pivo" not in html and 'npa-detail__big">–' not in html


def test_friend_invite_link_on_the_web(settings):
    inviter, inviter_token = _member("klara@example.com", "klara")
    code = _bearer(inviter_token).get("/v1/friends/invite").json()["code"]

    guest = Client().get(f"/p/{code}")
    assert guest.status_code == 200
    assert f"/prihlaseni?next=/p/{code}" in guest.content.decode()
    assert "klara" not in guest.content.decode()

    _member("tomas@example.com", "tomas")
    client = _web("tomas@example.com")
    page = client.get(f"/p/{code}")
    assert page.status_code == 200 and page["Cache-Control"] == "private, no-store"
    assert page.context["state"] == "valid" and "klara tě zve do party" in page.content.decode()
    added = client.post("/v1/friends/requests", {"invite_code": code}, content_type="application/json", **_csrf(client))
    assert added.status_code == 201
    assert client.get(f"/p/{code}").context["state"] in ("pending", "friends")
    assert _web("klara@example.com").get(f"/p/{code}").context["state"] == "self"
    assert client.get("/p/neznamy-kod").context["state"] == "invalid"


def test_pubs_page_shows_the_city_catalogue_with_my_pubs_and_where_the_crew_is(django_assert_max_num_queries):
    from django.utils import timezone

    from pubs.models import PubDirectory

    def pub(name, lat, lng):
        return PubDirectory.objects.create(name=name, lat=lat, lng=lng, city="Praha 1", country="cz", source="test",
                                           refreshed_at=timezone.now())

    tiger, kalich = pub("U Zlatého tygra", 50.0875, 14.4213), pub("U Kalicha", 50.0753, 14.4251)
    pub("U Pinkasů", 50.0832, 14.4237)
    me, my_token = _member("tomas@example.com", "tomas")
    friend, friend_token = _member("klara@example.com", "klara")
    assert _bearer(friend_token).post("/v1/friends/requests", {"nickname": "tomas"}, format="json").status_code == 201
    request_id = _bearer(my_token).get("/v1/friends").json()["incoming_requests"][0]["id"]
    assert _bearer(my_token).post(f"/v1/friends/requests/{request_id}/accept").status_code == 200
    now = timezone.now().isoformat()
    assert _bearer(my_token).post("/v1/pub-visits", {"client_id": str(uuid.uuid4()), "name": "U Kalicha",
                                  "lat": kalich.lat, "lng": kalich.lng, "city": "Praha 1", "started_at": now,
                                  "updated_at": now}, format="json").status_code in (200, 201)
    assert _bearer(friend_token).post("/v1/friends/pub-activity", {"client_id": str(uuid.uuid4()), "name": tiger.name,
                                      "lat": tiger.lat, "lng": tiger.lng, "city": "Praha 1"}, format="json").status_code == 201
    client = _web("tomas@example.com")

    with django_assert_max_num_queries(60):
        page = client.get("/moje-hospody")
    names = [row["name"] for row in page.context["rows"]]
    assert sorted(names) == ["U Kalicha", "U Pinkasů", "U Zlatého tygra"]
    row = {row["name"]: row for row in page.context["rows"]}
    assert row["U Kalicha"]["mine"][0].startswith("Byl jsi tu 1×") and row["U Pinkasů"]["mine"] == []
    assert row["U Zlatého tygra"]["friends"] == ["klara"] and row["U Kalicha"]["friends"] == []
    assert [row["name"] for row in client.get("/moje-hospody?moje=1").context["rows"]] == ["U Kalicha"]
    assert [row["name"] for row in client.get("/moje-hospody?parta=1").context["rows"]] == ["U Zlatého tygra"]
    assert [row["name"] for row in client.get("/moje-hospody?q=pinkas").context["rows"]] == ["U Pinkasů"]
    picked = client.get(f"/moje-hospody?hospoda={kalich.cache_key}").context["selected"]
    assert picked["name"] == "U Kalicha" and f"hospoda={kalich.cache_key}" in picked["log_url"]

    # A friend who is not out right now leaves no trace on the page.
    activity = _bearer(friend_token).get("/v1/friends").json()
    assert activity is not None
    from pubs.models import FriendPubActivity

    FriendPubActivity.objects.filter(account=friend).update(expires_at=timezone.now())
    assert all(not row["friends"] for row in client.get("/moje-hospody").context["rows"])


def test_small_fixes_on_settings_and_crew():
    me, _ = _member("tomas@example.com", "tomas")
    friend, friend_token = _member("klara@example.com", "klara")
    assert _bearer(friend_token).post("/v1/friends/requests", {"nickname": "tomas"}, format="json").status_code == 201
    client = _web("tomas@example.com")
    request_id = client.get("/v1/friends").json()["incoming_requests"][0]["id"]
    assert client.post(f"/v1/friends/requests/{request_id}/accept", content_type="application/json", **_csrf(client)).status_code == 200

    settings_html = client.get("/nastaveni?ulozeno=profil").content.decode()
    assert "Profil je uložený." in settings_html and "Profil je uložený." not in client.get("/nastaveni").content.decode()
    assert "Automaticky partě" in settings_html and ">Všem<" not in settings_html

    board = client.get("/parta").context["board"]
    mine = next(row for row in board if row["is_me"])
    assert mine["name"] == "Ty" and mine["avatar_name"][0].upper() == "T"
    assert client.get("/parta").context["needs_nickname"] is False
    Account.objects.filter(pk=me.pk).update(nickname=None)
    assert "Jak ti má parta říkat?" in client.get("/parta").content.decode()


def test_google_only_account_sets_a_password_with_its_email():
    from pubs.models import AuthIdentity
    from pubs.web.session import SESSION_KEY, hash_account_token

    _account, token, _created = accounts.resolve_social(
        None, provider=AuthIdentity.Provider.GOOGLE,
        claims={"sub": "g-only", "email": "gonly@example.com", "email_verified": True},
    )
    client = Client()
    session = client.session
    session[SESSION_KEY] = hash_account_token(token)
    session.save()

    html = client.get("/nastaveni").content.decode()

    assert '<input type="hidden" name="email" value="gonly@example.com">' in html
    assert "Nastavit heslo" in html and "Změnit heslo" not in html
    done = _bearer(token).post("/v1/auth/set-password", {"email": "gonly@example.com", "password": PASSWORD}, format="json")
    assert done.status_code == 200, done.content

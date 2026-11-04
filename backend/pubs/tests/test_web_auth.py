"""Web sign-in: same credential rules as /v1/auth, a session tied to an AuthToken."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest
from django.test import Client
from django.urls import include, path
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.views import APIView

import pubs.emailer as emailer
import pubs.oauth as oauth
from pubs.api.authentication import AccountTokenAuthentication, WebSessionAuthentication
from pubs.models import Account, AccountUsageStats, AuthIdentity, AuthToken, EmailCredential
from pubs.web.session import SESSION_KEY


class _SessionProbe(APIView):
    authentication_classes = [AccountTokenAuthentication, WebSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"id": str(request.user.public_id), "epoch": request._request.na_pivo_deletion_epoch})

    def post(self, request):
        return Response({"id": str(request.user.public_id)})


urlpatterns = [path("_probe", _SessionProbe.as_view()), path("", include("config.urls"))]
pytestmark = [pytest.mark.django_db, pytest.mark.urls(__name__)]

EMAIL = "stamgast@example.com"
PASSWORD = "Pivo-je-zivot-12"


@pytest.fixture(autouse=True)
def no_emails(monkeypatch):
    sent = []
    for name in ("send_verification_email", "send_password_reset_email",
                 "send_account_deletion_scheduled_email", "send_account_deleted_email"):
        monkeypatch.setattr(emailer, name, lambda to, _n=name, **kw: sent.append((_n, to, kw)) or True)
    return sent


def _register(client: Client, **extra) -> object:
    data = {"display_name": "Tomáš z Libně", "email": EMAIL, "password": PASSWORD, **extra}
    return client.post("/registrace", data)


def _api_login() -> str:
    response = APIClient().post("/v1/auth/login", {"email": EMAIL, "password": PASSWORD}, format="json")
    assert response.status_code == 200, response.content
    return response.json()["token"]


def test_register_signs_in_with_an_httponly_session_tied_to_a_token():
    client = Client()
    response = _register(client)
    assert response.status_code == 302 and response["Location"] == "/denik"
    cookie = client.cookies["sessionid"]
    assert cookie["httponly"] and cookie["samesite"] == "Lax"
    account = EmailCredential.objects.get(email=EMAIL).account
    assert account.display_name == "Tomáš z Libně"
    token_hash = client.session[SESSION_KEY]
    assert AuthToken.objects.filter(account=account, token_hash=token_hash).exists()

    page = client.get("/denik")
    html = page.content.decode()
    assert page.status_code == 200 and "Tomáš z Libně" in html and "Level 1 · " in html
    assert page["Cache-Control"] == "private, no-store"
    assert token_hash not in html


def test_register_uses_the_api_rules():
    client = Client()
    short = _register(client, password="kratke")
    assert short.status_code == 400 and 'aria-invalid="true"' in short.content.decode()
    api = APIClient().post("/v1/auth/register", {"email": EMAIL, "password": "kratke"}, format="json")
    assert api.status_code == 400
    assert _register(client).status_code == 302
    taken = _register(Client())
    assert taken.status_code == 409
    assert "Tento e-mail už používá jiný účet." in taken.content.decode()


def test_login_wrong_password_and_next_redirects():
    _register(Client())
    client = Client()
    wrong = client.post("/prihlaseni", {"email": EMAIL, "password": "spatne-heslo-1"})
    assert wrong.status_code == 401 and "Nesprávný e-mail nebo heslo." in wrong.content.decode()
    assert SESSION_KEY not in client.session

    to_login = client.get("/piva")
    assert to_login.status_code == 302 and to_login["Location"] == "/prihlaseni?next=/piva"
    ok = client.post("/prihlaseni", {"email": EMAIL, "password": PASSWORD, "next": "/piva"})
    assert ok["Location"] == "/piva"


@pytest.mark.parametrize("target", ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"])
def test_login_never_redirects_off_site(target):
    _register(Client())
    response = Client().post("/prihlaseni", {"email": EMAIL, "password": PASSWORD, "next": target})
    assert response["Location"] == "/denik"


def test_login_attempts_share_the_api_limit(settings):
    _register(Client())
    client = Client()
    api = APIClient()
    for _ in range(10):
        api.post("/v1/auth/login", {"email": EMAIL, "password": "nope-nope-1"}, format="json")
    for _ in range(9):
        assert client.post("/prihlaseni", {"email": EMAIL, "password": "nope-nope-1"}).status_code == 401
    limited = client.post("/prihlaseni", {"email": EMAIL, "password": PASSWORD})
    assert limited.status_code == 429
    assert SESSION_KEY not in client.session


def test_logout_needs_post_and_csrf_and_keeps_the_app_signed_in():
    _register(Client())
    app_token = _api_login()
    client = Client(enforce_csrf_checks=True)
    page = client.get("/prihlaseni")
    csrf = client.cookies["csrftoken"].value
    client.post("/prihlaseni", {"email": EMAIL, "password": PASSWORD, "csrfmiddlewaretoken": csrf})
    assert client.get("/denik").status_code == 200
    assert page.status_code == 200

    assert client.get("/odhlasit").status_code == 405
    assert client.post("/odhlasit").status_code == 403
    csrf = client.cookies["csrftoken"].value
    assert client.post("/odhlasit", {"csrfmiddlewaretoken": csrf})["Location"] == "/"
    assert client.get("/denik").status_code == 302
    me = APIClient().get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {app_token}")
    assert me.status_code == 200


def test_sign_out_everywhere_from_the_app_ends_the_web_session():
    client = Client()
    _register(client)
    app_token = _api_login()
    APIClient().post("/v1/auth/logout", {"all": True}, format="json", HTTP_AUTHORIZATION=f"Bearer {app_token}")
    assert client.get("/denik")["Location"] == "/prihlaseni?next=/denik"
    assert client.get("/_probe").status_code == 401


def test_account_deletion_ends_the_web_session_and_login_restores_it():
    client = Client()
    _register(client)
    app_token = _api_login()
    deleted = APIClient().delete("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {app_token}")
    assert deleted.status_code == 204
    account = EmailCredential.objects.get(email=EMAIL).account
    assert account.status == Account.Status.PENDING_DELETION
    assert client.get("/denik").status_code == 302
    assert client.get("/_probe").status_code == 401

    again = Client()
    assert again.post("/prihlaseni", {"email": EMAIL, "password": PASSWORD}).status_code == 302
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE and account.deleted_at is None
    assert again.get("/denik").status_code == 200


def test_session_authentication_for_v1_needs_csrf_and_keeps_bearer_working():
    client = Client(enforce_csrf_checks=True)
    client.get("/registrace")
    csrf = client.cookies["csrftoken"].value
    _register(client, csrfmiddlewaretoken=csrf)
    account = EmailCredential.objects.get(email=EMAIL).account

    read = client.get("/_probe")
    assert read.status_code == 200
    token = AuthToken.objects.get(token_hash=client.session[SESSION_KEY])
    assert read.json() == {"id": str(account.public_id), "epoch": token.deletion_epoch}
    assert client.post("/_probe", "{}", content_type="application/json").status_code == 403
    assert client.post("/_probe", "{}", content_type="application/json", HTTP_X_CSRFTOKEN=csrf).status_code == 200

    assert Client().get("/_probe").status_code == 401
    bearer = APIClient().post("/_probe", HTTP_AUTHORIZATION=f"Bearer {_api_login()}")
    assert bearer.status_code == 200


def test_signed_in_header_on_public_pages():
    client = Client()
    _register(client)
    html = client.get("/hospody").content.decode()
    assert 'class="np-header__account" href="/denik"' in html
    assert ">Přihlásit se<" not in html


def test_reset_from_the_email_link_sets_the_password_on_the_web(no_emails):
    _register(Client())
    Client().post("/zapomenute-heslo", {"email": EMAIL})
    link = urlsplit(no_emails[-1][2]["link"])
    browser = Client()
    page = browser.get(browser.get(f"{link.path}?{link.query}")["Location"])
    html = page.content.decode()
    token = parse_qs(link.query)["token"][0]
    assert page.status_code == 200 and f'href="napivo://auth/reset?token={token}"' in html
    assert page["Referrer-Policy"] == "same-origin" and page["Cache-Control"] == "no-store"

    short = browser.post("/nove-heslo", {"token": token, "password": "kratke"})
    assert short.status_code == 400 and "Heslo potřebuje aspoň 8 znaků." in short.content.decode()
    common = browser.post("/nove-heslo", {"token": token, "password": "password123"})
    assert "Tohle heslo se dá moc snadno uhodnout." in common.content.decode()

    done = browser.post("/nove-heslo", {"token": token, "password": "Nove-pivo-2026"})
    assert done.status_code == 302 and done["Location"] == "/denik"
    assert browser.get("/denik").status_code == 200

    assert Client().post("/prihlaseni", {"email": EMAIL, "password": PASSWORD}).status_code == 401
    assert Client().post("/prihlaseni", {"email": EMAIL, "password": "Nove-pivo-2026"})["Location"] == "/denik"
    used = Client().post("/nove-heslo", {"token": token, "password": "Jine-pivo-2026"})
    assert used.status_code == 400 and "Tenhle odkaz už neplatí." in used.content.decode()


def test_form_errors_talk_like_the_app():
    empty = Client().post("/prihlaseni", {"email": "", "password": ""}).content.decode()
    assert "Napiš svůj e-mail." in empty and "Napiš heslo." in empty
    assert "Toto pole" not in empty
    bad = Client().post("/registrace", {"email": "pivo", "password": "Pivo-je-zivot-12"}).content.decode()
    assert "Tohle nevypadá jako e-mail." in bad and "Vložte" not in bad
    forgot = Client().post("/en/forgot-password", {"email": ""}).content.decode()
    assert "Enter your email." in forgot


def test_forgot_password_sends_the_app_reset_email(no_emails):
    _register(Client())
    response = Client().post("/zapomenute-heslo", {"email": EMAIL})
    assert response.status_code == 200 and 'role="status"' in response.content.decode()
    sent = [s for s in no_emails if s[0] == "send_password_reset_email"]
    assert sent and sent[0][1] == EMAIL and "/v1/auth/reset" in sent[0][2]["link"]
    unknown = Client().post("/zapomenute-heslo", {"email": "nikdo@example.com"})
    assert unknown.status_code == 200 and 'role="status"' in unknown.content.decode()


def test_social_buttons_only_with_client_ids(settings):
    settings.GOOGLE_WEB_CLIENT_ID = ""
    settings.APPLE_SERVICES_ID = ""
    html = Client().get("/prihlaseni").content.decode()
    assert "Pokračovat přes Google" not in html and "Pokračovat přes Apple" not in html
    assert Client().get("/prihlaseni/google").status_code == 404
    settings.GOOGLE_WEB_CLIENT_ID = "web-client"
    html = Client().get("/prihlaseni").content.decode()
    assert "Pokračovat přes Google" in html and "Pokračovat přes Apple" not in html


@pytest.fixture
def fake_providers(monkeypatch, settings):
    settings.GOOGLE_WEB_CLIENT_ID = "web-client"
    settings.APPLE_SERVICES_ID = "cz.napivo.web"

    def claims(token: str) -> dict:
        _, sub, email, nonce = token.split(":")
        return {"sub": sub, "email": email, "email_verified": True, "nonce": nonce}

    monkeypatch.setattr(oauth, "verify_google_id_token", claims)
    monkeypatch.setattr(oauth, "verify_apple_identity_token", claims)
    monkeypatch.setattr(oauth, "exchange_apple_auth_code", lambda code: {"refresh_token": f"rt-{code}"})


def _start(client: Client, provider: str, next_url: str = "") -> dict:
    response = client.get(f"/prihlaseni/{provider}" + (f"?next={next_url}" if next_url else ""))
    assert response.status_code == 302
    query = parse_qs(urlsplit(response["Location"]).query)
    assert query["response_mode"] == ["form_post"]
    assert query["redirect_uri"] == [f"https://na-pivo.cz/prihlaseni/{provider}/navrat"]
    return {"state": query["state"][0], "nonce": query["nonce"][0]}


def test_google_sign_in_goes_through_the_api_verification(fake_providers):
    client = Client(enforce_csrf_checks=True)
    pending = _start(client, "google", "/piva")
    id_token = f"google:g-sub:{EMAIL}:{pending['nonce']}"

    # Google posts from its own site: no cookies, no CSRF token.
    bounce = Client(enforce_csrf_checks=True).post(
        "/prihlaseni/google/navrat", {"state": pending["state"], "id_token": id_token}
    )
    assert bounce.status_code == 200
    html = bounce.content.decode()
    assert 'action="/prihlaseni/google"' in html and id_token in html and "data-autosubmit" in html

    client.get("/prihlaseni")
    csrf = client.cookies["csrftoken"].value
    done = client.post("/prihlaseni/google", {"state": pending["state"], "id_token": id_token, "csrfmiddlewaretoken": csrf})
    assert done.status_code == 302 and done["Location"] == "/piva"
    identity = AuthIdentity.objects.get(provider=AuthIdentity.Provider.GOOGLE, subject="g-sub")
    assert AuthToken.objects.filter(account=identity.account, token_hash=client.session[SESSION_KEY]).exists()


def test_social_sign_in_rejects_a_foreign_state_or_nonce(fake_providers):
    client = Client()
    pending = _start(client, "google")
    wrong_state = client.post("/prihlaseni/google", {"state": "x", "id_token": f"google:s:{EMAIL}:{pending['nonce']}"})
    assert wrong_state.status_code == 400
    pending = _start(client, "google")
    wrong_nonce = client.post("/prihlaseni/google", {"state": pending["state"], "id_token": f"google:s:{EMAIL}:other"})
    assert wrong_nonce.status_code == 400
    assert not AuthIdentity.objects.exists() and SESSION_KEY not in client.session
    replay = client.post("/prihlaseni/google", {"state": pending["state"], "id_token": f"google:s:{EMAIL}:{pending['nonce']}"})
    assert replay.status_code == 400


def test_apple_sign_in_is_not_offered_on_the_web(client, settings):
    settings.APPLE_SERVICES_ID = "cz.napivo.web"

    assert "Pokračovat přes Apple" not in client.get("/prihlaseni").content.decode()
    assert client.get("/prihlaseni/apple").status_code == 404

def test_panel_level_counts_mapper_and_pivar_xp_like_the_app():
    client = Client()
    _register(client)
    account = EmailCredential.objects.get(email=EMAIL).account
    AccountUsageStats.objects.update_or_create(account=account, defaults={"mapper_xp": 300, "pivar_xp": 200})

    assert "Level 3 · " in client.get("/denik").content.decode()

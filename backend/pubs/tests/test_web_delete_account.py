"""Account deletion without signing in: an e-mailed one-time link confirms it.

What hurts most if it breaks, first: the answer never tells whether an e-mail
has an account, opening the link alone deletes nothing, the deletion is the
same as the app's (tokens out, grace period, sign-in restores).
"""

from __future__ import annotations

import uuid

import pytest
from django.test import Client
from rest_framework.test import APIClient

import pubs.emailer as emailer
from pubs.models import Account, AuthToken, EmailCredential
from pubs.web.delete_account_views import sitemap_paths

pytestmark = pytest.mark.django_db

EMAIL = "stamgast@example.com"
PASSWORD = "Pivo-je-zivot-12"
SENT = "Jestli k tomu e-mailu máš účet, odkaz už ti letí."


@pytest.fixture
def mails(monkeypatch):
    sent = []
    monkeypatch.setattr(emailer, "send_account_deletion_link_email", lambda to, **kw: sent.append(("link", to, kw)) or True)
    monkeypatch.setattr(emailer, "send_account_deletion_scheduled_email", lambda to, **kw: sent.append(("scheduled", to, kw)) or True)
    monkeypatch.setattr(emailer, "send_verification_email", lambda to, **kw: True)
    return sent


@pytest.fixture
def account_token(mails):
    api = APIClient()
    anonymous = api.post("/v1/account", {"device_id": str(uuid.uuid4())}, format="json").json()["token"]
    response = api.post("/v1/auth/register", {"email": EMAIL, "password": PASSWORD}, format="json",
                        HTTP_AUTHORIZATION=f"Bearer {anonymous}")
    assert response.status_code in (200, 201), response.content
    return response.json()["token"]


def _link_path(mails) -> str:
    link = next(kw["link"] for kind, _to, kw in mails if kind == "link")
    assert link.startswith("https://na-pivo.cz/smazat-ucet/potvrdit?token=")
    return link.split("na-pivo.cz", 1)[1]


def test_unknown_and_known_e_mail_get_the_same_answer(account_token, mails):
    unknown = Client().post("/smazat-ucet", {"email": "nikdo@example.com"})
    known = Client().post("/smazat-ucet", {"email": EMAIL.upper()})
    assert unknown.status_code == known.status_code == 200
    assert SENT in unknown.content.decode() and SENT in known.content.decode()
    assert [(kind, to) for kind, to, _ in mails] == [("link", EMAIL)]


def test_link_confirms_the_same_deletion_as_the_app_and_sign_in_restores(
    account_token, mails, django_capture_on_commit_callbacks
):
    Client().post("/smazat-ucet", {"email": EMAIL})
    path = _link_path(mails)
    account = EmailCredential.objects.get(email=EMAIL).account

    question = Client().get(path)
    assert question.status_code == 200
    assert EMAIL in question.content.decode()
    assert question.headers["Referrer-Policy"] == "no-referrer"
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE  # a mail scanner opening the link deletes nothing

    token = path.split("token=", 1)[1]
    with django_capture_on_commit_callbacks(execute=True):
        done = Client().post("/smazat-ucet/potvrdit", {"token": token})
    assert done.status_code == 200 and "Účet se maže" in done.content.decode()
    account.refresh_from_db()
    assert account.status == Account.Status.PENDING_DELETION
    assert not AuthToken.objects.filter(account=account).exists()
    assert APIClient().get("/v1/account/me", HTTP_AUTHORIZATION=f"Bearer {account_token}").status_code == 401
    assert ("scheduled", EMAIL) in [(kind, to) for kind, to, _ in mails]

    assert Client().post("/smazat-ucet/potvrdit", {"token": token}).status_code == 400
    login = APIClient().post("/v1/auth/login", {"email": EMAIL, "password": PASSWORD}, format="json")
    assert login.status_code == 200
    account.refresh_from_db()
    assert account.status == Account.Status.ACTIVE


def test_per_address_limit_answers_like_a_sent_link(account_token, mails):
    for _ in range(4):
        response = Client(REMOTE_ADDR=f"10.0.0.{len(mails)}").post("/smazat-ucet", {"email": EMAIL})
        assert SENT in response.content.decode()
    assert len([m for m in mails if m[0] == "link"]) == 3


def test_network_limit_and_bad_input(account_token, mails):
    assert Client().post("/smazat-ucet", {"email": "tohle-neni-mail"}).status_code == 400
    for _ in range(5):
        Client().post("/smazat-ucet", {"email": "nikdo@example.com"})
    assert Client().post("/smazat-ucet", {"email": EMAIL}).status_code == 429


def test_invalid_link_and_page_basics(account_token):
    assert Client().get("/smazat-ucet/potvrdit?token=nesmysl").status_code == 404
    page = Client().get("/smazat-ucet")
    html = page.content.decode()
    assert page.status_code == 200
    assert "Přihlásit se a smazat účet" in html and "/prihlaseni?next=/nastaveni" in html
    assert Client().get("/en/delete-account").status_code == 200
    assert sitemap_paths() == ["/smazat-ucet", "/en/delete-account"]

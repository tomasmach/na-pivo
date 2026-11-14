import re

import pytest
from django.contrib.auth.models import User
from django.test import Client

pytestmark = pytest.mark.django_db

LOGIN = "/admin/login/"


def _login_form(client: Client, next_url: str) -> dict:
    html = client.get(LOGIN).content.decode()
    token = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html).group(1)
    return {"csrfmiddlewaretoken": token, "username": "mach", "password": "pivo-heslo-123", "next": next_url}


def test_a_login_form_sent_twice_lands_in_the_admin():
    User.objects.create_superuser("mach", password="pivo-heslo-123")
    client = Client(enforce_csrf_checks=True)
    form = _login_form(client, "/admin/pubs/webstatsdaily/")

    assert client.post(LOGIN, form).status_code == 302
    again = client.post(LOGIN, form)
    elsewhere = client.post(LOGIN, {**form, "next": "https://evil.example/"})

    assert (again.status_code, again["Location"]) == (302, "/admin/pubs/webstatsdaily/")
    assert (elsewhere.status_code, elsewhere["Location"]) == (302, "/admin/")


def test_a_stale_form_without_a_login_still_fails():
    client = Client(enforce_csrf_checks=True)
    form = _login_form(client, "/admin/")
    client.cookies.clear()

    assert client.post(LOGIN, form).status_code == 403

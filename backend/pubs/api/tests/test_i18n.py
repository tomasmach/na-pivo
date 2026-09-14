"""English support: locale negotiation, stored locale, and per-reader rendering.

These tests assert the MECHANISM, not the wording. Each expected English string
is computed with ``gettext`` inside ``translation.override("en")``, so the suite
passes both before the translator fills backend/locale/en/LC_MESSAGES/django.po
(gettext returns the Czech msgid) and after (it returns the English msgstr).
"""

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache
from django.utils import timezone as dj_timezone
from django.utils import translation
from django.utils.translation import gettext, gettext_lazy
from rest_framework import status
from rest_framework.test import APIClient

from pubs.api.views import (
    _create_friend_notification,
    _pub_directory_item,
    _send_friend_push,
)
from pubs.i18n import LocalizedText, locale_for_account, normalize_locale
from pubs.models import (
    Account,
    AmenityKind,
    FriendNotification,
    PubDirectory,
    PubHours,
    PushDevice,
)

_PUSH_TOKEN = "ExponentPushToken[i18n-cs]"
_PUSH_TOKEN_EN = "ExponentPushToken[i18n-en]"


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


class _FakeExpoResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"data": []}


def _push_recorder(sent_payloads: list):
    def _fake_post(url, *, json, timeout):  # noqa: ANN001
        sent_payloads.append(json)
        return _FakeExpoResponse()

    return _fake_post


def _register(client: APIClient) -> tuple[str, Account]:
    device_id = str(uuid.uuid4())
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"], Account.objects.get(device_id=device_id)


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _in_english(value) -> str:
    with translation.override("en"):
        return str(value)


# ---------------------------------------------------------------------------
# normalize_locale
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("en", "en"),
        ("EN", "en"),
        ("en-GB", "en"),
        ("en_US", "en"),
        ("cs", "cs"),
        ("sk", "cs"),
        ("sk-SK", "cs"),
        ("de", "cs"),
        ("", "cs"),
        (None, "cs"),
        (42, "cs"),
    ],
)
def test_normalize_locale(raw, expected):
    assert normalize_locale(raw) == expected


# ---------------------------------------------------------------------------
# PUT /v1/push-device
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_push_device_accepts_released_payload_without_locale(client):
    """Contract: the payload shipped in released app versions still succeeds."""

    token, account = _register(client)

    resp = client.put(
        "/v1/push-device",
        data={
            "push_token": _PUSH_TOKEN,
            "platform": "ios",
            "permission_status": "granted",
            "enabled": True,
            "app_version": "1.5.1",
        },
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    device = PushDevice.objects.get(push_token=_PUSH_TOKEN)
    assert device.locale == ""
    account.refresh_from_db()
    assert account.locale == ""
    assert locale_for_account(account) == "cs"


@pytest.mark.django_db
def test_push_device_stores_locale_on_device_and_account(client):
    token, account = _register(client)

    resp = client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN_EN, "platform": "ios", "locale": "en-GB"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["locale"] == "en"
    assert PushDevice.objects.get(push_token=_PUSH_TOKEN_EN).locale == "en"
    account.refresh_from_db()
    assert account.locale == "en"


@pytest.mark.django_db
def test_push_device_normalizes_slovak_to_czech(client):
    token, account = _register(client)

    resp = client.put(
        "/v1/push-device",
        data={"push_token": _PUSH_TOKEN, "platform": "android", "locale": "sk"},
        format="json",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_200_OK
    assert PushDevice.objects.get(push_token=_PUSH_TOKEN).locale == "cs"
    account.refresh_from_db()
    assert account.locale == "cs"


# ---------------------------------------------------------------------------
# Accept-Language on API responses
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_accept_language_en_translates_detail(client):
    token, _account = _register(client)

    resp = client.get(
        "/v1/friends/invite/NOSUCHCODE",
        HTTP_ACCEPT_LANGUAGE="en",
        **_auth(token),
    )

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    body = resp.json()
    assert body["code"] == "invite_invalid"
    with translation.override("en"):
        assert body["detail"] == gettext("Pozvánku neznám.")


@pytest.mark.django_db
def test_missing_accept_language_stays_czech(client):
    """Released app versions send no Accept-Language and must keep seeing Czech."""

    token, _account = _register(client)

    resp = client.get("/v1/friends/invite/NOSUCHCODE", **_auth(token))

    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert resp.json()["detail"] == "Pozvánku neznám."


@pytest.mark.django_db
def test_slovak_accept_language_stays_czech(client):
    token, _account = _register(client)

    resp = client.get(
        "/v1/friends/invite/NOSUCHCODE",
        HTTP_ACCEPT_LANGUAGE="sk-SK,sk;q=0.9",
        **_auth(token),
    )

    assert resp.json()["detail"] == "Pozvánku neznám."


# ---------------------------------------------------------------------------
# Push and inbox render for the reader, not the sender
# ---------------------------------------------------------------------------


_PUSH_TITLE = LocalizedText(gettext_lazy("Žádost přijata"))
_PUSH_BODY = LocalizedText(
    gettext_lazy("%(name)s si tě přidal mezi kamarády."),
    {"name": "Pepa"},
)


@pytest.mark.django_db
def test_push_renders_per_device_locale(client, monkeypatch):
    _token, account = _register(client)
    PushDevice.objects.create(
        account=account,
        push_token=_PUSH_TOKEN,
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        locale="",
    )
    PushDevice.objects.create(
        account=account,
        push_token=_PUSH_TOKEN_EN,
        platform=PushDevice.Platform.ANDROID,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        locale="en",
    )
    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))

    _send_friend_push([account.id], _PUSH_TITLE, _PUSH_BODY, {"kind": "friend_accepted"})

    messages = {message["to"]: message for batch in sent for message in batch}
    assert set(messages) == {_PUSH_TOKEN, _PUSH_TOKEN_EN}
    assert messages[_PUSH_TOKEN]["title"] == "Žádost přijata"
    assert messages[_PUSH_TOKEN]["body"] == "Pepa si tě přidal mezi kamarády."
    assert messages[_PUSH_TOKEN_EN]["title"] == _in_english(_PUSH_TITLE)
    assert messages[_PUSH_TOKEN_EN]["body"] == _in_english(_PUSH_BODY)


@pytest.mark.django_db
def test_friend_notification_renders_in_recipient_locale(client):
    _token, recipient = _register(client)
    _actor_token, actor = _register(client)
    recipient.locale = "en"
    recipient.save(update_fields=["locale"])

    notification = _create_friend_notification(
        recipient=recipient,
        actor=actor,
        kind=FriendNotification.Kind.FRIEND_ACCEPTED,
        title=_PUSH_TITLE,
        body=_PUSH_BODY,
    )

    notification.refresh_from_db()
    assert notification.title == _in_english(_PUSH_TITLE)
    assert notification.body == _in_english(_PUSH_BODY)


@pytest.mark.django_db
def test_friend_notification_defaults_to_czech_for_unknown_locale(client):
    _token, recipient = _register(client)
    _actor_token, actor = _register(client)

    notification = _create_friend_notification(
        recipient=recipient,
        actor=actor,
        kind=FriendNotification.Kind.FRIEND_ACCEPTED,
        title=_PUSH_TITLE,
        body=_PUSH_BODY,
    )

    assert notification.title == "Žádost přijata"
    assert notification.body == "Pepa si tě přidal mezi kamarády."


# ---------------------------------------------------------------------------
# DB-backed amenity catalogue
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_amenity_kinds_expose_english_labels(client):
    resp = client.get("/v1/pub-amenities/kinds")

    assert resp.status_code == status.HTTP_200_OK
    kinds = {row["key"]: row for row in resp.json()["kinds"]}
    card = kinds["payment_card"]
    assert card["label_cs"] == "Platba kartou"
    assert card["label_en"] == "Card payment"
    assert card["short_label_en"] == "Card"
    # No Accept-Language: the resolved pair stays Czech for released clients.
    assert card["label"] == "Platba kartou"
    assert card["short_label"] == "Karta"


@pytest.mark.django_db
def test_amenity_kinds_resolve_labels_for_english_request(client):
    resp = client.get("/v1/pub-amenities/kinds", HTTP_ACCEPT_LANGUAGE="en")

    kinds = {row["key"]: row for row in resp.json()["kinds"]}
    assert kinds["payment_card"]["label"] == "Card payment"
    assert kinds["practical_tank_beer"]["label"] == "Tank beer"
    # The Czech wire fields released apps read never move.
    assert kinds["payment_card"]["label_cs"] == "Platba kartou"


@pytest.mark.django_db
def test_amenity_kind_falls_back_to_czech_when_english_is_missing(client):
    AmenityKind.objects.filter(key="payment_card").update(label_en="", short_label_en="")

    resp = client.get("/v1/pub-amenities/kinds", HTTP_ACCEPT_LANGUAGE="en")

    card = {row["key"]: row for row in resp.json()["kinds"]}["payment_card"]
    assert card["label_en"] == "Platba kartou"
    assert card["label"] == "Platba kartou"


# ---------------------------------------------------------------------------
# Release notes
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_release_note_2_0_0_carries_english_copy(client):
    resp = client.get("/v1/release-notes", data={"version": "2.0.0"})

    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["title"] == "Celý večer v jedné appce"
    assert body["title_en"] == "Your whole night in one app"
    assert all(item["text_en"] for item in body["items"])


# ---------------------------------------------------------------------------
# Machine-read enums must never be translated
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_pub_directory_label_stays_czech_in_english():
    """`label` is the Mapy category enum, not display copy.

    src/data/mapyClient.ts filters every result against a hardcoded Czech
    allow-list (ALLOWED_LABELS / TRUSTED_PUB_LABELS), so translating this would
    empty the compass and the map for an English user.
    """

    row = PubDirectory.objects.create(
        cache_key="u2fkbfvz",
        name="U Hrocha",
        lat=50.089,
        lng=14.404,
        city="Praha",
        country="CZ",
        venue_kind=PubHours.VenueKind.PUB,
        refreshed_at=dj_timezone.now(),
    )

    with translation.override("en"):
        item = _pub_directory_item(row)

    assert item["label"] == "Hospoda"

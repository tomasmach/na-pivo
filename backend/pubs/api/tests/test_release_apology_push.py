from __future__ import annotations

import uuid
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.models import Account, PushDevice

from .test_friends import _flatten_push, _push_recorder


def _device(nickname: str, app_version: str, *, locale: str = "", enabled: bool = True) -> Account:
    account = Account.objects.create(nickname=nickname, device_id=str(uuid.uuid4()))
    PushDevice.objects.create(
        account=account,
        push_token=f"ExponentPushToken[{nickname}]",
        platform=PushDevice.Platform.IOS,
        permission_status=PushDevice.PermissionStatus.GRANTED,
        enabled=enabled,
        app_version=app_version,
        locale=locale,
    )
    return account


@pytest.mark.django_db
def test_dry_run_counts_2x_devices_and_sends_nothing(monkeypatch):
    _device("old", "1.5.1")
    _device("two", "2.0.0")
    _device("fixed", "2.1.0")
    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))

    out = StringIO()
    call_command("send_release_apology_push", stdout=out)

    assert "recipients: 2 accounts" in out.getvalue()
    assert sent == []


@pytest.mark.django_db
def test_send_reaches_only_enabled_2x_devices_in_their_language(monkeypatch):
    _device("old", "1.5.1")
    _device("two", "2.0.0")
    _device("fixed", "2.1.0", locale="en")
    _device("off", "2.1.0", enabled=False)
    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))

    call_command("send_release_apology_push", "--send", stdout=StringIO())

    messages = _flatten_push(sent)
    assert sorted(m["to"] for m in messages) == [
        "ExponentPushToken[fixed]",
        "ExponentPushToken[two]",
    ]
    by_token = {m["to"]: m for m in messages}
    assert by_token["ExponentPushToken[two]"]["title"] == "Omlouvám se za dvojku"
    assert by_token["ExponentPushToken[fixed]"]["title"] == "Sorry about 2.0"
    assert all(m["data"] == {"kind": "release_apology"} for m in messages)

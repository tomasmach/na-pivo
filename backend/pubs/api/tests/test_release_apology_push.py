from __future__ import annotations

import uuid
from io import StringIO

import pytest
from django.core.management import call_command

from pubs.models import Account, PushDevice

from .test_friends import _flatten_push, _push_recorder, _set_quiet_window


def _device(nickname: str, app_version: str, *, locale: str = "", enabled: bool = True) -> Account:
    account = Account.objects.create(
        nickname=nickname, device_id=str(uuid.uuid4()), quiet_hours_enabled=False
    )
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
@pytest.mark.parametrize("version_format", ["{}", "v{}", "v{} (1)"])
def test_dry_run_counts_2x_devices_and_sends_nothing(monkeypatch, version_format):
    _device("old", version_format.format("1.5.1"))
    _device("two", version_format.format("2.0.0"))
    _device("fixed", version_format.format("2.1.0"))
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


@pytest.mark.django_db
@pytest.mark.parametrize("version_format", ["{}", "v{}", "v{} (1)"])
@pytest.mark.parametrize(
    ("options", "expected_tokens"),
    [
        ([], ["ExponentPushToken[two]", "ExponentPushToken[fixed]"]),
        (["--version-prefix", "2.0"], ["ExponentPushToken[two]"]),
    ],
)
def test_send_filters_each_device_on_the_same_account(
    monkeypatch, options, expected_tokens, version_format
):
    account = _device("two", version_format.format("2.0.0"))
    for nickname, version in [("old", "1.5.1"), ("fixed", "2.1.0")]:
        PushDevice.objects.create(
            account=account,
            push_token=f"ExponentPushToken[{nickname}]",
            platform=PushDevice.Platform.IOS,
            permission_status=PushDevice.PermissionStatus.GRANTED,
            enabled=True,
            app_version=version_format.format(version),
        )
    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))

    call_command("send_release_apology_push", "--send", *options, stdout=StringIO())

    assert sorted(message["to"] for message in _flatten_push(sent)) == sorted(expected_tokens)


@pytest.mark.django_db
def test_send_skips_accounts_in_quiet_hours(monkeypatch):
    quiet_account = _device("quiet", "2.0.0")
    _set_quiet_window(quiet_account, contains_now=True)
    _device("awake", "2.0.0")
    sent: list = []
    monkeypatch.setattr("pubs.api.views.requests.post", _push_recorder(sent))

    call_command("send_release_apology_push", "--send", stdout=StringIO())

    assert [message["to"] for message in _flatten_push(sent)] == ["ExponentPushToken[awake]"]

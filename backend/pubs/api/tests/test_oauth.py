from __future__ import annotations

import pytest

import pubs.oauth as oauth


class _FakeAppleResponse:
    status_code = 400
    text = (
        '{"error":"invalid_grant","error_description":"token leak secret-token '
        'user@example.com"}'
    )

    def json(self) -> dict:
        return {
            "error": "invalid_grant",
            "error_description": "token leak secret-token user@example.com",
        }


@pytest.fixture
def apple_settings(settings, monkeypatch):
    settings.APPLE_CLIENT_ID = "cz.test.na-pivo"
    monkeypatch.setattr(oauth, "_apple_client_secret", lambda: "client-secret")


def test_apple_auth_code_failure_log_omits_response_body(
    apple_settings,
    monkeypatch,
):
    logged: list[str] = []

    def record_warning(message: str, *args) -> None:
        logged.append(message % args)

    monkeypatch.setattr(oauth.requests, "post", lambda *args, **kwargs: _FakeAppleResponse())
    monkeypatch.setattr(oauth.logger, "warning", record_warning)

    with pytest.raises(oauth.OAuthError):
        oauth.exchange_apple_auth_code("auth-code")

    text = "\n".join(logged)
    assert "invalid_grant" in text
    assert "secret-token" not in text
    assert "user@example.com" not in text
    assert "error_description" not in text


def test_apple_revoke_failure_log_omits_response_body(
    apple_settings,
    monkeypatch,
):
    logged: list[str] = []

    def record_warning(message: str, *args) -> None:
        logged.append(message % args)

    monkeypatch.setattr(oauth.requests, "post", lambda *args, **kwargs: _FakeAppleResponse())
    monkeypatch.setattr(oauth.logger, "warning", record_warning)

    with pytest.raises(oauth.OAuthError):
        oauth.revoke_apple_token("refresh-token")

    text = "\n".join(logged)
    assert "invalid_grant" in text
    assert "secret-token" not in text
    assert "user@example.com" not in text
    assert "error_description" not in text

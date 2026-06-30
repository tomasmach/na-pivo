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


def test_google_verify_failure_log_omits_exception_message(settings, monkeypatch):
    settings.GOOGLE_OAUTH_ALLOWED_AUDIENCES = ["cz.test.na-pivo"]
    logged: list[str] = []

    def record_warning(message: str, *args) -> None:
        logged.append(message % args)

    def raise_value_error(*args, **kwargs):
        raise ValueError("secret-token user@example.com")

    monkeypatch.setattr(oauth.google_id_token, "verify_oauth2_token", raise_value_error)
    monkeypatch.setattr(oauth.logger, "warning", record_warning)

    with pytest.raises(oauth.OAuthError):
        oauth.verify_google_id_token("bad-token")

    text = "\n".join(logged)
    assert "ValueError" in text
    assert "secret-token" not in text
    assert "user@example.com" not in text


def test_apple_verify_failure_log_omits_exception_message(settings, monkeypatch):
    settings.APPLE_ALLOWED_AUDIENCES = ["cz.test.na-pivo"]
    logged: list[str] = []

    def record_warning(message: str, *args) -> None:
        logged.append(message % args)

    def raise_jwt_error(*args, **kwargs):
        raise oauth.jwt.InvalidTokenError("secret-token user@example.com")

    monkeypatch.setattr(oauth._apple_jwk_client, "get_signing_key_from_jwt", raise_jwt_error)
    monkeypatch.setattr(oauth.logger, "warning", record_warning)

    with pytest.raises(oauth.OAuthError):
        oauth.verify_apple_identity_token("bad-token")

    text = "\n".join(logged)
    assert "InvalidTokenError" in text
    assert "secret-token" not in text
    assert "user@example.com" not in text


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

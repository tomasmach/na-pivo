"""Hard purge × Linear feedback issues.

When an account is hard-purged, every FeedbackReport the account authored is
deleted with it. A report already synced to Linear has a remote issue
(``linear_issue_id``); the purge must delete that issue through Linear's
official GraphQL API *before* the local rows are committed, and any failure
must roll the whole purge back so no feedback outlives its author's consent.

Network is never touched: ``requests.post`` as seen from ``pubs.accounts`` is
monkeypatched everywhere in this module.
"""

from __future__ import annotations

import uuid
from unittest import mock

import pytest
import requests as requests_lib

import pubs.emailer as emailer
from pubs import accounts, oauth
from pubs.models import Account, AuthIdentity, EmailCredential, FeedbackReport

LINEAR_KEY = "lin_api_test_key"


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def sent_emails(monkeypatch):
    """Capture account lifecycle emails so tests can assert none was sent."""
    sent: list[dict] = []

    def make_recorder(tag: str):
        def recorder(to, **kwargs):
            sent.append({"tag": tag, "to": to, **kwargs})
            return True

        return recorder

    monkeypatch.setattr(
        emailer, "send_account_deletion_scheduled_email", make_recorder("deletion_scheduled")
    )
    monkeypatch.setattr(emailer, "send_account_deleted_email", make_recorder("deleted"))
    return sent


@pytest.fixture
def linear_enabled(settings):
    settings.LINEAR_API_KEY = LINEAR_KEY
    settings.LINEAR_TEAM_ID = "team-123"
    return settings


def _account_with_feedback(*, linear_issue_id: str = "") -> tuple[Account, FeedbackReport]:
    """A claimed (email) account with one feedback report, optionally synced."""
    account = Account.objects.create(device_id=f"purge-linear-{uuid.uuid4().hex[:10]}")
    EmailCredential.objects.create(
        account=account,
        email=f"{uuid.uuid4()}@example.test",
        password="unused-test-hash",
        email_verified=True,
    )
    report = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.BUG,
        message="Crash on launch",
        contact_type=FeedbackReport.ContactType.INSTAGRAM,
        contact="pivni_kompas",
        linear_issue_id=linear_issue_id,
    )
    return account, report


def _graphql_response(payload) -> mock.Mock:
    resp = mock.Mock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = payload
    return resp


def _assert_purge_rolled_back(account: Account, report: FeedbackReport, sent_emails) -> None:
    assert Account.objects.filter(pk=account.pk).exists()
    report.refresh_from_db()
    assert report.linear_issue_id  # stored identifier survived untouched
    assert not any(message["tag"] == "deleted" for message in sent_emails)


# ---------------------------------------------------------------------------
# Contract 1: unsynced report → no Linear request, purge completes
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_unsynced_feedback_purges_without_linear_request(linear_enabled, sent_emails):
    account, report = _account_with_feedback(linear_issue_id="")

    with mock.patch("pubs.accounts.requests.post") as mocked_post:
        accounts.hard_delete(account)

    mocked_post.assert_not_called()
    assert not Account.objects.filter(pk=account.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report.pk).exists()


# ---------------------------------------------------------------------------
# Contract 2: synced report → official issueDelete, then purge commits
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_synced_feedback_deletes_linear_issue_then_purges(linear_enabled, sent_emails):
    account, report = _account_with_feedback(linear_issue_id="ABC-123")

    with mock.patch(
        "pubs.accounts.requests.post",
        return_value=_graphql_response({"data": {"issueDelete": {"success": True}}}),
    ) as mocked_post:
        accounts.hard_delete(account)

    mocked_post.assert_called_once()
    args, kwargs = mocked_post.call_args
    body = kwargs["json"]
    headers = kwargs["headers"]

    assert "issueDelete" in body["query"]
    assert body["variables"]["id"] == "ABC-123"
    assert body["variables"]["permanentlyDelete"] is True
    assert headers["Authorization"] == LINEAR_KEY
    assert headers["Content-Type"] == "application/json"
    # Bounded timeout: the call must never hang a purge worker indefinitely.
    assert isinstance(kwargs.get("timeout"), (int, float)) and kwargs["timeout"] > 0

    assert not Account.objects.filter(pk=account.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report.pk).exists()


# ---------------------------------------------------------------------------
# Contract 3: any other Linear failure raises + rolls the whole purge back
# ---------------------------------------------------------------------------


_FAILURE_CASES = [
    "missing_api_key",
    "requests_exception",
    "http_non_2xx",
    "graphql_error_other_code",
    "graphql_error_message_only",
    "malformed_json",
    "success_false",
]


def _apply_failure_case(case: str, monkeypatch, linear_enabled) -> None:
    if case == "missing_api_key":
        linear_enabled.LINEAR_API_KEY = ""
        return

    def raise_requests_error(*args, **kwargs):
        raise requests_lib.ConnectionError("linear unreachable")

    def raise_http_error(*args, **kwargs):
        resp = mock.Mock()
        resp.status_code = 500
        resp.raise_for_status.side_effect = requests_lib.HTTPError("500 Server Error")
        return resp

    if case == "requests_exception":
        monkeypatch.setattr("pubs.accounts.requests.post", raise_requests_error)
    elif case == "http_non_2xx":
        monkeypatch.setattr("pubs.accounts.requests.post", raise_http_error)
    elif case == "graphql_error_other_code":
        monkeypatch.setattr(
            "pubs.accounts.requests.post",
            mock.Mock(
                return_value=_graphql_response(
                    {
                        "data": {"issueDelete": None},
                        "errors": [
                            {"message": "invalid input", "extensions": {"code": "INPUT_ERROR"}}
                        ],
                    }
                )
            ),
        )
    elif case == "graphql_error_message_only":
        # Message text matching must NOT be treated as idempotent success;
        # only the exact extension code counts.
        monkeypatch.setattr(
            "pubs.accounts.requests.post",
            mock.Mock(
                return_value=_graphql_response(
                    {
                        "data": {"issueDelete": None},
                        "errors": [
                            {"message": "Entity not found", "extensions": {"code": "INPUT_ERROR"}}
                        ],
                    }
                )
            ),
        )
    elif case == "malformed_json":
        broken = mock.Mock()
        broken.raise_for_status.return_value = None
        broken.json.side_effect = ValueError("not json")
        monkeypatch.setattr("pubs.accounts.requests.post", mock.Mock(return_value=broken))
    elif case == "success_false":
        monkeypatch.setattr(
            "pubs.accounts.requests.post",
            mock.Mock(return_value=_graphql_response({"data": {"issueDelete": {"success": False}}})),
        )
    else:  # pragma: no cover - guard against typos in the parameter list
        raise AssertionError(f"unknown failure case {case}")


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("case", _FAILURE_CASES)
def test_linear_failure_rolls_back_whole_hard_purge(
    case, linear_enabled, sent_emails, monkeypatch
):
    _apply_failure_case(case, monkeypatch, linear_enabled)
    account, report = _account_with_feedback(linear_issue_id="ABC-123")

    with pytest.raises(Exception) as exc_info:
        accounts.hard_delete(account)

    # The failure is a cleanup problem, not user-facing validation.
    assert not isinstance(exc_info.value, accounts.AccountError)
    _assert_purge_rolled_back(account, report, sent_emails)


# ---------------------------------------------------------------------------
# Contract 4: exact ENTITY_NOT_FOUND is idempotent success
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_exact_entity_not_found_is_accepted_and_purge_completes(linear_enabled, sent_emails):
    account, report = _account_with_feedback(linear_issue_id="ABC-123")

    with mock.patch(
        "pubs.accounts.requests.post",
        return_value=_graphql_response(
            {
                "data": {"issueDelete": None},
                "errors": [
                    {
                        "message": "Issue was already deleted.",
                        "extensions": {"code": "ENTITY_NOT_FOUND"},
                    }
                ],
            }
        ),
    ) as mocked_post:
        accounts.hard_delete(account)

    mocked_post.assert_called_once()
    assert not Account.objects.filter(pk=account.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report.pk).exists()


# ---------------------------------------------------------------------------
# Contract 5: Linear cleanup runs before Apple revoke — a Linear failure can
# never happen after Apple has already revoked the token
# ---------------------------------------------------------------------------


def _apple_account_with_feedback(*, linear_issue_id: str) -> tuple[Account, FeedbackReport]:
    """A claimed account with an Apple identity (revocable token) and one synced report."""
    account = Account.objects.create(device_id=f"purge-apple-{uuid.uuid4().hex[:10]}")
    AuthIdentity.objects.create(
        account=account,
        provider=AuthIdentity.Provider.APPLE,
        subject=f"apple-sub-{uuid.uuid4().hex[:10]}",
        apple_refresh_token="apple-refresh-token",
    )
    report = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.BUG,
        message="Crash on launch",
        linear_issue_id=linear_issue_id,
    )
    return account, report


@pytest.mark.django_db(transaction=True)
def test_linear_failure_aborts_before_apple_and_retry_completes_in_order(
    linear_enabled, sent_emails, monkeypatch
):
    """Linear failure must abort the purge before Apple is ever contacted.

    ``oauth.revoke_apple_token`` succeeds (returns nothing) on HTTP 200 and
    raises a generic :class:`oauth.OAuthError` on any non-200; there is no
    "already revoked" success state to lean on, so once Apple revokes there is
    no undo. Attempt 1 therefore proves Linear failure happens FIRST and Apple
    was never called. Attempt 2 runs Linear then Apple, both succeeding.
    """
    account, report = _apple_account_with_feedback(linear_issue_id="ABC-123")
    identity = AuthIdentity.objects.get(account=account)

    # --- attempt 1: Linear network fails → rollback, Apple never called ---
    def apple_must_not_run(*args, **kwargs):
        raise AssertionError("Apple revoke must not run after a Linear failure")

    monkeypatch.setattr(oauth, "revoke_apple_token", apple_must_not_run)
    with mock.patch(
        "pubs.accounts.requests.post",
        side_effect=requests_lib.ConnectionError("linear unreachable"),
    ):
        with pytest.raises(accounts.ExternalFeedbackCleanupError):
            accounts.hard_delete(account)

    assert Account.objects.filter(pk=account.pk).exists()
    report.refresh_from_db()
    identity.refresh_from_db()
    assert report.linear_issue_id == "ABC-123"
    # The locally stored refresh token survived untouched: on retry Apple is
    # asked to revoke exactly the same still-valid token.
    assert identity.apple_refresh_token == "apple-refresh-token"
    assert not any(message["tag"] == "deleted" for message in sent_emails)

    # --- attempt 2: Linear succeeds, then Apple succeeds, in that order ---
    order: list[str] = []

    def linear_post(*args, **kwargs):
        order.append("linear")
        return _graphql_response({"data": {"issueDelete": {"success": True}}})

    def revoke_apple(*args, **kwargs):
        order.append("apple")

    monkeypatch.setattr(oauth, "revoke_apple_token", revoke_apple)
    monkeypatch.setattr("pubs.accounts.requests.post", linear_post)

    accounts.hard_delete(account)

    assert order == ["linear", "apple"]
    assert not Account.objects.filter(pk=account.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report.pk).exists()


# ---------------------------------------------------------------------------
# Contract 6: two issues, partial remote deletion stays idempotent on retry
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_partial_linear_deletion_rolls_back_and_retry_never_duplicates(
    linear_enabled, sent_emails, django_capture_on_commit_callbacks
):
    """First issue deleted remotely, second transiently failing rolls back.

    On retry the first delete returns exact ENTITY_NOT_FOUND (idempotent),
    the second deletes, and the confirmation email fires exactly once.
    """
    account, report_first = _account_with_feedback(linear_issue_id="ABC-1")
    report_second = FeedbackReport.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        category=FeedbackReport.Category.IDEA,
        message="Please add dark mode",
        linear_issue_id="ABC-2",
    )

    def flaky_post(*args, **kwargs):
        issue_id = kwargs["json"]["variables"]["id"]
        if issue_id == "ABC-1":
            return _graphql_response({"data": {"issueDelete": {"success": True}}})
        raise requests_lib.ConnectionError("linear transient")

    with mock.patch("pubs.accounts.requests.post", side_effect=flaky_post):
        with pytest.raises(accounts.ExternalFeedbackCleanupError):
            accounts.hard_delete(account)

    assert Account.objects.filter(pk=account.pk).exists()
    report_first.refresh_from_db()
    report_second.refresh_from_db()
    assert report_first.linear_issue_id == "ABC-1"
    assert report_second.linear_issue_id == "ABC-2"
    assert not any(message["tag"] == "deleted" for message in sent_emails)

    def retry_post(*args, **kwargs):
        issue_id = kwargs["json"]["variables"]["id"]
        if issue_id == "ABC-1":
            return _graphql_response(
                {
                    "data": {"issueDelete": None},
                    "errors": [
                        {
                            "message": "Issue was already deleted.",
                            "extensions": {"code": "ENTITY_NOT_FOUND"},
                        }
                    ],
                }
            )
        return _graphql_response({"data": {"issueDelete": {"success": True}}})

    with mock.patch("pubs.accounts.requests.post", side_effect=retry_post) as mocked_post:
        with django_capture_on_commit_callbacks(execute=True):
            accounts.hard_delete(account)

    deleted_ids = [
        call.kwargs["json"]["variables"]["id"] for call in mocked_post.call_args_list
    ]
    assert sorted(deleted_ids) == ["ABC-1", "ABC-2"]
    assert not Account.objects.filter(pk=account.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report_first.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report_second.pk).exists()
    assert sum(1 for message in sent_emails if message["tag"] == "deleted") == 1


# ---------------------------------------------------------------------------
# Contract 7: local failure AFTER both remote cleanups stays retryable
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_local_failure_after_remote_cleanups_rolls_back_and_retry_completes(
    linear_enabled, sent_emails, monkeypatch, django_capture_on_commit_callbacks
):
    """A crash between remote cleanup and commit must leave a clean retry path.

    Attempt 1: Linear deletes and Apple revokes successfully, then a purely
    local step fails — the transaction rolls back, restoring the report and
    the Apple refresh token. Attempt 2 retries against idempotent providers:
    Linear answers exact ENTITY_NOT_FOUND for the already-deleted issue and
    Apple's revoke succeeds again (modelled as an idempotent 200). The purge
    completes and the confirmation email fires exactly once.
    """
    account, report = _apple_account_with_feedback(linear_issue_id="ABC-123")
    EmailCredential.objects.create(
        account=account,
        email=f"{uuid.uuid4()}@example.test",
        password="unused-test-hash",
        email_verified=True,
    )
    original_lifecycle_resolver = accounts._resolve_shared_lifecycles_before_delete

    # --- attempt 1: both remote cleanups succeed, then a local step fails ---
    apple_calls: list[int] = []

    def revoke_apple(*args, **kwargs):
        apple_calls.append(1)

    def broken_local_step(*args, **kwargs):
        raise RuntimeError("local purge step exploded")

    monkeypatch.setattr(oauth, "revoke_apple_token", revoke_apple)
    monkeypatch.setattr(
        "pubs.accounts.requests.post",
        mock.Mock(return_value=_graphql_response({"data": {"issueDelete": {"success": True}}})),
    )
    monkeypatch.setattr(accounts, "_resolve_shared_lifecycles_before_delete", broken_local_step)

    with pytest.raises(RuntimeError):
        accounts.hard_delete(account)

    assert len(apple_calls) == 1  # Apple ran exactly once before the local failure
    assert Account.objects.filter(pk=account.pk).exists()
    report.refresh_from_db()
    assert report.linear_issue_id == "ABC-123"
    identity = AuthIdentity.objects.get(account=account)
    assert identity.apple_refresh_token == "apple-refresh-token"  # rollback restored it
    assert not any(message["tag"] == "deleted" for message in sent_emails)

    # --- attempt 2: idempotent remote answers, local steps healthy ---
    def retry_post(*args, **kwargs):
        return _graphql_response(
            {
                "data": {"issueDelete": None},
                "errors": [
                    {
                        "message": "Issue was already deleted.",
                        "extensions": {"code": "ENTITY_NOT_FOUND"},
                    }
                ],
            }
        )

    monkeypatch.setattr(oauth, "revoke_apple_token", lambda *args, **kwargs: None)
    monkeypatch.setattr("pubs.accounts.requests.post", retry_post)
    monkeypatch.setattr(
        accounts, "_resolve_shared_lifecycles_before_delete", original_lifecycle_resolver
    )

    with django_capture_on_commit_callbacks(execute=True):
        accounts.hard_delete(account)

    assert not Account.objects.filter(pk=account.pk).exists()
    assert not FeedbackReport.objects.filter(pk=report.pk).exists()
    assert sum(1 for message in sent_emails if message["tag"] == "deleted") == 1

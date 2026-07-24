"""
pubs.management.commands.sync_feedback_linear — push unsynced FeedbackReport rows
to Linear as issues.

Reads LINEAR_API_KEY and LINEAR_TEAM_ID from settings (sourced from env). If either
is empty the command prints a short notice and exits 0 (no-op), so the worker loop
can call it unconditionally even when Linear is not configured.

For each FeedbackReport with an empty linear_issue_id (oldest first, up to --limit),
it sends a GraphQL `issueCreate` mutation and, on success, stores the resulting
issue identifier (e.g. "ABC-123"), its URL and the sync timestamp. Failures are
logged and skipped without crashing the loop.

Usage
-----
  python manage.py sync_feedback_linear
  python manage.py sync_feedback_linear --limit 20
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from pubs.models import FeedbackReport

logger = logging.getLogger(__name__)

LINEAR_API_URL = "https://api.linear.app/graphql"
REQUEST_TIMEOUT_SEC = 15

_ISSUE_CREATE_MUTATION = """
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
    }
  }
}
"""


def _build_title(report: FeedbackReport) -> str:
    snippet = " ".join((report.message or "").split())[:70]
    return f"[na pivo] {report.category}: {snippet}"


def _format_contact(report: FeedbackReport) -> str:
    if not report.contact:
        return "—"
    if report.contact_type == FeedbackReport.ContactType.INSTAGRAM:
        return f"instagram @{report.contact}"
    if report.contact_type == FeedbackReport.ContactType.EMAIL:
        return f"email {report.contact}"
    return report.contact


def _format_account(report: FeedbackReport) -> list[str]:
    """Describe the authenticated reporter without trusting client input."""
    account = report.account
    if account is None:
        return ["- Účet: —"]

    is_claimed = account.is_claimed
    lines = [
        f"- Účet: {'přihlášený' if is_claimed else 'anonymní zařízení'}",
        f"- Veřejné ID účtu: {account.public_id}",
        f"- Interní ID účtu: {account.pk}",
    ]
    if not is_claimed:
        return lines

    lines.extend(
        [
            f"- Přezdívka: {f'@{account.nickname}' if account.nickname else '—'}",
            f"- Jméno: {account.display_name or '—'}",
            f"- E-mail účtu: {account.primary_email or '—'}",
        ]
    )
    return lines


def _build_description(report: FeedbackReport) -> str:
    lines = [
        report.message or "",
        "",
        *(
            [f"![Příloha z aplikace]({report.attachment_url})", ""]
            if report.attachment_url
            else []
        ),
        "---",
        f"- app_version: {report.app_version or '—'}",
        f"- platform: {report.platform or '—'}",
        f"- os_version: {report.os_version or '—'}",
        f"- Kontakt: {_format_contact(report)}",
        f"- created_at: {report.created_at.isoformat()}",
        *_format_account(report),
    ]
    return "\n".join(lines)


class Command(BaseCommand):
    help = (
        "Create Linear issues for FeedbackReport rows that have not been synced "
        "yet. No-op when LINEAR_API_KEY or LINEAR_TEAM_ID are unset."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--limit",
            type=int,
            default=20,
            help="Maximum number of feedback rows to sync in this run.",
        )

    def handle(self, *args, **options) -> None:
        limit: int = options["limit"]

        api_key: str = getattr(settings, "LINEAR_API_KEY", "") or ""
        team_id: str = getattr(settings, "LINEAR_TEAM_ID", "") or ""

        if not api_key or not team_id:
            self.stdout.write(
                "sync_feedback_linear: LINEAR_API_KEY / LINEAR_TEAM_ID not set — skipping."
            )
            return

        qs = (
            FeedbackReport.objects.filter(linear_issue_id="")
            .order_by("created_at")[:limit]
        )

        headers = {
            "Authorization": api_key,
            "Content-Type": "application/json",
        }

        synced = 0
        for report in qs:
            variables = {
                "input": {
                    "teamId": team_id,
                    "title": _build_title(report),
                    "description": _build_description(report),
                }
            }
            try:
                resp = requests.post(
                    LINEAR_API_URL,
                    json={"query": _ISSUE_CREATE_MUTATION, "variables": variables},
                    headers=headers,
                    timeout=REQUEST_TIMEOUT_SEC,
                )
                resp.raise_for_status()
                payload = resp.json()
                issue_create = (payload.get("data") or {}).get("issueCreate") or {}
                issue = issue_create.get("issue") or {}
                if not issue_create.get("success") or not issue.get("identifier"):
                    raise ValueError(f"issueCreate failed: {payload}")
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "sync_feedback_linear: failed to sync feedback %s: %s",
                    report.pk,
                    exc,
                    exc_info=True,
                )
                continue

            report.linear_issue_id = issue["identifier"]
            report.linear_issue_url = issue.get("url", "") or ""
            report.linear_synced_at = timezone.now()
            report.save(
                update_fields=[
                    "linear_issue_id",
                    "linear_issue_url",
                    "linear_synced_at",
                    "updated_at",
                ]
            )
            synced += 1
            self.stdout.write(f"  synced feedback {report.pk} → {report.linear_issue_id}")

        self.stdout.write(self.style.SUCCESS(f"Done. Synced {synced} feedback report(s)."))

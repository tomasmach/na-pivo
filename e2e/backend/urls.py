"""Control API exists only under the guarded local settings module."""

import importlib
import json
import re
from pathlib import Path

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.http import JsonResponse
from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from pubs.models import Account, AuthToken, DrinkLog, EmailCredential, PubVisit

from .account_requests import export_requests
from .account_requests import requests as account_requests


@csrf_exempt
@require_POST
def reset(request):
    scenario = json.loads(request.body or b"{}").get("scenario", "base")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", scenario):
        return JsonResponse({"error": "invalid scenario"}, status=400)
    module = importlib.import_module(f"e2e.seeds.{scenario}")
    call_command("flush", interactive=False, verbosity=0)
    cache.clear()
    account_requests.clear()
    export_requests.clear()
    if hasattr(mail, "outbox"):
        mail.outbox.clear()
    module.seed()
    (Path(settings.RUN_DIR) / "scenario.txt").write_text(scenario)
    return JsonResponse({"ready": True, "scenario": scenario})


@require_GET
def state(request):
    accounts = []
    for account in Account.objects.order_by("pk"):
        credential = EmailCredential.objects.filter(account=account).first()
        accounts.append(
            {
                "publicId": str(account.public_id),
                "nickname": account.nickname,
                "displayName": account.display_name,
                "status": account.status,
                "registered": credential is not None,
                "verified": bool(credential and credential.email_verified),
                "ghostMode": account.ghost_mode,
                "shareDrinks": account.share_drinks_with_parta,
                "shareSpend": account.share_spend_with_parta,
                "drinks": list(
                    DrinkLog.objects.filter(account=account).values(
                        "beer_name", "price_czk", "volume_ml", "place_context", "drink_type"
                    )
                ),
                "visits": PubVisit.objects.filter(account=account).count(),
                "activeTokens": AuthToken.objects.filter(account=account).count(),
            }
        )
    # Area-owned seed modules may project their own fixture rows. No app response
    # is mocked; these are read-only DB observations after the native UI writes.
    scenario_file = Path(settings.RUN_DIR) / "scenario.txt"
    scenario_name = scenario_file.read_text() if scenario_file.exists() else "base"
    active_scenario = importlib.import_module(f"e2e.seeds.{scenario_name}")
    observation = getattr(active_scenario, "observe", dict)()
    return JsonResponse(
        {
            "accounts": accounts,
            "mailCount": len(getattr(mail, "outbox", [])),
            "accountWrites": list(account_requests),
            "exportRequests": list(export_requests),
            "scenario": observation,
        }
    )


@require_GET
def mailbox(request):
    # The harness consumes the real rendered message in memory; never log it.
    messages = getattr(mail, "outbox", [])
    purpose = request.GET.get("purpose")
    if purpose in ("verify", "reset"):
        fragment = "/auth/verify-email" if purpose == "verify" else "/auth/reset"
        messages = [message for message in messages if fragment in message.body]
    elif purpose == "export":
        messages = [message for message in messages if message.attachments]
    if not messages:
        return JsonResponse({"pending": True}, status=404)
    return JsonResponse({"text": messages[-1].body, "attachments": len(messages[-1].attachments)})


urlpatterns = [
    path("__e2e__/reset", reset),
    path("__e2e__/state", state),
    path("__e2e__/mail", mailbox),
    path("", include("config.urls")),
]

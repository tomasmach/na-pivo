"""Public profile page ``/u/<nickname>``: what a shared new-look "Kámoš" link opens.

Only a public, active account with a nickname has a page. It shows the same
public numbers as the in-app public profile (``derive_account_public_stats``
with ``is_friend=False``): beers and pubs from *public* published nights and
the Mapér level. Never the diary, presence, friends or the display name.
Pages are ``noindex``, so a profile does not become searchable on the web.
"""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.utils.translation import gettext

from pubs.api.profile_helpers import derive_account_public_stats
from pubs.home_views import app_store_url, play_store_url
from pubs.i18n import current_locale
from pubs.models import Account


def public_profile_account(nickname: str) -> Account | None:
    if not nickname:
        return None
    return Account.objects.filter(
        nickname__iexact=nickname,
        status=Account.Status.ACTIVE,
        is_public=True,
    ).first()


def public_profile_page(request: HttpRequest, nickname: str) -> HttpResponse:
    account = public_profile_account(nickname[:20])
    context = {"LANGUAGE_CODE": current_locale()}
    if account is None:
        response = render(
            request,
            "pubs/public_profile.html",
            {**context, "missing": True, "page_title": gettext("Profil nenalezen | Na pivo")},
            status=404,
        )
    else:
        stats = derive_account_public_stats(account, is_friend=False)
        response = render(
            request,
            "pubs/public_profile.html",
            {
                **context,
                "nickname": account.nickname,
                "initial": (account.nickname or "?")[:1].upper(),
                "stats": stats,
                "page_title": gettext("@%(nick)s na Na pivo") % {"nick": account.nickname},
                "canonical_url": f"{settings.PUBLIC_WEB_ORIGIN}/u/{account.nickname}",
                "app_store_url": app_store_url("profile"),
                "play_store_url": play_store_url("profile"),
            },
        )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response

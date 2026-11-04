"""Public profile page ``/u/<nickname>``: what a shared new-look "Kámoš" link opens.

Only a public, active account with a nickname has a page. It shows the same
public numbers as the in-app public profile (``derive_account_public_stats``
with ``is_friend=False``): beers and pubs from *public* published nights and
the Mapér level. Never the diary, presence, friends or the display name.
Pages are ``noindex``, so a profile does not become searchable on the web.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from django.utils.translation import gettext

from pubs.api.profile_helpers import derive_account_public_stats
from pubs.home_views import app_store_url, play_store_url
from pubs.models import Account
from pubs.web.pages import render_page, web_page


def public_profile_account(nickname: str) -> Account | None:
    if not nickname:
        return None
    return Account.objects.filter(
        nickname__iexact=nickname,
        status=Account.Status.ACTIVE,
        is_public=True,
    ).first()


@web_page
def public_profile_page(request: HttpRequest, nickname: str) -> HttpResponse:
    account = public_profile_account(nickname[:20])
    if account is None:
        response = render_page(
            request, "web/reskin/profile.html", {"missing": True},
            title=gettext("Profil nenalezen"), status=404, indexable=False,
        )
    else:
        response = render_page(
            request,
            "web/reskin/profile.html",
            {
                "nickname": account.nickname,
                "stats": derive_account_public_stats(account, is_friend=False),
                "app_store_url": app_store_url("profile"),
                "play_store_url": play_store_url("profile"),
            },
            title=f"@{account.nickname}",
            indexable=False,
        )
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response

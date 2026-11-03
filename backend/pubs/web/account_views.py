"""Signed-in web pages: beers, my pubs, the crew, the taproom and settings.

Every page reads its data through the same ``/v1/`` view the app calls (``_api``
runs it inside this request, signed in by the web session), and every write is
a ``/v1/`` call from ``account.js``. The web therefore has no rules of its own:
visibility, blocking, limits and the account lock stay in the API.
"""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlencode

from django.conf import settings
from django.db import transaction
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, QueryDict
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import get_language, gettext
from django.views.decorators.http import require_POST

from pubs import accounts
from pubs.api import piva_views, vycep_views
from pubs.api import views as api
from pubs.api.auth_views import _disable_account_push_devices
from pubs.web.auth_views import _over_limit
from pubs.web.pages import render_page, signed_in_page, web_page
from pubs.web.routes import web_reverse
from pubs.web.session import end_session

TAGS = ("crisp", "great_foam", "smooth", "watery", "stale", "overpriced", "one_more", "never_again")
STYLES = ("pale", "amber", "dark", "craft")
VISIBILITIES = ("private", "friends", "public")
# Fields of a check-in the app sends back when it rewrites one (``beerCheckInWire``).
_CHECKIN_WIRE = (
    "client_id", "beer_name", "brewery_name", "beer_style", "abv", "quantity", "price_czk",
    "rating", "tags", "note", "pub_cache_key", "pub_name", "pub_city", "visit_client_id",
    "visibility", "checked_in_at", "ended_at",
)


def _api(request: HttpRequest, view, query: dict | None = None, **kwargs) -> dict | list | None:
    """Body of a ``/v1/`` GET answered for this browser session, or None on any error."""

    query_string = urlencode({key: value for key, value in (query or {}).items() if value not in (None, "")})
    sub = HttpRequest()
    sub.method = "GET"
    sub.path = sub.path_info = request.path
    sub.META = {**request.META, "QUERY_STRING": query_string}
    sub.META.pop("HTTP_AUTHORIZATION", None)
    sub.GET = QueryDict(query_string)
    sub.COOKIES = request.COOKIES
    sub.session = request.session
    response = view.as_view()(sub, **kwargs)
    return response.data if response.status_code == 200 else None


def _labels() -> dict:
    return {
        "tags": {
            "crisp": gettext("Má říz"),
            "great_foam": gettext("Pěna jak smetana"),
            "smooth": gettext("Jde samo"),
            "watery": gettext("Vodový"),
            "stale": gettext("Zvětralý"),
            "overpriced": gettext("Předražený"),
            "one_more": gettext("Ještě jedno"),
            "never_again": gettext("Už nikdy"),
        },
        "verdicts": ["", gettext("Nic moc"), gettext("Ujde"), gettext("Dobrý"), gettext("Moc dobrý"), gettext("Pecka")],
        "visibility": {
            "private": gettext("Uvidíš jen ty"),
            "friends": gettext("Uvidí tvoje parta"),
            "public": gettext("Uvidí všichni u piva"),
        },
        "styles": {
            "pale": gettext("Světlá"),
            "amber": gettext("Polotmavá"),
            "dark": gettext("Tmavá"),
            "craft": gettext("Craft"),
        },
    }


def _plural(n: int, one: str, few: str, many: str, **values) -> str:
    """Czech has three plural forms and the .po file only two; pick by hand.

    ``one``, ``few`` and ``many`` are already translated and may contain ``%(n)s``.
    """

    if get_language() == "en":
        form = one if n == 1 else many
    else:
        form = one if n == 1 else few if 2 <= n <= 4 else many
    return form % {"n": n, **values} if "%(" in form else form


def _when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    return parse_datetime(value) if isinstance(value, str) else None


def _ago(value) -> str:
    """"dnes", "včera", "před 3 dny", "minulý týden" or the date, like the app."""

    moment = _when(value)
    if moment is None:
        return ""
    local = timezone.localtime(moment)
    days = (timezone.localdate() - local.date()).days
    if days <= 0:
        return gettext("dnes")
    if days == 1:
        return gettext("včera")
    if days < 7:
        return _plural(days, gettext("před %(n)s dnem"), gettext("před %(n)s dny"), gettext("před %(n)s dny"))
    if days < 14:
        return gettext("minulý týden")
    return f"{local.day}. {local.month}."


def _render(request: HttpRequest, template: str, context: dict, *, title: str, section: str = "") -> HttpResponse:
    js_text = {
        "offline": gettext("Jsi bez internetu. Zkus to znovu, až chytíš signál."),
        "tooMany": gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."),
        "failed": gettext("Nepovedlo se to. Zkus to prosím znovu."),
        "copied": gettext("Zkopírováno"),
        "verdicts": _labels()["verdicts"],
        "fillAll": gettext("Vyplň název, město i adresu."),
        "lookupDown": gettext("Adresu teď nedokážu dohledat. Zkus to za chvíli, vyplněné údaje ti tu nechám."),
        "notFound": gettext("Tuhle adresu jsem nenašel. Zkontroluj ulici s číslem a město."),
    }
    return render_page(
        request,
        template,
        {"js_text": js_text, "ugc_version": settings.UGC_POLICY_VERSION, **context},
        title=title,
        section=section,
        indexable=False,
    )


def _bar(shares: list) -> list[dict]:
    """Star shares (5 stars first) as segments of a 200 wide bar."""

    parts, x = [], 0.0
    for share in shares or []:
        width = round(float(share or 0) * 192, 1)
        if width > 0:
            # Strings, so the template never localizes them into "12,5".
            parts.append({"x": f"{x:.1f}", "w": f"{max(width, 2):.1f}"})
        x = round(x + width + 2, 1)
    return parts


def _person(profile: dict | None) -> str:
    profile = profile or {}
    return profile.get("display_name") or (f"@{profile['nickname']}" if profile.get("nickname") else gettext("Pivař"))


# ---------------------------------------------------------------------------
# Piva
# ---------------------------------------------------------------------------


def _rating_entry(name: str, brewery: str, history: list[dict]) -> dict:
    """What the rating dialog starts from, the same way ``saveBeerRating`` in the app does.

    Rating again rewrites my newest check-in of the beer (same ``client_id``), so
    the diary keeps one row; the stars, tags, note and visibility start from my
    newest rated one, and a first rating is private.
    """

    rated = next((row for row in history if row.get("rating") is not None), None)
    return {
        "name": name,
        "brewery": brewery,
        "base": {key: history[0].get(key) for key in _CHECKIN_WIRE} if history else None,
        "rating": round(float(rated["rating"])) if rated else 0,
        "tags": [tag for tag in (rated or {}).get("tags") or [] if tag in TAGS],
        "note": (rated or {}).get("note") or "",
        "visibility": (rated or {}).get("visibility") or "private",
    }


def _my_beers(checkins: list[dict], unrated: list[dict]) -> list[dict]:
    """My beers newest first: rated or checked in, then the ones I drank but never rated."""

    by_beer: dict[str, list[dict]] = {}
    for row in checkins:
        key = row.get("beer_product_key") or row.get("beer_name", "").strip().lower()
        if key:
            by_beer.setdefault(key, []).append(row)
    items = []
    for key, rows in by_beer.items():
        entry = _rating_entry(rows[0]["beer_name"], rows[0].get("brewery_name") or "", rows)
        items.append({
            "id": f"mine-{len(items)}",
            "key": key,
            "product_key": rows[0].get("beer_product_key"),
            "name": rows[0]["beer_name"],
            "meta": " · ".join(part for part in (rows[0].get("pub_name"), _ago(rows[0].get("checked_in_at"))) if part),
            "stars": entry["rating"],
            "entry": entry,
        })
    for row in unrated:
        if row["product_key"] in by_beer:
            continue
        items.append({
            "id": f"mine-{len(items)}",
            "key": row["product_key"],
            "product_key": row["product_key"],
            "name": row["name"],
            "meta": gettext("Vypil jsi ho %(n)s×") % {"n": row["count"]},
            "stars": 0,
            "entry": _rating_entry(row["name"], row.get("brand_name") or "", []),
        })
    return items


@signed_in_page
def beers(request: HttpRequest) -> HttpResponse:
    labels = _labels()
    style = request.GET.get("styl", "")
    style = style if style in STYLES else ""
    query = request.GET.get("q", "").strip()[:80]

    ranking = _api(request, piva_views.BeerRankingView, {"style": style, "limit": 10}) or {}
    search = _api(request, piva_views.BeerSearchView, {"q": query}) if query else None
    listed = (search or {}).get("items") if search is not None else ranking.get("items") or []
    selected_key = request.GET.get("pivo", "").strip()[:120] or (listed[0]["product_key"] if listed else "")

    detail = photos = None
    if selected_key:
        detail = _api(request, api.BeerDetailView, {"product": selected_key})
        if detail and detail.get("product_key"):
            photos = _api(request, vycep_views.BeerPhotosView, {"beer": selected_key})
        elif detail is not None:
            detail = None

    checkins = (_api(request, api.BeerCheckInView) or {}).get("checkins") or []
    collection = _api(request, piva_views.BeerCollectionView) or {}
    mine = _my_beers(checkins, collection.get("unrated") or [])

    entries = {item["id"]: item["entry"] for item in mine}
    if detail:
        entries["selected"] = _rating_entry(detail["beer_name"], detail.get("brewery_name") or "", detail.get("my_history") or [])

    def _url(**changes) -> str:
        params = {"q": query, "styl": style, "pivo": selected_key, **changes}
        clean = {key: value for key, value in params.items() if value}
        return web_reverse("web-beers") + (f"?{urlencode(clean)}" if clean else "")

    style_chips = [{"label": gettext("Všechna"), "url": _url(styl="", pivo=""), "current": not style}] + [
        {"label": labels["styles"][code], "url": _url(styl=code, pivo=""), "current": style == code} for code in STYLES
    ]
    for item in listed:
        item["url"] = _url(pivo=item["product_key"])
        item["current"] = item["product_key"] == selected_key
        item["bar"] = _bar(item.get("stars"))
        item["kind"] = " · ".join(
            part for part in (item.get("brand_name"), labels["styles"].get((item.get("styles") or [""])[0], "").lower()) if part
        )
    for item in mine:
        item["url"] = _url(pivo=item["product_key"]) if item["product_key"] else ""

    selected = None
    if detail:
        party = detail.get("party_drinkers") or []
        selected = {
            **detail,
            "kind": " · ".join(
                part for part in (detail.get("brand_name") or detail.get("brewery_name"),
                                  ", ".join(labels["styles"][code].lower() for code in detail.get("styles") or [] if code in labels["styles"]))
                if part
            ),
            "my_rating": entries["selected"]["rating"],
            "global_stars": round(detail["global_rating"]) if detail.get("global_rating") is not None else 0,
            "count_label": _plural(detail.get("global_rating_count") or 0, gettext("%(n)s hodnocení"), gettext("%(n)s hodnocení"), gettext("%(n)s hodnocení")),
            "pouring_label": _plural(detail.get("pubs_pouring") or 0, gettext("Čepuje ho %(n)s hospoda"), gettext("Čepujou ho %(n)s hospody"), gettext("Čepuje ho %(n)s hospod")),
            "party_names": ", ".join(_person(profile) for profile in party[:3]),
            "party_more": max(0, len(party) - 3),
            "photos": (photos or {}).get("photos", [])[:4],
            "photo_total": (photos or {}).get("total", 0),
        }

    return _render(
        request,
        "web/account/beers.html",
        {
            "query": query,
            "search": search,
            "listed": listed,
            "early": ranking.get("early"),
            "style_chips": style_chips,
            "selected": selected,
            "mine": mine[:12],
            "mine_total": len(mine),
            "rating_entries": entries,
            "labels": labels,
            "stars": range(1, 6),
        },
        title=gettext("Piva"),
        section="beers",
    )


# ---------------------------------------------------------------------------
# Moje hospody
# ---------------------------------------------------------------------------


def _pub_url(cache_key: str, name: str) -> str:
    return f"/h/{cache_key}?{urlencode({'n': name})}" if cache_key else ""


@signed_in_page
def my_pubs(request: HttpRequest) -> HttpResponse:
    visits = (_api(request, api.PubVisitView) or {}).get("visits") or []
    favorites = (_api(request, api.PubFavoriteView) or {}).get("favorites") or []
    added = _api(request, api.UserAddedPubView) or []

    pubs: dict[str, dict] = {}

    def _pub(key: str, name: str, city: str) -> dict:
        return pubs.setdefault(key, {"key": key, "name": name, "city": city, "visits": 0, "last": None,
                                     "favorite": False, "added": None})

    for visit in visits:
        if not visit.get("cache_key"):
            continue
        pub = _pub(visit["cache_key"], visit.get("name") or "", visit.get("city") or "")
        pub["visits"] += 1
        started = _when(visit.get("started_at"))
        if started and (pub["last"] is None or started > pub["last"]):
            pub["last"] = started
    for favorite in favorites:
        if favorite.get("cache_key"):
            _pub(favorite["cache_key"], favorite.get("name") or "", favorite.get("city") or "")["favorite"] = True
    for row in added:
        pub = _pub(row.get("cache_key") or f"added-{row['client_id']}", row.get("name") or "", row.get("city") or "")
        pub["added"] = row

    items = sorted(pubs.values(), key=lambda pub: (pub["visits"], pub["last"] or datetime.min.replace(tzinfo=UTC)), reverse=True)
    for pub in items:
        parts = []
        if pub["visits"]:
            parts.append(gettext("Byl jsi tu %(n)s×") % {"n": pub["visits"]})
        if pub["last"]:
            parts.append(gettext("naposledy %(when)s") % {"when": _ago(pub["last"])})
        pub["meta"] = " · ".join(parts)
        pub["address"] = ", ".join(part for part in ((pub["added"] or {}).get("address"), pub["city"]) if part)
        pub["status"] = gettext("Přidal jsi ji ty") if pub["added"] else ""
        pub["url"] = f"{web_reverse('web-my-pubs')}?{urlencode({'hospoda': pub['key']})}"
        pub["public_url"] = _pub_url(pub["key"] if not pub["key"].startswith("added-") else "", pub["name"])

    picked = request.GET.get("hospoda", "")
    selected = next((pub for pub in items if pub["key"] == picked), items[0] if items else None)
    return _render(
        request,
        "web/account/my_pubs.html",
        {"pubs": items, "selected": selected},
        title=gettext("Moje hospody"),
        section="pubs",
    )


@signed_in_page
def add_pub(request: HttpRequest) -> HttpResponse:
    return _render(
        request,
        "web/account/add_pub.html",
        {},
        title=gettext("Přidat hospodu"),
        section="pubs",
    )


# ---------------------------------------------------------------------------
# Parta
# ---------------------------------------------------------------------------


@signed_in_page
def crew(request: HttpRequest) -> HttpResponse:
    data = _api(request, api.FriendsView) or {}
    stats = data.get("friend_stats") or {}
    out_now = {
        (row.get("account") or {}).get("id"): row.get("name") or ""
        for row in data.get("active_friends") or []
    }
    friends = []
    for profile in data.get("friends") or []:
        stat = stats.get(profile["id"]) or {}
        last = _when(stat.get("last_shared_at"))
        if profile["id"] in out_now:
            meta = " · ".join(part for part in (gettext("Teď venku"), out_now[profile["id"]]) if part)
        elif last:
            recent = (timezone.localdate() - timezone.localtime(last).date()).days < 7
            when = _ago(last)
            meta = (gettext("Naposledy %(when)s · %(pub)s") % {"when": when, "pub": stat["last_pub_name"]}
                    if recent and stat.get("last_pub_name") else gettext("Naposledy %(when)s") % {"when": when})
        else:
            meta = gettext("Zatím jste spolu nebyli")
        count = stat.get("shared_pub_count") or 0
        friends.append({
            **profile,
            "name": _person(profile),
            "meta": meta,
            "out": profile["id"] in out_now,
            "together": _plural(count, gettext("%(n)s večer spolu"), gettext("%(n)s večery spolu"), gettext("%(n)s večerů spolu")) if count else "",
        })

    board = data.get("leaderboard") or []
    for row in board:
        row["name"] = gettext("Ty") if row.get("is_me") else _person(row.get("account"))
        row["unit"] = _plural(row.get("beers_30d") or 0, gettext("pivo"), gettext("piva"), gettext("piv"))
    board.sort(key=lambda row: -(row.get("beers_30d") or 0))
    chase = ""
    my_index = next((i for i, row in enumerate(board) if row.get("is_me")), None)
    if my_index:
        ahead = board[my_index - 1]
        gap = (ahead.get("beers_30d") or 0) - (board[my_index].get("beers_30d") or 0)
        if gap > 0:
            chase = _plural(gap, gettext("Před tebou je %(name)s o %(n)s pivo."), gettext("Před tebou je %(name)s o %(n)s piva."),
                            gettext("Před tebou je %(name)s o %(n)s piv."), name=ahead["name"])

    term = request.GET.get("hledat", "").strip()[:40]
    results = None
    if len(term) >= 2:
        known = {profile["id"] for profile in data.get("friends") or []}
        pending = {row["recipient"]["id"] for row in data.get("outgoing_requests") or []}
        results = [
            {**profile, "name": _person(profile), "friend": profile["id"] in known, "pending": profile["id"] in pending}
            for profile in (_api(request, api.FriendSearchView, {"q": term}) or {}).get("results") or []
        ]
    invite = _api(request, api.FriendInviteView) or {}
    return _render(
        request,
        "web/account/crew.html",
        {
            "incoming": [
                {**row, "name": _person(row["requester"])} for row in data.get("incoming_requests") or []
            ],
            "outgoing": [
                {**row, "name": _person(row["recipient"])} for row in data.get("outgoing_requests") or []
            ],
            "friends": friends,
            "board": board[:8],
            "chase": chase,
            "term": term,
            "results": results,
            "invite_url": invite.get("web_url") or "",
        },
        title=gettext("Parta"),
        section="crew",
    )


# ---------------------------------------------------------------------------
# Výčep
# ---------------------------------------------------------------------------


def _duration(minutes) -> str:
    if not minutes:
        return ""
    hours, rest = divmod(int(minutes), 60)
    if not hours:
        return gettext("%(m)s min") % {"m": rest}
    return gettext("%(h)s h %(m)s min") % {"h": hours, "m": rest} if rest else gettext("%(h)s h") % {"h": hours}


@signed_in_page
def taproom(request: HttpRequest) -> HttpResponse:
    scope = "friends" if request.GET.get("kde") == "parta" else "global"
    cursor = request.GET.get("dalsi", "")[:200]
    feed = _api(request, api.PublishedNightFeedView, {"scope": scope, "cursor": cursor, "limit": 10}) or {}
    summary = _api(request, vycep_views.NightsSummaryView, {"scope": scope, "days": 7})
    live = _api(request, api.FriendsView) or {}

    nights = []
    for night in feed.get("nights") or []:
        started = _when(night.get("started_at"))
        local = timezone.localtime(started) if started else None
        when = f"{_ago(started)} {local:%H:%M}" if local else ""
        nights.append({
            **night,
            "author_name": f"@{night['author']['nickname']}" if night["author"].get("nickname") else _person(night["author"]),
            "meta": " · ".join(part for part in (night.get("city"), when) if part),
            "route": " → ".join(night.get("pub_names") or []),
            "duration": _duration(night.get("duration_minutes")),
            "photo": (night.get("hero_photos") or [None])[0],
            "beers_label": _plural(night.get("beer_count") or 0, gettext("%(n)s pivo"), gettext("%(n)s piva"), gettext("%(n)s piv")),
        })
    out = [
        {"name": _person(row.get("account")), "pub": row.get("name") or ""}
        for row in live.get("active_friends") or []
    ]
    base = web_reverse("web-taproom")
    return _render(
        request,
        "web/account/taproom.html",
        {
            "scope": scope,
            "nights": nights,
            "summary": summary,
            "out": out,
            "segment": [
                {"label": gettext("Svět"), "url": base, "current": scope == "global"},
                {"label": gettext("Parta"), "url": f"{base}?kde=parta", "current": scope == "friends"},
            ],
            "next_url": (
                f"{base}?{urlencode({**({'kde': 'parta'} if scope == 'friends' else {}), 'dalsi': feed['next_cursor']})}"
                if feed.get("next_cursor") else ""
            ),
        },
        title=gettext("Výčep"),
        section="taproom",
    )


# ---------------------------------------------------------------------------
# Nastavení
# ---------------------------------------------------------------------------


@signed_in_page
def settings_page(request: HttpRequest) -> HttpResponse:
    me = _api(request, api.AccountMeView) or {}
    social = _api(request, api.FriendSettingsView) or {}
    providers = me.get("providers") or []
    names = {"email": gettext("E-mail a heslo"), "google": "Google", "apple": "Apple"}
    stats = me.get("stats") or {}
    return _render(
        request,
        "web/account/settings.html",
        {
            "me": me,
            "providers": [{"code": code, "name": names.get(code, code)} for code in providers],
            "provider_names": ", ".join(names.get(code, code) for code in providers),
            "can_unlink": len(providers) > 1,
            "share_drinks": social.get("share_drinks_with_parta", True),
            "autopublish": me.get("night_autopublish") or "off",
            "autopublish_options": [
                ("off", gettext("Ručně")),
                ("friends", gettext("Partě")),
                ("public", gettext("Všem")),
            ],
            "diary_line": _plural(stats.get("total_beers") or 0, gettext("Deník: %(n)s zapsané pivo"),
                                  gettext("Deník: %(n)s zapsaná piva"), gettext("Deník: %(n)s zapsaných piv")),
            "grace_days": settings.ACCOUNT_DELETION_GRACE_DAYS,
            "export_url": "/v1/account/export",
            "lang_urls": {
                "cs": web_reverse("web-settings", "cs"),
                "en": web_reverse("web-settings", "en"),
            },
        },
        title=gettext("Nastavení"),
        section="settings",
    )


@require_POST
@signed_in_page
def logout_everywhere(request: HttpRequest) -> HttpResponse:
    """Sign out the web, the app and every other device, like the app's "all" logout."""

    if _over_limit(request, "auth"):
        return HttpResponse(gettext("Moc pokusů za sebou. Dej si chvilku pauzu a zkus to znovu."), status=429)
    account = request.web_account
    with transaction.atomic():
        accounts.revoke_all_tokens(account)
        _disable_account_push_devices(account)
    end_session(request)
    return HttpResponseRedirect(web_reverse("home"))


@web_page
def account_deleted(request: HttpRequest) -> HttpResponse:
    """Where the web lands after deleting the account; the session is already gone."""

    return render_page(
        request,
        "web/account/deleted.html",
        {"grace_days": settings.ACCOUNT_DELETION_GRACE_DAYS},
        title=gettext("Účet mažeme"),
        indexable=False,
    )


def sitemap_paths() -> list[str]:
    """Signed-in pages stay out of the sitemap."""

    return []

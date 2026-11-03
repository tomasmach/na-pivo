"""Guest page of a plan: ``/pozvanka/<token>``, answered without the app or an account.

The guest sees what an invited friend sees: place and time, who goes (first
name or nickname) and the host's note. A home or custom place stays a name only:
the link can travel anywhere, so its address never leaves the invitees.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import prefetch_related_objects
from django.http import (
    HttpRequest,
    HttpResponse,
    HttpResponseNotAllowed,
    HttpResponseRedirect,
)
from django.utils import formats, translation
from django.utils import timezone as dj_timezone
from django.utils.translation import gettext, gettext_lazy, ngettext
from django.views.decorators.csrf import csrf_exempt
from PIL import Image, ImageDraw

from pubs.api.views import (
    PRAGUE_TZ,
    _blocked_account_ids,
    _create_friend_notification,
    _send_friend_push,
)
from pubs.i18n import LocalizedText
from pubs.models import (
    Account,
    FriendActivityResponse,
    FriendNotification,
    FriendPlanGuest,
    FriendPubActivity,
)
from pubs.plan_guests import (
    MAX_GUESTS,
    NAME_MAX,
    activity_for_token,
    clean_guest_name,
    device_hash,
    short_name,
)
from pubs.price_map import _FOAM, _FOAM_MUTED, _GROUND, _HAIR, _MUTED, _fitted, _font
from pubs.web.limits import over_limit
from pubs.web.pages import render_page, web_page
from pubs.web.pub_map import live_map, pub_map
from pubs.web.routes import web_reverse

COOKIE = "np_guest"
COOKIE_MAX_AGE = 60 * 24 * 3600
EVENING = timedelta(hours=3)
_YELLOW = (255, 196, 0)
GOING = FriendActivityResponse.Response.GOING
MAYBE = FriendActivityResponse.Response.MAYBE
CANT = FriendActivityResponse.Response.CANT
_RESPONSES = {GOING, MAYBE, CANT}


def _load(token: str) -> FriendPubActivity | None:
    activity = activity_for_token(token)
    if activity is not None:
        prefetch_related_objects([activity], "responses__account", "guests")
    return activity


def _state(activity: FriendPubActivity | None, now: datetime) -> str:
    if activity is None:
        return "missing"
    owner = activity.account
    if not activity.active or owner.status != Account.Status.ACTIVE or owner.ghost_mode:
        return "cancelled" if activity.expires_at > now else "ended"
    return "open" if activity.expires_at > now else "ended"


def _join(names: list[str]) -> str:
    if len(names) < 2:
        return "".join(names)
    return gettext("%(first)s a %(last)s") % {"first": ", ".join(names[:-1]), "last": names[-1]}


def _when(activity: FriendPubActivity, now: datetime) -> dict:
    start = activity.scheduled_for or activity.started_at
    local = dj_timezone.localtime(start, PRAGUE_TZ)
    days = (local.date() - dj_timezone.localtime(now, PRAGUE_TZ).date()).days
    if days <= 0:
        label = gettext("Dnes")
    elif days == 1:
        label = gettext("Zítra")
    else:
        label = formats.date_format(local, "l").capitalize()
    started = start <= now
    return {
        "day": local.day,
        "label": label,
        "time": gettext("od %(time)s") % {"time": f"{local:%H:%M}"} if started else f"{local:%H:%M}",
        "weekday": formats.date_format(local, "l").capitalize(),
        "date": formats.date_format(local, "j. n. Y"),
        "clock": f"{local:%H:%M}",
        "start": start,
    }


def _place(activity: FriendPubActivity, host: str) -> dict:
    if activity.place_kind in ("home", "custom"):
        hint = (
            gettext("Adresu ti dá %(name)s.") if activity.place_kind == "home"
            else gettext("Přesné místo ti dá %(name)s.")
        )
        return {"name": activity.name, "meta": hint % {"name": host}, "nav_url": "", "city": ""}
    return {
        "name": activity.name,
        "meta": activity.city,
        "city": activity.city,
        "nav_url": f"https://www.google.com/maps/dir/?api=1&destination={activity.lat:.6f},{activity.lng:.6f}",
        "map": pub_map([{"lat": activity.lat, "lng": activity.lng, "label": "", "url": ""}], focus=True, size=(608, 360)),
        "live_map": live_map([{"lat": activity.lat, "lng": activity.lng, "name": activity.name}], kind="focus"),
    }


def _people(activity: FriendPubActivity, mine: FriendPlanGuest | None) -> dict:
    """Who goes, as an invited friend sees it: names of who goes, only a count of maybes."""

    host = activity.account
    blocked = _blocked_account_ids(host)
    going = [{"name": short_name(host), "note": gettext("zve"), "status": gettext("jde"), "host": True}]
    maybe = 0
    for response in activity.responses.all():
        person = response.account
        if person.status != Account.Status.ACTIVE or person.ghost_mode or person.id in blocked:
            continue
        if response.response == GOING:
            going.append({"name": short_name(person), "note": "", "status": gettext("jde")})
        elif response.response == MAYBE:
            maybe += 1
    for guest in activity.guests.all():
        if mine is not None and guest.pk == mine.pk:
            continue
        if guest.response == GOING:
            going.append({"name": guest.name, "note": gettext("přes odkaz"), "status": gettext("jde")})
        elif guest.response == MAYBE:
            maybe += 1

    names = [row["name"] for row in going]
    shown = names[:3] if len(names) > 4 else names
    if len(names) > len(shown):
        shown = [*shown, gettext("%(count)s další") % {"count": len(names) - len(shown)}]
    rows = list(going)
    me_going = mine is not None and mine.response == GOING
    if mine is not None:
        status = {GOING: gettext("jde"), MAYBE: gettext("možná"), CANT: gettext("nejde")}[mine.response]
        rows.insert(0, {"name": mine.name, "note": gettext("ty"), "status": status, "you": True})
        maybe += mine.response == MAYBE
    if me_going:
        summary = gettext("Jdeš %(people)s") % {"people": _join([gettext("ty"), *shown])}
    else:
        summary = ngettext("%(people)s jde", "%(people)s jdou", len(names)) % {"people": _join(shown)}
    total = len(going) + me_going
    counts = ngettext("%(count)s jde", "%(count)s jdou", total) % {"count": total}
    if maybe:
        summary += ", " + ngettext("%(count)s možná", "%(count)s možná", maybe) % {"count": maybe}
        counts += " · " + ngettext("%(count)s možná", "%(count)s možná", maybe) % {"count": maybe}
    initials = ([rows[0]] if me_going else []) + going
    return {"rows": rows, "summary": summary, "counts": counts, "going": total, "initials": initials[:4]}


def _notify_host(activity: FriendPubActivity, name: str) -> None:
    title = LocalizedText(gettext_lazy("Host %(name)s už jde za tebou"), {"name": name})
    body = activity.name[:240]
    _create_friend_notification(
        recipient=activity.account,
        actor=None,
        kind=FriendNotification.Kind.FRIEND_RSVP,
        title=title,
        body=body,
        activity=activity,
        pub_cache_key=activity.cache_key,
        pub_name=activity.name[:200],
    )
    _send_friend_push(
        [activity.account_id],
        title,
        body,
        {"kind": "friend_rsvp", "activity_id": str(activity.public_id), "pub_cache_key": activity.cache_key},
    )


def _answer(request: HttpRequest, activity: FriendPubActivity, device: str) -> tuple[FriendPlanGuest | None, dict]:
    """Save the guest's answer. Returns the row, or field errors to show."""

    response = request.POST.get("response", "")
    if response not in _RESPONSES:
        return None, {"response": gettext("Vyber, jestli jdeš.")}
    try:
        name = clean_guest_name(request.POST.get("name", ""))
    except ValueError as exc:
        return None, {"name": str(exc)}
    if over_limit(request, "plan_guest") or over_limit(request, "plan_guest_plan", key=f"plan:{activity.pk}"):
        return None, {"form": gettext("Moc odpovědí za sebou. Zkus to za chvilku.")}

    with transaction.atomic():
        locked = FriendPubActivity.objects.select_for_update().get(pk=activity.pk)
        guest = FriendPlanGuest.objects.filter(activity=locked, device_hash=device).first()
        previous = guest.response if guest is not None else None
        if guest is None:
            if FriendPlanGuest.objects.filter(activity=locked).count() >= MAX_GUESTS:
                return None, {"form": gettext("Přes odkaz se už přihlásilo dost lidí. Napiš přímo tomu, kdo tě zve.")}
            try:
                with transaction.atomic():
                    guest = FriendPlanGuest.objects.create(
                        activity=locked, device_hash=device, name=name, response=response
                    )
            except IntegrityError:
                guest = FriendPlanGuest.objects.get(activity=locked, device_hash=device)
                previous = guest.response
        if guest.name != name or guest.response != response:
            guest.name, guest.response = name, response
            guest.save(update_fields=["name", "response", "updated_at"])
    if response == GOING and previous != GOING and not activity.account.ghost_mode:
        _notify_host(activity, name)
    return guest, {}


def _closed_page(request: HttpRequest, state: str) -> HttpResponse:
    texts = {
        "missing": (gettext("Takovou pozvánku neznám"), gettext("Odkaz je neplatný nebo ho někdo špatně zkopíroval. Řekni si o nový.")),
        "cancelled": (gettext("Tenhle plán se zrušil"), gettext("Kdo tě zval, plán odvolal. Třeba se domluvíte na jindy.")),
        "ended": (gettext("Tenhle večer už skončil"), gettext("Na pozvánku už odpovědět nejde. Příště se ozvi dřív.")),
    }
    title, text = texts[state]
    response = render_page(
        request,
        "web/invite/closed.html",
        {"empty_title": title, "empty_text": text},
        title=title,
        status=404 if state == "missing" else 410,
        indexable=False,
    )
    return _private(response)


def _private(response: HttpResponse) -> HttpResponse:
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "private, no-store"
    return response


# No-referrer makes the browser post with "Origin: null", which Django's CSRF check
# rejects. The form needs no CSRF token: the guest cookie is SameSite=Lax, so a
# cross-site post only creates a guest the attacker could have created anyway.
@csrf_exempt
@web_page
def plan_invite(request: HttpRequest, token: str) -> HttpResponse:
    if request.method not in ("GET", "POST"):
        return HttpResponseNotAllowed(["GET", "POST"])
    if over_limit(request, "plan_invite"):
        response = HttpResponse(gettext("Moc požadavků. Zkus to za chvilku."), status=429, content_type="text/plain; charset=utf-8")
        return _private(response)
    now = dj_timezone.now()
    activity = _load(token)
    state = _state(activity, now)
    if state != "open":
        return _closed_page(request, state)

    cookie = request.COOKIES.get(COOKIE, "")
    fresh_cookie = "" if 16 <= len(cookie) <= 64 else secrets.token_urlsafe(24)
    device = device_hash(fresh_cookie or cookie)
    mine = next((guest for guest in activity.guests.all() if guest.device_hash == device), None)
    errors: dict[str, str] = {}
    values = {"name": mine.name if mine else ""}

    if request.method == "POST":
        guest, errors = _answer(request, activity, device)
        if guest is not None:
            response = HttpResponseRedirect(request.path)
            response.status_code = 303
            return _with_cookie(_private(response), request, fresh_cookie)
        values["name"] = request.POST.get("name", "")[:NAME_MAX * 2]

    host = short_name(activity.account)
    lang = request.web_lang
    context = {
        "host": host,
        "when": _when(activity, now),
        "place": _place(activity, host),
        "message": activity.message,
        "people": _people(activity, mine),
        "mine": mine,
        "editing": mine is None or request.GET.get("zmenit") == "1" or bool(errors),
        "errors": errors,
        "values": values,
        "name_max": NAME_MAX,
        "calendar_url": web_reverse("web-plan-invite-calendar", token=token),
        "og_image_url": f"{settings.PUBLIC_WEB_ORIGIN}{web_reverse('web-plan-invite-og', lang, token=token)}",
        "og_url": f"{settings.PUBLIC_WEB_ORIGIN}{request.path}",
    }
    title = gettext("%(name)s tě zve na pivo") % {"name": host}
    response = render_page(
        request,
        "web/invite/plan.html",
        context,
        title=title,
        description=gettext("%(place)s. Odpověz bez appky a bez registrace.") % {"place": activity.name},
        status=400 if errors else 200,
        indexable=False,
        with_map=bool(context["place"].get("live_map")),
    )
    return _with_cookie(_private(response), request, fresh_cookie)


def _with_cookie(response: HttpResponse, request: HttpRequest, value: str) -> HttpResponse:
    if value:
        response.set_cookie(
            COOKIE, value, max_age=COOKIE_MAX_AGE, httponly=True, samesite="Lax", secure=request.is_secure()
        )
    return response


def render_invite_og(activity: FriendPubActivity, lang: str, now: datetime) -> bytes:
    """1200 × 630 share image: who invites, where, when and how many already go."""

    image = Image.new("RGB", (1200, 630), _GROUND)
    draw = ImageDraw.Draw(image)
    with translation.override(lang):
        host = short_name(activity.account)
        when = _when(activity, now)
        going = _people(activity, None)["going"]
        draw.text((80, 92), "Na pivo", font=_font("ExtraBold", 40), fill=_FOAM, anchor="ls")
        address = settings.PUBLIC_WEB_ORIGIN.split("://", 1)[-1] + ("/pozvanka" if lang == "cs" else "/en/invite")
        draw.text((1120, 92), address, font=_fitted(draw, address, "SemiBold", 28, 420), fill=_MUTED, anchor="rs")

        invite = gettext("%(name)s tě zve na pivo") % {"name": host}
        draw.text((80, 250), invite, font=_fitted(draw, invite, "SemiBold", 36, 700), fill=_FOAM_MUTED, anchor="ls")
        draw.text((80, 360), activity.name, font=_fitted(draw, activity.name, "ExtraBold", 96, 700), fill=_FOAM, anchor="ls")
        ask = gettext("Jdeš?")
        draw.text((1120, 320), ask, font=_fitted(draw, ask, "ExtraBold", 150, 340), fill=_YELLOW, anchor="rs")
        hint = gettext("odpověz bez appky")
        draw.text((1120, 375), hint, font=_fitted(draw, hint, "SemiBold", 32, 340), fill=_FOAM_MUTED, anchor="rs")

        draw.line((80, 450, 1120, 450), fill=_HAIR, width=2)
        place_note = activity.city if activity.place_kind not in ("home", "custom") else ""
        figures = [
            (when["weekday"], when["date"]),
            (when["clock"], place_note),
            (str(going), ngettext("už jde", "už jdou", going)),
        ]
        x = 80
        for value, label in figures:
            value_font = _fitted(draw, value, "ExtraBold", 56, 300)
            draw.text((x, 530), value, font=value_font, fill=_FOAM, anchor="ls")
            if label:
                draw.text((x, 578), label, font=_fitted(draw, label, "SemiBold", 28, 300), fill=_MUTED, anchor="ls")
            x += max(220, int(draw.textlength(value, font=value_font)) + 80)

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


@web_page
def plan_invite_og(request: HttpRequest, token: str) -> HttpResponse:
    if over_limit(request, "plan_invite"):
        return HttpResponse(status=429)
    now = dj_timezone.now()
    activity = _load(token)
    state = _state(activity, now)
    if state != "open":
        return _closed_page(request, state)
    lang = request.web_lang
    going = _people(activity, None)["going"]
    key = f"plan-invite-og:{activity.pk}:{lang}:{activity.updated_at.timestamp()}:{going}:{now.date()}"
    png = cache.get(key)
    if png is None:
        png = render_invite_og(activity, lang, now)
        cache.set(key, png, 24 * 3600)
    response = HttpResponse(png, content_type="image/png")
    response.headers["Cache-Control"] = "public, max-age=600"
    response.headers["X-Robots-Tag"] = "noindex"
    return response


def _ics_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@web_page
def plan_invite_calendar(request: HttpRequest, token: str) -> HttpResponse:
    """The plan as a calendar event. The place is its name only, never an address."""

    if over_limit(request, "plan_invite"):
        return HttpResponse(status=429)
    now = dj_timezone.now()
    activity = _load(token)
    state = _state(activity, now)
    if state != "open":
        return _closed_page(request, state)
    lang = request.web_lang
    start = activity.scheduled_for or activity.started_at
    location = activity.name if activity.place_kind in ("home", "custom") else ", ".join(
        part for part in (activity.name, activity.city) if part
    )
    link = f"{settings.PUBLIC_WEB_ORIGIN}{web_reverse('web-plan-invite', lang, token=token)}"
    stamp = "%Y%m%dT%H%M%SZ"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Na pivo//Pozvanka//CS",
        "BEGIN:VEVENT",
        f"UID:{(activity.guest_token_hash or '')[:16]}@na-pivo.cz",
        f"DTSTAMP:{now.astimezone(UTC):{stamp}}",
        f"DTSTART:{start.astimezone(UTC):{stamp}}",
        f"DTEND:{(start + EVENING).astimezone(UTC):{stamp}}",
        f"SUMMARY:{_ics_text('Na pivo: ' + activity.name)}",
        f"LOCATION:{_ics_text(location)}",
        f"DESCRIPTION:{_ics_text((activity.message + chr(10) + chr(10) if activity.message else '') + link)}",
        f"URL:{link}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    response = HttpResponse("\r\n".join(lines) + "\r\n", content_type="text/calendar; charset=utf-8")
    response.headers["Content-Disposition"] = 'attachment; filename="na-pivo.ics"'
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex"
    return response

"""Signed-in diary pages: Deník, a night's detail, logging beers and the profile.

The pages only read (``pubs.web.diary``). Logging, fixing and deleting a beer
run in the browser against the same ``/v1/drinks`` and ``/v1/pub-visits`` the
app uses (``diary.js``), so validation, XP, badges and the private-account
locks stay in one place.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.utils import translation
from django.utils.translation import gettext, pgettext

from pubs.api.profile_helpers import derive_account_badge_progress, derive_account_profile_stats
from pubs.models import PubVisit
from pubs.pivar import pivar_progress
from pubs.web import diary as d
from pubs.web.badges import earned_badges
from pubs.web.pages import render_page, signed_in_page
from pubs.web.routes import web_reverse

_RECENT_PUBS = 3
# A year can hold hundreds of nights; the month tiles lead to the rest.
_YEAR_NIGHTS = 15


def _months() -> list[str]:
    return [
        gettext("Leden"), gettext("Únor"), gettext("Březen"), gettext("Duben"), gettext("Květen"),
        gettext("Červen"), gettext("Červenec"), gettext("Srpen"), gettext("Září"), gettext("Říjen"),
        gettext("Listopad"), gettext("Prosinec"),
    ]


def _month_lower(month: int) -> str:
    name = _months()[month - 1]
    return name if translation.get_language() == "en" else name.lower()


def _months_in() -> list[str]:
    return [
        gettext("v lednu"), gettext("v únoru"), gettext("v březnu"), gettext("v dubnu"), gettext("v květnu"),
        gettext("v červnu"), gettext("v červenci"), gettext("v srpnu"), gettext("v září"), gettext("v říjnu"),
        gettext("v listopadu"), gettext("v prosinci"),
    ]


def _months_short() -> list[str]:
    return [
        gettext("led"), gettext("úno"), gettext("bře"), gettext("dub"), gettext("kvě"), gettext("čer"),
        gettext("čec"), gettext("srp"), gettext("zář"), gettext("říj"), gettext("lis"), gettext("pro"),
    ]


def _weekdays_short() -> list[str]:
    return [
        pgettext("weekday", "Po"), pgettext("weekday", "Út"), pgettext("weekday", "St"),
        pgettext("weekday", "Čt"), pgettext("weekday", "Pá"), pgettext("weekday", "So"),
        pgettext("weekday", "Ne"),
    ]


def _weekdays_long() -> list[str]:
    return [
        gettext("Pondělí"), gettext("Úterý"), gettext("Středa"), gettext("Čtvrtek"), gettext("Pátek"),
        gettext("Sobota"), gettext("Neděle"),
    ]


def _bar(value: int, peak: int) -> int:
    """Bar height in steps of 5 %: the page's CSP allows no inline styles."""

    return 5 * round(20 * value / peak) if peak else 0


def _word(n: int, one: str, few: str, many: str) -> str:
    return one if n == 1 else few if 2 <= n <= 4 else many


def _beers_word(n: int) -> str:
    return _word(n, gettext("pivo"), gettext("piva"), gettext("piv"))


def _num(n: int | float, digits: int = 0) -> str:
    text = f"{n:,.{digits}f}"
    if translation.get_language() == "en":
        return text
    return text.replace(",", " ").replace(".", ",")


def _money(czk: int) -> str:
    return f"{_num(czk)} {gettext('Kč')}"


def _clock(at: datetime) -> str:
    return at.astimezone(d.TZ).strftime("%H:%M")


def _span(first: datetime, last: datetime) -> str:
    start, end = _clock(first), _clock(last)
    return start if start == end else gettext("%(from)s až %(to)s") % {"from": start, "to": end}


def _day_label(day: date) -> str:
    """"Pá 30. 10." in Czech, "Fri 30/10" in English, like the app's night rows."""

    weekday = _weekdays_short()[day.weekday()]
    return gettext("%(weekday)s %(day)s. %(month)s.") % {"weekday": weekday, "day": day.day, "month": day.month}


def _short_date(day: date) -> str:
    return gettext("%(day)s. %(month)s.") % {"day": day.day, "month": day.month}


def _long_date(day: date) -> str:
    return gettext("%(day)s. %(month)s. %(year)s") % {"day": day.day, "month": day.month, "year": day.year}


def _duration(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return gettext("%(h)s h %(m)s m") % {"h": hours, "m": mins}
    if hours:
        return gettext("%(h)s h") % {"h": hours}
    return gettext("%(m)s min") % {"m": mins}


def _place_name(name: str, key: str) -> str:
    if not key.startswith("ctx:"):
        return name
    return {
        "ctx:private": gettext("Doma / na chatě"),
        "ctx:outdoors": gettext("Venku"),
    }.get(key, gettext("Mimo hospodu"))


def _stops_line(night: d.Night) -> str:
    return " → ".join(_place_name(stop.name, stop.key) for stop in night.stops)


def _serving_line(drink: d.Drink) -> str:
    parts = []
    if drink.is_beer:
        serving = {
            "bottle": gettext("lahváč"),
            "can": gettext("plechovka"),
            "plastic_bottle": gettext("PET lahev"),
        }.get(drink.serving_type)
        if serving:
            parts.append(serving)
        elif drink.in_pub or drink.serving_type == "draft":
            parts.append(gettext("čepované"))
    if drink.volume_ml:
        litres = drink.volume_ml / 1000
        parts.append(f"{_num(litres, 1 if drink.volume_ml % 100 == 0 else 2)} l")
    return " · ".join(parts)


def _parse_day(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value or "")
    except ValueError:
        return None


def _initials(people: list[dict]) -> list[str]:
    return [(p["name"] or p["handle"].lstrip("@") or "?")[:1].upper() for p in people[:3]]


def _night_row(night: d.Night, people: list[dict], today: date) -> dict:
    return {
        "label": gettext("Dnes") if night.day == today else _day_label(night.day),
        "meta": _stops_line(night),
        "beers": night.beers,
        "initials": _initials(people),
        "url": web_reverse("web-night", day=night.day.isoformat()),
    }


# ---------------------------------------------------------------------------
# Deník
# ---------------------------------------------------------------------------

_PERIODS = ("tyden", "mesic", "rok")


def _period_bounds(period: str, anchor: date) -> tuple[date, date]:
    if period == "tyden":
        monday = anchor - timedelta(days=anchor.weekday())
        return monday, monday + timedelta(days=6)
    if period == "rok":
        return date(anchor.year, 1, 1), date(anchor.year, 12, 31)
    last = calendar.monthrange(anchor.year, anchor.month)[1]
    return date(anchor.year, anchor.month, 1), date(anchor.year, anchor.month, last)


def _shift(period: str, start: date, step: int) -> date:
    if period == "tyden":
        return start + timedelta(weeks=step)
    if period == "rok":
        return date(start.year + step, 1, 1)
    absolute = start.year * 12 + start.month - 1 + step
    return date(absolute // 12, absolute % 12 + 1, 1)


def _period_names(period: str, start: date, end: date) -> tuple[str, str, str]:
    """(hero label, title of the card, "v září" style name for the comparison)."""

    if period == "tyden":
        title = gettext("%(from)s až %(to)s") % {"from": _short_date(start), "to": _short_date(end)}
        return gettext("za týden"), title, gettext("minulý týden")
    if period == "rok":
        return (
            gettext("v roce %(year)s") % {"year": start.year},
            str(start.year),
            gettext("v roce %(year)s") % {"year": start.year - 1},
        )
    previous = _shift("mesic", start, -1)
    return (
        _months_in()[start.month - 1],
        f"{_months()[start.month - 1]} {start.year}",
        _months_in()[previous.month - 1],
    )


def _comparison(beers: int, previous: int, previous_name: str) -> str:
    if not beers and not previous:
        return ""
    if beers == previous:
        return gettext("stejně jako %(when)s") % {"when": previous_name}
    if beers > previous:
        return gettext("o %(n)s víc než %(when)s") % {"n": beers - previous, "when": previous_name}
    return gettext("o %(n)s míň než %(when)s") % {"n": previous - beers, "when": previous_name}


def _calendar(start: date, nights_by_day: dict[date, d.Night], today: date) -> list[list[dict]]:
    first = start - timedelta(days=start.weekday())
    last_day = date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
    end = last_day + timedelta(days=6 - last_day.weekday())
    weeks, week, day = [], [], first
    while day <= end:
        night = nights_by_day.get(day)
        in_month = day.month == start.month
        cell = {"day": day.day, "in_month": in_month, "today": day == today, "beers": night.beers if night else 0}
        if in_month and night:
            cell["url"] = web_reverse("web-night", day=day.isoformat())
            cell["label"] = gettext("%(day)s, %(beers)s") % {"day": _day_label(day), "beers": f"{night.beers} {_beers_word(night.beers)}"}
        elif in_month and day <= today:
            cell["url"] = f"{web_reverse('web-log-beer')}?den={day.isoformat()}"
            cell["label"] = gettext("Dopsat %(day)s") % {"day": _day_label(day)}
        week.append(cell)
        if len(week) == 7:
            weeks.append(week)
            week = []
        day += timedelta(days=1)
    return weeks


def _records(period: str, nights: list[d.Night], start: date) -> list[dict]:
    if not nights:
        return []
    records = []
    if period == "rok":
        by_month = [0] * 12
        for night in nights:
            by_month[night.day.month - 1] += night.beers
        best = max(range(12), key=lambda i: (by_month[i], -i))
        records.append({
            "value": f"{by_month[best]} {_beers_word(by_month[best])}",
            "label": gettext("nejvíc %(when)s") % {"when": _months_in()[best]},
        })
    else:
        best = max(nights, key=lambda n: (n.beers, n.day))
        records.append({"value": f"{best.beers} {_beers_word(best.beers)}", "label": gettext("nejvíc za večer")})
    pub = d.top_pub(nights)
    if pub:
        records.append({"value": f"{pub[1]}×", "label": pub[0]})
    beers = d.beer_tally([drink for night in nights for drink in night.drinks])
    if beers:
        records.append({"value": f"{beers[0][1]}×", "label": beers[0][0]})
    return records


@signed_in_page
def diary(request: HttpRequest) -> HttpResponse:
    account = request.web_account
    today = d.today()
    period = request.GET.get("obdobi") if request.GET.get("obdobi") in _PERIODS else "mesic"
    anchor = min(_parse_day(request.GET.get("den")) or today, today)
    start, end = _period_bounds(period, anchor)
    prev_start, prev_end = _period_bounds(period, _shift(period, start, -1))

    drinks = d.load_drinks(account, prev_start, end)
    both = d.nights_of(drinks)
    nights = [n for n in both if start <= n.day <= end]
    previous = [n for n in both if prev_start <= n.day <= prev_end]
    has_any = bool(drinks) or account.drinks.exists()
    people = d.companions(account, nights)
    hero_label, card_title, previous_name = _period_names(period, start, end)
    beers = sum(n.beers for n in nights)
    friends_at_table = {p["handle"] or p["name"] for day in people.values() for p in day}

    def period_url(p: str, day: date) -> str:
        return f"{web_reverse('web-diary')}?obdobi={p}&den={day.isoformat()}"

    next_start = _shift(period, start, 1)
    context = {
        "period": period,
        "has_any": has_any,
        "segment": [
            {"label": gettext("Týden"), "url": period_url("tyden", anchor), "current": period == "tyden"},
            {"label": gettext("Měsíc"), "url": period_url("mesic", anchor), "current": period == "mesic"},
            {"label": gettext("Rok"), "url": period_url("rok", anchor), "current": period == "rok"},
        ],
        "headline": {
            "value": _num(beers),
            "label": f"{_beers_word(beers)} {hero_label}",
            "sub": _comparison(beers, sum(n.beers for n in previous), previous_name),
        },
        "stats": [
            s
            for s in (
                {"value": _num(len(nights)), "label": _word(len(nights), gettext("večer"), gettext("večery"), gettext("večerů"))},
                {"value": _num(d.distinct_pubs(nights)), "label": _word(d.distinct_pubs(nights), gettext("hospoda"), gettext("hospody"), gettext("hospod"))},
                {"value": _money(sum(n.spent_czk for n in nights)), "label": gettext("utraceno")} if any(n.priced for n in nights) else None,
                {"value": _num(len(friends_at_table)), "label": gettext("kamarádi u stolu")} if friends_at_table else None,
            )
            if s
        ],
        "card_title": card_title,
        "prev_url": period_url(period, _shift(period, start, -1)),
        "next_url": period_url(period, next_start) if next_start <= today else None,
        "weekdays": _weekdays_short(),
        "records": _records(period, nights, start),
        "nights": [_night_row(n, people.get(n.day, []), today) for n in nights[: _YEAR_NIGHTS if period == "rok" else None]],
        "more_nights": period == "rok" and len(nights) > _YEAR_NIGHTS,
        "nights_title": gettext("Večery %(when)s") % {"when": hero_label},
        "log_url": web_reverse("web-log-beer"),
        "backfill_url": f"{web_reverse('web-log-beer')}?den={today.isoformat()}",
    }
    if period == "mesic":
        context["weeks"] = _calendar(start, {n.day: n for n in nights}, today)
    elif period == "tyden":
        by_day = {n.day: n for n in nights}
        days = [start + timedelta(days=i) for i in range(7)]
        peak = max([by_day[x].beers for x in days if x in by_day] or [1]) or 1
        context["bars"] = [
            {
                "label": _weekdays_short()[i],
                "day": x.day,
                "beers": by_day[x].beers if x in by_day else 0,
                "height": _bar(by_day[x].beers if x in by_day else 0, peak),
                "url": web_reverse("web-night", day=x.isoformat()) if x in by_day else None,
            }
            for i, x in enumerate(days)
        ]
    else:
        tiles = []
        for month in range(1, 13):
            in_month = [n for n in nights if n.day.month == month]
            first = date(start.year, month, 1)
            tiles.append({
                "label": _months()[month - 1],
                "beers": sum(n.beers for n in in_month),
                "nights": len(in_month),
                "future": first > today,
                "current": first.year == today.year and month == today.month,
                "url": period_url("mesic", first),
            })
        context["tiles"] = tiles
    return render_page(request, "web/diary/diary.html", context, title=gettext("Deník"), section="diary", indexable=False)


# ---------------------------------------------------------------------------
# Detail večera
# ---------------------------------------------------------------------------


@signed_in_page
def night(request: HttpRequest, day: str) -> HttpResponse:
    account = request.web_account
    the_day = _parse_day(day)
    found = d.nights_of(d.load_drinks(account, the_day, the_day)) if the_day else []
    if not found:
        return render_page(
            request,
            "web/diary/night_missing.html",
            {"diary_url": web_reverse("web-diary")},
            title=gettext("Tenhle večer v deníku nemám."),
            section="diary",
            status=404,
            indexable=False,
        )
    the_night = found[0]
    people = d.companions(account, [the_night]).get(the_night.day, [])
    tempo = d.hourly_tempo(the_night)
    peak = max((count for _, count in tempo), default=0)
    peak_hour = next((hour for hour, count in tempo if count == peak), None)
    photos = d.night_photos(account, the_night)
    log_url = f"{web_reverse('web-log-beer')}?den={the_night.day.isoformat()}"
    month_url = f"{web_reverse('web-diary')}?obdobi=mesic&den={the_night.day.isoformat()}"
    weekday = _weekdays_long()[the_night.day.weekday()]
    title = gettext("%(weekday)s %(day)s. %(month)s.") % {"weekday": weekday, "day": the_night.day.day, "month": the_night.day.month}
    stops = [
        {
            "name": _place_name(stop.name, stop.key),
            "meta": " · ".join(
                x for x in (
                    _span(stop.first, stop.last),
                    f"{stop.beers} {_beers_word(stop.beers)}" if stop.beers else "",
                ) if x
            ),
        }
        for stop in the_night.stops
    ]
    context = {
        "title": title,
        "crumb": {"label": gettext("Deník · %(month)s") % {"month": _month_lower(the_night.day.month)}, "url": month_url},
        "subtitle": " · ".join(
            x for x in (
                _stops_line(the_night),
                _span(the_night.start, the_night.end),
            ) if x
        ),
        "stats": [
            s
            for s in (
                {"value": _num(the_night.beers), "label": _word(the_night.beers, gettext("pivo"), gettext("piva"), gettext("piv")), "hero": True},
                {"value": _money(the_night.spent_czk), "label": gettext("útrata")} if the_night.priced else None,
                {"value": _duration(the_night.minutes), "label": gettext("u stolu")} if the_night.minutes else None,
                {"value": _num(len(the_night.pub_keys)), "label": _word(len(the_night.pub_keys), gettext("hospoda"), gettext("hospody"), gettext("hospod"))} if the_night.pub_keys else None,
            )
            if s
        ],
        "tempo": [
            {"hour": f"{hour}:00", "count": count, "height": _bar(count, peak), "peak": count == peak and count > 0}
            for hour, count in tempo
        ] if len(tempo) > 1 else [],
        "tempo_peak": gettext("%(beers)s ve %(hour)s:00") % {"beers": f"{peak} {_beers_word(peak)}", "hour": peak_hour} if peak else "",
        "drinks": [
            {
                "client_id": drink.client_id,
                "time": _clock(drink.at),
                "name": drink.name,
                "meta": " · ".join(x for x in (_place_name(drink.place_name, drink.place_key), _serving_line(drink)) if x),
                "price": _money(drink.price_czk) if drink.price_czk is not None else "",
                "price_czk": drink.price_czk,
            }
            for drink in the_night.drinks
        ],
        "poured_meta": " · ".join(
            x for x in (f"{the_night.beers} {_beers_word(the_night.beers)}", _money(the_night.spent_czk) if the_night.priced else "") if x
        ),
        "stops": stops,
        "people": [{**p, "beers_label": f"{p['beers']} {_beers_word(p['beers'])}"} for p in people],
        "data": {
            "texts": {
                "failed": gettext("Nepovedlo se to. Zkus to znovu."),
                "invalid": gettext("Tohle neprojde. Zkontroluj název a cenu."),
                "offline": gettext("Bez internetu to neuložím. Zkus to, až chytíš signál."),
                "signed_out": gettext("Přihlášení vypršelo. Přihlas se znovu a zkus to znovu."),
            },
            # Oldest first, so the visit left after a delete spans exactly what remains.
            "drinks": [{"id": x.client_id, "key": x.place_key, "at": x.at.isoformat()} for x in the_night.drinks],
            "visits": [
                {
                    "client_id": str(v.client_id), "key": v.cache_key, "name": v.name, "lat": v.lat, "lng": v.lng,
                    "city": v.city, "external_id": v.external_id, "closed_at": v.closed_at.isoformat() if v.closed_at else None,
                }
                for v in PubVisit.objects.filter(
                    account=account,
                    started_at__gte=d.day_start(the_night.day),
                    started_at__lt=d.day_start(the_night.day + timedelta(days=1)),
                ).order_by("started_at")
            ],
        },
        "photos": [
            {"url": f"{settings.PUBLIC_API_ORIGIN}{photo.image.url}", "alt": photo.beer_name or photo.caption}
            for photo in photos
            if photo.image
        ],
        "log_url": log_url,
        "diary_url": month_url,
    }
    return render_page(request, "web/diary/night.html", context, title=title, section="diary", indexable=False)


# ---------------------------------------------------------------------------
# Zapsat pivo / Dopsat večer
# ---------------------------------------------------------------------------


def _recent_pubs(account) -> list[dict]:
    pubs, seen = [], set()
    rows = (
        account.drinks.filter(place_context="pub", cache_key__isnull=False, lat__isnull=False)
        .order_by("-drank_at")
        .values_list("cache_key", "name", "lat", "lng", "city", "external_id")[:200]
    )
    for cache_key, name, lat, lng, city, external_id in rows:
        if cache_key in seen or not name:
            continue
        seen.add(cache_key)
        pubs.append({"key": cache_key, "name": name, "lat": lat, "lng": lng, "city": city, "external_id": external_id})
        if len(pubs) >= _RECENT_PUBS:
            break
    return pubs


@signed_in_page
def log_beer(request: HttpRequest) -> HttpResponse:
    account = request.web_account
    today = d.today()
    earliest = today - timedelta(days=settings.DRINK_BACKDATE_FLAG_DAYS)
    chosen = _parse_day(request.GET.get("den"))
    day = chosen if chosen and earliest <= chosen <= today else today
    backfill = "den" in request.GET
    since = d.day_start(earliest)
    visits = [
        {
            "client_id": str(v.client_id),
            "key": v.cache_key,
            "day": d.drinking_day(v.started_at).isoformat(),
            "started_at": v.started_at.isoformat(),
            "ended_at": v.ended_at.isoformat() if v.ended_at else None,
        }
        for v in PubVisit.objects.filter(account=account, started_at__gte=since).order_by("started_at")
    ]
    recent = d.beer_tally(d.load_drinks(account, earliest, today))
    top = recent[0] if recent else None
    data = {
        "today": today.isoformat(),
        "earliest": earliest.isoformat(),
        "pubs": _recent_pubs(account),
        "visits": visits,
        "beer": {"name": top[0], "price": top[2].price_czk} if top else None,
        "diary_url": web_reverse("web-diary"),
        "night_url": web_reverse("web-night", day="0000-00-00"),
        "text": {
            "failed": gettext("Zápis nedošel. Zkus to znovu."),
            "offline": gettext("Bez internetu to neuložím. Zkus to, až chytíš signál."),
            "signed_out": gettext("Přihlášení vypršelo. Přihlas se znovu a zápis zopakuj."),
            "date_error": gettext("Zkontroluj datum a časy. Budoucnost zatím nečepuju."),
            "search_empty": gettext("Nic jsem nenašel. Zkus jiný název."),
            "beers": [gettext("pivo"), gettext("piva"), gettext("piv")],
            "currency": gettext("Kč"),
        },
    }
    title = gettext("Dopsat večer") if backfill else gettext("Zapsat pivo")
    context = {
        "data": data,
        "backfill": backfill,
        "day": day.isoformat(),
        "start": "19:00" if day != today else datetime.now(d.TZ).strftime("%H:%M"),
        "heading": title,
        "back_url": web_reverse("web-diary"),
    }
    return render_page(request, "web/diary/log.html", context, title=title, section="diary", indexable=False)


# ---------------------------------------------------------------------------
# Profil
# ---------------------------------------------------------------------------


def _profile_summary(drinks: list[d.Drink], nights: list[d.Night]) -> dict:
    evenings = {(drink.place_key, d.drinking_day(drink.at)) for drink in drinks}
    beers = sum(1 for drink in drinks if drink.is_beer)
    return {
        "beers": beers,
        "evenings": len(evenings),
        "pubs": d.distinct_pubs(nights),
        "spent": sum(drink.price_czk or 0 for drink in drinks),
        "priced": any(drink.price_czk is not None for drink in drinks),
        "first": drinks[0].at if drinks else None,
    }


def _top_pubs(drinks: list[d.Drink]) -> list[dict]:
    pubs: dict[str, dict] = {}
    for drink in drinks:
        if not drink.in_pub or not drink.place_key or drink.place_key.startswith("ctx:"):
            continue
        pub = pubs.setdefault(drink.place_key, {"beers": 0})
        pub["beers"] += int(drink.is_beer)
        pub["name"] = drink.place_name
        pub["city"] = drink.city or pub.get("city", "")
        pub["last"] = drink.at
    ranked = sorted(pubs.values(), key=lambda p: (p["beers"], p["last"]), reverse=True)[:5]
    return [
        {
            "name": p["name"],
            "meta": " · ".join(x for x in (p["city"], gettext("naposled %(day)s") % {"day": _short_date(d.drinking_day(p["last"]))}) if x),
            "value": _num(p["beers"]),
        }
        for p in ranked
    ]


@signed_in_page
def profile(request: HttpRequest) -> HttpResponse:
    account = request.web_account
    today = d.today()
    scope = "letos" if request.GET.get("obdobi") == "letos" else "celkem"
    year_start = date(today.year, 1, 1)
    all_drinks = d.load_drinks(account)
    drinks = [x for x in all_drinks if d.drinking_day(x.at) >= year_start] if scope == "letos" else all_drinks
    nights = d.nights_of(drinks)
    summary = _profile_summary(drinks, nights)

    year_nights = [n for n in d.nights_of(all_drinks) if n.day.year == today.year] if scope != "letos" else nights
    months = [0] * 12
    for n in year_nights:
        months[n.day.month - 1] += n.beers
    peak = max(months) or 1
    best_month = max(range(12), key=lambda i: (months[i], i))

    weekdays = [0] * 7
    for n in nights:
        weekdays[n.day.weekday()] += 1
    week_peak = max(weekdays) or 1
    busiest = max(range(7), key=lambda i: (weekdays[i], -i))

    people: dict[str, dict] = {}
    for day_people in d.companions(account, nights).values():
        for p in day_people:
            entry = people.setdefault(p["handle"] or p["name"], {**p, "nights": 0})
            entry["nights"] += 1
    companions = sorted(people.values(), key=lambda p: -p["nights"])[:5]

    ratings = d.my_ratings(account)
    beers = [
        {
            "name": name,
            "value": _num(count),
            "meta": (
                gettext("tvoje hodnocení %(rating)s") % {"rating": _num(ratings[name.casefold()], 1)}
                if name.casefold() in ratings else gettext("ještě nehodnoceno")
            ),
        }
        for name, count, _ in d.beer_tally(drinks)[:5]
    ]

    stats = derive_account_profile_stats(account)
    progress = derive_account_badge_progress(stats)
    badges, badge_total = earned_badges(progress)
    xp = pivar_progress(stats["mapper_xp"] + stats["pivar_xp"])
    friends = stats["accepted_friend_count"]
    per_evening = summary["beers"] / summary["evenings"] if summary["evenings"] else 0
    first = summary["first"]

    def scope_url(value: str) -> str:
        return f"{web_reverse('web-profile')}?obdobi={value}"

    month_short = _months_short()
    context = {
        "segment": [
            {"label": gettext("Letos"), "url": scope_url("letos"), "current": scope == "letos"},
            {"label": gettext("Celkově"), "url": scope_url("celkem"), "current": scope == "celkem"},
        ],
        "level": gettext("Level %(level)s · %(title)s") % {"level": xp["level"], "title": xp["title"]},
        "xp": xp,
        "xp_percent": round(100 * xp["xp_into_level"] / xp["xp_for_next_level"]) if xp["xp_for_next_level"] else 100,
        "xp_label": (
            gettext("Do levelu %(level)s") % {"level": xp["level"] + 1}
            if xp["xp_for_next_level"] else gettext("Nejvyšší level")
        ),
        "xp_of": (
            gettext("%(xp)s / %(next)s XP") % {"xp": _num(xp["xp_into_level"]), "next": _num(xp["xp_for_next_level"])}
            if xp["xp_for_next_level"] else ""
        ),
        "headline": {
            "value": _num(summary["beers"]),
            "label": (
                _word(summary["beers"], gettext("pivo letos"), gettext("piva letos"), gettext("piv letos"))
                if scope == "letos"
                else _word(summary["beers"], gettext("pivo za život"), gettext("piva za život"), gettext("piv za život"))
            ),
            "sub": gettext("od %(date)s") % {"date": _long_date(first.astimezone(d.TZ).date())} if first else "",
        },
        "stats": [
            s
            for s in (
                {"value": _num(summary["pubs"]), "label": _word(summary["pubs"], gettext("hospoda"), gettext("hospody"), gettext("hospod"))},
                {"value": _num(summary["evenings"]), "label": _word(summary["evenings"], gettext("večer"), gettext("večery"), gettext("večerů"))},
                {"value": _num(per_evening, 1), "label": gettext("piva na večer")} if summary["evenings"] else None,
                {"value": _money(summary["spent"]), "label": gettext("utraceno")} if summary["priced"] else None,
                {"value": _num(friends), "label": _word(friends, gettext("kamarád"), gettext("kamarádi"), gettext("kamarádů"))},
            )
            if s
        ],
        "months_title": gettext("Piva po měsících · %(year)s") % {"year": today.year},
        "months_peak": (
            gettext("nejvíc %(when)s · %(n)s") % {"when": _months_in()[best_month], "n": months[best_month]}
            if months[best_month] else ""
        ),
        "months": [
            {"label": month_short[i], "beers": months[i], "height": _bar(months[i], peak), "peak": months[i] == peak and months[i] > 0,
             "future": i > today.month - 1}
            for i in range(12)
        ],
        "pubs": _top_pubs(drinks),
        "beers": beers,
        "companions": [
            {**p, "value": f"{p['nights']} {_word(p['nights'], gettext('večer'), gettext('večery'), gettext('večerů'))}"}
            for p in companions
        ],
        "weekdays": [
            {"label": _weekdays_short()[i], "height": _bar(weekdays[i], week_peak), "peak": weekdays[i] == week_peak and weekdays[i] > 0}
            for i in range(7)
        ],
        "busiest": gettext("nejčastěji %(day)s") % {"day": _weekdays_long()[busiest].lower()} if weekdays[busiest] else "",
        "badges": badges[:4],
        "badges_count": gettext("%(earned)s z %(total)s") % {"earned": len(badges), "total": badge_total},
        "has_any": bool(all_drinks),
        "settings_url": web_reverse("web-settings"),
    }
    return render_page(request, "web/diary/profile.html", context, title=gettext("Profil"), section="profile", indexable=False)


def sitemap_paths() -> list[str]:
    """The diary is private; none of its pages belong in the sitemap."""

    return []

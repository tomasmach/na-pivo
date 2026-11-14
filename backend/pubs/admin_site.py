from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from . import admin_queue
from .models import Account, DrinkLog, PublishedNight

SECTIONS = [
    ("Lidé", [
        ("account", "Účty", "person"),
        ("publishednight", "Večery", "nightlife"),
        ("publishednightcomment", "Komentáře", "comment"),
        ("drinklog", "Vypitá piva", "local_drink"),
        ("tourpublication", "Túry", "route"),
    ]),
    ("Hospody", [
        ("canonicalpub", "Hospody", "storefront"),
        ("pubreport", "Nahlášené hospody", "wrong_location"),
        ("pubnamecorrection", "Opravy názvů", "edit_location_alt"),
        ("pubevent", "Akce hospod", "event"),
        ("communityevent", "Komunitní akce", "celebration"),
    ]),
    ("Pivo", [
        ("beerproduct", "Piva", "sports_bar"),
        ("beerbrand", "Pivovary", "factory"),
    ]),
    ("Čísla", [
        ("webstatsdaily", "Web analytika", "bar_chart"),
        ("pubreachdaily", "Dosah hospod", "visibility"),
        ("accountusagestats", "Používání appky", "monitoring"),
    ]),
    ("Obsah appky", [
        ("releasenote", "Co je nového", "campaign"),
    ]),
    ("Technické", [
        ("contentreport", "Historie nahlášení", "flag"),
        ("feedbackreport", "Historie zpětné vazby", "chat"),
        ("pubvisit", "Návštěvy", "pin_drop"),
        ("pubrating", "Hodnocení hospod", "thumb_up"),
        ("pubfavorite", "Oblíbené hospody", "favorite"),
        ("pubcontributionlog", "Příspěvky k hospodám", "volunteer_activism"),
        ("useraddedpub", "Přidané hospody", "add_location"),
        ("pubhours", "Otevírací doby", "schedule"),
        ("pubcommunitydata", "Komunitní data hospod", "groups"),
        ("pubalias", "Další názvy hospod", "alt_route"),
        ("pubmergeaudit", "Sloučení hospod", "merge"),
        ("pubbeerproduct", "Piva v hospodách", "local_bar"),
        ("pubbeerbrand", "Pivovary v hospodách", "liquor"),
        ("pubexternalbeermenu", "Nápojové lístky", "menu_book"),
        ("beerproductmergeaudit", "Sloučení piv", "merge"),
        ("pushdevice", "Push zařízení", "notifications"),
        ("clientevent", "Události z appky", "bug_report"),
        ("enrichtask", "Obohacování hospod", "manage_search"),
        ("pubsearchcache", "Cache hledání", "cached"),
        ("user", "Admini", "admin_panel_settings"),
        ("group", "Skupiny adminů", "group_work"),
    ]),
]


def _changelist(model_name: str) -> str:
    app = "auth" if model_name in ("user", "group") else "pubs"
    return reverse(f"admin:{app}_{model_name}_changelist")


def _can_view(request, model_name: str) -> bool:
    app = "auth" if model_name in ("user", "group") else "pubs"
    user = request.user
    return user.has_perm(f"{app}.view_{model_name}") or user.has_perm(f"{app}.change_{model_name}")


def navigation(request):
    top = [{"title": "Nástěnka", "icon": "dashboard", "link": reverse("admin:index")}]
    if admin_queue.visible_sources(request):
        top.append({"title": "Ke zpracování", "icon": "inbox", "link": reverse("admin_queue"), "badge": "pubs.admin_site.queue_badge"})
    groups = [{"items": top}]
    for title, items in SECTIONS:
        visible = [
            {"title": label, "icon": icon, "link": _changelist(model)}
            for model, label, icon in items
            if _can_view(request, model)
        ]
        if visible:
            groups.append({"title": title, "collapsible": title == "Technické", "items": visible})
    return groups


def queue_badge(request):
    count = admin_queue.waiting_count(request)
    return str(count) if count else ""


def dashboard(request, context):
    week_ago = timezone.now() - timedelta(days=7)
    week = [
        ("account", "Nové účty", Account.objects, "created_at"),
        ("drinklog", "Vypitá piva", DrinkLog.objects, "drank_at"),
        ("publishednight", "Večery", PublishedNight.objects, "created_at"),
    ]
    sources = admin_queue.visible_sources(request)
    total = admin_queue.waiting_count(request)
    context.update({
        "queue": admin_queue.items(request, sources)[:5] if sources else None,
        "queue_count": total,
        "queue_more": max(total - 5, 0),
        "week": [
            (
                label,
                rows.filter(**{f"{field}__gte": week_ago}).count(),
                f"{rows.count()} celkem",
                _changelist(model),
            )
            for model, label, rows, field in week
            if _can_view(request, model)
        ],
    })
    return context

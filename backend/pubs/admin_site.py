from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from .models import (
    Account,
    ContentReport,
    DrinkLog,
    FeedbackReport,
    PublishedNight,
    TourPublication,
)

SECTIONS = [
    ("Moderace", [
        ("contentreport", "Nahlášený obsah", "flag", "pubs.admin_site.new_content_reports"),
        ("feedbackreport", "Zpětná vazba", "chat", "pubs.admin_site.new_feedback"),
        ("tourpublication", "Túry", "route", "pubs.admin_site.reported_tours"),
        ("pubreport", "Nahlášené hospody", "wrong_location", None),
        ("pubnamecorrection", "Opravy názvů", "edit_location_alt", None),
        ("publishednightcomment", "Komentáře", "comment", None),
        ("publishednight", "Večery", "nightlife", None),
    ]),
    ("Čísla", [
        ("webstatsdaily", "Web analytika", "bar_chart", None),
        ("pubreachdaily", "Dosah hospod", "visibility", None),
    ]),
    ("Lidé", [
        ("account", "Účty", "person", None),
        ("pushdevice", "Push zařízení", "notifications", None),
        ("accountusagestats", "Používání appky", "monitoring", None),
    ]),
    ("Hospody", [
        ("canonicalpub", "Hospody", "storefront", None),
        ("useraddedpub", "Přidané hospody", "add_location", None),
        ("pubhours", "Otevírací doby", "schedule", None),
        ("pubcommunitydata", "Komunitní data", "groups", None),
        ("pubevent", "Akce hospod", "event", None),
        ("communityevent", "Komunitní akce", "celebration", None),
        ("pubalias", "Aliasy", "alt_route", None),
        ("pubmergeaudit", "Sloučení hospod", "merge", None),
    ]),
    ("Pivo", [
        ("beerproduct", "Piva", "sports_bar", None),
        ("beerbrand", "Pivovary", "factory", None),
        ("pubbeerproduct", "Piva v hospodách", "local_bar", None),
        ("pubbeerbrand", "Pivovary v hospodách", "liquor", None),
        ("pubexternalbeermenu", "Nápojové lístky", "menu_book", None),
        ("beerproductmergeaudit", "Sloučení piv", "merge", None),
    ]),
    ("Deník", [
        ("drinklog", "Vypitá piva", "local_drink", None),
        ("pubvisit", "Návštěvy", "pin_drop", None),
        ("pubrating", "Hodnocení", "thumb_up", None),
        ("pubfavorite", "Oblíbené", "favorite", None),
        ("pubcontributionlog", "Příspěvky", "volunteer_activism", None),
    ]),
    ("Systém", [
        ("releasenote", "Co je nového", "campaign", None),
        ("clientevent", "Události z appky", "bug_report", None),
        ("enrichtask", "Obohacování", "manage_search", None),
        ("pubsearchcache", "Cache hledání", "cached", None),
        ("user", "Admini", "admin_panel_settings", None),
        ("group", "Skupiny", "group_work", None),
    ]),
]


def _changelist(model_name: str) -> str:
    app = "auth" if model_name in ("user", "group") else "pubs"
    return reverse(f"admin:{app}_{model_name}_changelist")


def navigation(request):  # noqa: ARG001
    groups = [{"items": [{"title": "Nástěnka", "icon": "dashboard", "link": reverse("admin:index")}]}]
    for title, items in SECTIONS:
        groups.append({
            "title": title,
            "collapsible": title in ("Hospody", "Pivo", "Deník", "Systém"),
            "items": [
                {"title": label, "icon": icon, "link": _changelist(model), **({"badge": badge} if badge else {})}
                for model, label, icon, badge in items
            ],
        })
    return groups


def _waiting_content_reports():
    return ContentReport.objects.filter(status=ContentReport.Status.NEW)


def _waiting_feedback():
    return FeedbackReport.objects.filter(status=FeedbackReport.Status.NEW)


def _waiting_tours():
    return TourPublication.objects.filter(status=TourPublication.Status.HIDDEN, hidden_reason="reports")


def _badge(count: int) -> str:
    return str(count) if count else ""


def new_content_reports(request):  # noqa: ARG001
    return _badge(_waiting_content_reports().count())


def new_feedback(request):  # noqa: ARG001
    return _badge(_waiting_feedback().count())


def reported_tours(request):  # noqa: ARG001
    return _badge(_waiting_tours().count())


def dashboard(request, context):  # noqa: ARG001
    week_ago = timezone.now() - timedelta(days=7)
    changelist = _changelist
    context.update({
        "waiting": [
            ("Nahlášený obsah", _waiting_content_reports().count(), changelist("contentreport") + "?status__exact=new"),
            ("Zpětná vazba", _waiting_feedback().count(), changelist("feedbackreport") + "?status__exact=new"),
            ("Túry skryté nahlášením", _waiting_tours().count(), changelist("tourpublication") + "?status__exact=hidden&hidden_reason=reports"),
        ],
        "week": [
            ("Nové účty", Account.objects.filter(created_at__gte=week_ago).count(), f"{Account.objects.count()} celkem"),
            ("Vypitá piva", DrinkLog.objects.filter(drank_at__gte=week_ago).count(), f"{DrinkLog.objects.count()} celkem"),
            ("Večery", PublishedNight.objects.filter(created_at__gte=week_ago).count(), f"{PublishedNight.objects.count()} celkem"),
        ],
        "feedback": _waiting_feedback().order_by("-created_at")[:6],
    })
    return context

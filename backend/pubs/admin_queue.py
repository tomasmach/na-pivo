from dataclasses import dataclass, field
from datetime import datetime

from django.contrib import admin, messages
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import reverse
from django.utils import timezone

from .models import (
    Account,
    AccountUsageStats,
    ContentReport,
    DrinkLog,
    FeedbackReport,
    Friendship,
    PublishedNight,
    PublishedNightComment,
    TourPublication,
)
from .pub_events import PubEvent

WAITING_REPORT = (ContentReport.Status.NEW, ContentReport.Status.TRIAGED)
WAITING_FEEDBACK = (FeedbackReport.Status.NEW, FeedbackReport.Status.TRIAGED)


@dataclass
class Action:
    key: str
    label: str
    style: str = ""
    confirm: str = ""


@dataclass
class Item:
    kind: str
    pk: int | str
    tag: str
    tone: str
    title: str
    when: datetime
    url: str
    lines: list[str] = field(default_factory=list)
    quote: str = ""
    image: str = ""
    links: list[tuple[str, str]] = field(default_factory=list)
    actions: list[Action] = field(default_factory=list)

    @property
    def ref(self) -> str:
        return f"{self.kind}:{self.pk}"


def account_name(account: Account | None) -> str:
    return "smazaný účet" if account is None else str(account)


def account_link(account: Account | None) -> tuple[str, str] | None:
    if account is None:
        return None
    return account_name(account), reverse("admin:pubs_account_change", args=[account.pk])


def waiting_reports():
    return ContentReport.objects.filter(status__in=WAITING_REPORT)


def waiting_feedback():
    return FeedbackReport.objects.filter(status__in=WAITING_FEEDBACK)


def waiting_tours():
    return TourPublication.objects.filter(status=TourPublication.Status.HIDDEN, hidden_reason="reports")


def waiting_events():
    return PubEvent.objects.filter(status=PubEvent.Status.PENDING)


def _settle(report: ContentReport, status: str) -> None:
    report.status = status
    report.actioned_at = timezone.now() if status == ContentReport.Status.ACTIONED else report.actioned_at
    report.save(update_fields=["status", "actioned_at", "updated_at"])


def hide_profile(report: ContentReport) -> bool:
    target = report.target_account
    if target is None:
        return False
    target.is_public = False
    target.save(update_fields=["is_public", "last_seen_at"])
    _settle(report, ContentReport.Status.ACTIONED)
    return True


def clear_avatar(report: ContentReport) -> bool:
    target = report.target_account
    if target is None or not target.avatar:
        return False
    target.avatar.delete(save=False)
    target.avatar = ""
    target.save(update_fields=["avatar", "last_seen_at"])
    _settle(report, ContentReport.Status.ACTIONED)
    return True


def clear_nickname(report: ContentReport) -> bool:
    target = report.target_account
    if target is None:
        return False
    target.nickname = None
    target.save(update_fields=["nickname", "last_seen_at"])
    _settle(report, ContentReport.Status.ACTIONED)
    return True


def remove_comment(report: ContentReport) -> bool:
    PublishedNightComment.objects.filter(
        public_id=report.target_snapshot.get("comment_id"), is_removed=False
    ).update(is_removed=True, updated_at=timezone.now())
    _settle(report, ContentReport.Status.ACTIONED)
    return True


def remove_night(report: ContentReport) -> bool:
    PublishedNight.objects.filter(public_id=report.target_snapshot.get("night_id")).update(
        is_removed=True, updated_at=timezone.now()
    )
    _settle(report, ContentReport.Status.ACTIONED)
    return True


def hide_tour(report: ContentReport) -> bool:
    TourPublication.objects.filter(
        public_id=report.target_snapshot.get("tour_publication_id"), status=TourPublication.Status.ACTIVE
    ).update(status=TourPublication.Status.HIDDEN, hidden_reason="admin")
    _settle(report, ContentReport.Status.ACTIONED)
    return True


def dismiss(report: ContentReport) -> bool:
    _settle(report, ContentReport.Status.DISMISSED)
    return True


def restore_tours(queryset) -> int:
    restored = list(queryset.filter(status=TourPublication.Status.HIDDEN).values_list("public_id", flat=True))
    ContentReport.objects.filter(
        target_snapshot__tour_publication_id__in=[str(public_id) for public_id in restored],
        status__in=WAITING_REPORT,
    ).update(status=ContentReport.Status.DISMISSED)
    return TourPublication.objects.filter(public_id__in=restored).update(
        status=TourPublication.Status.ACTIVE, hidden_reason=""
    )


REPORT_ACTIONS = {
    "dismiss": (dismiss, "Nahlášení zamítnuté, obsah zůstává."),
    "hide_profile": (hide_profile, "Profil je skrytý."),
    "clear_avatar": (clear_avatar, "Profilová fotka je smazaná."),
    "clear_nickname": (clear_nickname, "Přezdívka je smazaná."),
    "remove_comment": (remove_comment, "Komentář je skrytý."),
    "remove_night": (remove_night, "Večer je skrytý."),
    "hide_tour": (hide_tour, "Túra je skrytá."),
}


def _report_item(report: ContentReport) -> Item:
    snap = report.target_snapshot or {}
    author = account_name(report.target_account)
    actions = [Action("dismiss", "Nechat")]
    quote = image = ""
    lines = [f"{report.get_reason_display()} · nahlásil(a): {account_name(report.reporter)}"]
    if report.comment:
        lines.append(f"Poznámka: „{report.comment}“")
    if snap.get("comment_id"):
        title = f"Komentář od {author}"
        quote = (snap.get("comment") or {}).get("body", "")
        actions.append(Action("remove_comment", "Skrýt komentář", "danger"))
    elif snap.get("tour_publication_id"):
        title = f"Túra „{snap.get('title', '')}“ od {author}"
        actions.append(Action("hide_tour", "Skrýt túru", "danger"))
    elif snap.get("photo_id"):
        title = f"Fotka od {author}"
        image = snap.get("photo_url") or ""
        quote = snap.get("photo_caption") or ""
    elif snap.get("checkin_id"):
        checkin = snap.get("checkin") or {}
        title = f"Hodnocení piva {checkin.get('beer_name', '')} od {author}"
        quote = checkin.get("note") or ""
    elif snap.get("night_id"):
        night = snap.get("night") or {}
        title = f"Večer od {author}"
        quote = f"Hospody: {', '.join(night.get('pub_names') or [])}" if night.get("pub_names") else ""
        actions.append(Action("remove_night", "Skrýt večer", "danger"))
    else:
        title = f"Profil {author}"
        if snap.get("nickname"):
            quote = f"Přezdívka v době nahlášení: {snap['nickname']}"
    if report.reason == ContentReport.Reason.INAPPROPRIATE_NICKNAME:
        actions.append(Action("clear_nickname", "Smazat přezdívku", "danger", f"Smazat přezdívku {author}? Vrátit to nejde."))
    if report.reason == ContentReport.Reason.INAPPROPRIATE_AVATAR:
        actions.append(Action("clear_avatar", "Smazat profilovou fotku", "danger", "Smazat profilovou fotku? Vrátit to nejde."))
    actions.append(Action("hide_profile", "Skrýt profil", "danger", f"Skrýt celý profil {author} z veřejných míst?"))
    return Item(
        kind="report",
        pk=report.pk,
        tag="Nahlášeno",
        tone="red",
        title=title,
        when=report.created_at,
        url=reverse("admin:pubs_contentreport_change", args=[report.pk]),
        lines=lines,
        quote=quote,
        image=image,
        links=[link for link in (account_link(report.target_account),) if link],
        actions=actions,
    )


def _feedback_item(feedback: FeedbackReport) -> Item:
    tone = "yellow" if feedback.category == FeedbackReport.Category.BUG else ""
    tags = {"bug": "Chyba", "idea": "Nápad"}
    device = " · ".join(part for part in (feedback.platform, feedback.app_version, feedback.os_version) if part)
    lines = [f"Od: {account_name(feedback.account)}" + (f" · {device}" if device else "")]
    if feedback.contact:
        lines.append(f"Kontakt: {feedback.contact}")
    links = [link for link in (account_link(feedback.account),) if link]
    if feedback.attachment:
        links.append(("Příloha", feedback.attachment.url))
    if feedback.linear_issue_url:
        links.append(("Úkol v Linearu", feedback.linear_issue_url))
    return Item(
        kind="feedback",
        pk=feedback.pk,
        tag=tags.get(feedback.category, "Zpětná vazba"),
        tone=tone,
        title=feedback.message,
        when=feedback.created_at,
        url=reverse("admin:pubs_feedbackreport_change", args=[feedback.pk]),
        lines=lines,
        links=links,
        actions=[Action("resolve", "Vyřízeno", "primary")],
    )


def _tour_item(tour: TourPublication) -> Item:
    owner = tour.plan.owner if tour.plan_id else None
    return Item(
        kind="tour",
        pk=tour.pk,
        tag="Skrytá túra",
        tone="red",
        title=f"Túra „{tour.title}“ od {account_name(owner)}",
        when=tour.updated_at,
        url=reverse("admin:pubs_tourpublication_change", args=[tour.pk]),
        lines=[f"Skrytá po nahlášení · {tour.stop_count} zastávek" + (f" · {tour.city}" if tour.city else "")],
        links=[link for link in (account_link(owner),) if link],
        actions=[Action("keep_hidden", "Nechat skrytou"), Action("restore", "Vrátit túru", "primary")],
    )


def _event_item(event: PubEvent) -> Item:
    when = f"{timezone.localtime(event.starts_at):%-d. %-m. %H:%M} až {timezone.localtime(event.ends_at):%-d. %-m. %H:%M}"
    return Item(
        kind="event",
        pk=event.pk,
        tag="Akce hospody",
        tone="",
        title=f"{event.title} · {event.name}",
        when=event.created_at,
        url=reverse("admin:pubs_pubevent_change", args=[event.pk]),
        lines=[f"{when} · přidal(a): {account_name(event.account)}"],
        quote=event.details,
        links=[link for link in (account_link(event.account),) if link],
        actions=[Action("reject", "Zamítnout"), Action("verify", "Ověřit", "primary")],
    )


SOURCES = {
    "report": ("Nahlášené", "contentreport", lambda: waiting_reports().select_related("reporter", "target_account"), _report_item),
    "feedback": ("Zpětná vazba", "feedbackreport", lambda: waiting_feedback().select_related("account"), _feedback_item),
    "tour": ("Túry", "tourpublication", lambda: waiting_tours().select_related("plan__owner"), _tour_item),
    "event": ("Akce hospod", "pubevent", lambda: waiting_events().select_related("account"), _event_item),
}
LIMIT = 50


def _can(request, model: str, action: str) -> bool:
    return request.user.has_perm(f"pubs.{action}_{model}")


def visible_sources(request) -> dict:
    return {
        kind: source
        for kind, source in SOURCES.items()
        if _can(request, source[1], "view") or _can(request, source[1], "change")
    }


COUNTERS = {"report": waiting_reports, "feedback": waiting_feedback, "tour": waiting_tours, "event": waiting_events}


def waiting_count(request) -> int:
    return sum(COUNTERS[kind]().count() for kind in visible_sources(request))


def items(request, kinds) -> list[Item]:
    result = []
    for kind in kinds:
        _, model, rows, build = SOURCES[kind]
        built = [build(row) for row in rows().order_by("-pk")[:LIMIT]]
        if not _can(request, model, "change"):
            for item in built:
                item.actions = []
        result.extend(built)
    return sorted(result, key=lambda item: item.when, reverse=True)


class NothingToChangeError(Exception):
    pass


def _perform(kind: str, pk: str, action: str) -> str | None:
    if kind == "report":
        report = waiting_reports().select_related("target_account").filter(pk=pk).first()
        if report is None or action not in REPORT_ACTIONS:
            return None
        handler, message = REPORT_ACTIONS[action]
        if not handler(report):
            raise NothingToChangeError("Nebylo co změnit. Účet už neexistuje nebo nemá přezdívku či fotku.")
        return message
    if kind == "feedback" and action == "resolve":
        return "Zpětná vazba je vyřízená." if waiting_feedback().filter(pk=pk).update(status=FeedbackReport.Status.RESOLVED) else None
    if kind == "tour" and action == "restore":
        return "Túra je zase veřejná." if restore_tours(waiting_tours().filter(pk=pk)) else None
    if kind == "tour" and action == "keep_hidden":
        return "Túra zůstává skrytá." if waiting_tours().filter(pk=pk).update(hidden_reason="admin") else None
    if kind == "event" and action == "verify":
        updated = waiting_events().filter(pk=pk).update(status=PubEvent.Status.VERIFIED, verified_at=timezone.now())
        return "Akce je ověřená a v appce se ukáže." if updated else None
    if kind == "event" and action == "reject":
        return "Akce je zamítnutá." if waiting_events().filter(pk=pk).update(status=PubEvent.Status.REJECTED, verified_at=None) else None
    return None


def queue_view(request):
    sources = visible_sources(request)
    show = request.GET.get("typ")
    if show not in sources:
        show = None
    if request.method == "POST":
        kind, _, pk = (request.POST.get("item") or "").partition(":")
        message = None
        if kind in sources and _can(request, sources[kind][1], "change"):
            try:
                message = _perform(kind, pk, request.POST.get("action") or "")
            except NothingToChangeError as problem:
                messages.warning(request, str(problem))
                message = ""
            except (ValueError, ValidationError):
                message = None
        if message:
            messages.success(request, message)
        elif message is None:
            messages.warning(request, "Tohle už někdo vyřídil nebo na to nemáš oprávnění.")
        return redirect(f"{reverse('admin_queue')}?typ={show}" if show else reverse("admin_queue"))

    counts = {kind: COUNTERS[kind]().count() for kind in sources}
    context = {
        **admin.site.each_context(request),
        "title": "Ke zpracování",
        "items": items(request, [show] if show else sources),
        "show": show,
        "filters": [
            {"kind": None, "label": "Vše", "count": sum(counts.values())},
            *({"kind": kind, "label": source[0], "count": counts[kind]} for kind, source in sources.items()),
        ],
        "history": [
            (source[0], reverse(f"admin:pubs_{source[1]}_changelist"))
            for source in sources.values()
        ],
    }
    return TemplateResponse(request, "admin/pubs/queue.html", context)


def account_profile(account: Account) -> dict:
    nights = PublishedNight.objects.filter(account=account)
    feedback = FeedbackReport.objects.filter(account=account).order_by("-created_at")[:10]
    reports = (
        ContentReport.objects.filter(Q(reporter=account) | Q(target_account=account))
        .select_related("reporter", "target_account")
        .order_by("-created_at")[:10]
    )
    usage = AccountUsageStats.objects.filter(account=account).first()
    activity = [
        {
            "tag": "Večer",
            "text": " · ".join(
                part
                for part in (
                    ", ".join(night.pub_names or []) or night.city or "bez hospody",
                    f"{night.beer_count} piv",
                    night.get_visibility_display(),
                    "skrytý" if night.is_removed else "",
                )
                if part
            ),
            "when": night.created_at,
            "url": reverse("admin:pubs_publishednight_change", args=[night.pk]),
        }
        for night in nights.order_by("-created_at")[:8]
    ]
    for item in feedback:
        activity.append({
            "tag": {"bug": "Chyba", "idea": "Nápad"}.get(item.category, "Zpětná vazba"),
            "tone": "yellow" if item.category == FeedbackReport.Category.BUG else "",
            "text": item.message,
            "when": item.created_at,
            "url": reverse("admin:pubs_feedbackreport_change", args=[item.pk]),
        })
    for report in reports:
        reported_self = report.target_account_id == account.pk
        activity.append({
            "tag": "Nahlášen(a)" if reported_self else "Nahlásil(a)",
            "tone": "red" if reported_self else "",
            "text": (
                f"{report.get_reason_display()} · nahlásil(a): {account_name(report.reporter)}"
                if reported_self
                else f"{account_name(report.target_account)} · {report.get_reason_display()}"
            ),
            "when": report.created_at,
            "url": reverse("admin:pubs_contentreport_change", args=[report.pk]),
        })
    activity.sort(key=lambda row: row["when"], reverse=True)
    friends = Friendship.objects.filter(
        Q(requester=account) | Q(recipient=account), status=Friendship.Status.ACCEPTED
    ).count()
    drinks = DrinkLog.objects.filter(account=account)
    beers = drinks.filter(drink_type=DrinkLog.DrinkType.BEER)
    return {
        "name": account_name(account),
        "since": account.created_at,
        "last_seen": account.last_seen_at,
        "device": " · ".join(
            part for part in (usage.last_platform, usage.last_app_version) if part
        ) if usage else "",
        "stats": [
            ("Piv", beers.count(), reverse("admin:pubs_drinklog_changelist") + f"?account__id__exact={account.pk}"),
            ("Večerů", nights.count(), reverse("admin:pubs_publishednight_changelist") + f"?account__id__exact={account.pk}"),
            ("Kamarádů", friends, None),
            ("Hospod", drinks.exclude(cache_key__isnull=True).values("cache_key").distinct().count(), None),
        ],
        "activity": activity[:15],
        "open_reports": ContentReport.objects.filter(target_account=account, status__in=WAITING_REPORT).count(),
    }

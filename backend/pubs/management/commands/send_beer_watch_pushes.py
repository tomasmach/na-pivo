"""
send_beer_watch_pushes — tell watchers that a beer they watch is newly on tap nearby.

Runs in the worker loop. Each pending BeerTapEvent is claimed once, then every
watcher whose ~500 m cell lies within their radius gets one push, at most one
per Prague day (BeerWatchPush's unique key). Nothing is sent in quiet hours;
events wait for the morning, and events older than 12 hours are dropped unsent.
"""

from __future__ import annotations

import math
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import IntegrityError, transaction
from django.utils import timezone, translation
from django.utils.translation import gettext

from pubs.api import views as api_views
from pubs.i18n import normalize_locale
from pubs.identity import resolve_pub_identity
from pubs.models import (
    Account,
    BeerTapEvent,
    BeerWatch,
    BeerWatchPush,
    PubBeerProduct,
    PushDevice,
)

EVENT_MAX_AGE = timedelta(hours=12)
LOCATION_MAX_AGE = timedelta(days=14)
MAX_RADIUS_M = 10_000
METRES_PER_DEGREE_LAT = 111_320


def in_quiet_hours(now) -> bool:
    start, end = settings.BEER_WATCH_QUIET_HOURS
    if start == end:
        return False
    hour = timezone.localtime(now, api_views.PRAGUE_TZ).hour
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def _render(event: BeerTapEvent, distance_km: float, now, locale: str) -> tuple[str, str]:
    hours = int((now - event.observed_at).total_seconds() // 3600)
    with translation.override(locale):
        age = gettext("před chvílí") if hours < 1 else gettext("před %(hours)s h") % {"hours": hours}
        distance = f"{distance_km:.1f}"
        if locale == "cs":
            distance = distance.replace(".", ",")
        title = gettext("Na čepu poblíž")
        body = gettext("%(beer)s je na čepu %(pub)s, %(distance)s km, doplnil někdo z komunity %(age)s") % {
            "beer": event.product.name,
            "pub": event.pub_name,
            "distance": distance,
            "age": age,
        }
    return title, body


def _still_on_tap(event: BeerTapEvent) -> bool:
    identity = resolve_pub_identity(event.cache_key, event.pub_name, lat=event.lat, lng=event.lng)
    return PubBeerProduct.objects.filter(
        cache_key__in={event.cache_key, *identity.cache_keys},
        product_id=event.product_id,
        active=True,
    ).exists()


def _recipients(event: BeerTapEvent, now) -> list[tuple[Account, float]]:
    lat_span = MAX_RADIUS_M / METRES_PER_DEGREE_LAT
    lng_span = lat_span / max(math.cos(math.radians(event.lat)), 0.01)
    watches = (
        BeerWatch.objects.filter(
            product_id=event.product_id,
            account__status=Account.Status.ACTIVE,
            account__beer_watch_located_at__gte=now - LOCATION_MAX_AGE,
            account__beer_watch_lat__range=(event.lat - lat_span, event.lat + lat_span),
            account__beer_watch_lng__range=(event.lng - lng_span, event.lng + lng_span),
        )
        .exclude(account_id=event.contributor_id)
        .select_related("account")
    )
    recipients = []
    for watch in watches:
        account = watch.account
        distance_km = api_views._haversine_km(
            account.beer_watch_lat, account.beer_watch_lng, event.lat, event.lng
        )
        if distance_km * 1000 <= account.beer_watch_radius_m:
            recipients.append((account, distance_km))
    return recipients


def _fan_out(event: BeerTapEvent, now) -> int:
    if not _still_on_tap(event):
        return 0
    recipients = _recipients(event, now)
    devices: dict[int, list[PushDevice]] = {}
    for device in PushDevice.objects.filter(
        account_id__in=[account.id for account, _ in recipients],
        enabled=True,
        permission_status=PushDevice.PermissionStatus.GRANTED,
    ):
        devices.setdefault(device.account_id, []).append(device)

    local_date = timezone.localtime(now, api_views.PRAGUE_TZ).date()
    data = {
        "kind": "beer_on_tap",
        "key": event.cache_key,
        "name": event.pub_name,
        "lat": event.lat,
        "lng": event.lng,
    }
    messages = []
    pushed = 0
    for account, distance_km in recipients:
        if account.id not in devices:
            continue
        try:
            with transaction.atomic():
                BeerWatchPush.objects.create(
                    account=account, event=event, local_date=local_date, sent_at=now
                )
        except IntegrityError:
            continue  # already had today's beer push
        pushed += 1
        for device in devices[account.id]:
            title, body = _render(event, distance_km, now, normalize_locale(device.locale))
            messages.append(
                {"to": device.push_token, "title": title, "body": body, "sound": "default", "data": data}
            )
    if messages:
        api_views._post_expo(messages)
    return pushed


class Command(BaseCommand):
    help = "Send beer-watch pushes for beers newly on tap near watchers."

    def handle(self, *args, **options) -> None:
        now = timezone.now()
        if in_quiet_hours(now):
            self.stdout.write("quiet hours, nothing sent")
            return
        expired = BeerTapEvent.objects.filter(
            fanned_out_at__isnull=True, observed_at__lt=now - EVENT_MAX_AGE
        ).update(fanned_out_at=now)
        pending = list(
            BeerTapEvent.objects.filter(fanned_out_at__isnull=True)
            .order_by("observed_at", "id")
            .values_list("id", flat=True)
        )
        events = pushes = 0
        for event_id in pending:
            now = timezone.now()
            if in_quiet_hours(now):
                break  # the rest wait for the morning, unclaimed
            # Claimed by exactly one worker run, so an event never fans out twice.
            if not BeerTapEvent.objects.filter(id=event_id, fanned_out_at__isnull=True).update(
                fanned_out_at=now
            ):
                continue
            event = BeerTapEvent.objects.select_related("product").get(id=event_id)
            events += 1
            pushes += _fan_out(event, now)
        self.stdout.write(f"events: {events}, accounts pushed: {pushes}, expired: {expired}")

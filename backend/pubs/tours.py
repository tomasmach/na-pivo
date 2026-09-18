"""Tour snapshot serialization and recoverable, hashed share capabilities."""

import base64
import hashlib
import hmac
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from pubs.models import Account, TourShare


def share_token(share):
    message = f"tour-share:v1:{share.plan_id}:{share.operation_id}".encode()
    digest = hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def share_expiry(plan, created_at=None):
    expiry = (created_at or timezone.now()) + timedelta(days=30)
    if plan.scheduled_date:
        scheduled = datetime.combine(
            plan.scheduled_date, plan.scheduled_time or time(23, 59),
            tzinfo=ZoneInfo(plan.timezone),
        )
        expiry = max(expiry, scheduled + timedelta(days=7))
    return expiry


def tour_snapshot(plan):
    return {
        "id": str(plan.pk), "title": plan.title,
        "scheduled_date": plan.scheduled_date.isoformat() if plan.scheduled_date else None,
        "scheduled_time": plan.scheduled_time.strftime("%H:%M") if plan.scheduled_time else None,
        "timezone": plan.timezone, "revision": plan.revision,
        "created_at": plan.created_at.isoformat(), "updated_at": plan.updated_at.isoformat(),
        "stops": [{
            "id": str(stop.client_id), "pub_id": stop.pub_id, "cache_key": stop.cache_key,
            "name": stop.name, "address": stop.address, "lat": stop.lat, "lon": stop.lon,
        } for stop in plan.stops.all()],
    }


def owner_payload(plan):
    share = TourShare.objects.filter(
        plan=plan, revoked_at__isnull=True, expires_at__gt=timezone.now(),
    ).first()
    if share and not hmac.compare_digest(token_hash(share_token(share)), share.token_hash):
        share = None
    return {
        "tour": tour_snapshot(plan),
        "share": {
            "url": f"{settings.PUBLIC_WEB_ORIGIN}/t/{share_token(share)}",
            "expires_at": share.expires_at.isoformat(),
        } if share else None,
    }


def public_share(token):
    share = TourShare.objects.select_related("plan").filter(
        token_hash=token_hash(token), revoked_at__isnull=True,
        expires_at__gt=timezone.now(), plan__deleted_at__isnull=True,
        plan__owner__status=Account.Status.ACTIVE,
    ).first()
    if share and not hmac.compare_digest(token_hash(share_token(share)), share.token_hash):
        return None
    return share


def protect_response(response):
    response["Cache-Control"] = "no-store, private"
    response["Referrer-Policy"] = "no-referrer"
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response

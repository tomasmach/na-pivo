"""Tour snapshot serialization, hashed share capabilities and public copies."""

import base64
import hashlib
import hmac
import math
import secrets
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from pubs.models import Account, TourPublication, TourRunMember, TourShare

# Walking at least this long with the party before a walker counts, measured on the server.
COUNT_MIN_WALK = timedelta(minutes=30)
# The public number is recounted at most this often.
COUNT_TTL = timedelta(minutes=10)


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
            "challenge": stop.challenge,
        } for stop in plan.stops.all()],
    }


def owner_payload(plan):
    share = getattr(plan, "share", None)
    if share and (share.revoked_at or share.expires_at <= timezone.now()
                  or not hmac.compare_digest(token_hash(share_token(share)), share.token_hash)):
        share = None
    publication = getattr(plan, "publication", None)
    return {
        "tour": tour_snapshot(plan),
        "share": {
            "url": f"{settings.PUBLIC_WEB_ORIGIN}/t/{share_token(share)}",
            "expires_at": share.expires_at.isoformat(),
        } if share else None,
        "publication": publication_summary(publication) if publication else None,
    }


def walking_meters(stops):
    """The app's walking guess: air distance with a quarter added for streets."""
    total = 0.0
    for a, b in zip(stops, stops[1:], strict=False):
        d_lat, d_lon = math.radians(b["lat"] - a["lat"]), math.radians(b["lon"] - a["lon"])
        h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(d_lon / 2) ** 2
        total += 2 * 6371000 * math.asin(min(1, math.sqrt(h))) * 1.25
    return round(total)


def new_publication_token():
    return secrets.token_urlsafe(16)


def author_payload(account, request=None):
    avatar = account.avatar.url if account.avatar else None
    if avatar and request is not None:
        avatar = request.build_absolute_uri(avatar)
    return {"id": str(account.public_id), "nickname": account.nickname,
            "display_name": account.display_name, "avatar_url": avatar}


def counted_people(publication_ids, now=None):
    """Distinct trusted walkers per public tour, each counted once however often they walk it."""
    from django.db.models import Count, F

    from pubs.community_trust import trusted_account_q

    now = now or timezone.now()
    rows = (TourRunMember.objects.filter(
        trusted_account_q("account__", now=now), run__publication_id__in=publication_ids,
        completed_at__isnull=False, completed_at__gte=F("run__publication__count_since"),
        joined_at__lte=now - COUNT_MIN_WALK, account__ghost_mode=False, account__excluded_from_leaderboards=False,
    ).values("run__publication_id").annotate(people=Count("account_id", distinct=True)))
    return {row["run__publication_id"]: row["people"] for row in rows}


def fresh_people_count(publication, force=False):
    now = timezone.now()
    if force or publication.people_count_at is None or publication.people_count_at <= now - COUNT_TTL:
        publication.people_count = counted_people([publication.pk], now).get(publication.pk, 0)
        publication.people_count_at = now
        TourPublication.objects.filter(pk=publication.pk).update(people_count=publication.people_count, people_count_at=now)
    return publication.people_count


def publication_summary(publication):
    return {
        "id": str(publication.public_id), "token": publication.token,
        "url": f"{settings.PUBLIC_WEB_ORIGIN}/t/{publication.token}",
        "status": publication.status, "revision": publication.revision,
        "plan_revision": publication.plan_revision, "people_count": fresh_people_count(publication),
        "title": publication.title, "city": publication.city, "stop_count": publication.stop_count,
        "walk_m": publication.walk_m, "has_challenges": publication.has_challenges,
    }


def readable_publications():
    """Active copies whose author still has an active, public profile with a nickname."""
    return (TourPublication.objects.select_related("plan__owner")
            .filter(status=TourPublication.Status.ACTIVE, plan__deleted_at__isnull=True,
                    plan__owner__status=Account.Status.ACTIVE, plan__owner__is_public=True)
            .exclude(plan__owner__nickname__isnull=True).exclude(plan__owner__nickname=""))


def public_payload(publication, request=None):
    """Shaped like a party-link snapshot so released apps can open and save it."""
    snapshot = publication.snapshot
    return {
        "tour": {
            "id": str(publication.public_id), "title": snapshot["title"],
            "scheduled_date": None, "scheduled_time": None, "timezone": snapshot.get("timezone", publication.plan.timezone),
            "revision": publication.revision, "created_at": publication.published_at.isoformat(),
            "updated_at": publication.updated_at.isoformat(), "stops": snapshot["stops"],
        },
        "expires_at": None,
        "public": {
            "id": str(publication.public_id), "author": author_payload(publication.plan.owner, request),
            "people_count": fresh_people_count(publication), "city": publication.city, "walk_m": publication.walk_m,
        },
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

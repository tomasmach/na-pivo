"""Additive, account-scoped tour publication and intentionally public snapshots."""

import hashlib
import json
import math
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import serializers
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from pubs.identity import normalize_pub_name, resolve_pub_identity
from pubs.models import Account, CanonicalPub, TourOperation, TourPlan, TourShare, TourStop
from pubs.tours import (
    owner_payload,
    protect_response,
    public_share,
    share_expiry,
    share_token,
    token_hash,
    tour_snapshot,
)

from .authentication import AccountTokenAuthentication
from .throttling import SharedScopedRateThrottle


class StopSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    pub_id = serializers.CharField(max_length=256)
    cache_key = serializers.CharField(max_length=32, allow_null=True, allow_blank=True, default=None)
    name = serializers.CharField(max_length=255)
    address = serializers.CharField(max_length=500, allow_blank=True, default="")
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)

    def validate(self, attrs):
        if not all(math.isfinite(attrs[key]) for key in ("lat", "lon")):
            raise serializers.ValidationError(_("Souřadnice hospody nejsou platné."))
        # Numeric source PKs must never be mistaken for canonical IDs. Resolve
        # retained aliases first; unresolvable pubs retain the client snapshot.
        identity = resolve_pub_identity(attrs.get("cache_key") or "", attrs["name"])
        if identity.canonical_id:
            attrs["pub_id"] = identity.canonical_id
        else:
            try:
                canonical = CanonicalPub.objects.filter(public_id=attrs["pub_id"]).first()
            except (ValueError, ValidationError):
                canonical = None
            if canonical:
                attrs["pub_id"] = str(canonical.public_id)
        return attrs


class PlanSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    base_revision = serializers.IntegerField(min_value=0)
    title = serializers.CharField(max_length=60)
    scheduled_date = serializers.DateField(allow_null=True, default=None)
    scheduled_time = serializers.TimeField(allow_null=True, default=None, input_formats=["%H:%M"])
    timezone = serializers.CharField(max_length=64, default="Europe/Prague")
    stops = StopSerializer(many=True, min_length=2, max_length=8)

    def validate(self, attrs):
        try:
            zone = ZoneInfo(attrs["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError(_("Vyber platnou časovou zónu.")) from None
        day, clock = attrs["scheduled_date"], attrs["scheduled_time"]
        if clock and not day:
            raise serializers.ValidationError(_("K času srazu vyber také datum."))
        if day and day > timezone.localdate(timezone=zone) + timedelta(days=90):
            raise serializers.ValidationError(_("Sraz může být nejvýše za 90 dní."))
        if day and clock:
            local = datetime.combine(day, clock, tzinfo=zone)
            if local.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != local.replace(tzinfo=None):
                raise serializers.ValidationError(_("Tento čas kvůli změně času neexistuje."))
        stops = attrs["stops"]
        identities = [(s.get("cache_key") or (round(s["lat"], 5), round(s["lon"], 5)),
                       normalize_pub_name(s["name"])) for s in stops]
        if (len({s["id"] for s in stops}) != len(stops)
                or len({s["pub_id"] for s in stops}) != len(stops)
                or len(set(identities)) != len(stops)):
            raise serializers.ValidationError(_("Každou hospodu přidej jen jednou."))
        return attrs


class ShareSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    rotate = serializers.BooleanField(default=False)


def _fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


def _error(code, text, status, **extra):
    return Response({"error": code, "detail": text, **extra}, status=status)


def _locked_account(request):
    account = Account.objects.select_for_update().filter(pk=request.user.pk).first()
    if (not account or account.status != Account.Status.ACTIVE
            or account.deletion_epoch != getattr(request._request, "na_pivo_deletion_epoch", account.deletion_epoch)):
        raise NotAuthenticated()
    return account


def _conflict(plan):
    return _error("revision_conflict", _("Tour se mezitím změnila. Obnov její publikovanou verzi."), 409,
                  **(owner_payload(plan) if plan and not plan.deleted_at else {}))


class OwnerTourView(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "tour_read"

    def finalize_response(self, request, response, *args, **kwargs):
        return protect_response(super().finalize_response(request, response, *args, **kwargs))

    def get_throttles(self):
        self.throttle_scope = "tour_read" if self.request.method == "GET" else "tour_write"
        return super().get_throttles()


class TourListView(OwnerTourView):
    def get(self, request):
        try:
            cursor = max(0, int(request.query_params.get("cursor", "0")))
        except ValueError:
            cursor = 0
        plans = list(TourPlan.objects.filter(owner=request.user, deleted_at__isnull=True)
                     .select_related("share").prefetch_related("stops").order_by("id")[cursor:cursor + 51])
        return Response({"tours": [owner_payload(p) for p in plans[:50]],
                         "next_cursor": str(cursor + 50) if len(plans) > 50 else None})


class TourDetailView(OwnerTourView):
    def get(self, request, plan_id):
        plan = TourPlan.objects.filter(pk=plan_id, owner=request.user, deleted_at__isnull=True).first()
        return Response(owner_payload(plan)) if plan else Response(status=404)

    def put(self, request, plan_id):
        serializer = PlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        fingerprint = _fingerprint(data)
        with transaction.atomic():
            account = _locked_account(request)
            plan = TourPlan.objects.select_for_update().filter(pk=plan_id).first()
            if plan and plan.owner_id != account.pk:
                return Response(status=404)
            if plan and plan.deleted_at:
                return _conflict(None)
            if plan:
                op = plan.operations.filter(operation_id=data["operation_id"]).first()
                if op:
                    if op.kind != "put" or op.fingerprint != fingerprint or op.result_revision != plan.revision:
                        return _conflict(plan)
                    return Response(owner_payload(plan))
            if data["base_revision"] != (plan.revision if plan else 0):
                return _conflict(plan)
            created = plan is None
            if created:
                if TourPlan.objects.filter(owner=account, deleted_at__isnull=True).count() >= 100:
                    return _error("tour_limit", _("Nejdřív smaž některou uloženou tour."), 400)
                plan = TourPlan(id=plan_id, owner=account)
            else:
                plan.revision += 1
            for field in ("title", "scheduled_date", "scheduled_time", "timezone"):
                setattr(plan, field, data[field])
            plan.save()
            plan.stops.all().delete()
            TourStop.objects.bulk_create([
                TourStop(plan=plan, position=index, client_id=stop["id"],
                         **{k: v for k, v in stop.items() if k != "id"})
                for index, stop in enumerate(data["stops"])
            ])
            share = TourShare.objects.filter(plan=plan, revoked_at__isnull=True, expires_at__gt=timezone.now()).first()
            if share:
                share.expires_at = max(share.expires_at, share_expiry(plan, share.created_at))
                share.save(update_fields=["expires_at"])
            TourOperation.objects.create(plan=plan, kind="put", operation_id=data["operation_id"], fingerprint=fingerprint, result_revision=plan.revision)
            return Response(owner_payload(plan), status=201 if created else 200)

    def delete(self, request, plan_id):
        with transaction.atomic():
            account = _locked_account(request)
            plan = TourPlan.objects.select_for_update().filter(pk=plan_id, owner=account).first()
            if plan:
                plan.deleted_at = timezone.now()
                plan.title = ""
                plan.scheduled_date = plan.scheduled_time = None
                plan.save(update_fields=["deleted_at", "title", "scheduled_date", "scheduled_time"])
                plan.stops.all().delete()
                plan.operations.all().delete()
                TourShare.objects.filter(plan=plan).update(revoked_at=timezone.now())
        return Response(status=204)


class TourShareView(OwnerTourView):
    def get_throttles(self):
        self.throttle_scope = "tour_share"
        return [SharedScopedRateThrottle()]

    def post(self, request, plan_id):
        serializer = ShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        fingerprint = _fingerprint(data)
        with transaction.atomic():
            account = _locked_account(request)
            plan = TourPlan.objects.select_for_update().filter(pk=plan_id, owner=account, deleted_at__isnull=True).first()
            if not plan:
                return Response(status=404)
            share = TourShare.objects.filter(plan=plan).first()
            op = plan.operations.filter(operation_id=data["operation_id"]).first()
            if op:
                if (op.kind != "share" or op.fingerprint != fingerprint or not share
                        or share.revoked_at or share.expires_at <= timezone.now()
                        or share.token_hash != token_hash(share_token(share))
                        or op.result_share_operation_id != share.operation_id):
                    return _conflict(plan)
                return Response(owner_payload(plan))
            active = (share and not share.revoked_at and share.expires_at > timezone.now()
                      and share.token_hash == token_hash(share_token(share)))
            if not active or data["rotate"]:
                if not active and TourShare.objects.filter(
                    plan__owner=account, revoked_at__isnull=True, expires_at__gt=timezone.now(),
                    plan__deleted_at__isnull=True,
                ).count() >= 20:
                    return _error("share_limit", _("Nejdřív zruš některý z aktivních odkazů."), 400)
                if share is None:
                    share = TourShare(plan=plan)
                share.operation_id = data["operation_id"]
                share.token_hash = token_hash(share_token(share))
                share.revoked_at = None
                share.expires_at = share_expiry(plan)
                share.save()
            TourOperation.objects.create(plan=plan, kind="share", operation_id=data["operation_id"], fingerprint=fingerprint, result_revision=plan.revision, result_share_operation_id=share.operation_id)
            return Response(owner_payload(plan))

    def delete(self, request, plan_id):
        with transaction.atomic():
            account = _locked_account(request)
            TourShare.objects.filter(plan_id=plan_id, plan__owner=account).update(revoked_at=timezone.now())
        return Response(status=204)


class PublicTourView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "tour_public"

    def finalize_response(self, request, response, *args, **kwargs):
        return protect_response(super().finalize_response(request, response, *args, **kwargs))

    def get(self, request, token):
        share = public_share(token)
        if not share:
            return Response(status=404)
        return Response({"tour": tour_snapshot(share.plan), "expires_at": share.expires_at.isoformat()})


class TourPubSearchView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [SharedScopedRateThrottle]
    throttle_scope = "tour_search"

    def get(self, request):
        from django.db.models import F, Q
        from django.db.models.functions import Cos, Power, Radians, Sin

        from pubs.models import PubDirectory, PubHours

        from .views import (
            _globally_reported_pub_cache_keys,
            _haversine_km,
            _pub_directory_item,
            _with_canonical_pub_aliases,
        )

        query = request.query_params.get("q", "").strip()
        try:
            lat = float(request.query_params["lat"]) if "lat" in request.query_params else None
            lon = float(request.query_params["lon"]) if "lon" in request.query_params else None
            radius = float(request.query_params.get("radius_km", "5"))
            if ((lat is None) != (lon is None) or not 0 < radius <= 25
                    or (lat is not None and (not -90 <= lat <= 90 or not -180 <= lon <= 180))
                    or len(query) > 120 or (query and len(query) < 2) or (not query and lat is None)):
                raise ValueError
        except (ValueError, TypeError):
            return Response({"error": "invalid_query"}, status=400)
        rows = PubDirectory.objects.filter(active=True).exclude(venue_kind=PubHours.VenueKind.NOT_PUB)
        if query:
            for part in query.replace(",", " ").split()[:8]:
                rows = rows.filter(Q(name__icontains=part) | Q(city__icontains=part))
        if lat is not None:
            delta_lat = radius / 111
            delta_lon = radius / max(1, 111 * math.cos(math.radians(lat)))
            rows = rows.filter(lat__range=(lat - delta_lat, lat + delta_lat),
                               lng__range=(lon - delta_lon, lon + delta_lon))
            # Haversine's inner term has the same distance ordering. Apply it
            # before limiting candidates so dense areas cannot hide nearby pubs.
            rows = rows.alias(proximity=(
                Power(Sin(Radians(F("lat") - lat) / 2), 2)
                + math.cos(math.radians(lat)) * Cos(Radians(F("lat")))
                * Power(Sin(Radians(F("lng") - lon) / 2), 2)
            )).order_by("proximity", "name", "pk")
        else:
            rows = rows.order_by("name", "pk")
        candidates = list(rows[:400])
        if lat is not None:
            candidates = [r for r in candidates if _haversine_km(lat, lon, r.lat, r.lng) <= radius]
            candidates.sort(key=lambda r: _haversine_km(lat, lon, r.lat, r.lng))
        blocked = _globally_reported_pub_cache_keys({r.cache_key for r in candidates})
        items = _with_canonical_pub_aliases([{**_pub_directory_item(r), "id": f"directory:{r.cache_key}:{r.name_key}", "cache_key": r.cache_key, "location": r.city}
                                            for r in candidates if r.cache_key not in blocked])
        return Response({"items": [{
            "id": str(item.get("canonicalPubId") or item["id"]), "name": item["name"],
            "lat": item["position"]["lat"], "lon": item["position"]["lon"],
            "address": item.get("location", ""), "cache_key": item.get("cache_key"),
        } for item in items[:40]]})

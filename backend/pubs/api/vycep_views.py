"""Výčep endpoints of the new look: the weekly summary, beer photos of one
beer, and per-entry FotoPivař entries and rundas.

Everything here is additive. Released clients keep their own endpoints and
semantics (one contest entry, one movable vote).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.translation import gettext
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.beer_photo_gallery import beer_photo_lookup_keys, visible_beer_photos
from pubs.models import Account, PhotoContestEntry, PhotoContestVote, PublishedNight
from pubs.photo_contest import current_photo_contest

from .authentication import AccountTokenAuthentication, WebSessionAuthentication
from .serializers import FriendsBeerPhotoFeedSerializer
from .views import (
    _accepted_friend_ids,
    _beer_photo_queryset,
    _blocked_account_ids,
    _friend_display_name,
    _internal_error,
)

logger = logging.getLogger("pubs.api.vycep")

SUMMARY_GLOBAL_TTL_S = 10 * 60
SUMMARY_FRIENDS_TTL_S = 5 * 60
BEER_PHOTOS_LIMIT = 60


class NightsSummaryQuerySerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=("friends", "global"), default="global")
    days = serializers.IntegerField(required=False, min_value=1, max_value=30, default=7)


def _summary(rows, *, leader_field: str) -> dict:
    totals = rows.aggregate(nights=Count("id"), beers=Sum("beer_count"))
    grouped = rows.exclude(city="") if leader_field == "city" else rows
    top = (
        grouped.values(leader_field)
        .annotate(beers=Sum("beer_count"), nights=Count("id"))
        .order_by("-beers", "-nights", leader_field)
        .first()
    )
    return {
        "nights": int(totals["nights"] or 0),
        "beers": int(totals["beers"] or 0),
        "leader": top if top is not None and (top["beers"] or 0) > 0 else None,
    }


class NightsSummaryView(APIView):
    """GET /v1/nights/summary?scope=friends|global&days=7 — "Posledních 7 dní".

    Global counts public nights of accounts with a public handle and names the
    leading city. Friends counts my nights plus my accepted friends' nights
    they let me see and names the leading person. Only aggregates leave the
    server; both answers are cached for a few minutes.
    """

    authentication_classes = [AccountTokenAuthentication, WebSessionAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        query = NightsSummaryQuerySerializer(data=request.query_params)
        if not query.is_valid():
            return Response(query.errors, status=status.HTTP_400_BAD_REQUEST)
        scope = query.validated_data["scope"]
        days = query.validated_data["days"]
        since = timezone.now() - timedelta(days=days)
        base = PublishedNight.objects.filter(
            is_removed=False,
            created_at__gte=since,
            account__status=Account.Status.ACTIVE,
        )

        if scope == "global":
            key = f"nights_summary:global:{days}"
            payload = cache.get(key)
            if payload is None:
                rows = base.filter(visibility=PublishedNight.Visibility.PUBLIC).exclude(
                    Q(account__nickname__isnull=True) | Q(account__nickname="")
                )
                summary = _summary(rows, leader_field="city")
                leader = summary["leader"]
                payload = {
                    "scope": scope,
                    "days": days,
                    "nights": summary["nights"],
                    "beers": summary["beers"],
                    "leader": {"kind": "city", "name": leader["city"]} if leader else None,
                }
                cache.set(key, payload, SUMMARY_GLOBAL_TTL_S)
            return Response(payload, status=status.HTTP_200_OK)

        key = f"nights_summary:friends:{request.user.pk}:{days}"
        payload = cache.get(key)
        if payload is None:
            blocked_ids = _blocked_account_ids(request.user)
            friend_ids = set(_accepted_friend_ids(request.user)) - blocked_ids
            rows = base.filter(
                Q(account=request.user)
                | Q(
                    account_id__in=friend_ids,
                    account__ghost_mode=False,
                    visibility__in=(
                        PublishedNight.Visibility.FRIENDS,
                        PublishedNight.Visibility.PUBLIC,
                    ),
                )
            )
            summary = _summary(rows, leader_field="account_id")
            leader = None
            if summary["leader"] is not None:
                account = Account.objects.filter(pk=summary["leader"]["account_id"]).first()
                if account is not None:
                    leader = {
                        "kind": "account",
                        "id": str(account.public_id),
                        "name": str(_friend_display_name(account)),
                        "is_me": account.pk == request.user.pk,
                    }
            payload = {
                "scope": scope,
                "days": days,
                "nights": summary["nights"],
                "beers": summary["beers"],
                "leader": leader,
            }
            cache.set(key, payload, SUMMARY_FRIENDS_TTL_S)
        return Response(payload, status=status.HTTP_200_OK)


class BeerPhotosQuerySerializer(serializers.Serializer):
    beer = serializers.CharField(required=False, allow_blank=True, default="", max_length=100)
    beer_name = serializers.CharField(required=False, allow_blank=True, default="", max_length=200)

    def validate(self, attrs: dict) -> dict:
        if not attrs["beer"].strip() and not attrs["beer_name"].strip():
            raise serializers.ValidationError(
                {"beer": gettext("Napiš, o jaké pivo jde.")}, code="missing_beer"
            )
        return attrs


class BeerPhotosView(APIView):
    """GET /v1/beers/photos?beer=<key>|beer_name=<name> — photos of one beer.

    My own photos plus every photo of that beer I may see (see
    :mod:`pubs.beer_photo_gallery`), newest first. Never exposes pub GPS.
    """

    authentication_classes = [AccountTokenAuthentication, WebSessionAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        query = BeerPhotosQuerySerializer(data=request.query_params)
        if not query.is_valid():
            return Response(query.errors, status=status.HTTP_400_BAD_REQUEST)
        keys = beer_photo_lookup_keys(
            beer=query.validated_data["beer"], beer_name=query.validated_data["beer_name"]
        )
        visible = visible_beer_photos(
            request.user,
            friend_ids=set(_accepted_friend_ids(request.user)),
            blocked_ids=_blocked_account_ids(request.user),
            beer_keys=keys,
        )
        contest = current_photo_contest()
        rows = (
            _beer_photo_queryset(contest)
            .filter(pk__in=visible.values("pk"))
            .select_related("account")
            .order_by("-taken_at", "-pk")[:BEER_PHOTOS_LIMIT]
        )
        return Response(
            {
                "photos": FriendsBeerPhotoFeedSerializer(
                    rows, many=True, context={"request": request}
                ).data,
                "total": visible.count(),
            },
            status=status.HTTP_200_OK,
        )


def _entry_not_found() -> Response:
    return Response(
        {"detail": gettext("Tahle soutěžní fotka tu není."), "code": "entry_not_found"},
        status=status.HTTP_404_NOT_FOUND,
    )


class PhotoContestEntryDetailView(APIView):
    """DELETE /v1/photo-contest/entries/<id> — withdraw one of my entries."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "photo_contest"

    def delete(self, request: Request, entry_id) -> Response:
        contest = current_photo_contest()
        PhotoContestEntry.objects.filter(
            contest=contest, account=request.user, public_id=entry_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PhotoContestRoundView(APIView):
    """POST/DELETE /v1/photo-contest/entries/<id>/round — give or take a runda.

    A voter may give one runda to every entry of the current round except
    their own. Both directions are idempotent and return the fresh count.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "photo_contest"

    def _entry(self, request: Request, entry_id):
        contest = current_photo_contest()
        entry = (
            PhotoContestEntry.objects.select_related("account")
            .filter(contest=contest, public_id=entry_id)
            .first()
        )
        if (
            entry is None
            or entry.account.status != Account.Status.ACTIVE
            or entry.account_id in _blocked_account_ids(request.user)
        ):
            return contest, None
        return contest, entry

    def _result(self, entry: PhotoContestEntry, mine: bool) -> Response:
        return Response(
            {
                "entry_id": str(entry.public_id),
                "votes": PhotoContestVote.objects.filter(entry=entry).count(),
                "my_vote": mine,
            },
            status=status.HTTP_200_OK,
        )

    def post(self, request: Request, entry_id) -> Response:
        contest, entry = self._entry(request, entry_id)
        if entry is None:
            return _entry_not_found()
        if entry.account_id == request.user.pk:
            return Response(
                {"detail": gettext("Pro vlastní fotku hlasovat nemůžeš."), "code": "cannot_vote_own"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                PhotoContestVote.objects.get_or_create(
                    contest=contest, entry=entry, voter=request.user
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("photo_contest: round failed: %s", exc, exc_info=True)
            return _internal_error()
        return self._result(entry, True)

    def delete(self, request: Request, entry_id) -> Response:
        contest, entry = self._entry(request, entry_id)
        if entry is None:
            return _entry_not_found()
        PhotoContestVote.objects.filter(contest=contest, entry=entry, voter=request.user).delete()
        return self._result(entry, False)

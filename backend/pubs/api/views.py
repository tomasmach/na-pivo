"""
pubs.api.views — DRF views for the pub-hours API.

Endpoints
---------
POST   /v1/pub-hours   → PubHoursView
POST   /v1/pubs        → UserAddedPubView
POST   /v1/pub-reports → PubReportView
GET    /v1/pub-reports/blocked → BlockedPubReportsView
GET    /v1/pubs/suggest → PubLocationSuggestView
GET    /v1/pubs/geocode → PubLocationGeocodeView
GET    /v1/beer-brands/suggest → BeerBrandSuggestView
POST   /v1/drinks      → DrinksView
PATCH  /v1/drinks/<client_id> → DrinksView
DELETE /v1/drinks/<client_id> → DrinksView
GET    /v1/release-notes → ReleaseNotesView
GET    /v1/health      → HealthView
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import secrets
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.core.cache import cache as default_cache
from django.core.files.uploadhandler import FileUploadHandler, StopUpload
from django.db import IntegrityError, transaction
from django.db.models import (
    Avg,
    Count,
    Exists,
    ExpressionWrapper,
    F,
    FloatField,
    Min,
    OuterRef,
    Prefetch,
    Q,
    Value,
)
from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs import accounts, emailer
from pubs.accounts import AccountError
from pubs.beer_catalog import (
    BeerCatalogMatchCache,
    match_beer_brand,
    suggest_beer_brands,
    sync_pub_beer_indexes_for_menu,
    upsert_pub_beer_brand,
)
from pubs.enrichment import (
    MapyAllQueriesFailedError,
    MapyDailyCapExceededError,
    MapySuggestSource,
    OpenRouterDailyCapExceededError,
    OpenRouterUnavailableError,
    community_hours_to_osm,
    geohash6,
    geohash8,
    names_match,
)
from pubs.mapper import maper_snapshot
from pubs.menu_scan import (
    MenuScanError,
    extract_drinks_from_image,
    validate_and_prepare_image,
)
from pubs.models import (
    BEER_CHECKIN_TAGS,
    Account,
    AccountMappedPub,
    AccountPubCompletion,
    AccountUsageStats,
    AmenityKind,
    AmenityXpLedger,
    AuthToken,
    BeerBrand,
    BeerCheckIn,
    BeerCheckInReaction,
    ClientEvent,
    ContentReport,
    DrinkLog,
    FeedbackReport,
    FriendActivityReaction,
    FriendActivityResponse,
    FriendBlock,
    FriendInviteCode,
    FriendNotification,
    FriendPubActivity,
    FriendPubActivityRecipient,
    Friendship,
    PubAmenity,
    PubAmenityVote,
    PubAmenityVoteTombstone,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
    PubCommunityXpLedger,
    PubContributionLog,
    PubNameCorrection,
    PubRating,
    PubReport,
    PubSearchCache,
    PubVisit,
    PushDevice,
    ReleaseNote,
    UserAddedPub,
)
from pubs.user_added_pub_geocoding import resolve_user_added_pub_location

from .authentication import AccountTokenAuthentication
from .cache import get_or_enrich
from .serializers import (
    AccountMeSerializer,
    AccountRegisterSerializer,
    AccountSerializer,
    AccountUpdateSerializer,
    BeerBrandSuggestionSerializer,
    BeerBrandSuggestQuerySerializer,
    BeerCheckInReactionSerializer,
    BeerCheckInRequestSerializer,
    BeerCheckInSerializer,
    BlockedPubsResponseSerializer,
    ClientEventRequestSerializer,
    ContentReportRequestSerializer,
    ContentReportSerializer,
    DrinkRequestSerializer,
    DrinkUpdateSerializer,
    FeedbackReportSerializer,
    FeedbackRequestSerializer,
    FriendActivityReactionSerializer,
    FriendActivityRequestSerializer,
    FriendActivityResponseSerializer,
    FriendBlockRequestSerializer,
    FriendInviteSerializer,
    FriendNotificationSerializer,
    FriendProfileSerializer,
    FriendPubActivitySerializer,
    FriendRequestCreateSerializer,
    FriendSearchQuerySerializer,
    FriendSettingsPatchSerializer,
    FriendshipSerializer,
    MenuScanResultSerializer,
    PubAmenityKindSerializer,
    PubAmenityReadQuerySerializer,
    PubAmenityVotesRequestSerializer,
    PubCommunityRequestSerializer,
    PubCommunityResponseSerializer,
    PubHoursRequestSerializer,
    PubHoursResponseSerializer,
    PubLocationLookupQuerySerializer,
    PubNameCorrectionRequestSerializer,
    PubNameCorrectionSerializer,
    PubRatingRequestSerializer,
    PubReportBlockedQuerySerializer,
    PubReportRequestSerializer,
    PubReportSerializer,
    PubsNearQuerySerializer,
    PubVisitRequestSerializer,
    PushDeviceDeleteSerializer,
    PushDeviceRequestSerializer,
    PushDeviceResponseSerializer,
    ReleaseNoteSerializer,
    RestorePurchasesRequestSerializer,
    UserAddedPubRenameRequestSerializer,
    UserAddedPubRequestSerializer,
    UserAddedPubSerializer,
    _amenity_aggregate_item,
    _amenity_vote_item,
    normalize_beer_checkin_tags,
)

logger = logging.getLogger(__name__)

DEFAULT_BLOCKED_REPORT_RADIUS_KM = 25.0
_IDENTITY_SPACE_RE = re.compile(r"\s+")
_BEER_KEY_RE = re.compile(r"\s+")

# Radius buckets (km) for the Mapy "pubs near" cache — the same widening steps
# the search itself uses. radius_bucket = the smallest bucket >= the requested
# radius (capped at the largest). A 25 km and a 40 km request in one cell thus
# share the 50 km row.
PUBS_NEAR_RADIUS_BUCKETS = (5, 15, 50, 100)


def _internal_error() -> Response:
    """Opaque 500 — the body is identical across every endpoint."""
    return Response(
        {"detail": "Internal server error."},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def _coded_error(exc) -> Response:
    """Map a domain error (AccountError / MenuScanError …) to its Response."""
    return Response(
        {"detail": exc.message, "code": exc.code}, status=exc.http_status
    )


def _idempotent_delete(queryset, *, scope: str, key_label: str, key_value) -> Response:
    """Delete account-scoped rows → {"deleted": <bool>}.

    A foreign / missing / already-deleted key matches nothing → deleted: false,
    never a hard 404, so the client's offline delete queue can retry safely.
    """
    try:
        deleted_count, _ = queryset.delete()
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "%s: unexpected error deleting %s %r: %s",
            scope,
            key_label,
            key_value,
            exc,
            exc_info=True,
        )
        return _internal_error()
    return Response({"deleted": deleted_count > 0}, status=status.HTTP_200_OK)


def _radius_bucket(radius_km: float) -> int:
    """Smallest bucket >= radius_km (capped at the largest bucket)."""
    for bucket in PUBS_NEAR_RADIUS_BUCKETS:
        if radius_km <= bucket:
            return bucket
    return PUBS_NEAR_RADIUS_BUCKETS[-1]


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    radius_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    lat1 = math.radians(a_lat)
    lat2 = math.radians(b_lat)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius_km * math.asin(math.sqrt(h))


def _pub_identity_key(cache_key: str, name: str) -> str:
    """Stable per-business key inside a geohash-8 cell."""
    normalized_name = _IDENTITY_SPACE_RE.sub(" ", (name or "").strip().casefold())
    return f"{cache_key}::{normalized_name}" if normalized_name else cache_key


def _beer_identity_key(value: str) -> str:
    normalized = _BEER_KEY_RE.sub(" ", (value or "").strip().casefold())
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _beer_identity_filters(beer_key: str, brewery_key: str) -> dict[str, str]:
    filters = {"beer_key": beer_key}
    if brewery_key:
        filters["brewery_key"] = brewery_key
    return filters


def _beer_tag_counts(tag_values) -> dict[str, int]:
    counts = {tag: 0 for tag in BEER_CHECKIN_TAGS}
    for tags in tag_values:
        for tag in normalize_beer_checkin_tags(tags):
            counts[tag] += 1
    return {tag: count for tag, count in counts.items() if count}


def _beer_top_tags(tag_counts: dict[str, int]) -> list[str]:
    return sorted(tag_counts, key=lambda tag: (-tag_counts[tag], BEER_CHECKIN_TAGS.index(tag)))[:3]


FRIEND_ACTIVITY_DEFAULT_TTL = timedelta(hours=4)
FRIEND_ACTIVITY_MAX_TTL = timedelta(hours=8)

# Quiet-hours and the party streak are evaluated against Czech local wall-clock,
# never UTC, so an 11pm push is muted regardless of the server timezone.
PRAGUE_TZ = ZoneInfo("Europe/Prague")

# Party leaderboard window: pub visits in the trailing 30 days.
LEADERBOARD_WINDOW = timedelta(days=30)
# Friend dashboard shared-evening stats stay recent enough to be useful while
# keeping the hot /v1/friends read path bounded as accounts build history.
FRIEND_SHARED_STATS_WINDOW = timedelta(days=365)


def _friend_display_name(account: Account | None) -> str:
    if account is None:
        return "Kamarád"
    if account.nickname:
        return f"@{account.nickname}"
    if account.display_name:
        return account.display_name
    return "Kamarád"


def _is_active_account(account: Account) -> bool:
    return account.status == Account.Status.ACTIVE


def _accepted_friend_ids(account: Account) -> list[int]:
    rows = Friendship.objects.filter(status=Friendship.Status.ACCEPTED).filter(
        Q(requester=account) | Q(recipient=account)
    )
    friend_ids: list[int] = []
    for row in rows.select_related("requester", "recipient").only(
        "requester_id",
        "recipient_id",
        "requester__status",
        "recipient__status",
    ):
        friend = row.recipient if row.requester_id == account.id else row.requester
        if _is_active_account(friend):
            friend_ids.append(friend.id)
    return friend_ids


def _shared_pub_stats(
    account: Account, friend_ids: list[int]
) -> tuple[dict[int, dict[str, object]], set]:
    """Return shared-evening stats plus the set of shared local dates.

    A shared evening is currently a same-day visit to the same geohash-8 pub,
    bucketed on the Europe/Prague local date so a late-night beer counts on the
    night it actually happened for CZ/SK users (never the UTC rollover). This
    avoids storing any route or raw GPS history and stays cheap enough for the
    friend dashboard; a future version can tighten it to true time overlap.

    Returns ``(stats, shared_dates)`` from a single pass over the same two
    PubVisit scans: ``stats`` is keyed by friend account id, and ``shared_dates``
    is the set of distinct local dates the party was out together — the raw
    material for the consecutive-week streak. Privacy-safe: only geohash + local
    date, never raw coordinates.
    """

    if not friend_ids:
        return {}, set()
    stats: dict[int, dict[str, object]] = {
        friend_id: {"shared_count": 0, "last_shared_at": None, "last_pub_name": ""}
        for friend_id in friend_ids
    }
    cutoff = dj_timezone.now() - FRIEND_SHARED_STATS_WINDOW
    my_visits = list(
        PubVisit.objects.filter(account=account, started_at__gte=cutoff).only(
            "cache_key", "started_at", "name"
        )
    )
    if not my_visits:
        return stats, set()

    def _local_date(value):
        return dj_timezone.localtime(value, PRAGUE_TZ).date()

    my_keys = {(visit.cache_key, _local_date(visit.started_at)) for visit in my_visits}
    my_pub_names = {
        (visit.cache_key, _local_date(visit.started_at)): visit.name for visit in my_visits
    }
    shared_dates: set = set()
    friend_visits = (
        PubVisit.objects.filter(account_id__in=friend_ids, started_at__gte=cutoff)
        .only("account_id", "cache_key", "started_at", "name")
        .order_by("-started_at")
    )
    seen_pairs: set[tuple[int, str, object]] = set()
    for visit in friend_visits:
        local_date = _local_date(visit.started_at)
        key = (visit.cache_key, local_date)
        if key not in my_keys:
            continue
        shared_dates.add(local_date)
        pair = (visit.account_id, visit.cache_key, local_date)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        item = stats[visit.account_id]
        item["shared_count"] = int(item["shared_count"]) + 1
        last_shared_at = item["last_shared_at"]
        if last_shared_at is None or visit.started_at > last_shared_at:
            item["last_shared_at"] = visit.started_at
            item["last_pub_name"] = my_pub_names.get(key) or visit.name
    return stats, shared_dates


def _friend_rituals(shared_count: int) -> list[dict[str, str]]:
    rituals: list[dict[str, str]] = []
    if shared_count >= 1:
        rituals.append({"key": "first_round", "title": "První společné pivo"})
    if shared_count >= 3:
        rituals.append({"key": "regular_table", "title": "Už máte svůj stůl"})
    if shared_count >= 10:
        rituals.append({"key": "house_crew", "title": "Hospodská dvojka"})
    return rituals


def _friend_stats_item(stats: dict) -> dict:
    """One friend_stats entry from a per-account shared-stats dict (or {})."""
    shared_count = int(stats.get("shared_count") or 0)
    last_shared_at = stats.get("last_shared_at")
    return {
        "shared_pub_count": shared_count,
        "last_shared_at": last_shared_at.isoformat() if last_shared_at else None,
        "last_pub_name": stats.get("last_pub_name") or "",
        "rituals": _friend_rituals(shared_count),
    }


def _friend_profile_context(request: Request) -> dict:
    return {"request": request}


def _friend_activity_context(request: Request, blocked_ids: set[int] | None = None) -> dict:
    """Serializer context for FriendPubActivitySerializer.

    Carries ``request`` (avatar URLs), ``account`` so the serializer can resolve
    ``my_response`` for the caller, and ``blocked_ids`` so a blocked account never
    surfaces in the GOING roster the caller sees (bidirectional, mirroring the
    other block-gated read paths). Callers that already built the block set pass
    it in to avoid a duplicate query.
    """
    if blocked_ids is None:
        blocked_ids = _blocked_account_ids(request.user)
    return {"request": request, "account": request.user, "blocked_ids": blocked_ids}


def _friend_activity_responses_prefetch() -> Prefetch:
    """Prefetch RSVP rows in the shape FriendPubActivitySerializer expects."""
    return Prefetch(
        "responses",
        queryset=FriendActivityResponse.objects.select_related("account"),
    )


def _friend_activity_reactions_prefetch() -> Prefetch:
    """Prefetch reaction rows so ``reactions`` / ``my_reaction`` stay N+1-free."""
    return Prefetch(
        "reactions",
        queryset=FriendActivityReaction.objects.all(),
    )


def _friend_activity_prefetches() -> tuple[Prefetch, Prefetch]:
    """The RSVP + reaction prefetches every FriendPubActivity read path needs."""
    return _friend_activity_responses_prefetch(), _friend_activity_reactions_prefetch()


def _beer_checkin_context(request: Request) -> dict:
    return {"request": request, "account": request.user}


def _beer_checkin_reactions_prefetch() -> Prefetch:
    return Prefetch("reactions", queryset=BeerCheckInReaction.objects.all())


def _beer_checkin_queryset():
    return BeerCheckIn.objects.select_related("account").prefetch_related(
        _beer_checkin_reactions_prefetch()
    )


def _blocked_account_ids(account: Account) -> set[int]:
    """Account ids I have blocked OR that have blocked me (bidirectional).

    Used to gate search / requests / respond / react / dashboard / fanout /
    invite-resolve so a block hides both parties from each other everywhere.
    """
    rows = FriendBlock.objects.filter(
        Q(blocker=account) | Q(blocked=account)
    ).values_list("blocker_id", "blocked_id")
    blocked: set[int] = set()
    for blocker_id, blocked_id in rows:
        blocked.add(blocked_id if blocker_id == account.id else blocker_id)
    return blocked


def _requested_activity_recipient_ids(
    requested_public_ids: list[uuid.UUID] | None,
    *,
    friend_ids: list[int],
    blocked_ids: set[int],
) -> list[int]:
    """Return DB ids an activity should target, or all eligible friends.

    ``None`` means the client omitted the field, preserving legacy fanout to all
    accepted non-blocked friends. A provided list is intersected with that safe
    friend set so stale local partičky or malicious ids never widen visibility.
    """
    eligible = [fid for fid in friend_ids if fid not in blocked_ids]
    if requested_public_ids is None:
        return eligible
    if not requested_public_ids or not eligible:
        return []
    eligible_set = set(eligible)
    return list(
        Account.objects.filter(
            id__in=eligible_set,
            public_id__in=requested_public_ids,
            status=Account.Status.ACTIVE,
        ).values_list("id", flat=True)
    )


def _apply_friend_activity_visibility(queryset, viewer: Account):
    """Limit friend activities to rows visible to ``viewer``.

    Activities without explicit target rows are legacy public-to-friends rows.
    Activities with targets are visible only when ``viewer`` is one of them.
    The caller still applies friendship/block/ghost gates before this helper.
    """
    target_rows = FriendPubActivityRecipient.objects.filter(activity_id=OuterRef("pk"))
    target_to_viewer = target_rows.filter(account=viewer)
    return queryset.annotate(
        has_explicit_targets=Exists(target_rows),
        targets_viewer=Exists(target_to_viewer),
    ).filter(Q(has_explicit_targets=False) | Q(targets_viewer=True))


def _friend_activity_visible_to(activity: FriendPubActivity, viewer: Account) -> bool:
    """Whether ``viewer`` passes the explicit activity-target gate."""
    has_targets = FriendPubActivityRecipient.objects.filter(activity=activity).exists()
    if not has_targets:
        return True
    return FriendPubActivityRecipient.objects.filter(
        activity=activity,
        account=viewer,
    ).exists()


def _prague_today_bounds(now=None) -> tuple[datetime, datetime]:
    """[start, end) of the current Europe/Prague local day, as aware datetimes.

    Plans are bucketed on the local (Prague) date so "dnešní plán" means the same
    calendar day a CZ/SK user sees, never the UTC rollover.
    """
    now = now or dj_timezone.now()
    local_now = dj_timezone.localtime(now, PRAGUE_TZ)
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def _account_in_quiet_hours(account: Account, now=None) -> bool:
    """Whether ``account`` is inside its local (Europe/Prague) quiet-hours window.

    Returns False when quiet hours are disabled. The window runs from
    ``quiet_hours_start`` (inclusive) to ``quiet_hours_end`` (exclusive) in local
    hours and may wrap midnight (e.g. 23..9 mutes 23,0,1,..,8). A degenerate
    start == end window is treated as never-quiet.
    """
    if not getattr(account, "quiet_hours_enabled", False):
        return False
    start = int(getattr(account, "quiet_hours_start", 23)) % 24
    end = int(getattr(account, "quiet_hours_end", 9)) % 24
    if start == end:
        return False
    now = now or dj_timezone.now()
    hour = dj_timezone.localtime(now, PRAGUE_TZ).hour
    if start < end:
        return start <= hour < end
    # Wrapping window: quiet from start..23 and 0..end-1.
    return hour >= start or hour < end


def _friend_settings_payload(account: Account) -> dict:
    """The social-settings dict shared by the dashboard and FriendSettingsView."""
    return {
        "ghost_mode": bool(account.ghost_mode),
        "quiet_hours_enabled": bool(account.quiet_hours_enabled),
        "quiet_hours_start": int(account.quiet_hours_start),
        "quiet_hours_end": int(account.quiet_hours_end),
    }


def _party_streak(shared_dates: set) -> dict:
    """Consecutive-week party streak from a set of shared-evening local dates.

    A week (ISO year, week, Europe/Prague) is "lit" when it holds >=1 shared
    evening. Counting starts at the current week and walks backwards: the streak
    stays standing if the current week is not yet lit but last week was. Returns
    ``{"current_weeks": int, "this_week_lit": bool}``.
    """
    if not shared_dates:
        return {"current_weeks": 0, "this_week_lit": False}

    lit_weeks = {(d.isocalendar().year, d.isocalendar().week) for d in shared_dates}
    today = dj_timezone.localtime(dj_timezone.now(), PRAGUE_TZ).date()
    iso = today.isocalendar()
    cursor_year, cursor_week = iso.year, iso.week
    this_week_lit = (cursor_year, cursor_week) in lit_weeks

    # Allow a not-yet-lit current week: start the walk at last week instead so a
    # streak earned through last week is still reported as standing.
    if not this_week_lit:
        cursor_year, cursor_week = _previous_iso_week(cursor_year, cursor_week)

    streak = 0
    while (cursor_year, cursor_week) in lit_weeks:
        streak += 1
        cursor_year, cursor_week = _previous_iso_week(cursor_year, cursor_week)
    return {"current_weeks": streak, "this_week_lit": this_week_lit}


def _previous_iso_week(year: int, week: int) -> tuple[int, int]:
    """The ISO (year, week) seven days before the Monday of (year, week)."""
    monday = date.fromisocalendar(year, week, 1)
    prev = monday - timedelta(days=7)
    iso = prev.isocalendar()
    return iso.year, iso.week


def _single_friend_shared(account: Account, friend: Account) -> tuple[list[dict], set]:
    """Shared evenings with ONE friend (cheap — used by the friend profile GET).

    Returns ``(shared_evenings, shared_dates)`` where ``shared_evenings`` is a
    list of ``{"pub_name", "cache_key", "at"}`` dicts (most recent first, deduped
    per (pub, local date)) and ``shared_dates`` feeds the pair streak. Same
    same-day-same-geohash definition as ``_shared_pub_stats`` but scoped to a
    single friend, so it stays bounded regardless of how many friends I have.
    Privacy-safe: only geohash + local date, never raw coordinates.
    """

    cutoff = dj_timezone.now() - FRIEND_SHARED_STATS_WINDOW

    def _local_date(value):
        return dj_timezone.localtime(value, PRAGUE_TZ).date()

    my_visits = list(
        PubVisit.objects.filter(account=account, started_at__gte=cutoff).only(
            "cache_key", "started_at", "name"
        )
    )
    if not my_visits:
        return [], set()
    my_by_key: dict[tuple[str, object], tuple[str, object]] = {}
    for visit in my_visits:
        my_by_key[(visit.cache_key, _local_date(visit.started_at))] = (
            visit.name,
            visit.started_at,
        )

    friend_visits = (
        PubVisit.objects.filter(account=friend, started_at__gte=cutoff)
        .only("cache_key", "started_at", "name")
        .order_by("-started_at")
    )
    shared_dates: set = set()
    shared_evenings: list[dict] = []
    seen: set[tuple[str, object]] = set()
    for visit in friend_visits:
        local_date = _local_date(visit.started_at)
        key = (visit.cache_key, local_date)
        if key not in my_by_key:
            continue
        shared_dates.add(local_date)
        if key in seen:
            continue
        seen.add(key)
        my_name, my_started_at = my_by_key[key]
        shared_evenings.append(
            {
                "pub_name": my_name or visit.name,
                "cache_key": visit.cache_key,
                "at": my_started_at,
            }
        )
    shared_evenings.sort(key=lambda item: item["at"], reverse=True)
    return shared_evenings, shared_dates


def _send_friend_push(account_ids: list[int], title: str, body: str, data: dict) -> None:
    """Best-effort Expo push fanout.

    Push tokens are secrets. This helper never logs token values, request bodies
    or response payloads; the in-app FriendNotification row is the durable truth
    if Expo is down or the device has disabled pushes.
    """

    if not account_ids:
        return

    # Drop any recipient currently inside their local quiet-hours window. This
    # suppresses only the PUSH; the in-app FriendNotification row is created
    # separately and is unaffected. Computed once against the same `now`.
    now = dj_timezone.now()
    quiet_account_ids = {
        account.id
        for account in Account.objects.filter(id__in=account_ids).only(
            "id", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end"
        )
        if _account_in_quiet_hours(account, now)
    }
    deliver_ids = [account_id for account_id in account_ids if account_id not in quiet_account_ids]
    if not deliver_ids:
        return

    tokens = list(
        PushDevice.objects.filter(
            account_id__in=deliver_ids,
            enabled=True,
            permission_status=PushDevice.PermissionStatus.GRANTED,
        ).values_list("push_token", flat=True)
    )
    if not tokens:
        return

    # Expo caps a single /push/send POST at 100 messages; chunk the (now opt-in
    # driven, so potentially large) token base into batches. Tickets come back in
    # the same order as the messages sent, so we can map a per-token delivery
    # result back to its device and retire tokens Expo reports as unreachable.
    chunk_size = max(1, int(getattr(settings, "EXPO_PUSH_CHUNK_SIZE", 100)))
    dead_tokens: list[str] = []
    for start in range(0, len(tokens), chunk_size):
        batch_tokens = tokens[start : start + chunk_size]
        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": data,
            }
            for token in batch_tokens
        ]
        try:
            response = requests.post(
                "https://exp.host/--/api/v2/push/send",
                json=messages,
                timeout=3,
            )
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "friend push delivery failed",
                extra={
                    "event": "friend_push_failed",
                    "observability": {
                        "recipient_count": len(deliver_ids),
                        "token_count": len(batch_tokens),
                        "error": exc.__class__.__name__,
                    },
                },
            )
            continue
        # Best-effort ticket parse: a device that uninstalled reports
        # DeviceNotRegistered, so we disable that token to shrink future fanout.
        # Never log token values or bodies.
        try:
            tickets = response.json().get("data", [])
        except Exception:  # noqa: BLE001
            tickets = []
        for token, ticket in zip(batch_tokens, tickets):
            if (
                isinstance(ticket, dict)
                and ticket.get("status") == "error"
                and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
            ):
                dead_tokens.append(token)

    if dead_tokens:
        PushDevice.objects.filter(push_token__in=dead_tokens).update(
            enabled=False,
            permission_status=PushDevice.PermissionStatus.DENIED,
        )


def _create_friend_notification(
    *,
    recipient: Account,
    actor: Account,
    kind: str,
    title: str,
    body: str,
    friendship: Friendship | None = None,
    activity: FriendPubActivity | None = None,
    pub_cache_key: str = "",
    pub_name: str = "",
) -> FriendNotification:
    return FriendNotification.objects.create(
        recipient=recipient,
        actor=actor,
        kind=kind,
        title=title,
        body=body,
        friendship=friendship,
        activity=activity,
        pub_cache_key=pub_cache_key,
        pub_name=pub_name,
    )


def _bulk_create_friend_notifications(
    *,
    recipient_ids: list[int],
    actor: Account,
    kind: str,
    title: str,
    body: str,
    activity: FriendPubActivity | None = None,
    pub_cache_key: str = "",
    pub_name: str = "",
) -> None:
    """Fan a single in-app notification out to many recipients in one INSERT.

    Replaces the per-recipient create loop so a broadcast to a large parta is one
    ``bulk_create`` instead of N queries. The push fan-out is separate.
    """
    if not recipient_ids:
        return
    FriendNotification.objects.bulk_create(
        [
            FriendNotification(
                recipient_id=recipient_id,
                actor=actor,
                kind=kind,
                title=title,
                body=body,
                activity=activity,
                pub_cache_key=pub_cache_key,
                pub_name=pub_name,
            )
            for recipient_id in recipient_ids
        ]
    )


class HealthView(APIView):
    """GET /v1/health — liveness probe."""

    def get(self, request: Request) -> Response:  # noqa: ARG002
        return Response({"status": "ok"})


class PubHoursView(APIView):
    """
    POST /v1/pub-hours

    Accept a list of pubs and return opening hours + isOpenNow for each.
    Pubs are served from cache when fresh; otherwise enriched synchronously
    up to sync_budget, with the remainder queued as EnrichTask rows.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_hours"

    def post(self, request: Request) -> Response:
        req_serializer = PubHoursRequestSerializer(data=request.data)
        if not req_serializer.is_valid():
            return Response(req_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        validated = req_serializer.validated_data
        pubs: list[dict] = validated["pubs"]
        sync_budget: int | None = validated.get("sync_budget")  # None → use settings default

        try:
            results = get_or_enrich(pubs, sync_budget=sync_budget)
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-hours: unexpected error: %s", exc, exc_info=True)
            return _internal_error()

        resp_serializer = PubHoursResponseSerializer({"results": results})
        return Response(resp_serializer.data, status=status.HTTP_200_OK)


class PubReportView(APIView):
    """
    POST /v1/pub-reports

    Save a user report that a Mapy.cz result should no longer be offered by the
    compass. The mobile app also hides the place locally immediately; this
    endpoint makes the block available to later searches and other installs.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_reports"

    def post(self, request: Request) -> Response:
        serializer = PubReportRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        external_id = data.get("external_id") or None

        try:
            report, created = PubReport.objects.update_or_create(
                account=request.user,
                cache_key=cache_key,
                reason=data["reason"],
                defaults={
                    "external_id": external_id,
                    "name": data["name"],
                    "lat": data["lat"],
                    "lng": data["lng"],
                    "city": data.get("city") or None,
                    "address": data.get("address") or None,
                    "active": True,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-report: unexpected error saving report for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(
            PubReportSerializer(report).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PubNameCorrectionView(APIView):
    """
    POST /v1/pub-name-corrections

    Save a user-submitted display-name correction for a pub. The correction is
    applied when /v1/pubs/near serves matching items; the upstream cache remains
    untouched so this is reversible from admin by deactivating the correction.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_reports"

    def post(self, request: Request) -> Response:
        serializer = PubNameCorrectionRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        external_id = data.get("external_id") or None

        try:
            with transaction.atomic():
                existing = (
                    PubNameCorrection.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                if existing is not None:
                    return Response(
                        PubNameCorrectionSerializer(existing).data,
                        status=status.HTTP_200_OK,
                    )

                correction = PubNameCorrection.objects.create(
                    account=request.user,
                    client_id=data["client_id"],
                    cache_key=cache_key,
                    external_id=external_id,
                    original_name=data["name"],
                    suggested_name=data["suggested_name"],
                    lat=data["lat"],
                    lng=data["lng"],
                    city=data.get("city") or None,
                    address=data.get("address") or None,
                    active=True,
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-name-correction: unexpected error saving correction for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(
            PubNameCorrectionSerializer(correction).data,
            status=status.HTTP_201_CREATED,
        )


class UserAddedPubView(APIView):
    """
    POST /v1/pubs
    PATCH /v1/pubs/<client_id>

    Add a pub that the normal Mapy.cz nearby search does not show. The submitted
    pub is immediately visible to all users through GET /v1/pubs/near, where it
    is mixed into the Mapy result stream by distance. Auth + throttling mirror
    the existing community contribution endpoint.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "added_pubs"

    def post(self, request: Request) -> Response:
        serializer = UserAddedPubRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        lat = data["lat"]
        lng = data["lng"]
        city = data.get("city") or ""
        address = data.get("address") or ""

        if address:
            resolved_location = resolve_user_added_pub_location(
                name=data["name"],
                address=address,
                city=city,
                lat=lat,
                lng=lng,
            )
            if resolved_location is not None:
                lat = resolved_location.lat
                lng = resolved_location.lng
                city = city or resolved_location.city
                address = address or resolved_location.address

        cache_key = geohash8(lat, lng)

        try:
            with transaction.atomic():
                existing = (
                    UserAddedPub.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                if existing is not None:
                    return Response(
                        UserAddedPubSerializer(existing).data,
                        status=status.HTTP_200_OK,
                    )

                pub, created = UserAddedPub.objects.update_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": lat,
                        "lng": lng,
                        "city": city,
                        "address": address,
                        "active": True,
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "user-added-pub: unexpected error saving pub for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(
            UserAddedPubSerializer(pub).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def patch(self, request: Request, client_id: uuid.UUID) -> Response:
        serializer = UserAddedPubRenameRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                pub = (
                    UserAddedPub.objects.select_for_update()
                    .filter(account=request.user, client_id=client_id)
                    .first()
                )
                if pub is None:
                    return Response(
                        {"detail": "User-added pub not found."},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                pub.name = serializer.validated_data["name"]
                pub.save(update_fields=["name", "updated_at"])
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "user-added-pub: unexpected error renaming pub %s: %s",
                client_id,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(UserAddedPubSerializer(pub).data, status=status.HTTP_200_OK)


class PubCommunityView(APIView):
    """
    POST /v1/pub-community

    Accept community-contributed opening hours and/or a list of beers on tap for
    a pub. Contributions go LIVE IMMEDIATELY (no approval queue): the per-pub
    PubCommunityData row is upserted and full history is appended to
    PubContributionLog for audit / revert. Community opening hours take
    precedence over firmy.cz data in the /v1/pub-hours read path.

    Auth: Bearer token (per-account). Idempotent on (account, client_id, kind):
    re-POSTing the same client_id never duplicates a log row. Throttled per-IP
    (scope "community").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "community"

    def post(self, request: Request) -> Response:
        match_cache = BeerCatalogMatchCache()
        serializer = PubCommunityRequestSerializer(
            data=request.data,
            context={"beer_match_cache": match_cache},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        has_hours = data.get("hours") is not None
        has_beers = "beers" in data
        now = dj_timezone.now()

        try:
            defaults = {
                "name": data["name"],
                "lat": data["lat"],
                "lng": data["lng"],
                "city": data.get("city") or None,
                "external_id": data.get("external_id") or None,
                "account": request.user,
            }
            if has_hours:
                hours_json = data["hours"]
                defaults["hours_json"] = hours_json
                defaults["opening_hours_raw"] = community_hours_to_osm(hours_json)
                defaults["hours_updated_at"] = now
            if has_beers:
                defaults["beers"] = data["beers"]
                defaults["beers_updated_at"] = now

            record, _ = PubCommunityData.objects.update_or_create(
                cache_key=cache_key,
                defaults=defaults,
            )

            # Append idempotent history rows, one per submitted kind.
            if has_hours:
                PubContributionLog.objects.get_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    kind=PubContributionLog.Kind.HOURS,
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "payload": data["hours"],
                    },
                )
            if has_beers:
                PubContributionLog.objects.get_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    kind=PubContributionLog.Kind.BEERS,
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "payload": data["beers"],
                    },
                )
                sync_pub_beer_indexes_for_menu(
                    cache_key=cache_key,
                    data=data,
                    beers=data["beers"],
                    source=PubBeerBrand.Source.COMMUNITY,
                    account=request.user,
                    match_cache=match_cache,
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-community: unexpected error saving contribution for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return _internal_error()

        # ── Mapér XP (additive; an XP failure must never break a saved edit) ──
        xp_awarded = 0
        mapper = None
        try:
            pub_identity_key = _pub_identity_key(cache_key, data["name"])
            kinds: set[str] = set()
            if has_hours:
                kinds.add(PubCommunityXpLedger.Kind.HOURS)
            if has_beers:
                kinds.add(PubCommunityXpLedger.Kind.BEERS)
            xp_awarded = _award_community_xp(
                request.user, cache_key, pub_identity_key, kinds
            )
            stats, _ = AccountUsageStats.objects.get_or_create(account=request.user)
            mapper = maper_snapshot(stats.mapper_xp, _mapper_counters(stats))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "pub-community: XP award failed for cache key %s: %s", cache_key, exc
            )

        body = PubCommunityResponseSerializer(
            {
                "cache_key": record.cache_key,
                "hours": record.hours_json,
                "beers": record.beers or [],
                "xp_awarded": xp_awarded,
                "mapper": mapper,
            }
        ).data
        return Response(body, status=status.HTTP_200_OK)


class BeerBrandSuggestView(APIView):
    """
    GET /v1/beer-brands/suggest

    Lightweight canonical beer-brand suggestions for manual beer entry. Public
    and read-only; failures are non-critical because the mobile form remains
    free-text.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "beer_brands"

    def get(self, request: Request) -> Response:
        query = BeerBrandSuggestQuerySerializer(data=request.query_params)
        if not query.is_valid():
            return Response(query.errors, status=status.HTTP_400_BAD_REQUEST)

        brands = suggest_beer_brands(
            query.validated_data.get("q") or "",
            limit=query.validated_data["limit"],
        )
        return Response(
            {"suggestions": BeerBrandSuggestionSerializer(brands, many=True).data},
            status=status.HTTP_200_OK,
        )


# Mirror the community menu cap (serializers._MAX_BEERS): a community beer menu
# holds at most 12 entries. When the menu is full a drink is still logged, but
# the merge is skipped.
_MAX_MENU_BEERS = 12


def _merge_drink_into_menu(beers: list[dict], beer: dict) -> bool:
    """Merge one drunk ``beer`` into a community ``beers`` menu list IN PLACE.

    The match key is (normalized name, volume_ml): the beer name trimmed +
    casefolded, plus the exact volume (None matches None). On a match the
    existing entry's ``price_czk`` is updated to the posted price. Otherwise the
    beer is appended IF the menu has room (< 12 entries); a full menu is left
    untouched.

    Every entry is kept in the canonical CommunityBeerSerializer shape (all three
    keys ``name`` / ``price_czk`` / ``volume_ml`` present).

    Returns True if the list was changed (price updated or beer appended), False
    if nothing changed (no match and the menu was full).
    """
    posted_key = ((beer.get("name") or "").strip().casefold(), beer.get("volume_ml"))
    for entry in beers:
        entry_key = ((entry.get("name") or "").strip().casefold(), entry.get("volume_ml"))
        if entry_key == posted_key:
            entry["price_czk"] = beer["price_czk"]
            return True

    if len(beers) >= _MAX_MENU_BEERS:
        return False

    beers.append(
        {
            "name": beer["name"],
            "price_czk": beer["price_czk"],
            "volume_ml": beer.get("volume_ml"),
        }
    )
    return True


class DrinksView(APIView):
    """
    POST   /v1/drinks
    PATCH  /v1/drinks/<client_id>
    DELETE /v1/drinks/<client_id>

    Log one categorized drink via the in-app counter. Beer remains the default
    for released clients and is merged into PubCommunityData.beers. Soft drinks
    and shots are stored privately without touching beer menus or catalogues.

    Auth: Bearer token (per-account). Idempotent on (account, client_id): a
    replayed client_id returns 200 ``duplicate: true`` with NO repeated side
    effects (no second log row, no second merge). Throttled per-IP (scope
    "drinks").

    The menu merge NEVER touches PubCommunityData.hours and is guarded by
    names_match so a different business in the same ~38 m geohash cell does not
    inherit the menu — in that case the drink is logged but the merge is skipped.

    DELETE removes the per-user DrinkLog row for (account, client_id) — used when
    the in-app minus button decrements a beer that was already delivered. It is
    idempotent (a missing row is a success with ``deleted: false``, so the
    client's offline delete queue can retry safely) and NEVER touches
    PubCommunityData: the contributed price was real community data and stays.

    PATCH fixes the private beer name on a single DrinkLog row. It is scoped to
    the account, idempotent for repeated retries, and deliberately does NOT edit
    PubCommunityData, price, volume, pub or timestamps.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "drinks"

    def post(self, request: Request) -> Response:
        match_cache = BeerCatalogMatchCache()
        serializer = DrinkRequestSerializer(
            data=request.data,
            context={"beer_match_cache": match_cache},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        beer = data["beer"]
        drink_type = data["drink_type"]
        is_beer = drink_type == DrinkLog.DrinkType.BEER
        brand_match = (
            match_beer_brand(beer["name"], match_cache=match_cache)
            if is_beer
            else None
        )
        drank_at = data.get("drank_at") or dj_timezone.now()

        try:
            with transaction.atomic():
                drink, created = DrinkLog.objects.get_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "external_id": data.get("external_id") or "",
                        "drink_type": drink_type,
                        "beer_name": beer["name"],
                        "beer_brand": brand_match.brand if brand_match else None,
                        "beer_brand_key": brand_match.brand.key if brand_match else "",
                        "beer_brand_name": brand_match.brand.name if brand_match else "",
                        "beer_product": brand_match.product if brand_match else None,
                        "beer_product_key": (
                            brand_match.product.key if brand_match and brand_match.product else ""
                        ),
                        "beer_product_name": (
                            brand_match.product.name if brand_match and brand_match.product else ""
                        ),
                        "price_czk": beer["price_czk"],
                        "volume_ml": beer.get("volume_ml"),
                        "drank_at": drank_at,
                    },
                )

                # Idempotent replay: the drink already exists, so do NOT repeat the
                # menu merge (which is not itself idempotent — a price could have
                # changed since).
                if not created:
                    return Response(
                        {
                            "accepted": True,
                            "duplicate": True,
                            "cache_key": drink.cache_key,
                            "menu_updated": False,
                        },
                        status=status.HTTP_200_OK,
                    )

                menu_updated = False
                if is_beer:
                    menu_updated = self._merge_into_community(
                        cache_key,
                        data,
                        beer,
                        account=request.user,
                        match_cache=match_cache,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "drinks: unexpected error logging drink for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(
            {
                "accepted": True,
                "duplicate": False,
                "cache_key": cache_key,
                "menu_updated": menu_updated,
            },
            status=status.HTTP_201_CREATED,
        )

    def patch(self, request: Request, client_id) -> Response:
        match_cache = BeerCatalogMatchCache()
        serializer = DrinkUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        beer_name = serializer.validated_data["beer_name"]
        try:
            with transaction.atomic():
                drink = (
                    DrinkLog.objects.select_for_update()
                    .filter(account=request.user, client_id=client_id)
                    .first()
                )
                if drink is None:
                    return Response({"updated": False}, status=status.HTTP_200_OK)

                brand_match = (
                    match_beer_brand(beer_name, match_cache=match_cache)
                    if drink.drink_type == DrinkLog.DrinkType.BEER
                    else None
                )

                old_brand_key = drink.beer_brand_key
                old_product_key = drink.beer_product_key

                drink.beer_name = beer_name
                drink.beer_brand = brand_match.brand if brand_match else None
                drink.beer_brand_key = brand_match.brand.key if brand_match else ""
                drink.beer_brand_name = brand_match.brand.name if brand_match else ""
                drink.beer_product = brand_match.product if brand_match else None
                drink.beer_product_key = (
                    brand_match.product.key if brand_match and brand_match.product else ""
                )
                drink.beer_product_name = (
                    brand_match.product.name if brand_match and brand_match.product else ""
                )
                drink.save(
                    update_fields=[
                        "beer_name",
                        "beer_brand",
                        "beer_brand_key",
                        "beer_brand_name",
                        "beer_product",
                        "beer_product_key",
                        "beer_product_name",
                    ]
                )

                if drink.drink_type == DrinkLog.DrinkType.BEER:
                    self._refresh_drink_brand_indexes_after_patch(
                        drink=drink,
                        old_brand_key=old_brand_key,
                        old_product_key=old_product_key,
                        account=request.user,
                        match_cache=match_cache,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "drinks: unexpected error updating drink %r: %s",
                client_id,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response({"updated": True}, status=status.HTTP_200_OK)

    def delete(self, request: Request, client_id) -> Response:
        # Idempotent delete of the per-user drink. The account filter means a
        # client_id belonging to another account (or never logged, or already
        # deleted) simply matches nothing → deleted: false, never a hard 404,
        # so the client's offline delete queue can retry safely. The community
        # menu (PubCommunityData) is deliberately left untouched — the price was
        # real community data and stays.
        return _idempotent_delete(
            DrinkLog.objects.filter(account=request.user, client_id=client_id),
            scope="drinks",
            key_label="drink",
            key_value=client_id,
        )

    @staticmethod
    def _merge_into_community(
        cache_key: str,
        data: dict,
        beer: dict,
        account: Account,
        *,
        match_cache: BeerCatalogMatchCache | None = None,
    ) -> bool:
        """Merge the drunk beer into PubCommunityData.beers for ``cache_key``.

        Returns whether the community menu was changed. NEVER touches hours.

        Three cases:
          * No row for the cell → create one holding just this beer (mirrors how
            PubCommunityView seeds a row), menu_updated = True.
          * Row exists and names_match(row.name, posted name) → merge the beer
            (update price of a same name+volume entry, else append if room).
          * Row exists but names_match fails (different business in the same
            ~38 m cell) → skip the merge, leave the menu untouched.
        """
        now = dj_timezone.now()
        row = PubCommunityData.objects.select_for_update().filter(cache_key=cache_key).first()

        if row is None:
            try:
                # Nested atomic gives this INSERT its own savepoint. If a concurrent
                # first-drink wins the unique cache_key race, the savepoint rolls back
                # cleanly and the outer DrinkLog transaction can still continue.
                with transaction.atomic():
                    PubCommunityData.objects.create(
                        cache_key=cache_key,
                        name=data["name"],
                        lat=data["lat"],
                        lng=data["lng"],
                        city=data.get("city") or None,
                        external_id=data.get("external_id") or None,
                        account=account,
                        beers=[
                            {
                                "name": beer["name"],
                                "price_czk": beer["price_czk"],
                                "volume_ml": beer.get("volume_ml"),
                            }
                        ],
                        beers_updated_at=now,
                    )
                upsert_pub_beer_brand(
                    cache_key=cache_key,
                    data=data,
                    beer=beer,
                    source=PubBeerBrand.Source.DRINK,
                    account=account,
                    match_cache=match_cache,
                )
                return True
            except IntegrityError:
                # A concurrent first-drink for this brand-new cell won the race and
                # already created the row (cache_key is unique). Re-fetch it and
                # fall through to the names_match + merge path instead of letting
                # the IntegrityError bubble up as a 500 (which would commit our
                # DrinkLog but silently drop this beer from the menu). The merge
                # below is still guarded by names_match against whatever business
                # the winner seeded.
                row = (
                    PubCommunityData.objects.select_for_update()
                    .filter(cache_key=cache_key)
                    .first()
                )
                if row is None:
                    # The winner's row vanished between INSERT-fail and re-SELECT
                    # (deleted concurrently) — nothing to merge into.
                    return False

        # Collision guard: a different business sharing this geohash cell must not
        # inherit the menu (same gate as the read path).
        if not names_match(row.name, data["name"]):
            return False

        beers = list(row.beers or [])
        changed = _merge_drink_into_menu(beers, beer)
        if changed:
            row.beers = beers
            row.beers_updated_at = now
            # Refresh the most-recent-contributor pointer; never touch hours.
            row.account = account
            row.save(update_fields=["beers", "beers_updated_at", "account", "updated_at"])
        upsert_pub_beer_brand(
            cache_key=cache_key,
            data=data,
            beer=beer,
            source=PubBeerBrand.Source.DRINK,
            account=account,
            match_cache=match_cache,
        )
        return changed

    @staticmethod
    def _community_has_signal(
        cache_key: str,
        *,
        brand_key: str | None = None,
        product_key: str | None = None,
        match_cache: BeerCatalogMatchCache | None = None,
    ) -> bool:
        """True if the pub's community menu names a beer matching the supplied
        brand_key or product_key (exactly one is passed by callers)."""
        row = PubCommunityData.objects.filter(cache_key=cache_key).first()
        if row is None:
            return False
        for beer in row.beers or []:
            match = match_beer_brand(str(beer.get("name") or ""), match_cache=match_cache)
            if match is None:
                continue
            if brand_key is not None and match.brand.key == brand_key:
                return True
            if (
                product_key is not None
                and match.product is not None
                and match.product.key == product_key
            ):
                return True
        return False

    @staticmethod
    def _refresh_drink_brand_indexes_after_patch(
        *,
        drink: DrinkLog,
        old_brand_key: str,
        old_product_key: str,
        account: Account,
        match_cache: BeerCatalogMatchCache | None = None,
    ) -> None:
        data = {
            "name": drink.name,
            "lat": drink.lat,
            "lng": drink.lng,
            "city": drink.city,
            "external_id": drink.external_id,
        }
        beer = {
            "name": drink.beer_name,
            "price_czk": drink.price_czk,
            "volume_ml": drink.volume_ml,
        }
        upsert_pub_beer_brand(
            cache_key=drink.cache_key,
            data=data,
            beer=beer,
            source=PubBeerBrand.Source.DRINK,
            account=account,
            match_cache=match_cache,
        )

        if old_brand_key and old_brand_key != drink.beer_brand_key:
            has_other_drink = DrinkLog.objects.filter(
                cache_key=drink.cache_key,
                beer_brand_key=old_brand_key,
            ).exists()
            if not has_other_drink and not DrinksView._community_has_signal(
                drink.cache_key,
                brand_key=old_brand_key,
                match_cache=match_cache,
            ):
                PubBeerBrand.objects.filter(
                    cache_key=drink.cache_key,
                    brand_key=old_brand_key,
                    active=True,
                ).update(active=False, last_seen_at=dj_timezone.now())

        if old_product_key and old_product_key != drink.beer_product_key:
            has_other_product = DrinkLog.objects.filter(
                cache_key=drink.cache_key,
                beer_product_key=old_product_key,
            ).exists()
            if not has_other_product and not DrinksView._community_has_signal(
                drink.cache_key,
                product_key=old_product_key,
                match_cache=match_cache,
            ):
                PubBeerProduct.objects.filter(
                    cache_key=drink.cache_key,
                    product_key=old_product_key,
                    active=True,
                ).update(active=False, last_seen_at=dj_timezone.now())


class FeedbackView(APIView):
    """
    POST /v1/feedback

    Save in-app feedback / a bug report from the mobile app. Keyed by
    (account, client_id): the client generates a UUID per submission and re-POSTs
    it verbatim on offline retries, so the same client_id updates the existing row
    instead of duplicating it. Returns 201 when created, 200 when an existing row
    was updated. Throttled per-IP (scope "feedback").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback"

    def post(self, request: Request) -> Response:
        serializer = FeedbackRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data

        try:
            report, created = FeedbackReport.objects.update_or_create(
                account=request.user,
                client_id=data["client_id"],
                defaults={
                    "category": data["category"],
                    "message": data["message"],
                    "contact_type": data.get("contact_type") or "",
                    "contact": data.get("contact") or "",
                    "app_version": data.get("app_version") or "",
                    "platform": data.get("platform") or "",
                    "os_version": data.get("os_version") or "",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "feedback: unexpected error saving feedback %r: %s",
                data.get("client_id"),
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(
            FeedbackReportSerializer(report).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ContentReportView(APIView):
    """
    POST /v1/content-reports

    Save a report for inappropriate public profile content. The report captures a
    small target snapshot so moderation still has context if the user changes
    their nickname/avatar before the admin reviews it.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback"

    def post(self, request: Request) -> Response:
        serializer = ContentReportRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        target = Account.objects.filter(
            public_id=data["target_account_id"],
            status=Account.Status.ACTIVE,
        ).first()
        # A profile the reporter can actually see can be reported: a public
        # profile, or a non-public one they share a friendship with. "Share a
        # friendship" includes a still-pending request in either direction, not
        # just accepted ones: the friends dashboard shows the requester's profile
        # in its incoming/outgoing request lists, so an abusive private account
        # that has only sent a request must stay reportable.
        can_report = target is not None and (
            target.is_public
            or Friendship.objects.filter(
                Q(requester=request.user, recipient=target)
                | Q(requester=target, recipient=request.user),
                status__in=(Friendship.Status.ACCEPTED, Friendship.Status.PENDING),
            ).exists()
        )
        if not can_report:
            return Response(
                {"detail": "Profile not found.", "code": "profile_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if target.pk == request.user.pk:
            return Response(
                {"detail": "Nelze nahlásit vlastní profil.", "code": "self_report"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        snapshot = {
            "id": str(target.public_id),
            "nickname": target.nickname,
            "display_name": target.display_name,
            "has_avatar": bool(target.avatar),
            "is_public": target.is_public,
        }
        report = ContentReport.objects.create(
            reporter=request.user,
            target_account=target,
            reason=data["reason"],
            comment=data.get("comment") or "",
            target_snapshot=snapshot,
        )
        return Response(ContentReportSerializer(report).data, status=status.HTTP_201_CREATED)


def _rating_item(rating: PubRating) -> dict:
    """Serialize one PubRating to the wire shape the mobile app expects.

    An empty verdict ("") is exposed as null, and updated_at is the client's
    last-write-wins timestamp (client_updated_at), not the server's updated_at.
    """
    return {
        "cache_key": rating.cache_key,
        "name": rating.name,
        "lat": rating.lat,
        "lng": rating.lng,
        "external_id": rating.external_id,
        "verdict": rating.verdict or None,
        "tag": rating.tag,
        "note": rating.note,
        "updated_at": rating.client_updated_at.isoformat(),
    }


class PubRatingView(APIView):
    """
    PUT    /v1/pub-ratings            → upsert one private rating
    GET    /v1/pub-ratings            → list all ratings of the account
    DELETE /v1/pub-ratings/<cache_key> → idempotent delete by geohash-8 key

    Two-way sync of a user's private per-pub ratings (thumbs verdict + optional
    tag + free-text note), keyed by the geohash-8 ``cache_key`` computed
    server-side from lat/lng. Conflict resolution is LAST-WRITE-WINS on the
    client's ``updated_at``: a PUT older than the stored client_updated_at is
    ignored (``applied: false``). An empty rating (no verdict, tag, or note)
    deletes any existing row. GET returns every rating so a fresh install can
    restore. Throttled per-IP (scope "pub_ratings").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_ratings"

    def get(self, request: Request) -> Response:
        try:
            ratings = PubRating.objects.filter(account=request.user)
            items = [_rating_item(rating) for rating in ratings]
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-ratings: unexpected error listing ratings: %s", exc, exc_info=True)
            return _internal_error()
        return Response({"ratings": items}, status=status.HTTP_200_OK)

    def put(self, request: Request) -> Response:
        serializer = PubRatingRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])
        # Normalise the optional signal fields to "" (the model's blank default).
        verdict = data.get("verdict") or ""
        tag = (data.get("tag") or "").strip()
        note = (data.get("note") or "").strip()
        updated_at = data["updated_at"]

        try:
            with transaction.atomic():
                existing = (
                    PubRating.objects.select_for_update()
                    .filter(account=request.user, cache_key=cache_key)
                    .first()
                )
                # Last-write-wins: a stale write (older than what we already have)
                # is ignored — return the existing row with applied: false.
                if existing is not None and existing.client_updated_at > updated_at:
                    body = _rating_item(existing)
                    body["applied"] = False
                    return Response(body, status=status.HTTP_200_OK)

                # No signal at all → this is a clear/delete, guarded by the same
                # last-write-wins timestamp as normal upserts.
                if not verdict and not tag and not note:
                    if existing is not None:
                        existing.delete()
                    return Response(
                        {"deleted": existing is not None, "applied": True},
                        status=status.HTTP_200_OK,
                    )

                rating, _ = PubRating.objects.update_or_create(
                    account=request.user,
                    cache_key=cache_key,
                    defaults={
                        "name": data.get("name") or "",
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "external_id": data.get("external_id") or "",
                        "verdict": verdict,
                        "tag": tag,
                        "note": note,
                        "client_updated_at": updated_at,
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-ratings: unexpected error saving rating for cache key %s: %s",
                cache_key,
                exc,
                exc_info=True,
            )
            return _internal_error()

        body = _rating_item(rating)
        body["applied"] = True
        return Response(body, status=status.HTTP_200_OK)

    def delete(self, request: Request, cache_key: str) -> Response:
        # Idempotent delete: the account filter means a cache_key belonging to
        # another account (or never rated, or already deleted) matches nothing →
        # deleted: false, never a hard 404, so the client can retry safely.
        return _idempotent_delete(
            PubRating.objects.filter(account=request.user, cache_key=cache_key),
            scope="pub-ratings",
            key_label="rating",
            key_value=cache_key,
        )


def _visit_item(visit: PubVisit) -> dict:
    """Serialize one PubVisit to the wire shape the mobile app expects."""
    return {
        "client_id": str(visit.client_id),
        "cache_key": visit.cache_key,
        "name": visit.name,
        "lat": visit.lat,
        "lng": visit.lng,
        "city": visit.city,
        "external_id": visit.external_id,
        "started_at": visit.started_at.isoformat(),
        "ended_at": visit.ended_at.isoformat() if visit.ended_at else None,
        "updated_at": visit.client_updated_at.isoformat(),
    }


class PubVisitView(APIView):
    """
    POST   /v1/pub-visits              → push one explicit visit (upsert)
    GET    /v1/pub-visits              → list all visits of the account
    DELETE /v1/pub-visits/<client_id>  → idempotent delete by client_id

    Records that the user spent an evening at a pub even when no beer was
    counted. Idempotent on (account, client_id): a re-POST (offline retry, or a
    later POST filling in ``ended_at``) updates the same row. ``cache_key`` is
    the geohash-8 cell computed server-side. Throttled per-IP (scope
    "pub_visits").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_visits"

    def get(self, request: Request) -> Response:
        try:
            visits = PubVisit.objects.filter(account=request.user)
            items = [_visit_item(visit) for visit in visits]
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-visits: unexpected error listing visits: %s", exc, exc_info=True)
            return _internal_error()
        return Response({"visits": items}, status=status.HTTP_200_OK)

    def post(self, request: Request) -> Response:
        serializer = PubVisitRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        cache_key = geohash8(data["lat"], data["lng"])

        try:
            with transaction.atomic():
                existing = (
                    PubVisit.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                if existing is not None and existing.client_updated_at > data["updated_at"]:
                    return Response(
                        {
                            "accepted": True,
                            "duplicate": True,
                            "cache_key": existing.cache_key,
                            "applied": False,
                        },
                        status=status.HTTP_200_OK,
                    )

                _, created = PubVisit.objects.update_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults={
                        "cache_key": cache_key,
                        "name": data["name"],
                        "lat": data["lat"],
                        "lng": data["lng"],
                        "city": data.get("city") or "",
                        "external_id": data.get("external_id") or "",
                        "started_at": data["started_at"],
                        "ended_at": data.get("ended_at"),
                        "client_updated_at": data["updated_at"],
                    },
                )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-visits: unexpected error saving visit %r: %s",
                data.get("client_id"),
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response(
            {
                "accepted": True,
                "duplicate": not created,
                "cache_key": cache_key,
                "applied": True,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request: Request, client_id) -> Response:
        # Idempotent delete scoped to the account (a foreign / missing / already
        # deleted client_id matches nothing → deleted: false, never a 404).
        return _idempotent_delete(
            PubVisit.objects.filter(account=request.user, client_id=client_id),
            scope="pub-visits",
            key_label="visit",
            key_value=client_id,
        )


def _account_from_request(request: Request) -> Account | None:
    user = getattr(request, "user", None)
    return user if isinstance(user, Account) else None


def _update_usage_stats(event: ClientEvent) -> None:
    """Fold one authenticated client event into per-account usage counters."""

    if event.account_id is None:
        return

    now = event.created_at or dj_timezone.now()
    stats, _ = AccountUsageStats.objects.get_or_create(account=event.account)

    update_fields: dict[str, object] = {
        "last_event_at": now,
    }
    if event.app_version:
        update_fields["last_app_version"] = event.app_version
    if event.platform:
        update_fields["last_platform"] = event.platform
    if event.os_version:
        update_fields["last_os_version"] = event.os_version

    if event.event == ClientEvent.Event.APP_OPEN:
        update_fields["app_open_count"] = F("app_open_count") + 1
        update_fields["last_app_open_at"] = now
    elif event.event == ClientEvent.Event.APP_FOREGROUND:
        update_fields["app_foreground_count"] = F("app_foreground_count") + 1
    elif event.event == ClientEvent.Event.WALKING_DISTANCE:
        distance_m = int(event.context.get("distance_m") or 0)
        if distance_m > 0:
            update_fields["walked_distance_m"] = F("walked_distance_m") + distance_m

    if event.event == ClientEvent.Event.API_FAILURE:
        update_fields["api_failure_count"] = F("api_failure_count") + 1

    if event.severity == ClientEvent.Severity.WARNING:
        update_fields["client_warning_count"] = F("client_warning_count") + 1
    elif event.severity == ClientEvent.Severity.ERROR:
        update_fields["client_error_count"] = F("client_error_count") + 1

    AccountUsageStats.objects.filter(pk=stats.pk).update(**update_fields)


class ClientEventsView(APIView):
    """
    POST /v1/client-events

    Accept one sanitized app observability event. Auth is optional: events with a
    valid account token are linked to the anonymous account and folded into
    AccountUsageStats; unauthenticated events are still useful for aggregate
    diagnostics but cannot affect per-account leaderboards.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "client_events"

    def post(self, request: Request) -> Response:
        serializer = ClientEventRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        account = _account_from_request(request)

        try:
            event = ClientEvent.objects.create(
                account=account,
                event=data["event"],
                severity=data["severity"],
                message=data.get("message") or "",
                context=data.get("context") or {},
                app_version=data.get("app_version") or "",
                platform=data.get("platform") or "",
                os_version=data.get("os_version") or "",
            )
            _update_usage_stats(event)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "client-events: unexpected error saving %r: %s",
                data.get("event"),
                exc,
                exc_info=True,
            )
            return _internal_error()

        logger.info(
            "client event accepted",
            extra={
                "event": "client_event",
                "observability": {
                    "client_event": event.event,
                    "severity": event.severity,
                    "account_id": str(account.public_id) if account else "",
                    "app_version": event.app_version,
                    "platform": event.platform,
                },
            },
        )
        return Response({"accepted": True}, status=status.HTTP_202_ACCEPTED)


class PushDeviceView(APIView):
    """
    PUT/DELETE /v1/push-device

    Register or disable this install's Expo push token. The endpoint stores no
    coordinates, pub identity or notification history; reminder decisions stay
    local on the mobile device.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "push_devices"

    def put(self, request: Request) -> Response:
        serializer = PushDeviceRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        try:
            device, _created = PushDevice.objects.update_or_create(
                push_token=data["push_token"],
                defaults={
                    "account": request.user,
                    "platform": data["platform"],
                    "permission_status": data["permission_status"],
                    "enabled": data["enabled"],
                    "app_version": data.get("app_version") or "",
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "push-device: unexpected error registering token",
                extra={"observability": {"error": exc.__class__.__name__}},
            )
            return _internal_error()

        return Response(PushDeviceResponseSerializer(device).data, status=status.HTTP_200_OK)

    def delete(self, request: Request) -> Response:
        serializer = PushDeviceDeleteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        push_token = serializer.validated_data["push_token"]
        queryset = PushDevice.objects.filter(
            account=request.user,
            enabled=True,
            push_token=push_token,
        )

        try:
            disabled = queryset.update(
                enabled=False,
                permission_status=PushDevice.PermissionStatus.DENIED,
                updated_at=dj_timezone.now(),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "push-device: unexpected error disabling token",
                extra={"observability": {"error": exc.__class__.__name__}},
            )
            return _internal_error()

        return Response({"disabled": disabled}, status=status.HTTP_200_OK)


def _friend_activity_slices(request, friend_ids, now, activity_context) -> dict:
    """Serialized live + plan activity slices shared by the dashboard and the poll.

    Returns ``active_friends`` / ``my_active_activity`` (kind=live) and ``plans`` /
    ``my_plan`` (kind=plan scheduled for the current Prague day). Callers pass
    ``friend_ids`` already stripped of blocked accounts. Live rows keep the exact
    meaning old clients expect (narrowed to kind=live is byte-identical for anyone
    without plans); plans live only in the new keys old clients ignore.
    """
    prefetches = _friend_activity_prefetches()
    day_start, day_end = _prague_today_bounds(now)

    active = (
        _apply_friend_activity_visibility(
            FriendPubActivity.objects.filter(
                account_id__in=friend_ids,
                active=True,
                expires_at__gt=now,
                kind=FriendPubActivity.Kind.LIVE,
                account__status=Account.Status.ACTIVE,
            ),
            request.user,
        )
        # A friend who toggles ghost mode vanishes from everyone else's feed
        # immediately (their own broadcast row is kept for their own view).
        .exclude(account__ghost_mode=True)
        .select_related("account")
        .prefetch_related(*prefetches)
        .order_by("-started_at")[:20]
    )
    my_active_activity = (
        FriendPubActivity.objects.filter(
            account=request.user,
            active=True,
            expires_at__gt=now,
            kind=FriendPubActivity.Kind.LIVE,
        )
        .select_related("account")
        .prefetch_related(*prefetches)
        .order_by("-started_at")
        .first()
    )
    plans = (
        _apply_friend_activity_visibility(
            FriendPubActivity.objects.filter(
                account_id__in=friend_ids,
                active=True,
                kind=FriendPubActivity.Kind.PLAN,
                scheduled_for__gte=day_start,
                scheduled_for__lt=day_end,
                account__status=Account.Status.ACTIVE,
            ),
            request.user,
        )
        .exclude(account__ghost_mode=True)
        .select_related("account")
        .prefetch_related(*prefetches)
        .order_by("scheduled_for")[:20]
    )
    my_plan = (
        FriendPubActivity.objects.filter(
            account=request.user,
            active=True,
            kind=FriendPubActivity.Kind.PLAN,
            scheduled_for__gte=day_start,
            scheduled_for__lt=day_end,
        )
        .select_related("account")
        .prefetch_related(*prefetches)
        .order_by("scheduled_for")
        .first()
    )
    return {
        "active_friends": FriendPubActivitySerializer(
            active, many=True, context=activity_context
        ).data,
        "my_active_activity": (
            FriendPubActivitySerializer(my_active_activity, context=activity_context).data
            if my_active_activity is not None
            else None
        ),
        "plans": FriendPubActivitySerializer(plans, many=True, context=activity_context).data,
        "my_plan": (
            FriendPubActivitySerializer(my_plan, context=activity_context).data
            if my_plan is not None
            else None
        ),
    }


class FriendsView(APIView):
    """
    GET /v1/friends

    Social dashboard payload: accepted friends, incoming/outgoing requests,
    active friend pub statuses (kind=live), today's plans (kind=plan) and recent
    in-app notifications. Blocked accounts (either direction) are excluded from
    every list. Reads use the separate ``friends_dashboard`` throttle budget so
    the bounded live poll never starves the friend write budget.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        now = dj_timezone.now()
        context = _friend_profile_context(request)
        blocked_ids = _blocked_account_ids(request.user)
        activity_context = _friend_activity_context(request, blocked_ids)

        friendships = (
            Friendship.objects.filter(Q(requester=request.user) | Q(recipient=request.user))
            .select_related("requester", "recipient")
            .order_by("-updated_at")
        )

        def _other(row):
            return row.recipient if row.requester_id == request.user.id else row.requester

        accepted = [
            row
            for row in friendships
            if row.status == Friendship.Status.ACCEPTED
            and _is_active_account(_other(row))
            and _other(row).id not in blocked_ids
        ]
        incoming = [
            row
            for row in friendships
            if row.status == Friendship.Status.PENDING and row.recipient_id == request.user.id
            and _is_active_account(row.requester)
            and row.requester_id not in blocked_ids
        ]
        outgoing = [
            row
            for row in friendships
            if row.status == Friendship.Status.PENDING and row.requester_id == request.user.id
            and _is_active_account(row.recipient)
            and row.recipient_id not in blocked_ids
        ]

        friend_accounts = [_other(row) for row in accepted]
        friend_ids = [account.id for account in friend_accounts]
        shared_stats, shared_dates = _shared_pub_stats(request.user, friend_ids)
        slices = _friend_activity_slices(request, friend_ids, now, activity_context)

        notification_base = (
            FriendNotification.objects.filter(recipient=request.user)
            .filter(
                Q(actor__isnull=True)
                | Q(actor__status=Account.Status.ACTIVE, actor__ghost_mode=False)
            )
            .filter(
                Q(activity__isnull=True)
                | Q(activity__account=request.user)
                | Q(
                    activity__account__status=Account.Status.ACTIVE,
                    activity__account__ghost_mode=False,
                )
            )
            .exclude(actor_id__in=blocked_ids)
        )
        notifications = (
            notification_base
            .select_related("actor", "friendship", "activity", "activity__account")
            .order_by("-created_at")[:30]
        )
        unread_count = notification_base.filter(read_at__isnull=True).count()

        streak = _party_streak(shared_dates)
        leaderboard = self._build_leaderboard(
            request, friend_accounts, shared_stats, now, context
        )

        return Response(
            {
                "friends": FriendProfileSerializer(friend_accounts, many=True, context=context).data,
                "friend_stats": {
                    str(account.public_id): _friend_stats_item(shared_stats.get(account.id, {}))
                    for account in friend_accounts
                },
                "incoming_requests": FriendshipSerializer(incoming, many=True, context=context).data,
                "outgoing_requests": FriendshipSerializer(outgoing, many=True, context=context).data,
                "active_friends": slices["active_friends"],
                "my_active_activity": slices["my_active_activity"],
                "plans": slices["plans"],
                "my_plan": slices["my_plan"],
                "notifications": FriendNotificationSerializer(notifications, many=True, context=context).data,
                "unread_count": unread_count,
                "settings": _friend_settings_payload(request.user),
                "streak": streak,
                "leaderboard": leaderboard,
                "blocked_ids": [
                    str(public_id)
                    for public_id in FriendBlock.objects.filter(blocker=request.user)
                    .values_list("blocked__public_id", flat=True)
                ],
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _build_leaderboard(
        request: Request,
        friend_accounts: list,
        shared_stats: dict,
        now,
        context: dict,
    ) -> list[dict]:
        """Party leaderboard: me + accepted friends ranked by 30-day pub visits.

        Excludes accounts pending deletion. Visits come from ONE grouped query;
        ``shared_count`` is the shared-evening tally with me (0 for myself).
        Sorted desc by visits_30d, then shared_count.
        """
        members = [request.user] + [
            account
            for account in friend_accounts
            if account.status != Account.Status.PENDING_DELETION
        ]
        member_ids = [account.id for account in members]
        visit_rows = (
            PubVisit.objects.filter(
                account_id__in=member_ids,
                started_at__gte=now - LEADERBOARD_WINDOW,
            )
            .values("account_id")
            .annotate(c=Count("id"))
        )
        visits_by_account = {row["account_id"]: row["c"] for row in visit_rows}

        entries = []
        for account in members:
            is_me = account.id == request.user.id
            entries.append(
                {
                    "account": FriendProfileSerializer(account, context=context).data,
                    "visits_30d": int(visits_by_account.get(account.id, 0)),
                    "shared_count": 0
                    if is_me
                    else int(shared_stats.get(account.id, {}).get("shared_count") or 0),
                    "is_me": is_me,
                }
            )
        entries.sort(key=lambda e: (e["visits_30d"], e["shared_count"]), reverse=True)
        return entries


class FriendsLiveView(APIView):
    """
    GET /v1/friends/live

    Cheap poll slice backing the bounded 30–45s live poll: just the live/plan
    activity slices plus lightweight counts, with none of the dashboard's
    365-day shared-stats scan or leaderboard query. Uses the ``friends_dashboard``
    throttle budget. Old backends 404 this, so the client falls back to the full
    dashboard.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        now = dj_timezone.now()
        blocked_ids = _blocked_account_ids(request.user)
        activity_context = _friend_activity_context(request, blocked_ids)

        friend_ids = [
            fid for fid in _accepted_friend_ids(request.user) if fid not in blocked_ids
        ]
        slices = _friend_activity_slices(request, friend_ids, now, activity_context)

        incoming_count = (
            Friendship.objects.filter(
                recipient=request.user,
                status=Friendship.Status.PENDING,
                requester__status=Account.Status.ACTIVE,
            )
            .exclude(requester_id__in=blocked_ids)
            .count()
        )
        unread_count = (
            FriendNotification.objects.filter(recipient=request.user, read_at__isnull=True)
            .filter(
                Q(actor__isnull=True)
                | Q(actor__status=Account.Status.ACTIVE, actor__ghost_mode=False)
            )
            .filter(
                Q(activity__isnull=True)
                | Q(activity__account=request.user)
                | Q(
                    activity__account__status=Account.Status.ACTIVE,
                    activity__account__ghost_mode=False,
                )
            )
            .exclude(actor_id__in=blocked_ids)
            .count()
        )

        return Response(
            {
                "active_friends": slices["active_friends"],
                "my_active_activity": slices["my_active_activity"],
                "plans": slices["plans"],
                "my_plan": slices["my_plan"],
                "incoming_count": incoming_count,
                "unread_count": unread_count,
                "server_time": now.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class FriendSearchView(APIView):
    """GET /v1/friends/search?q=nick — public profile lookup for adding friends."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        serializer = FriendSearchQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        q = serializer.validated_data["q"]
        profiles = (
            Account.objects.filter(
                status=Account.Status.ACTIVE,
                is_public=True,
            )
            .exclude(pk=request.user.pk)
            # A block (either direction) hides both parties from search.
            .exclude(pk__in=_blocked_account_ids(request.user))
            .filter(Q(nickname__icontains=q) | Q(display_name__icontains=q))
            .order_by("nickname", "display_name")[:20]
        )
        return Response(
            {
                "results": FriendProfileSerializer(
                    profiles,
                    many=True,
                    context=_friend_profile_context(request),
                ).data
            },
            status=status.HTTP_200_OK,
        )


class FriendRequestView(APIView):
    """POST /v1/friends/requests — send a friend request by id, nickname or invite code."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        serializer = FriendRequestCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        now = dj_timezone.now()
        target_query = Account.objects.filter(status=Account.Status.ACTIVE)

        # An invite code is the QR / deep-link growth path: it carries no PII, so
        # the inviter is resolved server-side and the is_public gate is bypassed
        # (minting a code IS explicit consent to be added).
        via_invite = bool(data.get("invite_code"))
        if via_invite:
            code_row = (
                FriendInviteCode.objects.select_related("account")
                .filter(code=data["invite_code"])
                .first()
            )
            if code_row is None:
                return Response(
                    {"detail": "Pozvánku neznám.", "code": "invite_invalid"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if code_row.revoked or code_row.expires_at <= now:
                return Response(
                    {"detail": "Pozvánka už vypršela.", "code": "invite_expired"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            target = code_row.account if _is_active_account(code_row.account) else None
            if target is None:
                return Response(
                    {"detail": "Pozvánku neznám.", "code": "invite_invalid"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        elif data.get("target_account_id"):
            target = target_query.filter(public_id=data["target_account_id"]).first()
        else:
            target = target_query.filter(nickname__iexact=data["nickname"]).first()

        # A block in either direction hides the target completely.
        if target is not None and target.pk in _blocked_account_ids(request.user):
            target = None

        if not via_invite and (
            target is None
            or (not target.is_public and target.pk not in _accepted_friend_ids(request.user))
        ):
            return Response(
                {"detail": "Profil se nepodařilo najít.", "code": "profile_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if via_invite and target is None:
            return Response(
                {"detail": "Profil se nepodařilo najít.", "code": "profile_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if target.pk == request.user.pk:
            return Response(
                {"detail": "Sám sobě žádost neposílej. To by bylo moc smutné.", "code": "self_request"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                # Serialize both A→B and B→A attempts through the same account
                # locks so two simultaneous requests cannot create mirrored rows.
                list(
                    Account.objects.select_for_update()
                    .filter(pk__in=sorted([request.user.pk, target.pk]))
                    .values_list("pk", flat=True)
                )
                reverse = (
                    Friendship.objects.select_for_update()
                    .filter(requester=target, recipient=request.user)
                    .first()
                )
                if reverse is not None:
                    if reverse.status != Friendship.Status.ACCEPTED:
                        reverse.status = Friendship.Status.ACCEPTED
                        reverse.responded_at = now
                        reverse.save(update_fields=["status", "responded_at", "updated_at"])
                        title = "Žádost přijata"
                        body = f"{_friend_display_name(request.user)} si tě přidal mezi kamarády."
                        _create_friend_notification(
                            recipient=target,
                            actor=request.user,
                            kind=FriendNotification.Kind.FRIEND_ACCEPTED,
                            title=title,
                            body=body,
                            friendship=reverse,
                        )
                        _send_friend_push(
                            [target.id],
                            title,
                            body,
                            {"kind": "friend_accepted", "friendship_id": str(reverse.public_id)},
                        )
                    return Response(
                        FriendshipSerializer(reverse, context=_friend_profile_context(request)).data,
                        status=status.HTTP_200_OK,
                    )

                friendship, created = Friendship.objects.select_for_update().get_or_create(
                    requester=request.user,
                    recipient=target,
                    defaults={"status": Friendship.Status.PENDING},
                )
                if not created and friendship.status == Friendship.Status.DECLINED:
                    # Anti-harassment: a declined request may NOT silently re-open
                    # (and re-notify the decliner) during the cooldown window. We
                    # return 2xx (so old apps show "sent") but leave the row
                    # DECLINED and add cooldown_until for new clients; only after
                    # the window does it flip back to PENDING and notify afresh.
                    cooldown = timedelta(days=settings.FRIEND_DECLINE_COOLDOWN_DAYS)
                    responded_at = friendship.responded_at
                    if responded_at is not None and now - responded_at < cooldown:
                        payload = FriendshipSerializer(
                            friendship, context=_friend_profile_context(request)
                        ).data
                        payload["cooldown_until"] = (responded_at + cooldown).isoformat()
                        return Response(payload, status=status.HTTP_200_OK)
                    friendship.status = Friendship.Status.PENDING
                    friendship.responded_at = None
                    friendship.save(update_fields=["status", "responded_at", "updated_at"])
                    created = True
                if friendship.status == Friendship.Status.ACCEPTED:
                    return Response(
                        FriendshipSerializer(friendship, context=_friend_profile_context(request)).data,
                        status=status.HTTP_200_OK,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: request create failed: %s", exc, exc_info=True)
            return _internal_error()

        if created:
            title = "Nový kámoš na pivo?"
            body = f"{_friend_display_name(request.user)} si tě chce přidat mezi kamarády."
            _create_friend_notification(
                recipient=target,
                actor=request.user,
                kind=FriendNotification.Kind.FRIEND_REQUEST,
                title=title,
                body=body,
                friendship=friendship,
            )
            _send_friend_push(
                [target.id],
                title,
                body,
                {"kind": "friend_request", "friendship_id": str(friendship.public_id)},
            )

        return Response(
            FriendshipSerializer(friendship, context=_friend_profile_context(request)).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FriendRequestActionView(APIView):
    """POST /v1/friends/requests/<id>/accept|decline."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request, request_id, action: str) -> Response:
        friendship = (
            Friendship.objects.select_related("requester", "recipient")
            .filter(public_id=request_id, recipient=request.user)
            .first()
        )
        if friendship is None:
            return Response(
                {"detail": "Žádost neexistuje.", "code": "request_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if action not in {"accept", "decline"}:
            return Response(
                {"detail": "Neznámá akce.", "code": "unknown_action"},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = dj_timezone.now()
        if action == "accept":
            created_notification = friendship.status != Friendship.Status.ACCEPTED
            friendship.status = Friendship.Status.ACCEPTED
            friendship.responded_at = friendship.responded_at or now
            friendship.save(update_fields=["status", "responded_at", "updated_at"])
            if created_notification:
                title = "Jde se na pivo"
                body = f"{_friend_display_name(request.user)} přijal tvoji žádost."
                _create_friend_notification(
                    recipient=friendship.requester,
                    actor=request.user,
                    kind=FriendNotification.Kind.FRIEND_ACCEPTED,
                    title=title,
                    body=body,
                    friendship=friendship,
                )
                _send_friend_push(
                    [friendship.requester_id],
                    title,
                    body,
                    {"kind": "friend_accepted", "friendship_id": str(friendship.public_id)},
                )
        else:
            friendship.status = Friendship.Status.DECLINED
            friendship.responded_at = now
            friendship.save(update_fields=["status", "responded_at", "updated_at"])

        return Response(
            FriendshipSerializer(friendship, context=_friend_profile_context(request)).data,
            status=status.HTTP_200_OK,
        )


class FriendDetailView(APIView):
    """GET/DELETE /v1/friends/<account_id> — friend profile / remove friend or cancel invite."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request, account_id) -> Response:
        now = dj_timezone.now()
        friend = Account.objects.filter(
            public_id=account_id, status=Account.Status.ACTIVE
        ).first()
        blocked_ids = _blocked_account_ids(request.user)
        friendship = None
        if friend is not None and friend.id not in blocked_ids:
            friendship = (
                Friendship.objects.filter(status=Friendship.Status.ACCEPTED)
                .filter(
                    Q(requester=request.user, recipient=friend)
                    | Q(requester=friend, recipient=request.user)
                )
                .first()
            )
        if friend is None or friendship is None:
            return Response(
                {"detail": "Tenhle kámoš tu není.", "code": "friend_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        context = _friend_profile_context(request)
        activity_context = _friend_activity_context(request)
        prefetches = _friend_activity_prefetches()

        shared_evenings, shared_dates = _single_friend_shared(request.user, friend)
        shared_count = len(shared_evenings)
        last = shared_evenings[0] if shared_evenings else None
        streak = _party_streak(shared_dates)

        live_activity = (
            _apply_friend_activity_visibility(
                FriendPubActivity.objects.filter(
                    account=friend,
                    active=True,
                    expires_at__gt=now,
                    kind=FriendPubActivity.Kind.LIVE,
                    account__ghost_mode=False,
                ),
                request.user,
            )
            .select_related("account")
            .prefetch_related(*prefetches)
            .order_by("-started_at")
            .first()
        )
        day_start, day_end = _prague_today_bounds(now)
        plan = (
            _apply_friend_activity_visibility(
                FriendPubActivity.objects.filter(
                    account=friend,
                    active=True,
                    kind=FriendPubActivity.Kind.PLAN,
                    scheduled_for__gte=day_start,
                    scheduled_for__lt=day_end,
                    account__ghost_mode=False,
                ),
                request.user,
            )
            .select_related("account")
            .prefetch_related(*prefetches)
            .order_by("scheduled_for")
            .first()
        )
        latest_beers = (
            _beer_checkin_queryset()
            .filter(
                account=friend,
                visibility=BeerCheckIn.Visibility.FRIENDS,
                account__ghost_mode=False,
            )
            .order_by("-checked_in_at")[:5]
        )

        return Response(
            {
                "profile": FriendProfileSerializer(friend, context=context).data,
                "is_friend": True,
                "friendship_id": str(friendship.public_id),
                "stats": {
                    "shared_pub_count": shared_count,
                    "nights_together": shared_count,
                    "last_shared_at": last["at"].isoformat() if last else None,
                    "last_pub_name": last["pub_name"] if last else "",
                    "streak_weeks": int(streak.get("current_weeks", 0)),
                    "rituals": _friend_rituals(shared_count),
                },
                "live_activity": (
                    FriendPubActivitySerializer(live_activity, context=activity_context).data
                    if live_activity is not None
                    else None
                ),
                "plan": (
                    FriendPubActivitySerializer(plan, context=activity_context).data
                    if plan is not None
                    else None
                ),
                "recent_together": [
                    {
                        "pub_name": evening["pub_name"],
                        "cache_key": evening["cache_key"],
                        "at": evening["at"].isoformat(),
                    }
                    for evening in shared_evenings[:3]
                ],
                "latest_beers": BeerCheckInSerializer(
                    latest_beers,
                    many=True,
                    context=_beer_checkin_context(request),
                ).data,
                "blocked": FriendBlock.objects.filter(
                    blocker=request.user, blocked=friend
                ).exists(),
            },
            status=status.HTTP_200_OK,
        )

    def delete(self, request: Request, account_id) -> Response:
        friend = Account.objects.filter(public_id=account_id).first()
        if friend is None:
            return Response({"removed": False}, status=status.HTTP_200_OK)
        # Remove an accepted friendship (either direction) OR cancel an outgoing
        # pending request (requester=me). An incoming pending request is left
        # untouched — that is a decline, handled by the request-action endpoint.
        deleted, _ = Friendship.objects.filter(
            Q(
                status=Friendship.Status.ACCEPTED,
            )
            & (
                Q(requester=request.user, recipient=friend)
                | Q(requester=friend, recipient=request.user)
            )
            | Q(
                status=Friendship.Status.PENDING,
                requester=request.user,
                recipient=friend,
            )
        ).delete()
        return Response({"removed": deleted > 0}, status=status.HTTP_200_OK)


class FriendActivityView(APIView):
    """POST /v1/friends/pub-activity — share "I'm at this pub" to accepted friends."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        serializer = FriendActivityRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        now = dj_timezone.now()

        # A future scheduled_for makes this a `plan` (converted to live at that
        # time by the worker); absent or in the past keeps the exact live-now
        # behavior old clients rely on.
        scheduled_for = data.get("scheduled_for")
        is_plan = scheduled_for is not None and scheduled_for > now
        if is_plan:
            max_ahead = timedelta(hours=settings.FRIEND_PLAN_MAX_AHEAD_HOURS)
            if scheduled_for > now + max_ahead:
                return Response(
                    {"detail": "Plán je moc daleko. Zkus dřívější čas.", "code": "invalid_schedule"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kind = FriendPubActivity.Kind.PLAN
            started_at = scheduled_for
            expires_at = min(
                scheduled_for + FRIEND_ACTIVITY_DEFAULT_TTL,
                scheduled_for + FRIEND_ACTIVITY_MAX_TTL,
            )
        else:
            kind = FriendPubActivity.Kind.LIVE
            scheduled_for = None
            started_at = data.get("started_at") or now
            requested_expiry = data.get("expires_at")
            max_expiry = started_at + FRIEND_ACTIVITY_MAX_TTL
            expires_at = requested_expiry or started_at + FRIEND_ACTIVITY_DEFAULT_TTL
            if expires_at <= now:
                return Response(
                    {"detail": "expires_at must be in the future.", "code": "expired_activity"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if expires_at > max_expiry:
                expires_at = max_expiry

        cache_key = geohash8(data["lat"], data["lng"])
        requested_recipient_ids = data.get("recipient_ids")
        blocked_ids = _blocked_account_ids(request.user)
        friend_ids = _accepted_friend_ids(request.user)
        target_friend_ids = _requested_activity_recipient_ids(
            requested_recipient_ids,
            friend_ids=friend_ids,
            blocked_ids=blocked_ids,
        )
        if requested_recipient_ids is not None and not target_friend_ids:
            return Response(
                {"detail": "Vyber aspoň jednoho kámoše z party.", "code": "no_recipients"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        should_notify = False
        try:
            with transaction.atomic():
                existing = (
                    FriendPubActivity.objects.select_for_update()
                    .filter(account=request.user, client_id=data["client_id"])
                    .first()
                )
                # The single-active-row invariant is per-kind, so creating a plan
                # never kills my live broadcast (and vice-versa).
                current_active = (
                    FriendPubActivity.objects.select_for_update()
                    .filter(
                        account=request.user,
                        active=True,
                        expires_at__gt=now,
                        kind=kind,
                    )
                    .order_by("-started_at")
                    .first()
                )
                existing_is_live = (
                    existing is not None and existing.active and existing.expires_at > now
                )
                activity = existing if existing_is_live else current_active or existing
                previous_target_ids = (
                    list(
                        FriendPubActivityRecipient.objects.filter(
                            activity=activity
                        ).values_list("account_id", flat=True)
                    )
                    if activity is not None
                    else []
                )
                previous_target_signature = (
                    tuple(sorted(previous_target_ids)) if previous_target_ids else None
                )
                target_signature = (
                    tuple(sorted(target_friend_ids))
                    if requested_recipient_ids is not None
                    else None
                )
                should_notify = (
                    activity is None
                    or not activity.active
                    or activity.expires_at <= now
                    or activity.cache_key != cache_key
                    or previous_target_signature != target_signature
                )
                if activity is None:
                    activity = FriendPubActivity.objects.create(
                        account=request.user,
                        client_id=data["client_id"],
                        cache_key=cache_key,
                        name=data["name"],
                        lat=data["lat"],
                        lng=data["lng"],
                        city=data.get("city") or "",
                        external_id=data.get("external_id") or "",
                        message=data.get("message") or "",
                        kind=kind,
                        scheduled_for=scheduled_for,
                        started_at=started_at,
                        expires_at=expires_at,
                        active=True,
                    )
                else:
                    activity.client_id = data["client_id"]
                    activity.cache_key = cache_key
                    activity.name = data["name"]
                    activity.lat = data["lat"]
                    activity.lng = data["lng"]
                    activity.city = data.get("city") or ""
                    activity.external_id = data.get("external_id") or ""
                    activity.message = data.get("message") or ""
                    activity.kind = kind
                    activity.scheduled_for = scheduled_for
                    activity.started_at = started_at
                    activity.expires_at = expires_at
                    activity.active = True
                    activity.save(
                        update_fields=[
                            "client_id",
                            "cache_key",
                            "name",
                            "lat",
                            "lng",
                            "city",
                            "external_id",
                            "message",
                            "kind",
                            "scheduled_for",
                            "started_at",
                            "expires_at",
                            "active",
                            "updated_at",
                        ]
                    )

                FriendPubActivity.objects.filter(
                    account=request.user,
                    active=True,
                    expires_at__gt=now,
                    kind=kind,
                ).exclude(pk=activity.pk).update(active=False, updated_at=now)
                FriendPubActivityRecipient.objects.filter(activity=activity).delete()
                if requested_recipient_ids is not None:
                    FriendPubActivityRecipient.objects.bulk_create(
                        [
                            FriendPubActivityRecipient(activity=activity, account_id=friend_id)
                            for friend_id in target_friend_ids
                        ],
                        ignore_conflicts=True,
                    )
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: pub activity failed: %s", exc, exc_info=True)
            return _internal_error()

        # Ghost mode keeps the owner's own activity row (so they can still track
        # their own RSVP roster) but broadcasts NOTHING: no notification rows, no
        # push fanout. The activity also vanishes from friends' active feed via
        # the ghost_mode exclusion in FriendsView.
        is_ghost = bool(getattr(request.user, "ghost_mode", False))
        if should_notify and target_friend_ids and not is_ghost:
            actor = _friend_display_name(request.user)
            if is_plan:
                local_time = dj_timezone.localtime(scheduled_for, PRAGUE_TZ).strftime("%H:%M")
                title = "Kamarád plánuje pivo"
                body = f"{actor} plánuje {activity.name} v {local_time}. Přidáš se?"
                notif_kind = FriendNotification.Kind.FRIEND_PLAN
                push_kind = "friend_plan"
            else:
                title = "Kamarád je na pivu"
                body = f"{actor} sedí v {activity.name}. Nechceš se přidat?"
                notif_kind = FriendNotification.Kind.FRIEND_AT_PUB
                push_kind = "friend_at_pub"
            _bulk_create_friend_notifications(
                recipient_ids=target_friend_ids,
                actor=request.user,
                kind=notif_kind,
                title=title,
                body=body,
                activity=activity,
                pub_cache_key=activity.cache_key,
                pub_name=activity.name[:200],
            )
            _send_friend_push(
                target_friend_ids,
                title,
                body,
                {
                    "kind": push_kind,
                    "activity_id": str(activity.public_id),
                    "pub_cache_key": activity.cache_key,
                },
            )

        fresh = (
            FriendPubActivity.objects.select_related("account")
            .prefetch_related(*_friend_activity_prefetches())
            .get(pk=activity.pk)
        )
        return Response(
            FriendPubActivitySerializer(fresh, context=_friend_activity_context(request)).data,
            status=status.HTTP_201_CREATED if should_notify else status.HTTP_200_OK,
        )

    def delete(self, request: Request, activity_id) -> Response:
        updated = FriendPubActivity.objects.filter(
            account=request.user,
            public_id=activity_id,
            active=True,
        ).update(active=False, updated_at=dj_timezone.now())
        return Response({"ended": updated > 0}, status=status.HTTP_200_OK)


class FriendActivityRespondView(APIView):
    """POST/DELETE /v1/friends/pub-activity/<activity_id>/respond.

    The svolávací smyčka: an accepted friend RSVPs Going / Maybe / Can't to an
    owner's active broadcast. POST upserts my response; DELETE clears it. On a new
    or changed-to-Going response the OWNER gets a FRIEND_RSVP notification + push
    (regardless of broadcast gating — this is a direct reply to them).
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def _load_active_activity(self, activity_id) -> FriendPubActivity | None:
        now = dj_timezone.now()
        return (
            FriendPubActivity.objects.select_related("account")
            .filter(
                public_id=activity_id,
                active=True,
                expires_at__gt=now,
                account__status=Account.Status.ACTIVE,
                account__ghost_mode=False,
            )
            .first()
        )

    def post(self, request: Request, activity_id) -> Response:
        serializer = FriendActivityResponseSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        response_value = serializer.validated_data["response"]

        activity = self._load_active_activity(activity_id)
        if activity is None:
            return Response(
                {"detail": "Tahle hláška už vyšuměla.", "code": "activity_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if activity.account_id == request.user.pk:
            return Response(
                {"detail": "Na vlastní cinknutí reagovat nemusíš.", "code": "self_rsvp"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if activity.account_id in _blocked_account_ids(request.user):
            return Response(
                {"detail": "Tady se reagovat nedá.", "code": "blocked"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if activity.account_id not in _accepted_friend_ids(request.user):
            return Response(
                {"detail": "S tímhle člověkem ještě nejste parta.", "code": "not_friends"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not _friend_activity_visible_to(activity, request.user):
            return Response(
                {"detail": "Tahle hláška už vyšuměla.", "code": "activity_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            with transaction.atomic():
                # Lock the activity row so concurrent RSVPs serialise around the
                # owner-notification decision. Scope the lock to the activity row
                # only (of="self") so the joined owner Account row is not locked
                # too on Postgres.
                locked = (
                    FriendPubActivity.objects.select_for_update(of=("self",))
                    .filter(
                        pk=activity.pk,
                        active=True,
                        expires_at__gt=dj_timezone.now(),
                        account__status=Account.Status.ACTIVE,
                        account__ghost_mode=False,
                    )
                    .first()
                )
                if locked is None:
                    return Response(
                        {"detail": "Tahle hláška už vyšuměla.", "code": "activity_not_found"},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                existing = (
                    FriendActivityResponse.objects.filter(activity=locked, account=request.user)
                    .only("response")
                    .first()
                )
                previous = existing.response if existing is not None else None
                FriendActivityResponse.objects.update_or_create(
                    activity=locked,
                    account=request.user,
                    defaults={"response": response_value},
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: rsvp failed: %s", exc, exc_info=True)
            return _internal_error()

        is_going = response_value == FriendActivityResponse.Response.GOING
        newly_going = is_going and previous != FriendActivityResponse.Response.GOING
        if newly_going:
            title = f"{_friend_display_name(request.user)} už jde za tebou"
            body = activity.name[:240]
            _create_friend_notification(
                recipient=activity.account,
                actor=request.user,
                kind=FriendNotification.Kind.FRIEND_RSVP,
                title=title[:120],
                body=body,
                activity=activity,
                pub_cache_key=activity.cache_key,
                pub_name=activity.name[:200],
            )
            _send_friend_push(
                [activity.account_id],
                title[:120],
                body,
                {
                    "kind": "friend_rsvp",
                    "activity_id": str(activity.public_id),
                    "pub_cache_key": activity.cache_key,
                },
            )

        fresh = (
            FriendPubActivity.objects.select_related("account")
            .prefetch_related(*_friend_activity_prefetches())
            .get(pk=activity.pk)
        )
        return Response(
            FriendPubActivitySerializer(fresh, context=_friend_activity_context(request)).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request: Request, activity_id) -> Response:
        # Idempotent: a missing row is still a success so an offline retry queue
        # can replay safely. We do NOT require the activity to be active so a
        # responder can always retract.
        activity = FriendPubActivity.objects.filter(public_id=activity_id).first()
        if activity is None:
            return Response({"removed": False}, status=status.HTTP_200_OK)
        deleted, _ = FriendActivityResponse.objects.filter(
            activity=activity, account=request.user
        ).delete()
        return Response({"removed": deleted > 0}, status=status.HTTP_200_OK)


class FriendActivityReactView(APIView):
    """POST/DELETE /v1/friends/pub-activity/<activity_id>/react — the "Na zdraví" loop.

    A lightweight acknowledgement from the quiet majority. Unlike an RSVP, a
    reaction is allowed against a PAST / expired activity (cheering the memory from
    the feed). POST upserts my reaction; DELETE retracts it. A newly-created
    reaction notifies the owner (``friend_cheers`` in-app + push), deduped within
    ``FRIEND_REACTION_NOTIFY_COOLDOWN_MIN`` so undo/redo does not spam.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def _load_activity(self, activity_id) -> FriendPubActivity | None:
        return (
            FriendPubActivity.objects.select_related("account")
            .filter(public_id=activity_id)
            .first()
        )

    def _serialize_fresh(self, request, activity) -> dict:
        fresh = (
            FriendPubActivity.objects.select_related("account")
            .prefetch_related(*_friend_activity_prefetches())
            .get(pk=activity.pk)
        )
        return FriendPubActivitySerializer(
            fresh, context=_friend_activity_context(request)
        ).data

    def post(self, request: Request, activity_id) -> Response:
        serializer = FriendActivityReactionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"detail": "Tuhle reakci neznám.", "code": "invalid_reaction"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reaction_value = serializer.validated_data["reaction"]

        activity = self._load_activity(activity_id)
        if activity is None:
            return Response(
                {"detail": "Tahle hláška už vyšuměla.", "code": "activity_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if activity.account_id == request.user.pk:
            return Response(
                {"detail": "Na vlastní cinknutí si připít nemusíš.", "code": "self_reaction"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if activity.account_id in _blocked_account_ids(request.user):
            return Response(
                {"detail": "Tady se reagovat nedá.", "code": "blocked"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if activity.account_id not in _accepted_friend_ids(request.user):
            return Response(
                {"detail": "S tímhle člověkem ještě nejste parta.", "code": "not_friends"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not _friend_activity_visible_to(activity, request.user):
            return Response(
                {"detail": "Tahle hláška už vyšuměla.", "code": "activity_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        now = dj_timezone.now()
        try:
            with transaction.atomic():
                _, created = FriendActivityReaction.objects.update_or_create(
                    activity=activity,
                    account=request.user,
                    defaults={"kind": reaction_value},
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: reaction failed: %s", exc, exc_info=True)
            return _internal_error()

        if created:
            # Dedup: only notify if no friend_cheers for (me, activity) landed in
            # the owner's inbox within the cooldown window.
            cooldown = now - timedelta(minutes=settings.FRIEND_REACTION_NOTIFY_COOLDOWN_MIN)
            already_notified = FriendNotification.objects.filter(
                recipient=activity.account,
                actor=request.user,
                activity=activity,
                kind=FriendNotification.Kind.FRIEND_CHEERS,
                created_at__gte=cooldown,
            ).exists()
            if not already_notified:
                title = "Na zdraví!"
                body = f"{_friend_display_name(request.user)} ti připil. Na zdraví!"
                _create_friend_notification(
                    recipient=activity.account,
                    actor=request.user,
                    kind=FriendNotification.Kind.FRIEND_CHEERS,
                    title=title,
                    body=body[:240],
                    activity=activity,
                    pub_cache_key=activity.cache_key,
                    pub_name=activity.name[:200],
                )
                _send_friend_push(
                    [activity.account_id],
                    title,
                    body[:240],
                    {
                        "kind": "friend_cheers",
                        "activity_id": str(activity.public_id),
                    },
                )

        return Response(self._serialize_fresh(request, activity), status=status.HTTP_200_OK)

    def delete(self, request: Request, activity_id) -> Response:
        # Idempotent retract: a missing reaction is still a success so an offline
        # replay is safe. A gone activity returns {"removed": bool}.
        activity = self._load_activity(activity_id)
        if activity is None:
            return Response({"removed": False}, status=status.HTTP_200_OK)
        FriendActivityReaction.objects.filter(
            activity=activity, account=request.user
        ).delete()
        return Response(self._serialize_fresh(request, activity), status=status.HTTP_200_OK)


class BeerCheckInView(APIView):
    """GET/POST/DELETE beer diary check-ins.

    POST is idempotent on (account, client_id) so mobile offline retries can
    safely replay. The payload never accepts raw GPS, only a chosen pub identity.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        rows = _beer_checkin_queryset().filter(account=request.user).order_by("-checked_in_at")[:100]
        return Response(
            {"checkins": BeerCheckInSerializer(rows, many=True, context=_beer_checkin_context(request)).data},
            status=status.HTTP_200_OK,
        )

    def post(self, request: Request) -> Response:
        serializer = BeerCheckInRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        defaults = {
            "beer_name": data["beer_name"],
            "brewery_name": data.get("brewery_name") or "",
            "beer_style": data.get("beer_style") or "",
            "abv": data.get("abv"),
            "rating": data.get("rating"),
            "tags": data.get("tags") or [],
            "note": data.get("note") or "",
            "pub_cache_key": data.get("pub_cache_key") or "",
            "pub_name": data.get("pub_name") or "",
            "pub_city": data.get("pub_city") or "",
            "visit_client_id": data.get("visit_client_id"),
            "visibility": data.get("visibility") or BeerCheckIn.Visibility.PRIVATE,
            "beer_key": _beer_identity_key(data["beer_name"]),
            "brewery_key": _beer_identity_key(data.get("brewery_name") or ""),
            "checked_in_at": data.get("checked_in_at") or dj_timezone.now(),
        }

        try:
            with transaction.atomic():
                checkin, created = BeerCheckIn.objects.update_or_create(
                    account=request.user,
                    client_id=data["client_id"],
                    defaults=defaults,
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("beer_checkins: upsert failed: %s", exc, exc_info=True)
            return _internal_error()

        fresh = _beer_checkin_queryset().get(pk=checkin.pk)
        return Response(
            BeerCheckInSerializer(fresh, context=_beer_checkin_context(request)).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request: Request, client_id) -> Response:
        return _idempotent_delete(
            BeerCheckIn.objects.filter(account=request.user, client_id=client_id),
            scope="beer_checkins",
            key_label="client_id",
            key_value=client_id,
        )


class BeerCheckInFeedView(APIView):
    """GET /v1/beer-checkins/feed — friends-only beer check-in feed."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        blocked_ids = _blocked_account_ids(request.user)
        friend_ids = [fid for fid in _accepted_friend_ids(request.user) if fid not in blocked_ids]
        rows = (
            _beer_checkin_queryset()
            .filter(
                account_id__in=friend_ids,
                account__status=Account.Status.ACTIVE,
                account__ghost_mode=False,
                visibility=BeerCheckIn.Visibility.FRIENDS,
            )
            .order_by("-checked_in_at")[:50]
        )
        return Response(
            {"checkins": BeerCheckInSerializer(rows, many=True, context=_beer_checkin_context(request)).data},
            status=status.HTTP_200_OK,
        )


class BeerCheckInReactView(APIView):
    """POST/DELETE /v1/beer-checkins/<id>/react — "Na zdraví" on a beer check-in."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def _load_visible_checkin(self, request: Request, checkin_id) -> BeerCheckIn | None:
        return (
            BeerCheckIn.objects.select_related("account")
            .filter(
                public_id=checkin_id,
                visibility=BeerCheckIn.Visibility.FRIENDS,
                account__status=Account.Status.ACTIVE,
                account__ghost_mode=False,
            )
            .first()
        )

    def _can_react(self, request: Request, checkin: BeerCheckIn) -> Response | None:
        if checkin.account_id == request.user.pk:
            return Response(
                {"detail": "Na vlastní pivo si připít nemusíš.", "code": "self_reaction"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if checkin.account_id in _blocked_account_ids(request.user):
            return Response(
                {"detail": "Tady se reagovat nedá.", "code": "blocked"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if checkin.account_id not in _accepted_friend_ids(request.user):
            return Response(
                {"detail": "S tímhle člověkem ještě nejste parta.", "code": "not_friends"},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def _serialize_fresh(self, request: Request, checkin: BeerCheckIn) -> dict:
        fresh = _beer_checkin_queryset().get(pk=checkin.pk)
        return BeerCheckInSerializer(fresh, context=_beer_checkin_context(request)).data

    def post(self, request: Request, checkin_id) -> Response:
        serializer = BeerCheckInReactionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"detail": "Tuhle reakci neznám.", "code": "invalid_reaction"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        checkin = self._load_visible_checkin(request, checkin_id)
        if checkin is None:
            return Response(
                {"detail": "Tenhle zápis nevidím.", "code": "checkin_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        error = self._can_react(request, checkin)
        if error is not None:
            return error
        try:
            BeerCheckInReaction.objects.update_or_create(
                checkin=checkin,
                account=request.user,
                defaults={"kind": serializer.validated_data["reaction"]},
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("beer_checkins: reaction failed: %s", exc, exc_info=True)
            return _internal_error()
        return Response(self._serialize_fresh(request, checkin), status=status.HTTP_200_OK)

    def delete(self, request: Request, checkin_id) -> Response:
        checkin = BeerCheckIn.objects.filter(public_id=checkin_id).first()
        if checkin is None:
            return Response({"removed": False}, status=status.HTTP_200_OK)
        deleted, _ = BeerCheckInReaction.objects.filter(
            checkin=checkin, account=request.user
        ).delete()
        return Response({"removed": deleted > 0}, status=status.HTTP_200_OK)


class BeerMemoryView(APIView):
    """GET /v1/beers/memory — caller-only lightweight beer memory."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        beer_name = (request.query_params.get("beer_name") or "").strip()
        brewery_name = (request.query_params.get("brewery_name") or "").strip()
        beer_key = _beer_identity_key(beer_name)
        brewery_key = _beer_identity_key(brewery_name)
        rows = []
        if beer_key:
            rows = list(
                BeerCheckIn.objects.filter(
                    account=request.user,
                    **_beer_identity_filters(beer_key, brewery_key),
                )
                .only("checked_in_at", "pub_name", "rating", "tags")
                .order_by("checked_in_at", "id")
            )
        tag_counts = _beer_tag_counts(row.tags for row in rows)
        ratings = [row.rating for row in rows if row.rating is not None]
        first = rows[0] if rows else None
        last = rows[-1] if rows else None
        return Response(
            {
                "beer_name": beer_name,
                "brewery_name": brewery_name,
                "my_count": len(rows),
                "first_checked_in_at": first.checked_in_at if first else None,
                "last_checked_in_at": last.checked_in_at if last else None,
                "last_pub_name": last.pub_name if last else "",
                "last_rating": float(last.rating) if last and last.rating is not None else None,
                "my_average_rating": float(sum(ratings) / len(ratings)) if ratings else None,
                "top_tags": _beer_top_tags(tag_counts),
            },
            status=status.HTTP_200_OK,
        )


class BeerDetailView(APIView):
    """GET /v1/beers/detail?beer_name=&brewery_name= — personal + party aggregate."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends_dashboard"

    def get(self, request: Request) -> Response:
        beer_name = (request.query_params.get("beer_name") or "").strip()
        brewery_name = (request.query_params.get("brewery_name") or "").strip()
        if not beer_name:
            return Response(
                {"detail": "beer_name is required.", "code": "missing_beer_name"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        beer_key = _beer_identity_key(beer_name)
        brewery_key = _beer_identity_key(brewery_name)
        blocked_ids = _blocked_account_ids(request.user)
        friend_ids = [fid for fid in _accepted_friend_ids(request.user) if fid not in blocked_ids]
        mine = BeerCheckIn.objects.filter(
            account=request.user,
            beer_key=beer_key,
            brewery_key=brewery_key,
        )
        party = BeerCheckIn.objects.filter(
            account_id__in=friend_ids,
            account__status=Account.Status.ACTIVE,
            account__ghost_mode=False,
            visibility=BeerCheckIn.Visibility.FRIENDS,
            beer_key=beer_key,
            brewery_key=brewery_key,
        )
        party_accounts = Account.objects.filter(id__in=party.values("account_id")).order_by(
            "nickname",
            "display_name",
        )
        recent = (
            _beer_checkin_queryset()
            .filter(
                Q(account=request.user) | Q(account_id__in=friend_ids),
                beer_key=beer_key,
                brewery_key=brewery_key,
            )
            .filter(Q(account=request.user) | Q(visibility=BeerCheckIn.Visibility.FRIENDS))
            .filter(
                Q(account=request.user)
                | Q(account__status=Account.Status.ACTIVE, account__ghost_mode=False)
            )
            .exclude(account_id__in=blocked_ids)
            .order_by("-checked_in_at")[:20]
        )
        my_history = (
            _beer_checkin_queryset()
            .filter(account=request.user, beer_key=beer_key, brewery_key=brewery_key)
            .order_by("-checked_in_at")[:50]
        )
        my_summary = mine.aggregate(
            count=Count("id"),
            first_checked_in_at=Min("checked_in_at"),
            average_rating=Avg("rating"),
        )
        return Response(
            {
                "beer_name": beer_name,
                "brewery_name": brewery_name,
                "my_count": my_summary["count"],
                "first_checked_in_at": (
                    my_summary["first_checked_in_at"] if my_summary["count"] else None
                ),
                "party_count": party.count(),
                "my_average_rating": my_summary["average_rating"],
                "party_average_rating": party.aggregate(value=Avg("rating"))["value"],
                "my_tags": _beer_tag_counts(mine.values_list("tags", flat=True)),
                "party_drinkers": FriendProfileSerializer(
                    party_accounts,
                    many=True,
                    context=_friend_profile_context(request),
                ).data,
                "recent_checkins": BeerCheckInSerializer(
                    recent,
                    many=True,
                    context=_beer_checkin_context(request),
                ).data,
                "my_history": BeerCheckInSerializer(
                    my_history,
                    many=True,
                    context=_beer_checkin_context(request),
                ).data,
            },
            status=status.HTTP_200_OK,
        )


class FriendBlockView(APIView):
    """POST/GET /v1/friends/blocks and DELETE /v1/friends/blocks/<account_id> — safety."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        serializer = FriendBlockRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        target = Account.objects.filter(
            public_id=serializer.validated_data["account_id"]
        ).first()
        if target is None:
            return Response(
                {"detail": "Profil se nepodařilo najít.", "code": "profile_not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if target.pk == request.user.pk:
            return Response(
                {"detail": "Sám sebe zablokovat nejde.", "code": "self_block"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                FriendBlock.objects.get_or_create(blocker=request.user, blocked=target)
                # A block severs the friendship both ways, so the target drops out
                # of every list immediately — but DECLINED rows are preserved so a
                # block→unblock cycle can't wipe the anti-harassment decline
                # cooldown (a DECLINED row appears in no user-visible list, so
                # keeping it doesn't weaken the block).
                Friendship.objects.filter(
                    Q(requester=request.user, recipient=target)
                    | Q(requester=target, recipient=request.user)
                ).exclude(status=Friendship.Status.DECLINED).delete()
        except Exception as exc:  # noqa: BLE001
            logger.error("friends: block failed: %s", exc, exc_info=True)
            return _internal_error()

        return Response({"blocked": True}, status=status.HTTP_200_OK)

    def get(self, request: Request) -> Response:
        blocked_accounts = [
            row.blocked
            for row in FriendBlock.objects.filter(blocker=request.user).select_related(
                "blocked"
            )
        ]
        return Response(
            {
                "blocked": FriendProfileSerializer(
                    blocked_accounts,
                    many=True,
                    context=_friend_profile_context(request),
                ).data
            },
            status=status.HTTP_200_OK,
        )

    def delete(self, request: Request, account_id) -> Response:
        # Idempotent unblock; never auto-refriends.
        target = Account.objects.filter(public_id=account_id).first()
        if target is not None:
            FriendBlock.objects.filter(blocker=request.user, blocked=target).delete()
        return Response({"unblocked": True}, status=status.HTTP_200_OK)


class FriendInviteView(APIView):
    """GET /v1/friends/invite — my reusable, opaque invite code + deep link.

    Reuses the account's current non-revoked, non-expired code (one active code
    per account) and mints a fresh one only when none is live. The code carries no
    PII; identity resolves server-side only after the scanner authenticates.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        now = dj_timezone.now()
        code_row = (
            FriendInviteCode.objects.filter(
                account=request.user, revoked=False, expires_at__gt=now
            )
            .order_by("-created_at")
            .first()
        )
        if code_row is None:
            code_row = self._mint(request.user, now)
            if code_row is None:
                return _internal_error()
        return Response(FriendInviteSerializer(code_row).data, status=status.HTTP_200_OK)

    @staticmethod
    def _mint(account: Account, now) -> FriendInviteCode | None:
        ttl = timedelta(days=settings.FRIEND_INVITE_TTL_DAYS)
        # ~72 bits of entropy — collisions are astronomically unlikely, but retry
        # a few times defensively before giving up.
        for _ in range(5):
            code = secrets.token_urlsafe(9)
            try:
                with transaction.atomic():
                    return FriendInviteCode.objects.create(
                        account=account, code=code, expires_at=now + ttl
                    )
            except IntegrityError:
                continue
        return None


class FriendInviteResolveView(APIView):
    """GET /v1/friends/invite/<code> — resolve a code to the inviter (no request sent).

    Powers the claim screen ("@Pepa tě zve do party"). A block in either direction
    resolves as invalid (no leak). A user's own code still resolves as valid so the
    client can show "to je tvůj kód".
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request, code) -> Response:
        now = dj_timezone.now()
        code_row = (
            FriendInviteCode.objects.select_related("account").filter(code=code).first()
        )
        if code_row is None:
            return Response(
                {"detail": "Pozvánku neznám.", "code": "invite_invalid"},
                status=status.HTTP_404_NOT_FOUND,
            )
        inviter = code_row.account
        if (
            not _is_active_account(inviter)
            or inviter.id in _blocked_account_ids(request.user)
        ):
            return Response(
                {"detail": "Pozvánku neznám.", "code": "invite_invalid"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if code_row.revoked or code_row.expires_at <= now:
            return Response(
                {"detail": "Pozvánka už vypršela.", "code": "invite_expired"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {
                "valid": True,
                "expired": False,
                "inviter": FriendProfileSerializer(
                    inviter, context=_friend_profile_context(request)
                ).data,
            },
            status=status.HTTP_200_OK,
        )


class FriendSettingsView(APIView):
    """GET/PATCH /v1/friends/settings — ghost mode + quiet-hours preferences."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def get(self, request: Request) -> Response:
        return Response(_friend_settings_payload(request.user), status=status.HTTP_200_OK)

    def patch(self, request: Request) -> Response:
        serializer = FriendSettingsPatchSerializer(data=request.data)
        if not serializer.is_valid():
            code = (
                "invalid_hour"
                if "quiet_hours_start" in serializer.errors or "quiet_hours_end" in serializer.errors
                else "invalid_settings"
            )
            return Response(
                {"detail": "Nastavení se nepodařilo uložit.", "code": code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        account = request.user
        update_fields: list[str] = []
        data = serializer.validated_data

        if "ghost_mode" in data:
            account.ghost_mode = data["ghost_mode"]
            update_fields.append("ghost_mode")
        if "quiet_hours_enabled" in data:
            account.quiet_hours_enabled = data["quiet_hours_enabled"]
            update_fields.append("quiet_hours_enabled")
        for key in ("quiet_hours_start", "quiet_hours_end"):
            if key in data:
                setattr(account, key, data[key])
                update_fields.append(key)

        if update_fields:
            account.save(update_fields=update_fields)
        return Response(_friend_settings_payload(account), status=status.HTTP_200_OK)


class FriendNotificationReadView(APIView):
    """POST /v1/friends/notifications/read — mark selected or all notifications read."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "friends"

    def post(self, request: Request) -> Response:
        ids = request.data.get("ids")
        queryset = FriendNotification.objects.filter(recipient=request.user, read_at__isnull=True)
        if ids is not None:
            if not isinstance(ids, list):
                return Response(
                    {"detail": "ids must be a list.", "code": "invalid_ids"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            queryset = queryset.filter(public_id__in=ids)
        updated = queryset.update(read_at=dj_timezone.now())
        return Response({"marked_read": updated}, status=status.HTTP_200_OK)


class BlockedPubReportsView(APIView):
    """
    GET /v1/pub-reports/blocked?lat=...&lng=...&radius_km=...

    Return active reports near the user. This intentionally stays unauthenticated
    so filtering still works before or without a recovered anonymous account.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        serializer = PubReportBlockedQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        lat = data["lat"]
        lng = data["lng"]
        radius_km = data.get("radius_km") or DEFAULT_BLOCKED_REPORT_RADIUS_KM

        lat_delta = radius_km / 111.0
        lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))

        reports = PubReport.objects.filter(
            active=True,
            lat__gte=lat - lat_delta,
            lat__lte=lat + lat_delta,
            lng__gte=lng - lng_delta,
            lng__lte=lng + lng_delta,
        ).order_by("-created_at")

        blocked = []
        seen: set[tuple[str, str | None]] = set()
        for report in reports:
            if _haversine_km(lat, lng, report.lat, report.lng) > radius_km:
                continue
            key = (report.cache_key, report.external_id)
            if key in seen:
                continue
            seen.add(key)
            blocked.append(
                {
                    "cache_key": report.cache_key,
                    "external_id": report.external_id,
                    "reason": report.reason,
                }
            )

        return Response(
            BlockedPubsResponseSerializer({"blocked": blocked}).data,
            status=status.HTTP_200_OK,
        )


def _user_added_pub_item(pub: UserAddedPub) -> dict:
    """Return a Mapy-suggest-shaped item for the mobile client's existing parser."""

    regional_structure = []
    if pub.address:
        regional_structure.append({"name": pub.address, "type": "regional.street"})
    if pub.city:
        regional_structure.append({"name": pub.city, "type": "regional.municipality"})

    item = {
        "name": pub.name,
        "label": "Hospoda",
        "position": {"lat": pub.lat, "lon": pub.lng},
        "regionalStructure": regional_structure,
        "source": "community",
    }
    if pub.address:
        item["location"] = pub.address
    elif pub.city:
        item["location"] = pub.city
    return item


# Upper bounds on the user-added pubs mixed into one /v1/pubs/near response.
# A bounding-box query can match an unbounded number of rows (an attacker can
# POST ~20 pubs/min), so cap how many we scan and how many we ultimately return.
# We scan a generous prefix, compute the haversine distance, then keep only the
# nearest MAX so the rows we drop are the most distant ones, not arbitrary ones.
_USER_ADDED_SCAN_LIMIT = 200
_USER_ADDED_MAX_RESULTS = 50
_BEER_BRAND_SCAN_LIMIT = 200
_BEER_BRAND_MAX_RESULTS = 50


def _nearest_rows(
    queryset,
    lat: float,
    lng: float,
    radius_km: float,
    *,
    tiebreak: str,
    scan_limit: int,
    max_results: int,
):
    """Bounding-box prefilter + haversine refine for a lat/lng-bearing model.

    The queryset must already carry its own filters (e.g. ``active=True``) and
    expose float ``lat``/``lng`` fields. We annotate a cheap planar distance for a
    DB-side order, scan at most ``scan_limit`` rows, refine to the true circle by
    haversine, and return the nearest ``max_results`` rows (nearest first). The
    scan/result caps keep a flood of rows from inflating the response.
    """
    lat_delta = radius_km / 111.0
    lng_scale = max(math.cos(math.radians(lat)), 0.01)
    lng_delta = radius_km / (111.0 * lng_scale)
    lat_distance = F("lat") - Value(lat)
    lng_distance = (F("lng") - Value(lng)) * Value(lng_scale)
    distance_score = ExpressionWrapper(
        lat_distance * lat_distance + lng_distance * lng_distance,
        output_field=FloatField(),
    )

    rows = (
        queryset.filter(
            lat__gte=lat - lat_delta,
            lat__lte=lat + lat_delta,
            lng__gte=lng - lng_delta,
            lng__lte=lng + lng_delta,
        )
        .annotate(distance_score=distance_score)
        .order_by("distance_score", tiebreak)[:scan_limit]
    )

    within = []
    for row in rows:
        distance = _haversine_km(lat, lng, row.lat, row.lng)
        if distance <= radius_km:
            within.append((distance, row))

    within.sort(key=lambda pair: pair[0])
    return [row for _, row in within[:max_results]]


def _nearby_user_added_pub_items(lat: float, lng: float, radius_km: float) -> list[dict]:
    """Active user-added pubs within the requested circle, as suggest items.

    Bounded: at most _USER_ADDED_SCAN_LIMIT rows are scanned and at most
    _USER_ADDED_MAX_RESULTS (nearest first) are returned, so a flood of added
    pubs cannot inflate the response.
    """
    pubs = _nearest_rows(
        UserAddedPub.objects.filter(active=True),
        lat,
        lng,
        radius_km,
        tiebreak="-updated_at",
        scan_limit=_USER_ADDED_SCAN_LIMIT,
        max_results=_USER_ADDED_MAX_RESULTS,
    )
    return [_user_added_pub_item(pub) for pub in pubs]


def _pub_beer_brand_item(link: PubBeerBrand) -> dict:
    item = {
        "name": link.name,
        "label": "Hospoda",
        "position": {"lat": link.lat, "lon": link.lng},
        "source": "beer_signal",
        "beerBrand": {
            "slug": link.brand_key,
            "name": link.brand_name,
            "source": link.source,
        },
    }
    if link.external_id:
        item["id"] = link.external_id
    if link.city:
        item["regionalStructure"] = [
            {"name": link.city, "type": "regional.municipality"},
        ]
        item["location"] = link.city
    return item


def _item_cache_key(item: dict) -> str:
    pos = item.get("position") or {}
    lat = pos.get("lat")
    lng = pos.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return ""
    return geohash8(float(lat), float(lng))


def _item_external_id(item: dict) -> str | None:
    external_id = item.get("id")
    if isinstance(external_id, str) and external_id.strip():
        return external_id.strip()

    pos = item.get("position") or {}
    lat = pos.get("lat")
    lng = pos.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    return f"mapy:{float(lat):.5f},{float(lng):.5f}"


def _is_coordinate_external_id(external_id: str | None) -> bool:
    if not external_id:
        return False
    return re.fullmatch(r"mapy:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?", external_id) is not None


def _with_pub_name_corrections(items: list[dict]) -> list[dict]:
    """Apply active display-name corrections to Mapy-shaped nearby items."""

    if not items:
        return items

    cache_keys = {_item_cache_key(item) for item in items}
    cache_keys.discard("")
    external_ids = {_item_external_id(item) for item in items}
    external_ids.discard(None)
    if not cache_keys and not external_ids:
        return items

    corrections = (
        PubNameCorrection.objects.filter(active=True)
        .filter(Q(cache_key__in=cache_keys) | Q(external_id__in=external_ids))
        .order_by("updated_at", "id")
    )
    external_corrections: dict[str, list[tuple[int, PubNameCorrection, str]]] = {}
    cache_key_corrections: dict[str, list[tuple[int, PubNameCorrection, str]]] = {}
    for order, correction in enumerate(corrections):
        name = correction.suggested_name.strip()
        if not name:
            continue
        entry = (order, correction, name)
        if correction.cache_key:
            cache_key_corrections.setdefault(correction.cache_key, []).append(entry)
        if correction.external_id and not _is_coordinate_external_id(correction.external_id):
            external_corrections.setdefault(correction.external_id, []).append(entry)

    if not cache_key_corrections and not external_corrections:
        return items

    corrected_items: list[dict] = []
    for item in items:
        external_id = _item_external_id(item)
        cache_key = _item_cache_key(item)
        current_name = str(item.get("name") or "")
        candidate_entries: dict[int, tuple[int, PubNameCorrection, str]] = {}
        if external_id:
            for entry in external_corrections.get(external_id, []):
                candidate_entries[entry[0]] = entry
        if cache_key:
            for entry in cache_key_corrections.get(cache_key, []):
                candidate_entries.setdefault(entry[0], entry)
        for _, correction, suggested_name in sorted(candidate_entries.values(), key=lambda entry: entry[0]):
            has_strong_external_match = (
                bool(correction.external_id)
                and not _is_coordinate_external_id(correction.external_id)
                and correction.external_id == external_id
            )
            has_name_checked_place_match = (
                correction.cache_key == cache_key
                and names_match(correction.original_name, current_name)
            )
            if has_strong_external_match or has_name_checked_place_match:
                current_name = suggested_name
        if not current_name or current_name == item.get("name"):
            corrected_items.append(item)
            continue
        corrected = {**item, "name": current_name}
        corrected_items.append(corrected)
    return corrected_items


def _nearby_pub_beer_brand_items(
    *,
    brand_key: str,
    lat: float,
    lng: float,
    radius_km: float,
) -> tuple[list[dict], set[str]]:
    """Known pubs serving a brand, based on community menus and drink logs."""
    links = _nearest_rows(
        PubBeerBrand.objects.filter(active=True, brand_key=brand_key),
        lat,
        lng,
        radius_km,
        tiebreak="-last_seen_at",
        scan_limit=_BEER_BRAND_SCAN_LIMIT,
        max_results=_BEER_BRAND_MAX_RESULTS,
    )
    return [_pub_beer_brand_item(link) for link in links], {link.cache_key for link in links}


def _filter_items_by_cache_key(items: list[dict], cache_keys: set[str]) -> list[dict]:
    if not cache_keys:
        return []
    return [item for item in items if _item_cache_key(item) in cache_keys]


def _pub_near_dedupe_key(item: dict) -> str:
    """Match key for deduping community vs Mapy items.

    Mirrors enrichment.mapy._dedupe_key: casefolded name + (lat, lon) rounded to
    5 decimals (~1 m). Community items carry position.lon (not lng), same as the
    trimmed Mapy suggest items, so both sides hash identically.
    """
    pos = item.get("position") or {}
    name = (item.get("name") or "").strip().casefold()
    return f"{round(pos.get('lat', 0.0), 5)},{round(pos.get('lon', 0.0), 5)}|{name}"


def _with_user_added_items(user_added_items: list[dict], mapy_items: list[dict]) -> list[dict]:
    """Prepend user-added pubs, dropping any Mapy item that duplicates one.

    Once a community-added pub also shows up in the upstream Mapy results it would
    otherwise be returned twice; drop the Mapy copy so each physical pub appears
    once. The upstream cache row itself is left untouched.
    """

    if not user_added_items:
        return mapy_items

    seen = {_pub_near_dedupe_key(item) for item in user_added_items}
    deduped_mapy = [
        item for item in mapy_items if _pub_near_dedupe_key(item) not in seen
    ]
    return [*user_added_items, *deduped_mapy]


class PubsNearView(APIView):
    """
    GET /v1/pubs/near?lat=<float>&lng=<float>&radius_km=<float, default 25>

    Server-side Mapy.cz /v1/suggest proxy with a shared DB cache. The mobile app
    used to call Mapy.cz directly from every device, which nearly exhausted the
    shared API credit; this endpoint fetches once per small (geohash-6) cell and
    radius bucket, caches the trimmed suggest items, and serves nearby devices
    from that row.

    Response 200:
        {"items": [<MapySuggestItem>...], "cached": <bool>, "fetched_at": "<ISO>"}
    where each MapySuggestItem is a trimmed raw Mapy suggest item the client feeds
    into its existing filtering pipeline.

    Returns 503 when Mapy is not configured / unavailable AND there is no cached
    row to fall back on — the client then calls Mapy.cz directly.

    Unauthenticated by design (like BlockedPubReportsView — filtering must work
    before an account is recovered) but throttled per-IP (scope "pubs_near").
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pubs_near"

    def get(self, request: Request) -> Response:
        serializer = PubsNearQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        radius_km: float = data["radius_km"]
        beer_brand_key = data.get("beer_brand") or ""
        if beer_brand_key and not BeerBrand.objects.filter(
            key=beer_brand_key,
            active=True,
        ).exists():
            return Response(
                {"beer_brand": ["Unknown beer brand."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_added_items = _nearby_user_added_pub_items(data["lat"], data["lng"], radius_km)
        beer_brand_items: list[dict] = []
        beer_brand_cache_keys: set[str] = set()
        if beer_brand_key:
            beer_brand_items, beer_brand_cache_keys = _nearby_pub_beer_brand_items(
                brand_key=beer_brand_key,
                lat=data["lat"],
                lng=data["lng"],
                radius_km=radius_km,
            )
            user_added_items = _filter_items_by_cache_key(user_added_items, beer_brand_cache_keys)
            if not beer_brand_cache_keys:
                return Response(
                    {
                        "items": [],
                        "cached": True,
                        "fetched_at": dj_timezone.now().isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )

        def apply_beer_brand_filter(items: list[dict]) -> list[dict]:
            if not beer_brand_key:
                return _with_user_added_items(user_added_items, items)
            return _with_user_added_items(
                beer_brand_items,
                _filter_items_by_cache_key(items, beer_brand_cache_keys),
            )

        def final_items(items: list[dict]) -> list[dict]:
            return _with_pub_name_corrections(apply_beer_brand_filter(items))

        # Quantize to a small shared cache cell but run the search from the user's
        # actual position. The old geohash-5 centre search could be >2 km away at
        # a cell edge, which made dense-city results point to the wrong quarter.
        cache_key = geohash6(data["lat"], data["lng"])
        radius_bucket = _radius_bucket(radius_km)

        ttl_days: int = int(getattr(settings, "PUBS_NEAR_TTL_DAYS", 7))
        cutoff = dj_timezone.now() - timedelta(days=ttl_days)

        row = PubSearchCache.objects.filter(
            cache_key=cache_key, radius_bucket=radius_bucket
        ).first()

        def serve_stale_or_fallback() -> Response | None:
            # Best-effort 200 when a live Mapy fetch isn't possible: serve the
            # stale cache row if we have one, else any local user-added /
            # beer-brand fallback items. None → caller emits its own error.
            if row is not None:
                return Response(
                    {
                        "items": final_items(row.items),
                        "cached": True,
                        "fetched_at": row.fetched_at.isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            fallback_items = final_items([])
            if fallback_items:
                return Response(
                    {
                        "items": fallback_items,
                        "cached": True,
                        "fetched_at": dj_timezone.now().isoformat(),
                    },
                    status=status.HTTP_200_OK,
                )
            return None

        # Fresh cache hit — serve as-is.
        if row is not None and row.fetched_at >= cutoff:
            return Response(
                {
                    "items": final_items(row.items),
                    "cached": True,
                    "fetched_at": row.fetched_at.isoformat(),
                },
                status=status.HTTP_200_OK,
            )

        # Stale or missing → fetch from Mapy. If the key isn't configured, fall
        # back to any stale row, else 503.
        api_key: str = getattr(settings, "MAPY_API_KEY", "") or ""
        if not api_key:
            if row is not None:
                logger.info(
                    "pubs-near: MAPY_API_KEY unset — serving stale cache for %s/%dkm",
                    cache_key, radius_bucket,
                )
            served = serve_stale_or_fallback()
            if served is not None:
                return served
            return Response(
                {"detail": "Mapy.cz proxy is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        daily_cap = int(getattr(settings, "MAPY_DAILY_CAP", 5000))

        try:
            with MapySuggestSource(api_key=api_key, daily_cap=daily_cap) as source:
                result = source.search_near(data["lat"], data["lng"], radius_bucket)
        except (MapyDailyCapExceededError, MapyAllQueriesFailedError) as exc:
            # Daily cap hit or every upstream query failed. Serve the stale row if
            # we have one (better stale than nothing); otherwise 503 so the client
            # falls back to calling Mapy.cz directly.
            if row is not None:
                logger.warning(
                    "pubs-near: Mapy fetch failed (%s) — serving stale cache for %s/%dkm",
                    exc, cache_key, radius_bucket,
                )
            served = serve_stale_or_fallback()
            if served is not None:
                return served
            logger.warning(
                "pubs-near: Mapy fetch failed (%s) and no cache for %s/%dkm — 503",
                exc, cache_key, radius_bucket,
            )
            return Response(
                {"detail": "Mapy.cz is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pubs-near: unexpected error fetching %s/%dkm: %s",
                cache_key, radius_bucket, exc, exc_info=True,
            )
            served = serve_stale_or_fallback()
            if served is not None:
                return served
            return _internal_error()

        # Success — upsert the cache row. We accept the small write race between
        # concurrent requests for the same cell (both fetch, last write wins via
        # update_or_create on the unique (cache_key, radius_bucket) key): the
        # project runs sqlite in dev and Postgres in prod, so we avoid a
        # Postgres-only stampede lock (e.g. advisory locks) and a select_for_update
        # that would behave differently across the two backends. The duplicate
        # fetch is rare (TTL is days) and the result is identical, so it is cheaper
        # to tolerate than to serialize every request.
        now = dj_timezone.now()
        PubSearchCache.objects.update_or_create(
            cache_key=cache_key,
            radius_bucket=radius_bucket,
            defaults={"items": result.items, "fetched_at": now},
        )

        return Response(
            {
                "items": final_items(result.items),
                "cached": False,
                "fetched_at": now.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class _PubLocationLookupBaseView(APIView):
    """Shared Mapy.cz lookup proxy for add-pub autocomplete and fallback geocode."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pubs_near"

    lookup_kind = "location"

    def _lookup(self, source: MapySuggestSource, query: str, lat: float | None, lng: float | None):
        raise NotImplementedError

    def get(self, request: Request) -> Response:
        serializer = PubLocationLookupQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        api_key: str = getattr(settings, "MAPY_API_KEY", "") or ""
        if not api_key:
            return Response(
                {"detail": "Mapy.cz proxy is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        daily_cap = int(getattr(settings, "MAPY_DAILY_CAP", 5000))
        try:
            with MapySuggestSource(api_key=api_key, daily_cap=daily_cap) as source:
                result = self._lookup(
                    source,
                    data["query"],
                    data.get("lat"),
                    data.get("lng"),
                )
        except MapyDailyCapExceededError as exc:
            logger.warning("pubs-%s: Mapy daily cap hit: %s", self.lookup_kind, exc)
            return Response(
                {"detail": "Mapy.cz daily cap exceeded."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except (requests.RequestException, ValueError) as exc:
            logger.warning("pubs-%s: Mapy lookup failed: %s", self.lookup_kind, exc)
            return Response(
                {"detail": "Mapy.cz is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pubs-%s: unexpected lookup error: %s",
                self.lookup_kind,
                exc,
                exc_info=True,
            )
            return _internal_error()

        return Response({"items": result.items}, status=status.HTTP_200_OK)


class PubLocationSuggestView(_PubLocationLookupBaseView):
    """GET /v1/pubs/suggest?query=...&lat=...&lng=..."""

    lookup_kind = "suggest"

    def _lookup(self, source: MapySuggestSource, query: str, lat: float | None, lng: float | None):
        return source.suggest_locations(query, lat=lat, lng=lng)


class PubLocationGeocodeView(_PubLocationLookupBaseView):
    """GET /v1/pubs/geocode?query=...&lat=...&lng=..."""

    lookup_kind = "geocode"

    def _lookup(self, source: MapySuggestSource, query: str, lat: float | None, lng: float | None):
        return source.geocode_location(query, lat=lat, lng=lng)


class ReleaseNotesView(APIView):
    """
    GET /v1/release-notes              → full published changelog (newest first)
    GET /v1/release-notes?version=<v>  → the published note for that version, 404 if none

    Two read shapes on one endpoint, both unauthenticated:

    - With ``version``: the launch popup's single-note lookup. The app calls this
      right after an update; a 404 (no note for this version) is an expected,
      cheap miss, not an error.
    - Without ``version``: the collection, used by the in-app "O appce" screen to
      let the user scroll through every update. Returns ``{"notes": [...]}``
      ordered newest-first (ReleaseNote.Meta.ordering = ["-created_at"]).
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        version = (request.query_params.get("version") or "").strip()

        # No version → the whole published changelog for the "O appce" screen.
        if not version:
            notes = ReleaseNote.objects.filter(is_published=True).prefetch_related("items")
            return Response(
                {"notes": ReleaseNoteSerializer(notes, many=True).data},
                status=status.HTTP_200_OK,
            )

        note = (
            ReleaseNote.objects.filter(version=version, is_published=True)
            .prefetch_related("items")
            .first()
        )
        if note is None:
            return Response(
                {"detail": "No release note for this version."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(ReleaseNoteSerializer(note).data, status=status.HTTP_200_OK)


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _load_export_account(account: Account) -> Account:
    """Load the account plus every relation serialized by the export endpoint."""

    return (
        Account.objects.select_related("email_credential", "usage_stats")
        .prefetch_related(
            "identities",
            "push_devices",
            "drinks",
            "beer_checkins",
            Prefetch(
                "beer_checkin_reactions",
                queryset=BeerCheckInReaction.objects.select_related("checkin"),
            ),
            "pub_visits",
            "pub_ratings",
            "contribution_logs",
            "pub_reports",
            "feedback_reports",
            "amenity_votes",
            Prefetch(
                "sent_friendships",
                queryset=Friendship.objects.select_related("requester", "recipient"),
            ),
            Prefetch(
                "received_friendships",
                queryset=Friendship.objects.select_related("requester", "recipient"),
            ),
            "friend_pub_activities",
            Prefetch(
                "activity_responses",
                queryset=FriendActivityResponse.objects.select_related("activity"),
            ),
            Prefetch(
                "activity_reactions",
                queryset=FriendActivityReaction.objects.select_related("activity"),
            ),
            Prefetch(
                "friend_notifications",
                queryset=FriendNotification.objects.select_related("actor", "friendship", "activity"),
            ),
            Prefetch(
                "blocks_made",
                queryset=FriendBlock.objects.select_related("blocked"),
            ),
            Prefetch(
                "blocks_received",
                queryset=FriendBlock.objects.select_related("blocker"),
            ),
            "invite_codes",
            Prefetch(
                "content_reports_made",
                queryset=ContentReport.objects.select_related("target_account"),
            ),
        )
        .get(pk=account.pk)
    )


def _export_account_identity(account: Account) -> dict:
    credential = getattr(account, "email_credential", None)
    identities = list(account.identities.all())
    social_email = next((identity.email for identity in identities if identity.email), "")
    return {
        "email": credential.email if credential is not None else social_email,
        "email_verified": bool(credential and credential.email_verified),
        "providers": [
            *(["email"] if credential is not None else []),
            *(identity.provider for identity in identities),
        ],
    }


def _export_account_data(account: Account) -> dict:
    """Return a GDPR-style JSON export for one account, excluding secrets."""

    usage = getattr(account, "usage_stats", None)
    identity = _export_account_identity(account)
    return {
        "exported_at": dj_timezone.now().isoformat(),
        "account": {
            "id": str(account.public_id),
            "device_id": account.device_id,
            "nickname": account.nickname,
            "display_name": account.display_name,
            "has_avatar": bool(account.avatar),
            "is_public": account.is_public,
            "email": identity["email"],
            "email_verified": identity["email_verified"],
            "providers": identity["providers"],
            "status": account.status,
            "created_at": _iso(account.created_at),
            "last_seen_at": _iso(account.last_seen_at),
        },
        "settings": {
            "hide_pub_names": account.hide_pub_names,
            "compass_mode": account.compass_mode,
            "max_distance_km": account.max_distance_km,
            "price_currency": account.price_currency,
            "haptic_enabled": account.haptic_enabled,
            "sound_enabled": account.sound_enabled,
            "hide_closed_pubs": account.hide_closed_pubs,
            "marketing_emails_enabled": account.marketing_emails_enabled,
        },
        "subscription": {
            "tier": account.subscription_tier,
            "status": account.subscription_status,
            "platform": account.subscription_platform,
            "product_id": account.subscription_product_id,
            "original_transaction_id": account.subscription_original_transaction_id,
            "expires_at": _iso(account.subscription_expires_at),
            "updated_at": _iso(account.subscription_updated_at),
        },
        "push_devices": [
            {
                "platform": device.platform,
                "permission_status": device.permission_status,
                "enabled": device.enabled,
                "app_version": device.app_version,
                "created_at": _iso(device.created_at),
                "updated_at": _iso(device.updated_at),
                "last_registered_at": _iso(device.last_registered_at),
            }
            for device in account.push_devices.all()
        ],
        "usage": {
            "app_open_count": usage.app_open_count if usage else 0,
            "app_foreground_count": usage.app_foreground_count if usage else 0,
            "walked_distance_m": usage.walked_distance_m if usage else 0,
            "client_warning_count": usage.client_warning_count if usage else 0,
            "client_error_count": usage.client_error_count if usage else 0,
            "api_failure_count": usage.api_failure_count if usage else 0,
        },
        "drinks": [
            {
                "client_id": str(drink.client_id),
                "cache_key": drink.cache_key,
                "name": drink.name,
                "lat": drink.lat,
                "lng": drink.lng,
                "city": drink.city,
                "external_id": drink.external_id,
                "drink_type": drink.drink_type,
                "beer_name": drink.beer_name,
                "price_czk": drink.price_czk,
                "volume_ml": drink.volume_ml,
                "drank_at": _iso(drink.drank_at),
                "created_at": _iso(drink.created_at),
            }
            for drink in account.drinks.all()
        ],
        "beer_checkins": [
            {
                "id": str(checkin.public_id),
                "client_id": str(checkin.client_id),
                "beer_name": checkin.beer_name,
                "brewery_name": checkin.brewery_name,
                "beer_style": checkin.beer_style,
                "abv": str(checkin.abv) if checkin.abv is not None else None,
                "rating": str(checkin.rating) if checkin.rating is not None else None,
                "tags": normalize_beer_checkin_tags(checkin.tags),
                "note": checkin.note,
                "pub_cache_key": checkin.pub_cache_key,
                "pub_name": checkin.pub_name,
                "pub_city": checkin.pub_city,
                "visit_client_id": (
                    str(checkin.visit_client_id) if checkin.visit_client_id else None
                ),
                "visibility": checkin.visibility,
                "checked_in_at": _iso(checkin.checked_in_at),
                "created_at": _iso(checkin.created_at),
                "updated_at": _iso(checkin.updated_at),
            }
            for checkin in account.beer_checkins.all()
        ],
        "social": {
            "friendships": [
                {
                    "id": str(row.public_id),
                    "status": row.status,
                    "requester_id": str(row.requester.public_id),
                    "recipient_id": str(row.recipient.public_id),
                    "requested_at": _iso(row.requested_at),
                    "responded_at": _iso(row.responded_at),
                    "updated_at": _iso(row.updated_at),
                }
                for row in [*account.sent_friendships.all(), *account.received_friendships.all()]
            ],
            "friend_activities": [
                {
                    "id": str(activity.public_id),
                    "client_id": str(activity.client_id),
                    "cache_key": activity.cache_key,
                    "name": activity.name,
                    "city": activity.city,
                    "external_id": activity.external_id,
                    "message": activity.message,
                    "kind": activity.kind,
                    "scheduled_for": _iso(activity.scheduled_for),
                    "started_at": _iso(activity.started_at),
                    "expires_at": _iso(activity.expires_at),
                    "active": activity.active,
                    "created_at": _iso(activity.created_at),
                    "updated_at": _iso(activity.updated_at),
                }
                for activity in account.friend_pub_activities.all()
            ],
            "rsvp": [
                {
                    "activity_id": str(row.activity.public_id),
                    "response": row.response,
                    "created_at": _iso(row.created_at),
                    "updated_at": _iso(row.updated_at),
                }
                for row in account.activity_responses.all()
            ],
            "reactions": [
                {
                    "target": "friend_activity",
                    "activity_id": str(row.activity.public_id),
                    "kind": row.kind,
                    "created_at": _iso(row.created_at),
                    "updated_at": _iso(row.updated_at),
                }
                for row in account.activity_reactions.all()
            ]
            + [
                {
                    "target": "beer_checkin",
                    "checkin_id": str(row.checkin.public_id),
                    "kind": row.kind,
                    "created_at": _iso(row.created_at),
                    "updated_at": _iso(row.updated_at),
                }
                for row in account.beer_checkin_reactions.all()
            ],
            "notifications": [
                {
                    "id": str(row.public_id),
                    "kind": row.kind,
                    "title": row.title,
                    "body": row.body,
                    "actor_id": str(row.actor.public_id) if row.actor_id else None,
                    "friendship_id": (
                        str(row.friendship.public_id) if row.friendship_id else None
                    ),
                    "activity_id": str(row.activity.public_id) if row.activity_id else None,
                    "pub_cache_key": row.pub_cache_key,
                    "pub_name": row.pub_name,
                    "read_at": _iso(row.read_at),
                    "created_at": _iso(row.created_at),
                }
                for row in account.friend_notifications.all()
            ],
            "blocks": [
                {
                    "direction": "made",
                    "account_id": str(row.blocked.public_id),
                    "created_at": _iso(row.created_at),
                }
                for row in account.blocks_made.all()
            ]
            + [
                {
                    "direction": "received",
                    "account_id": str(row.blocker.public_id),
                    "created_at": _iso(row.created_at),
                }
                for row in account.blocks_received.all()
            ],
            "invite_codes": [
                {
                    "code": row.code,
                    "created_at": _iso(row.created_at),
                    "expires_at": _iso(row.expires_at),
                    "revoked": row.revoked,
                }
                for row in account.invite_codes.all()
            ],
        },
        "visits": [_visit_item(visit) for visit in account.pub_visits.all()],
        "ratings": [_rating_item(rating) for rating in account.pub_ratings.all()],
        "community_contributions": [
            {
                "client_id": str(row.client_id),
                "kind": row.kind,
                "cache_key": row.cache_key,
                "name": row.name,
                "lat": row.lat,
                "lng": row.lng,
                "payload": row.payload,
                "created_at": _iso(row.created_at),
            }
            for row in account.contribution_logs.all()
        ],
        "pub_reports": [
            {
                "cache_key": report.cache_key,
                "external_id": report.external_id,
                "name": report.name,
                "lat": report.lat,
                "lng": report.lng,
                "city": report.city,
                "address": report.address,
                "reason": report.reason,
                "active": report.active,
                "created_at": _iso(report.created_at),
            }
            for report in account.pub_reports.all()
        ],
        "feedback_reports": [
            {
                "client_id": str(report.client_id),
                "category": report.category,
                "message": report.message,
                "contact_type": report.contact_type,
                "contact": report.contact,
                "app_version": report.app_version,
                "platform": report.platform,
                "os_version": report.os_version,
                "status": report.status,
                "created_at": _iso(report.created_at),
            }
            for report in account.feedback_reports.all()
        ],
        "content_reports_made": [
            {
                "target_account_id": (
                    str(report.target_account.public_id)
                    if report.target_account_id is not None
                    else None
                ),
                "reason": report.reason,
                "comment": report.comment,
                "status": report.status,
                "created_at": _iso(report.created_at),
            }
            for report in account.content_reports_made.all()
        ],
        # PubAmenityVote is a per-account, location-adjacent dataset (§8.5): the
        # owner's own export includes it (name/city/coords are what they supplied).
        "amenity_votes": [
            {
                "cache_key": vote.cache_key,
                "amenity_key": vote.amenity_key,
                "name": vote.name,
                "lat": vote.lat,
                "lng": vote.lng,
                "city": vote.city,
                "external_id": vote.external_id,
                "value": vote.value,
                "taxonomy_version": vote.taxonomy_version,
                "client_updated_at": _iso(vote.client_updated_at),
                "created_at": _iso(vote.created_at),
            }
            for vote in account.amenity_votes.all()
        ],
    }


class AccountExportView(APIView):
    """GET downloads data; POST sends the same export to the account e-mail."""

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        body = _export_account_data(_load_export_account(request.user))
        response = Response(body, status=status.HTTP_200_OK)
        response["Content-Disposition"] = 'attachment; filename="na-pivo-export.json"'
        return response

    def post(self, request: Request) -> Response:
        account = _load_export_account(request.user)
        credential = getattr(account, "email_credential", None)
        if credential is None:
            return Response(
                {
                    "code": "missing_email",
                    "detail": "K účtu nemáme e-mail, kam bychom export poslali.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not credential.email_verified:
            return Response(
                {
                    "code": "email_unverified",
                    "detail": "Export e-mailem pošleme až na ověřený e-mail.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        email = credential.email

        filename = f"na-pivo-export-{dj_timezone.now().date().isoformat()}.json"
        body = _export_account_data(account)
        json_bytes = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8")
        sent = emailer.send_account_export_email(
            email,
            filename=filename,
            json_bytes=json_bytes,
        )
        if not sent:
            return Response(
                {
                    "code": "email_failed",
                    "detail": "Export se nepodařilo odeslat e-mailem. Zkus to prosím znovu.",
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response({"email": email}, status=status.HTTP_202_ACCEPTED)


class AccountView(APIView):
    """
    POST /v1/account

    Idempotently register (ensure) an anonymous device-bound account. The mobile
    app sends the device_id it generated and persisted locally; we get_or_create
    the Account and return it with a token. Re-posting a known device_id rotates
    and returns a fresh token only when the request already carries a valid Bearer
    token for that same account.

    Unauthenticated by design — this is how a brand-new device gets its first
    credentials — but throttled per-IP (scope "account") to blunt scripted mass
    account creation.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account"

    def post(self, request: Request) -> Response:
        serializer = AccountRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        device_id = serializer.validated_data["device_id"]
        try:
            # Idempotent on the device_id UNIQUE constraint: under a concurrent
            # first-registration race, get_or_create wraps the INSERT in a
            # savepoint and re-SELECTs on IntegrityError, so a lost-response retry
            # never creates a duplicate Account.
            #
            # Tokens live in AuthToken now (kind=device for this bootstrap path).
            # Only the SHA-256 hash is stored, so a raw token cannot be recovered.
            # A known device_id is therefore allowed to rotate only when the caller
            # proves possession of the current token for this same account;
            # otherwise device_id would act as a bearer-equivalent recovery key.
            account, created = Account.objects.get_or_create(device_id=device_id)
            if created:
                raw_token = accounts.issue_token(account, kind=AuthToken.Kind.DEVICE)
            else:
                auth_result = AccountTokenAuthentication().authenticate(request)
                if auth_result is None:
                    return Response(
                        {"detail": "Authentication credentials were not provided."},
                        status=status.HTTP_401_UNAUTHORIZED,
                        headers={"WWW-Authenticate": "Bearer"},
                    )

                authenticated_account, presented_token = auth_result
                if authenticated_account.pk != account.pk:
                    return Response(
                        {"detail": "Bearer token does not match device account."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                # Rotate: revoke the presented token and mint a fresh device token.
                # Touch last_seen_at (auto_now fires via update_fields).
                accounts.revoke_token(presented_token)
                raw_token = accounts.issue_token(account, kind=AuthToken.Kind.DEVICE)
                account.save(update_fields=["last_seen_at"])
        except AuthenticationFailed as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_401_UNAUTHORIZED,
                headers={"WWW-Authenticate": "Bearer"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "account: unexpected error registering account: %s",
                exc,
                exc_info=True,
            )
            return _internal_error()

        # The raw token is injected here — it is never a model field, never stored.
        body = dict(AccountSerializer(account).data)
        body["token"] = raw_token
        body["created"] = created
        return Response(
            body,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


def _first_error_detail_and_code(errors) -> tuple[str, str | None]:
    """Pull the first human message + machine code out of a DRF errors dict.

    DRF wraps each message in an ``ErrorDetail`` whose ``.code`` carries the
    stable code we attached in ``validate_nickname`` (e.g. ``nickname_taken``).
    Returns ``(detail, code)`` where ``code`` is ``None`` for generic field
    errors that have no custom code (so the caller falls back to the raw dict).
    """
    for value in errors.values():
        items = value if isinstance(value, list) else [value]
        for item in items:
            code = getattr(item, "code", None)
            # DRF's default field codes ('required', 'invalid', 'null', 'blank',
            # 'max_length', 'min_length') are not our nickname_* contract codes;
            # only surface a code that looks like ours.
            if isinstance(code, str) and code.startswith("nickname_"):
                return str(item), code
            return str(item), None
    return "Neplatný požadavek.", None


class AccountMeView(APIView):
    """
    GET/PATCH /v1/account/me

    Return or update the account that owns the supplied Bearer token.
    Token-authenticated; never echoes the token back. This is the scaffolding
    future per-user features build on.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        # request.user is the authenticated Account instance. Pass the request as
        # context so avatar_url is built absolute (the highest-leverage bug).
        return Response(
            AccountMeSerializer(request.user, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def patch(self, request: Request) -> Response:
        serializer = AccountUpdateSerializer(
            request.user,
            data=request.data,
            partial=True,
        )
        if not serializer.is_valid():
            # A nickname validation error carries a stable machine code (set by
            # AccountUpdateSerializer.validate_nickname); surface it as
            # {detail, code} like the auth endpoints, not DRF's field-error dict.
            detail, code = _first_error_detail_and_code(serializer.errors)
            if code:
                # nickname_taken is a 409 (a uniqueness conflict), matching both
                # the DB IntegrityError backstop below and the contract; the other
                # nickname_* codes (invalid/reserved/too_short/too_long) are 400.
                http_status = (
                    status.HTTP_409_CONFLICT
                    if code == "nickname_taken"
                    else status.HTTP_400_BAD_REQUEST
                )
                return Response({"detail": detail, "code": code}, status=http_status)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            account = serializer.save()
        except IntegrityError:
            # DB UniqueConstraint backstop for a nickname TOCTOU race.
            return Response(
                {"detail": "Tuto přezdívku už někdo používá.", "code": "nickname_taken"},
                status=status.HTTP_409_CONFLICT,
            )
        except AccountError as exc:
            return _coded_error(exc)
        return Response(
            AccountMeSerializer(account, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def delete(self, request: Request) -> Response:
        """Delete the account — required in-app by the App Store and Google Play.

        Soft-delete with a grace window: revoke every token, revoke the Apple
        token (Apple mandates it), mark the account pending-deletion, and email a
        cancel-by date. The ``purge_deleted_accounts`` command hard-purges after
        the window; signing back in within it reactivates the account.
        """
        try:
            accounts.schedule_deletion(request.user)
        except Exception as exc:  # noqa: BLE001
            logger.error("account delete failed: %s", exc, exc_info=True)
            return _internal_error()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RestorePurchasesView(APIView):
    """
    POST /v1/account/me/purchases/restore

    Store purchase identifiers on the account so a future Na Pivo+ verifier can
    restore entitlements across devices. This endpoint deliberately does not
    unlock Plus by itself; without App Store / Play verification it marks the
    subscription state as pending_verification.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account"

    def post(self, request: Request) -> Response:
        serializer = RestorePurchasesRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        account = request.user
        account.subscription_platform = data["platform"]
        account.subscription_product_id = data.get("product_id") or ""
        account.subscription_original_transaction_id = (
            data.get("original_transaction_id") or data.get("transaction_id") or ""
        )
        account.subscription_expires_at = data.get("expires_at")
        account.subscription_status = Account.SubscriptionStatus.PENDING_VERIFICATION
        account.subscription_updated_at = dj_timezone.now()
        account.save(
            update_fields=[
                "subscription_platform",
                "subscription_product_id",
                "subscription_original_transaction_id",
                "subscription_expires_at",
                "subscription_status",
                "subscription_updated_at",
                "last_seen_at",
            ]
        )
        return Response(
            AccountMeSerializer(account, context={"request": request}).data,
            status=status.HTTP_202_ACCEPTED,
        )


class AccountAvatarView(APIView):
    """
    PUT/POST/DELETE /v1/account/me/avatar

    Upload, replace, or remove the authenticated account's avatar. The upload is
    ``multipart/form-data`` with a single ``avatar`` file part (jpeg/png/webp/heic
    accepted, but the server NEVER trusts the declared type — every image is
    re-decoded and re-encoded to a 256px square webp with EXIF stripped). POST is
    accepted as a mobile alias for PUT. DELETE resets to the initials fallback and
    is idempotent (200 even when there was no avatar).

    ``parser_classes`` is overridden LOCALLY to MultiPartParser — the global
    default stays JSON-only so no other endpoint is affected.
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "avatar"

    def _store(self, request: Request) -> Response:
        upload = request.FILES.get("avatar")
        if upload is None:
            return Response(
                {"detail": "Chybí soubor s obrázkem.", "code": "avatar_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            accounts.set_avatar(request.user, upload)
        except AccountError as exc:
            return _coded_error(exc)
        return Response(
            AccountMeSerializer(request.user, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    def put(self, request: Request) -> Response:
        return self._store(request)

    def post(self, request: Request) -> Response:
        # Mobile alias for PUT (some HTTP clients can't send multipart PUT).
        return self._store(request)

    def delete(self, request: Request) -> Response:
        accounts.clear_avatar(request.user)
        return Response(
            AccountMeSerializer(request.user, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


def _menu_scan_count_today(account_id: int, now) -> int:
    """Increment and return this account's menu-scan count since UTC midnight.

    A per-account daily sub-cap bounds how much of the shared OpenRouter daily
    pool one actor can drain (defence-in-depth behind the per-minute throttle and
    the process-wide cap). Backed by the Django cache, so — like every cache-backed
    counter and throttle here — it is per-process under the default LocMemCache; a
    shared cache (Redis/Memcached) makes it exact across workers.
    """
    key = f"menu_scan:acct:{account_id}:{now:%Y%m%d}"
    # add() seeds the key with a >24h TTL only on the day's first call; it is a
    # no-op afterwards so the TTL keeps counting from that first request.
    default_cache.add(key, 0, timeout=60 * 60 * 25)
    try:
        return default_cache.incr(key)
    except ValueError:
        # The key expired between add() and incr(); treat this as today's first.
        default_cache.set(key, 1, timeout=60 * 60 * 25)
        return 1


class _MenuScanUploadLimitHandler(FileUploadHandler):
    """Stop a menu-scan file upload once it exceeds the configured byte cap."""

    def __init__(self, request, max_bytes: int) -> None:
        super().__init__(request)
        self.max_bytes = max_bytes
        self.total_bytes = 0

    def receive_data_chunk(self, raw_data: bytes, start: int) -> bytes:  # noqa: ARG002
        self.total_bytes += len(raw_data)
        if self.total_bytes > self.max_bytes:
            self.request.META["MENU_SCAN_UPLOAD_TOO_LARGE"] = "1"
            raise StopUpload(connection_reset=True)
        return raw_data

    def file_complete(self, file_size: int):  # noqa: ANN201
        return None


def _menu_scan_too_large_response() -> Response:
    return Response(
        {"detail": "Fotka je příliš velká.", "code": "image_too_large"},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _menu_scan_vision_unavailable() -> Response:
    return Response(
        {
            "detail": "Skenování menu teď nejede, zkus to za chvíli.",
            "code": "vision_unavailable",
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _menu_scan_daily_cap_response() -> Response:
    return Response(
        {
            "detail": "Skenování menu má pro dnešek vyčerpaný limit. Zkus to zítra.",
            "code": "daily_cap",
        },
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _menu_scan_request_too_large(request: Request) -> bool:
    """Return True when Content-Length is over the whole-request menu cap."""
    raw_length = request.META.get("CONTENT_LENGTH")
    if raw_length in (None, ""):
        return False
    try:
        content_length = int(raw_length)
    except (TypeError, ValueError):
        return False
    return content_length > settings.MENU_SCAN_MAX_REQUEST_BYTES


def _install_menu_scan_upload_limit(request: Request) -> None:
    """Install a streaming file cap before request.FILES triggers multipart parse."""
    django_request = request._request
    if django_request.META.get("MENU_SCAN_UPLOAD_LIMIT_INSTALLED") == "1":
        return
    django_request.upload_handlers.insert(
        0,
        _MenuScanUploadLimitHandler(
            django_request, settings.MENU_SCAN_MAX_UPLOAD_BYTES
        ),
    )
    django_request.META["MENU_SCAN_UPLOAD_LIMIT_INSTALLED"] = "1"


class MenuScanView(APIView):
    """
    POST /v1/pub-menu-scan

    Accept a photo of a pub beer menu (``multipart/form-data`` with a single
    ``image`` file part), send it to an AI vision model via OpenRouter, and return
    the extracted beers for the user to review.

    This is a PURE extraction helper: NO DB writes, NO XP, NO image storage. The
    user reviews/edits the result in ContributeScreen and the existing
    ``POST /v1/pub-community`` path does the actual save + XP.

    ``parser_classes`` is overridden LOCALLY to MultiPartParser (the global default
    stays JSON-only). The endpoint degrades gracefully: when the OpenRouter key is
    unset or the model is unreachable it returns 503 rather than 500/crashing.

    Responses
    ---------
    200 ``{"beers": [...], "drinks": [{"drink_type", "name", ...}], "model": <str>}``
        ``beers`` stays capped at 12 for released clients; ``drinks`` contains
        up to 24 categorized items for current clients.
    400 ``{"detail", "code": image_missing | image_invalid | image_too_large}``
    429 default DRF throttle response (scope ``menu_scan``).
    503 ``{"detail", "code": vision_unavailable | daily_cap}``
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "menu_scan"

    def post(self, request: Request) -> Response:
        if _menu_scan_request_too_large(request):
            return _menu_scan_too_large_response()

        _install_menu_scan_upload_limit(request)
        upload = request.FILES.get("image")
        if request._request.META.get("MENU_SCAN_UPLOAD_TOO_LARGE") == "1":
            return _menu_scan_too_large_response()
        if upload is None:
            return Response(
                {"detail": "Chybí fotka menu.", "code": "image_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            jpeg_bytes = validate_and_prepare_image(upload)
        except MenuScanError as exc:
            return _coded_error(exc)

        # Feature degrades gracefully when the vision key is unconfigured.
        if not settings.OPENROUTER_API_KEY:
            return _menu_scan_vision_unavailable()

        # Per-account daily cap: bounds how much of the shared OpenRouter pool one
        # actor can drain before the (cheaply mintable) per-account throttle. Reuses
        # the existing "daily_cap" code so released clients need no change.
        cap = settings.MENU_SCAN_DAILY_PER_ACCOUNT_CAP
        account_id = getattr(request.user, "pk", None)
        if (
            cap
            and account_id is not None
            and _menu_scan_count_today(account_id, datetime.now(tz=UTC)) > cap
        ):
            return _menu_scan_daily_cap_response()

        try:
            drinks = extract_drinks_from_image(jpeg_bytes)
        except OpenRouterDailyCapExceededError:
            return _menu_scan_daily_cap_response()
        except (OpenRouterUnavailableError, requests.RequestException):
            return _menu_scan_vision_unavailable()

        # ``beers`` remains byte-for-byte compatible for released clients. New
        # clients use the categorized ``drinks`` list for private logging.
        beers = [
            {key: drink[key] for key in ("name", "price_czk", "volume_ml")}
            for drink in drinks
            if drink["drink_type"] == DrinkLog.DrinkType.BEER
        ][:12]
        payload = MenuScanResultSerializer(
            {"beers": beers, "drinks": drinks, "model": settings.OPENROUTER_MODEL}
        ).data
        return Response(payload, status=status.HTTP_200_OK)


class NicknameAvailableView(APIView):
    """
    GET /v1/account/nickname-available?nickname=<candidate>

    Probe whether a nickname can be claimed. Public (AllowAny) with OPTIONAL auth:
    when a Bearer token is supplied, the caller's OWN current nickname reports as
    available (so the edit screen doesn't flag the unchanged value as taken).
    Returns ``200 {nickname, available, reason}``; ``400`` when the param is
    missing. Throttled per-IP (scope ``nickname_check``).
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "nickname_check"

    def get(self, request: Request) -> Response:
        nickname = request.query_params.get("nickname")
        if nickname is None or not nickname.strip():
            return Response(
                {"detail": "Chybí parametr 'nickname'.", "code": "nickname_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        nickname = nickname.strip()
        account = request.user if isinstance(request.user, Account) else None
        available, reason = accounts.check_nickname(nickname, account=account)
        return Response(
            {"nickname": nickname, "available": available, "reason": reason},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Pub amenities ("Zmapuj hospodu")
# ---------------------------------------------------------------------------


def _amenity_status(yes: int, no: int) -> tuple[str, float]:
    """Map (yes, no) vote counts to a (status, confidence) pair (§5.4).

    Pure + env-tunable. Below AMENITY_MIN_VOTES the fact stays "unknown" (the
    completeness meter still ticks via the moving confidence); a minority share
    >= AMENITY_DISPUTE_RATIO marks it "disputed". Confidence is agreement×volume,
    rounded to 4, so the Nth confirming voter barely moves it (diminishing
    reward for confirming known facts).
    """
    total = yes + no
    if total == 0:
        return (PubAmenity.Status.UNKNOWN, 0.0)
    majority, minority = max(yes, no), min(yes, no)
    agreement = majority / total  # 0.5..1.0
    volume = total / (total + 2)  # diminishing-returns weight
    confidence = round(agreement * volume, 4)  # 0.0..1.0
    if total < settings.AMENITY_MIN_VOTES:
        return (PubAmenity.Status.UNKNOWN, confidence)  # 1-2 votes: meter ticks, not yet truth
    if minority / total >= settings.AMENITY_DISPUTE_RATIO:
        return (PubAmenity.Status.DISPUTED, confidence)
    return ((PubAmenity.Status.YES if yes >= no else PubAmenity.Status.NO), confidence)


def _active_amenity_keys() -> set[str]:
    """The set of currently-active AmenityKind keys (the read/write allow-list)."""
    return set(AmenityKind.objects.filter(active=True).values_list("key", flat=True))


def _mapper_counters(stats: AccountUsageStats) -> dict:
    """The Mapér counter payload fed to ``maper_snapshot``."""
    return {
        "mapped_pubs_count": stats.mapped_pubs_count,
        "amenity_votes_count": stats.amenity_votes_count,
        "first_mapper_count": stats.first_mapper_count,
        "completed_pubs_count": stats.completed_pubs_count,
    }


def _recompute_amenity_aggregate(
    cache_key: str,
    pub_identity_key: str,
    amenity_key: str,
    account: Account,
    data: dict,
) -> tuple[PubAmenity, bool]:
    """Recompute the PubAmenity aggregate for one (cache_key, amenity_key).

    Must be called inside a transaction. get_or_create the aggregate row, then
    select_for_update it so concurrent voters on a hot pub serialize and counts
    never lost-update (§5.3). Returns (aggregate, was_first_map) where
    was_first_map is True only when THIS call created the row. first_mapper /
    first_mapped_at are set ONLY on creation and NEVER reassigned.
    """
    now = dj_timezone.now()
    agg, created = PubAmenity.objects.get_or_create(
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
        defaults={
            "cache_key": cache_key,
            "name": data.get("name") or "",
            "lat": data["lat"],
            "lng": data["lng"],
            "city": data.get("city") or "",
            "external_id": data.get("external_id") or "",
            "first_mapper": account,
            "first_mapped_at": now,
            "last_updated": now,
        },
    )
    # Lock THIS aggregate row (it exists now) so the recount is atomic on both
    # backends without relying on locking a phantom (not-yet-existing) vote row.
    agg = PubAmenity.objects.select_for_update().get(pk=agg.pk)

    votes = PubAmenityVote.objects.filter(
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
    )
    counts = votes.aggregate(
        yes_count=Count("id", filter=Q(value=PubAmenityVote.Value.YES)),
        no_count=Count("id", filter=Q(value=PubAmenityVote.Value.NO)),
    )
    yes_count = int(counts["yes_count"] or 0)
    no_count = int(counts["no_count"] or 0)

    agg.yes_count = yes_count
    agg.no_count = no_count
    agg.distinct_voter_count = yes_count + no_count  # one vote per account by unique constraint
    agg.status, agg.confidence = _amenity_status(yes_count, no_count)
    # Keep the denormalised identity fresh from the latest vote (dominant name).
    agg.name = data.get("name") or agg.name
    agg.lat = data["lat"]
    agg.lng = data["lng"]
    agg.city = data.get("city") or agg.city
    agg.external_id = data.get("external_id") or agg.external_id
    agg.last_updated = now
    # first_mapper / first_mapped_at are NEVER touched after creation.
    agg.save(
        update_fields=[
            "name",
            "lat",
            "lng",
            "city",
            "external_id",
            "yes_count",
            "no_count",
            "distinct_voter_count",
            "status",
            "confidence",
            "last_updated",
            "updated_at",
        ]
    )
    return agg, created


def _account_completed_pub(account: Account, pub_identity_key: str, active_keys: set[str]) -> bool:
    """Whether this account has answered every active amenity for this pub.

    The public completeness meter still depends on aggregate confidence, but the
    Pořádkumil badge copy is personal: "Zmapuj jednu hospodu naplno". A user who
    fills every visible row should unlock it even when the crowd has not reached
    AMENITY_MIN_VOTES yet. Deactivated kinds never block completion.
    """
    if not active_keys:
        return False
    answered = set(
        PubAmenityVote.objects.filter(
            account=account,
            pub_identity_key=pub_identity_key,
            amenity_key__in=active_keys,
        )
        .values_list("amenity_key", flat=True)
    )
    return active_keys.issubset(answered)


def _first_touched_pub_count_today(account: Account, now) -> int:
    """Distinct cache_keys this account FIRST cast a vote on since UTC midnight.

    The daily soft cap (AMENITY_MAX_PUBS_PER_DAY) is on distinct pubs first
    touched today, to blunt first-mapper farming. Counts the account's own vote
    rows created today (created_at is the server time the row first appeared);
    a flip/re-vote updates the row but does not move created_at, so it never
    re-counts an already-mapped pub.
    """
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return AccountMappedPub.objects.filter(
        account=account,
        created_at__gte=start_of_day,
    ).count()


def _award_community_xp(
    account: Account,
    cache_key: str,
    pub_identity_key: str,
    kinds: set[str],
) -> int:
    """Award first-fact Mapér XP for opening-hours / beers contributions and
    return the XP this request paid (the wire ``xp_awarded``).

    Mirrors :func:`_award_mapper_xp`'s durable-ledger idempotency: each kind pays
    ``MAPER_XP_FIRST_FACT`` AT MOST ONCE per (account, cache_key, kind) via
    :class:`PubCommunityXpLedger`, so a later edit or a retried offline POST pays
    0. F()-increments AccountUsageStats (never a read-modify-write on the hot
    Account row).

    The pub also counts toward ``distinct_mapped_pubs`` the first time the account
    touches it through ANY channel — reusing the shared :class:`AccountMappedPub`
    marker keeps an hours contribution and an amenity vote on the same pub from
    double-counting it. No first-mapper / pub-complete bonuses apply here: those
    are amenity-aggregate concepts, and hours/beers are last-writer-wins data.
    """
    _mapped_pub, is_new_pub = AccountMappedPub.objects.get_or_create(
        account=account,
        pub_identity_key=pub_identity_key,
        defaults={"cache_key": cache_key},
    )

    xp_awarded = 0
    facts = 0
    for kind in kinds:
        _ledger, pays_base = PubCommunityXpLedger.objects.get_or_create(
            account=account,
            cache_key=cache_key,
            kind=kind,
        )
        if pays_base:
            xp_awarded += settings.MAPER_XP_FIRST_FACT
            facts += 1

    inc: dict[str, object] = {}
    if facts:
        inc["amenity_votes_count"] = F("amenity_votes_count") + facts
    if is_new_pub:
        inc["mapped_pubs_count"] = F("mapped_pubs_count") + 1
    if xp_awarded > 0:
        inc["mapper_xp"] = F("mapper_xp") + xp_awarded

    if inc:
        stats, _ = AccountUsageStats.objects.get_or_create(account=account)
        AccountUsageStats.objects.filter(pk=stats.pk).update(**inc)

    return xp_awarded


def _award_mapper_xp(
    account: Account,
    cache_key: str,
    pub_identity_key: str,
    amenity_key: str,
    vote: PubAmenityVote,
    was_first_map: bool,
    active_keys: set[str],
    now,
) -> int:
    """Award server-authoritative Mapér XP for one applied vote and return the
    total XP this write paid (the wire ``xp_awarded``). Must run inside the vote
    transaction. F()-increments AccountUsageStats (never a read-modify-write on
    the hot Account row).

    Idempotency is anchored on DURABLE markers that outlive the vote row (§7.3),
    NOT on PubAmenityVote.awarded_xp — a retraction HARD-deletes the vote row, so
    a per-row gate would be reset and let a retract-then-revote re-farm:
      * base per-fact XP and the distinct-pub / first-fact counters are gated on
        the per-(account, cache_key, amenity_key) :class:`AmenityXpLedger` row,
        which is created on first pay and never deleted;
      * the pub-complete bonus is gated on the per-(account, cache_key)
        :class:`AccountPubCompletion` row, paid at most once per (account, pub).

    Award rules (§7.3):
      * base per-fact XP is paid AT MOST ONCE per (account, cache_key,
        amenity_key) — a flip/re-vote/retract-then-revote pays 0;
      * the base is ``first_fact`` (this account created the aggregate) or
        ``confirm`` (someone already answered it);
      * ``first_mapper_bonus`` is added when this write set the immutable
        aggregate first_mapper to this account (``was_first_map``), UNLESS the
        account is over the daily distinct-pub cap (soft anti-farm: accept the
        vote, suppress only the bonus — §7.3);
      * ``pub_complete_bonus`` is paid once when this fresh fact brings the pub to
        100% completeness.

    Counters incremented:
      * ``amenity_votes_count`` + 1 only when base XP is first paid for the row;
      * ``mapped_pubs_count`` + 1 the first time the account votes on a new pub;
      * ``first_mapper_count`` + 1 on a first-map (regardless of bonus suppression);
      * ``completed_pubs_count`` + 1 on a pub-complete bonus.
    """
    # A pub is "new for the account" only when this durable per-pub marker is
    # created. The unique row makes mapped_pubs_count race-safe across concurrent
    # first votes for different amenities on the same pub.
    _mapped_pub, is_new_pub_for_account = AccountMappedPub.objects.get_or_create(
        account=account,
        pub_identity_key=pub_identity_key,
        defaults={"cache_key": cache_key},
    )

    # Durable base-XP gate: the first pay creates the ledger row; a flip/re-vote/
    # retract-then-revote finds it already present and pays 0.
    _ledger, pays_base = AmenityXpLedger.objects.get_or_create(
        account=account,
        pub_identity_key=pub_identity_key,
        amenity_key=amenity_key,
        defaults={"cache_key": cache_key},
    )

    xp_awarded = 0
    inc: dict[str, object] = {}

    if pays_base:
        if was_first_map:
            xp_awarded += settings.MAPER_XP_FIRST_FACT
            inc["first_mapper_count"] = F("first_mapper_count") + 1
            # Daily soft cap: over the cap, accept the vote but suppress the
            # first-mapper bonus (NOT a 4xx) to blunt city-grid farming (§7.3).
            over_cap = (
                _first_touched_pub_count_today(account, now)
                > settings.AMENITY_MAX_PUBS_PER_DAY
            )
            if not over_cap:
                xp_awarded += settings.MAPER_XP_FIRST_MAPPER_BONUS
        else:
            xp_awarded += settings.MAPER_XP_CONFIRM

        inc["amenity_votes_count"] = F("amenity_votes_count") + 1

    # Completion marker: once the account has live answers for every active row,
    # unlock "Pořádkumil" and bump the completed-pub counter exactly once. The XP
    # bonus is paid only when this same write also paid fresh base XP; that keeps
    # legacy/revote repairs from showing fake +XP while still unlocking the badge.
    if _account_completed_pub(account, pub_identity_key, active_keys):
        _completion, first_completion = AccountPubCompletion.objects.get_or_create(
            account=account,
            pub_identity_key=pub_identity_key,
            defaults={"cache_key": cache_key},
        )
        if first_completion:
            inc["completed_pubs_count"] = F("completed_pubs_count") + 1
            if pays_base:
                xp_awarded += settings.MAPER_XP_PUB_COMPLETE_BONUS

    if is_new_pub_for_account:
        inc["mapped_pubs_count"] = F("mapped_pubs_count") + 1

    # Mirror the XP onto the vote row for observability (the durable gate is the
    # ledger, NOT this field — a deleted row no longer matters).
    if pays_base and xp_awarded > 0:
        vote.awarded_xp = xp_awarded
        vote.save(update_fields=["awarded_xp"])

    if xp_awarded > 0:
        inc["mapper_xp"] = F("mapper_xp") + xp_awarded

    if inc:
        stats, _ = AccountUsageStats.objects.get_or_create(account=account)
        AccountUsageStats.objects.filter(pk=stats.pk).update(**inc)

    return xp_awarded


class PubAmenityKindsView(APIView):
    """
    GET /v1/pub-amenities/kinds → the server-driven amenity taxonomy.

    Public (AllowAny, like PubsNearView) and cacheable: the client GETs this to
    render the mapping sheet. Only active kinds are returned, ordered by
    (order, key). ``version`` is the full ISO-8601 max(updated_at) across active
    kinds so two same-day edits produce distinct versions. Throttled per-IP
    (scope "amenity_kinds").
    """

    # Truly public: no auth class at all (like PubsNearView), so a stale/invalid
    # bearer can never 401 this read — the taxonomy never needs an account.
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "amenity_kinds"

    def get(self, request: Request) -> Response:
        try:
            kinds = list(
                AmenityKind.objects.filter(active=True).order_by("rank", "key")
            )
            version = (
                max(k.updated_at for k in kinds).isoformat()
                if kinds
                else dj_timezone.now().isoformat()
            )
            items = PubAmenityKindSerializer(kinds, many=True).data
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities/kinds: unexpected error: %s", exc, exc_info=True)
            return _internal_error()
        return Response({"kinds": items, "version": version}, status=status.HTTP_200_OK)


class PubAmenityVoteView(APIView):
    """
    PUT    /v1/pub-amenities/votes                          → upsert votes (per-amenity LWW)
    GET    /v1/pub-amenities/votes                          → list the account's own votes
    DELETE /v1/pub-amenities/votes/<cache_key>/<amenity_key> → idempotent retract

    Two-way sync of a user's PUBLIC per-(pub, amenity) yes/no votes, each keyed
    by the geohash-8 ``cache_key`` computed server-side. The body is a
    ``{"votes": [...]}`` array (one row per amenity — §4.2); conflict resolution
    is LAST-WRITE-WINS on each row's ``client_updated_at`` so a stale push of one
    amenity can never clobber another. A ``value`` of null is an explicit
    retraction. On every write the (cache_key, amenity_key) aggregate is
    recomputed synchronously under a row lock. Throttled per-IP (scope
    "pub_amenities").
    """

    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pub_amenities"

    def get(self, request: Request) -> Response:
        try:
            votes = PubAmenityVote.objects.filter(account=request.user)
            tombstones = PubAmenityVoteTombstone.objects.filter(account=request.user)
            items = [_amenity_vote_item(vote) for vote in votes]
            items.extend(
                {
                    "cache_key": tombstone.cache_key,
                    "pub_identity_key": tombstone.pub_identity_key,
                    "name": tombstone.name,
                    "amenity_key": tombstone.amenity_key,
                    "value": None,
                    "client_updated_at": tombstone.client_updated_at.isoformat(),
                }
                for tombstone in tombstones
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities/votes: unexpected error listing votes: %s", exc, exc_info=True)
            return _internal_error()
        return Response({"votes": items}, status=status.HTTP_200_OK)

    def put(self, request: Request) -> Response:
        serializer = PubAmenityVotesRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            active_keys = _active_amenity_keys()
            results = [
                self._apply_one(request.user, row, active_keys)
                for row in serializer.validated_data["votes"]
            ]
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities/votes: unexpected error saving votes: %s", exc, exc_info=True)
            return _internal_error()

        # mapper: fresh Mapér snapshot is returned ONCE at the envelope level so
        # Profile updates without a second GET. Re-read the durable XP from
        # AccountUsageStats AFTER all rows applied (F()-increments are committed).
        stats = AccountUsageStats.objects.filter(account=request.user).first()
        counters = _mapper_counters(stats) if stats is not None else None
        mapper = maper_snapshot(stats.mapper_xp if stats is not None else 0, counters=counters)
        return Response({"results": results, "mapper": mapper}, status=status.HTTP_200_OK)

    def _apply_one(self, account: Account, data: dict, active_keys: set[str]) -> dict:
        """Apply one amenity vote row and return its result object.

        Each row runs in its own atomic block so one stale/ignored row does not
        roll back its siblings. ``cache_key`` is derived from lat/lng; lat/lng
        are never logged or echoed.
        """
        amenity_key = data["amenity_key"]
        cache_key = geohash8(data["lat"], data["lng"])
        pub_identity_key = _pub_identity_key(cache_key, data.get("name") or "")
        client_updated_at = data["client_updated_at"]
        # The wire sends explicit null as a retraction.
        value = data.get("value")

        # Unknown/inactive key → ignore (NOT 400): additive forward-compat so an
        # old server tolerates a newer client's key without breaking its queue.
        if amenity_key not in active_keys:
            return {
                "applied": False,
                "ignored_unknown_amenity": True,
                "deleted": False,
                "was_first_map": False,
                "xp_awarded": 0,  # an ignored unknown key never pays XP
                "vote": None,
                "aggregate": None,
            }

        with transaction.atomic():
            existing = (
                PubAmenityVote.objects.select_for_update()
                .filter(account=account, pub_identity_key=pub_identity_key, amenity_key=amenity_key)
                .first()
            )
            tombstone = (
                PubAmenityVoteTombstone.objects.select_for_update()
                .filter(account=account, pub_identity_key=pub_identity_key, amenity_key=amenity_key)
                .first()
            )

            # Geohash-8 collision guard: if the stored vote's name does not match
            # the new one, this is a logged collision signal; v1 keeps writing
            # (the read path's names_match guard protects consumers). §2.6.
            new_name = data.get("name") or ""
            if existing is not None and new_name and existing.name and not names_match(
                new_name, existing.name
            ):
                logger.info(
                    "pub-amenities/votes: geohash-8 name collision for %s/%s",
                    cache_key,
                    amenity_key,
                )

            # Last-write-wins per amenity: a stale push (<= stored timestamp) is
            # ignored → applied: false, return the current aggregate.
            if existing is not None and existing.client_updated_at >= client_updated_at:
                agg = PubAmenity.objects.filter(
                    pub_identity_key=pub_identity_key, amenity_key=amenity_key
                ).first()
                return {
                    "applied": False,
                    "ignored_unknown_amenity": False,
                    "deleted": False,
                    "was_first_map": False,
                    "xp_awarded": 0,  # a stale (LWW-rejected) write pays nothing
                    "vote": _vote_minimal(existing),
                    "aggregate": (
                        _amenity_aggregate_item(agg, my_value=existing.value)
                        if agg is not None
                        else None
                    ),
                }

            # A newer/equal durable retraction wins even when the live vote row is
            # gone, preventing stale offline upserts from resurrecting a cleared
            # answer.
            if tombstone is not None and tombstone.client_updated_at >= client_updated_at:
                agg = PubAmenity.objects.filter(
                    pub_identity_key=pub_identity_key, amenity_key=amenity_key
                ).first()
                return {
                    "applied": False,
                    "ignored_unknown_amenity": False,
                    "deleted": False,
                    "was_first_map": False,
                    "xp_awarded": 0,
                    "vote": None,
                    "aggregate": (
                        _amenity_aggregate_item(agg, my_value=None)
                        if agg is not None
                        else None
                    ),
                }

            # value: null → explicit retraction (delete the user's row),
            # guarded by the same LWW timestamp above.
            if value is None:
                deleted = existing is not None
                if existing is not None:
                    existing.delete()
                PubAmenityVoteTombstone.objects.update_or_create(
                    account=account,
                    cache_key=cache_key,
                    pub_identity_key=pub_identity_key,
                    amenity_key=amenity_key,
                    defaults={
                        "name": new_name,
                        "client_updated_at": client_updated_at,
                    },
                )
                agg = None
                if deleted or PubAmenity.objects.filter(
                    pub_identity_key=pub_identity_key, amenity_key=amenity_key
                ).exists():
                    agg, _ = _recompute_amenity_aggregate(
                        cache_key,
                        pub_identity_key,
                        amenity_key,
                        account,
                        data,
                    )
                return {
                    "applied": True,
                    "ignored_unknown_amenity": False,
                    "deleted": deleted,
                    "was_first_map": False,
                    "xp_awarded": 0,  # retraction never pays (and never claws back)
                    "vote": None,
                    "aggregate": (
                        _amenity_aggregate_item(agg, my_value=None)
                        if agg is not None
                        else None
                    ),
                }

            # XP idempotency gate is the DURABLE AmenityXpLedger / AccountPubCompletion
            # marker (checked inside _award_mapper_xp), NOT the vote row — a
            # retraction hard-deletes the row, so a per-row gate would re-farm on
            # revote (§7.3).
            # Upsert the user's own vote row (unique per account). update_or_create
            # is IntegrityError-safe for two concurrent first voters: one inserts,
            # the other updates the same unique row.
            vote, _ = PubAmenityVote.objects.update_or_create(
                account=account,
                pub_identity_key=pub_identity_key,
                amenity_key=amenity_key,
                defaults={
                    "cache_key": cache_key,
                    "name": new_name,
                    "lat": data["lat"],
                    "lng": data["lng"],
                    "city": data.get("city") or "",
                    "external_id": data.get("external_id") or "",
                    "value": value,
                    "client_updated_at": client_updated_at,
                    "taxonomy_version": data.get("taxonomy_version"),
                },
            )
            if tombstone is not None:
                tombstone.delete()
            agg, was_first_map = _recompute_amenity_aggregate(
                cache_key, pub_identity_key, amenity_key, account, data
            )
            # Award server-authoritative XP + bump counters in the SAME transaction
            # (F()-increments, never a read-modify-write on the hot Account row).
            xp_awarded = _award_mapper_xp(
                account=account,
                cache_key=cache_key,
                pub_identity_key=pub_identity_key,
                amenity_key=amenity_key,
                vote=vote,
                was_first_map=was_first_map,
                active_keys=active_keys,
                now=dj_timezone.now(),
            )
            # Re-read so the echoed client_updated_at is the DB-normalised UTC
            # value, matching the GET restore path / _rating_item exactly.
            vote.refresh_from_db(fields=["client_updated_at", "value"])

        return {
            "applied": True,
            "ignored_unknown_amenity": False,
            "deleted": False,
            # was_first_map is an AGGREGATE fact (this write created the row); the
            # first-mapper XP bonus rides on it (subject to the daily cap).
            "was_first_map": was_first_map,
            # The authoritative per-vote award for the optimistic toast (§7.1).
            "xp_awarded": xp_awarded,
            # Echo the persisted row (client_updated_at normalised to UTC, like
            # the GET restore path and _rating_item), not the raw request offset.
            "vote": _vote_minimal(vote),
            "aggregate": _amenity_aggregate_item(agg, my_value=value),
        }

    def delete(self, request: Request, cache_key: str, amenity_key: str) -> Response:
        # Idempotent delete scoped to the account, filtering only by (account,
        # cache_key, amenity_key) with NO AmenityKind existence check, so a vote
        # for a since-deactivated kind can always be cleared. Recompute the
        # aggregate so the public truth reflects the removal.
        try:
            with transaction.atomic():
                existing = (
                    PubAmenityVote.objects.select_for_update()
                    .filter(account=request.user, cache_key=cache_key, amenity_key=amenity_key)
                    .first()
                )
                deleted = existing is not None
                if existing is not None:
                    tombstone_at = dj_timezone.now()
                    data = {
                        "name": existing.name,
                        "lat": existing.lat,
                        "lng": existing.lng,
                        "city": existing.city,
                        "external_id": existing.external_id,
                    }
                    existing.delete()
                    PubAmenityVoteTombstone.objects.update_or_create(
                        account=request.user,
                        cache_key=cache_key,
                        pub_identity_key=existing.pub_identity_key,
                        amenity_key=amenity_key,
                        defaults={
                            "name": existing.name,
                            "client_updated_at": tombstone_at,
                        },
                    )
                    # Only recompute if the aggregate row exists (it should).
                    if PubAmenity.objects.filter(
                        pub_identity_key=existing.pub_identity_key, amenity_key=amenity_key
                    ).exists():
                        _recompute_amenity_aggregate(
                            cache_key, existing.pub_identity_key, amenity_key, request.user, data
                        )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "pub-amenities/votes: unexpected error deleting vote %s/%s: %s",
                cache_key,
                amenity_key,
                exc,
                exc_info=True,
            )
            return _internal_error()
        return Response({"deleted": deleted}, status=status.HTTP_200_OK)


def _vote_minimal(vote: PubAmenityVote) -> dict:
    """The minimal {amenity_key, value, client_updated_at} echoed on a PUT result."""
    return {
        "cache_key": vote.cache_key,
        "pub_identity_key": vote.pub_identity_key,
        "name": vote.name,
        "amenity_key": vote.amenity_key,
        "value": vote.value,
        "client_updated_at": vote.client_updated_at.isoformat(),
    }


def _optional_amenity_account(request: Request) -> Account | None:
    """Best-effort bearer → Account for the public amenity read.

    The read is truly AllowAny (authentication_classes=[]) so a stale/invalid
    token can never 401 it (§4.4, like PubsNearView). We still want ``my_value``
    for a valid token, so we resolve the account out-of-band and SWALLOW any
    AuthenticationFailed — a bad token simply degrades to an anonymous read.
    """
    try:
        result = AccountTokenAuthentication().authenticate(request)
    except AuthenticationFailed:
        return None
    if result is None:
        return None
    account, _raw_token = result
    return account if isinstance(account, Account) else None


class PubAmenityReadView(APIView):
    """
    GET /v1/pub-amenities?cache_keys=<k1>,<k2>...&name=<pub name>

    Public, cheap, local-DB-only aggregate read (the sheet/read path). Served
    from PubAmenity with its OWN short TTL, deliberately NOT bolted onto the
    metered Mapy ``/pubs/near`` proxy (§4.4). Each row is gated against the
    requesting client's pub ``name`` via names_match (§2.6): a mismatch treats
    the row as unmapped rather than leaking a neighbouring business's votes.
    Only active kinds are returned; completeness uses the active denominator and
    is clamped to [0, 1] so a pub never shows >100%. ``my_value`` is populated
    only for authenticated callers. Throttled per-IP (scope "amenity_reads").
    """

    # Truly public (like PubsNearView): no auth class, so a stale token can never
    # 401 this read. ``my_value`` is resolved best-effort via the optional bearer
    # lookup below, which degrades a bad token to an anonymous read.
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "amenity_reads"

    def get(self, request: Request) -> Response:
        serializer = PubAmenityReadQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        request_name = serializer.validated_data.get("name") or ""
        raw_keys = serializer.validated_data["cache_keys"]
        # Comma-split, strip, dedup (preserve order), cap to AMENITY_READ_MAX_KEYS.
        seen: set[str] = set()
        cache_keys: list[str] = []
        for k in raw_keys.split(","):
            k = k.strip()
            if k and k not in seen:
                seen.add(k)
                cache_keys.append(k)
            if len(cache_keys) >= settings.AMENITY_READ_MAX_KEYS:
                break

        # AllowAny + authentication_classes=[] means request.user is anonymous;
        # resolve my_value best-effort (a bad token degrades to anonymous, no 401).
        account = _optional_amenity_account(request)

        try:
            active_keys = _active_amenity_keys()
            total_kinds = len(active_keys)

            # My own live votes for these cells, so my_value comes from ONE query.
            my_votes: dict[tuple[str, str], str] = {}
            if account is not None and cache_keys:
                for v in PubAmenityVote.objects.filter(
                    account=account, cache_key__in=cache_keys
                ).values_list("pub_identity_key", "amenity_key", "value"):
                    my_votes[(v[0], v[1])] = v[2]

            aggregates = (
                PubAmenity.objects.filter(cache_key__in=cache_keys)
                if cache_keys
                else PubAmenity.objects.none()
            )
            by_cache: dict[str, list[PubAmenity]] = {}
            for agg in aggregates:
                # names_match collision guard (§2.6). When the caller sent a
                # name, a row can only be served if it carries a name that
                # matches: a stored EMPTY name can't be verified against the
                # request, so drop it rather than leak it to any business sharing
                # the ~38m geohash-8 cell. (The write path requires a non-blank
                # name, so guardless aggregates can no longer be created; this
                # also defends any legacy empty-name rows.)
                if request_name and (not agg.name or not names_match(request_name, agg.name)):
                    continue
                # Only active kinds are surfaced (deactivated kinds excluded).
                if agg.amenity_key not in active_keys:
                    continue
                by_cache.setdefault(agg.cache_key, []).append(agg)

            pubs = []
            for cache_key in cache_keys:
                rows = by_cache.get(cache_key, [])
                mapper_count = (
                    max((r.distinct_voter_count for r in rows), default=0) if rows else 0
                )
                mapped_count = sum(
                    1 for r in rows if r.status != PubAmenity.Status.UNKNOWN
                )
                pct = (mapped_count / total_kinds) if total_kinds else 0.0
                pct = max(0.0, min(1.0, pct))  # clamp to [0, 1]
                amenities = [
                    _amenity_aggregate_item(
                        r, my_value=my_votes.get((r.pub_identity_key, r.amenity_key))
                    )
                    for r in rows
                ]
                pubs.append(
                    {
                        "cache_key": cache_key,
                        "mapper_count": mapper_count,
                        "completeness": {
                            "mapped_count": mapped_count,
                            "total_kinds": total_kinds,
                            "pct": round(pct, 4),
                        },
                        "amenities": amenities,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("pub-amenities: unexpected error reading aggregates: %s", exc, exc_info=True)
            return _internal_error()

        return Response({"pubs": pubs}, status=status.HTTP_200_OK)

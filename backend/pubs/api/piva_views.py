"""Piva tab: national ranking, beer search, public reviews and my beer collection."""

from __future__ import annotations

from django.db.models import Q, TextField, Value
from django.db.models.functions import Coalesce, Lower, NullIf, Trim
from django.utils import timezone as dj_timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from pubs.beer_catalog import BeerCatalogMatchCache, match_beer_identity, suggest_beers
from pubs.beer_photo_gallery import visible_beer_photo_count, visible_beer_photos
from pubs.beer_ranking import (
    DEGREES,
    STYLES,
    degree_of,
    is_early,
    pouring_pubs,
    ranking_item,
    regional_item,
    star_shares,
    tag_shares,
)
from pubs.models import (
    Account,
    BeerCheckIn,
    BeerPhoto,
    BeerProduct,
    BeerRanking,
    BeerRegionRanking,
    BeerStyleVote,
    DrinkLog,
)
from pubs.regions import REGION_CODES

from .authentication import AccountTokenAuthentication

# Ochutnávač levels: taste the top 10, then the top 50, then the top 100 of the ranking.
TASTER_TIERS = (10, 50, 100)
# "Proti proudu" lists beers where my rating is at least this far from the national average.
AGAINST_MIN_GAP = 1.0
SHARED_VISIBILITIES = (BeerCheckIn.Visibility.FRIENDS, BeerCheckIn.Visibility.PUBLIC)


class _BeersPolicy(APIView):
    authentication_classes = [AccountTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "beers"


def _int_param(request: Request, name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(request.query_params.get(name, default))
    except TypeError, ValueError:
        return default
    return max(low, min(high, value))


def _location(request: Request) -> tuple[float | None, float | None]:
    try:
        lat = float(request.query_params["lat"])
        lng = float(request.query_params["lng"])
    except KeyError, TypeError, ValueError:
        return None, None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None, None
    return lat, lng


def beer_photo_count(product: BeerProduct | None, viewer: Account) -> int | None:
    """Photos of this beer the viewer may see, for the beer page."""

    if product is None:
        return None
    return visible_beer_photo_count(viewer, beer=product.key)


def review_photos(checkins: list[BeerCheckIn], request: Request) -> dict[int, str]:
    """The author's latest photo of the same beer per review, only if the viewer may see it."""

    from pubs.api.views import _accepted_friend_ids, _blocked_account_ids

    if not checkins:
        return {}
    viewer = request.user
    photos = (
        visible_beer_photos(
            viewer,
            friend_ids=set(_accepted_friend_ids(viewer)),
            blocked_ids=_blocked_account_ids(viewer),
        )
        .filter(
            account_id__in={row.account_id for row in checkins},
            beer_key__in={row.beer_key for row in checkins},
        )
        .order_by("-created_at")
    )
    latest: dict[tuple[int, str], BeerPhoto] = {}
    for photo in photos[:500]:
        latest.setdefault((photo.account_id, photo.beer_key), photo)
    urls: dict[int, str] = {}
    for row in checkins:
        photo = latest.get((row.account_id, row.beer_key))
        if photo is None:
            continue
        try:
            urls[row.pk] = request.build_absolute_uri(photo.image.url)
        except ValueError:
            continue
    return urls


def resolve_product(
    product_key: str, beer_name: str = "", brewery_name: str = ""
) -> BeerProduct | None:
    if product_key:
        return BeerProduct.objects.filter(key=product_key, active=True).first()
    if not beer_name:
        return None
    match = match_beer_identity(beer_name, brewery_name, match_cache=BeerCatalogMatchCache())
    return match.product if match is not None else None


def beer_global_detail(
    product: BeerProduct | None, lat: float | None, lng: float | None, viewer: Account
) -> dict:
    """The additive, everyone-wide part of GET /v1/beers/detail."""

    row = BeerRanking.objects.filter(product=product).first() if product is not None else None
    mine = (
        BeerStyleVote.objects.filter(account=viewer, product=product)
        .values_list("style", "degree")
        .first()
        if product is not None
        else None
    )
    pubs = pouring_pubs([product.pk], lat, lng).get(product.pk) if product is not None else None
    return {
        "product_key": product.key if product is not None else None,
        "brand_name": product.brand_name if product is not None else "",
        "styles": row.styles if row is not None else [],
        "global_rating": round(row.rating_avg, 2)
        if row is not None and row.rating_avg is not None
        else None,
        "global_rating_count": row.rating_count if row is not None else 0,
        "national_rank": row.rank if row is not None else None,
        "rating_stars": star_shares(row),
        "tag_shares": tag_shares(row),
        "drunk_total": row.drunk_total if row is not None else 0,
        "drinkers": row.drinkers if row is not None else 0,
        "drunk_week": row.drunk_week if row is not None else 0,
        "pubs_pouring": pubs["count"] if pubs else 0,
        "nearest_pub": pubs["nearest"] if pubs else None,
        "photo_count": beer_photo_count(product, viewer),
        "style_settled": bool(row is not None and row.style_settled),
        "degree": (row.degree if row is not None else degree_of(product.name if product else ""))
        or None,
        "my_style": mine[0] or None if mine else None,
        "my_degree": mine[1] or None if mine else None,
    }


class BeerRankingView(_BeersPolicy):
    """GET /v1/beers/ranking?order=best|bottom&style=&degree=&region=&cursor=&limit= — the ranking.

    Without ``region`` it is national; with a NUTS 3 code it ranks the ratings and
    drinks given at pubs in that region.
    """

    def get(self, request: Request) -> Response:
        order = request.query_params.get("order") or "best"
        style = request.query_params.get("style") or ""
        region = request.query_params.get("region") or ""
        degree = request.query_params.get("degree") or ""
        if (
            order not in ("best", "bottom")
            or (style and style not in STYLES)
            or (degree and degree not in DEGREES)
            or (region and region not in REGION_CODES)
        ):
            return Response({"code": "invalid_query"}, status=status.HTTP_400_BAD_REQUEST)
        offset = _int_param(request, "cursor", 0, 0, 10_000)
        limit = _int_param(request, "limit", 20, 1, 50)
        if region:
            return self._regional(region, order, style, degree, offset, limit)
        rows = BeerRanking.objects.filter(rank__isnull=False).select_related("product")
        rows = rows.order_by("rank" if order == "best" else "-rank")
        if degree:
            rows = rows.filter(degree=degree)
        if style:
            # styles is a short JSON list; filtering in Python keeps SQLite and Postgres alike.
            ranked = [row for row in rows if style in (row.styles or [])][
                offset : offset + limit + 1
            ]
        else:
            ranked = list(rows[offset : offset + limit + 1])
        page = ranked[:limit]
        computed_at = (
            BeerRanking.objects.order_by("-computed_at")
            .values_list("computed_at", flat=True)
            .first()
        )
        return Response(
            {
                "early": is_early(),
                "computed_at": computed_at,
                "items": [ranking_item(row, offset + index + 1) for index, row in enumerate(page)],
                "next_cursor": str(offset + limit) if len(ranked) > limit else None,
            },
            status=status.HTTP_200_OK,
        )

    def _regional(
        self, region: str, order: str, style: str, degree: str, offset: int, limit: int
    ) -> Response:
        rows = (
            BeerRegionRanking.objects.filter(region=region, rank__isnull=False)
            .select_related("product", "product__ranking")
            .order_by("rank" if order == "best" else "-rank")
        )
        if degree:
            rows = rows.filter(product__ranking__degree=degree)
        if style:
            ranked = [
                row
                for row in rows
                if style
                in (getattr(row.product, "ranking", None) and row.product.ranking.styles or [])
            ][offset : offset + limit + 1]
        else:
            ranked = list(rows[offset : offset + limit + 1])
        page = ranked[:limit]
        computed_at = (
            BeerRegionRanking.objects.order_by("-computed_at")
            .values_list("computed_at", flat=True)
            .first()
        )
        return Response(
            {
                "early": is_early(),
                "computed_at": computed_at,
                "items": [regional_item(row, offset + index + 1) for index, row in enumerate(page)],
                "next_cursor": str(offset + limit) if len(ranked) > limit else None,
            },
            status=status.HTTP_200_OK,
        )


class BeerStyleVoteView(_BeersPolicy):
    """POST /v1/beers/style — my answer to "Jaké je to pivo?" for one catalogue beer.

    Body: ``product`` (or ``beer_name`` + ``brewery_name``) and ``style`` and/or
    ``degree``. A field left out keeps my earlier answer. The ranking uses the
    majority of answers once enough people agree.
    """

    def post(self, request: Request) -> Response:
        style = str(request.data.get("style") or "")
        degree = str(request.data.get("degree") or "")
        if (
            (not style and not degree)
            or (style and style not in BeerStyleVote.Style.values)
            or (degree and degree not in BeerStyleVote.Degree.values)
        ):
            return Response({"code": "invalid_style"}, status=status.HTTP_400_BAD_REQUEST)
        product = resolve_product(
            str(request.data.get("product") or "").strip(),
            str(request.data.get("beer_name") or "").strip()[:200],
            str(request.data.get("brewery_name") or "").strip()[:200],
        )
        if product is None:
            return Response({"code": "beer_not_found"}, status=status.HTTP_404_NOT_FOUND)
        changes = {key: value for key, value in (("style", style), ("degree", degree)) if value}
        vote, _ = BeerStyleVote.objects.update_or_create(
            account=request.user, product=product, defaults=changes
        )
        return Response(
            {
                "product_key": product.key,
                "my_style": vote.style or None,
                "my_degree": vote.degree or None,
            },
            status=status.HTTP_200_OK,
        )


class BeerSearchView(_BeersPolicy):
    """GET /v1/beers/search?q= — catalogue beers with their national rating."""

    def get(self, request: Request) -> Response:
        query = (request.query_params.get("q") or "").strip()[:80]
        limit = _int_param(request, "limit", 20, 1, 40)
        keys: list[str] = []
        if len(query) < 2:
            keys = list(
                BeerRanking.objects.filter(rank__isnull=False)
                .order_by("rank")
                .values_list("product__key", flat=True)[:limit]
            )
        keys += [
            item.slug
            for item in suggest_beers(query, limit=limit)
            if item.kind == "product" and item.slug not in keys
        ]
        keys = keys[:limit]
        products = {product.key: product for product in BeerProduct.objects.filter(key__in=keys)}
        rankings = {
            row.product_id: row for row in BeerRanking.objects.filter(product__key__in=keys)
        }
        items = []
        for key in keys:
            product = products.get(key)
            if product is None:
                continue
            row = rankings.get(product.pk)
            items.append(
                {
                    "product_key": product.key,
                    "name": product.name,
                    "brand_name": product.brand_name,
                    "styles": row.styles if row is not None else [],
                    "rating_avg": round(row.rating_avg, 2)
                    if row is not None and row.rating_avg is not None
                    else None,
                    "rating_count": row.rating_count if row is not None else 0,
                }
            )
        return Response({"items": items}, status=status.HTTP_200_OK)


class BeerReviewsView(_BeersPolicy):
    """GET /v1/beers/reviews?product=|beer_name=&filter=newest|party|photo&cursor= — what people write.

    Shows check-ins the author made public, plus the ones my friends share with
    their party. Reviews carry the day, never the time.
    """

    def get(self, request: Request) -> Response:
        from .views import (
            _accepted_friend_ids,
            _beer_checkin_queryset,
            _beer_identity_query,
            _blocked_account_ids,
        )

        product_key = (request.query_params.get("product") or "").strip()
        beer_name = (request.query_params.get("beer_name") or "").strip()
        brewery_name = (request.query_params.get("brewery_name") or "").strip()
        review_filter = request.query_params.get("filter") or "newest"
        if review_filter not in ("newest", "party", "photo") or not (product_key or beer_name):
            return Response({"code": "invalid_query"}, status=status.HTTP_400_BAD_REQUEST)
        offset = _int_param(request, "cursor", 0, 0, 10_000)
        limit = _int_param(request, "limit", 10, 1, 50)

        if product_key:
            product = BeerProduct.objects.filter(key=product_key).first()
            if product is None:
                return Response(
                    {"total": 0, "items": [], "next_cursor": None}, status=status.HTTP_200_OK
                )
            identity = Q(beer_product=product)
        else:
            identity = _beer_identity_query(
                beer_name, brewery_name, match_cache=BeerCatalogMatchCache()
            )

        viewer = request.user
        blocked = _blocked_account_ids(viewer)
        friends = set(_accepted_friend_ids(viewer)) - blocked
        # Like public nights, a stranger's review needs a nickname to stand behind it.
        public = Q(visibility=BeerCheckIn.Visibility.PUBLIC, account__nickname__isnull=False) & ~Q(
            account__nickname=""
        )
        visible = public | Q(visibility__in=SHARED_VISIBILITIES, account_id__in=friends)
        rows = (
            _beer_checkin_queryset()
            .filter(identity)
            .filter(visible)
            .filter(account__status=Account.Status.ACTIVE, account__ghost_mode=False)
            .exclude(account=viewer)
            .exclude(account_id__in=blocked)
            .exclude(note="")
            .order_by("-checked_in_at", "-id")
        )
        if review_filter == "party":
            rows = rows.filter(account_id__in=friends)
        if review_filter == "photo":
            with_photo = review_photos(list(rows[:500]), request)
            rows = rows.filter(id__in=list(with_photo))
        total = rows.count()
        page = list(rows[offset : offset + limit])
        photos = review_photos(page, request)
        return Response(
            {
                "total": total,
                "items": [self._item(row, viewer, friends, photos.get(row.pk)) for row in page],
                "next_cursor": str(offset + limit) if offset + limit < total else None,
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _item(row: BeerCheckIn, viewer: Account, friends: set[int], photo_url: str | None) -> dict:
        author = row.account
        reactions = list(row.reactions.all())
        return {
            "id": str(row.public_id),
            "author": {
                "id": str(author.public_id),
                "nickname": author.nickname,
                "display_name": author.display_name,
            },
            "in_party": row.account_id in friends,
            "rating": float(row.rating) if row.rating is not None else None,
            "tags": row.tags if isinstance(row.tags, list) else [],
            "note": row.note,
            "pub_name": row.pub_name,
            "day": dj_timezone.localtime(row.checked_in_at).date().isoformat(),
            "cheers": len(reactions),
            "my_reaction": next((r.kind for r in reactions if r.account_id == viewer.pk), None),
            "photo_url": photo_url,
        }


class BeerCollectionView(_BeersPolicy):
    """GET /v1/beers/collection?lat=&lng= — my beers, the Ochutnávač challenge and where I disagree."""

    def get(self, request: Request) -> Response:
        account = request.user
        lat, lng = _location(request)
        drinks = account.drinks.filter(drink_type=DrinkLog.DrinkType.BEER, is_suspect=False)
        identity = Coalesce(
            NullIf(Trim("beer_product_key"), Value("")),
            NullIf(Trim("beer_brand_key"), Value("")),
            NullIf(Lower(Trim("beer_name")), Value("")),
            output_field=TextField(),
        )
        distinct_beers = (
            drinks.annotate(identity=identity)
            .filter(identity__isnull=False)
            .order_by()
            .values("identity")
            .distinct()
            .count()
        )
        breweries = (
            drinks.exclude(beer_brand_key="").order_by().values("beer_brand_key").distinct().count()
        )

        drunk_counts: dict[int, int] = {}
        for product_id in drinks.filter(beer_product__isnull=False).values_list(
            "beer_product_id", flat=True
        ):
            drunk_counts[product_id] = drunk_counts.get(product_id, 0) + 1
        my_ratings: dict[int, float] = {}
        rated_or_checked: set[int] = set()
        for product_id, rating in (
            account.beer_checkins.filter(beer_product__isnull=False)
            .order_by("checked_in_at", "id")
            .values_list("beer_product_id", "rating")
        ):
            rated_or_checked.add(product_id)
            if rating is not None:
                my_ratings[product_id] = float(rating)
        had = set(drunk_counts) | rated_or_checked

        return Response(
            {
                "distinct_beers": distinct_beers,
                "drunk_total": drinks.count(),
                "breweries": breweries,
                "taster": self._taster(had, lat, lng),
                "against": self._against(my_ratings),
                "unrated": self._unrated(drunk_counts, my_ratings),
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _taster(had: set[int], lat: float | None, lng: float | None) -> dict | None:
        ranked = list(
            BeerRanking.objects.filter(rank__isnull=False)
            .order_by("rank")
            .values_list("product_id", flat=True)[: TASTER_TIERS[-1]]
        )
        if not ranked:
            return None
        # While the ranking is short, only the levels it can fill count.
        tiers = [size for size in TASTER_TIERS if size <= len(ranked)] or [TASTER_TIERS[0]]
        level, tier = len(tiers), tiers[-1]
        for index, size in enumerate(tiers):
            if any(product_id not in had for product_id in ranked[:size]):
                level, tier = index + 1, size
                break
        top = ranked[:tier]
        missing_id = next((product_id for product_id in top if product_id not in had), None)
        missing = None
        if missing_id is not None:
            product = BeerProduct.objects.get(pk=missing_id)
            nearest = (pouring_pubs([missing_id], lat, lng).get(missing_id) or {}).get("nearest")
            missing = {
                "product_key": product.key,
                "name": product.name,
                "nearest_distance_m": nearest["distance_m"] if nearest else None,
            }
        return {
            "level": level,
            "tier": tier,
            "target": len(top),
            "have": sum(1 for product_id in top if product_id in had),
            "missing": missing,
        }

    @staticmethod
    def _against(my_ratings: dict[int, float]) -> list[dict]:
        rows = BeerRanking.objects.filter(
            product_id__in=list(my_ratings), rank__isnull=False, rating_avg__isnull=False
        ).select_related("product")
        gaps = [
            (abs(my_ratings[row.product_id] - row.rating_avg), row)
            for row in rows
            if abs(my_ratings[row.product_id] - row.rating_avg) >= AGAINST_MIN_GAP
        ]
        gaps.sort(key=lambda item: (-item[0], item[1].product.name))
        return [
            {
                "product_key": row.product.key,
                "name": row.product.name,
                "rating_avg": round(row.rating_avg, 2),
                "my_rating": my_ratings[row.product_id],
            }
            for _, row in gaps[:2]
        ]

    @staticmethod
    def _unrated(drunk_counts: dict[int, int], my_ratings: dict[int, float]) -> list[dict]:
        candidates = sorted(
            (product_id for product_id in drunk_counts if product_id not in my_ratings),
            key=lambda product_id: -drunk_counts[product_id],
        )[:3]
        products = {
            product.pk: product for product in BeerProduct.objects.filter(pk__in=candidates)
        }
        return [
            {
                "product_key": products[product_id].key,
                "name": products[product_id].name,
                "brand_name": products[product_id].brand_name,
                "count": drunk_counts[product_id],
            }
            for product_id in candidates
            if product_id in products
        ]

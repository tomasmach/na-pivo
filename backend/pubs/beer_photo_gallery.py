"""Who may see which beer photo, and which photos show a given beer.

A beer photo is visible to its author always, to accepted friends when it is
``friends`` or ``public``, and to everyone when it is ``public`` and the author
has a public handle. Blocks in either direction, ghost mode and non-active
accounts hide photos everywhere outside the author's own diary.
"""

from __future__ import annotations

import hashlib
import re

from django.db.models import Q, QuerySet

from pubs.beer_catalog import match_beer_identity
from pubs.models import Account, BeerPhoto

BEER_PHOTO_SHARED_VISIBILITIES = (BeerPhoto.Visibility.FRIENDS, BeerPhoto.Visibility.PUBLIC)

_WHITESPACE_RE = re.compile(r"\s+")


def _legacy_beer_key(beer_name: str) -> str:
    normalized = _WHITESPACE_RE.sub(" ", (beer_name or "").strip().casefold())
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def beer_photo_key(beer_name: str) -> str:
    """The stored identity of a typed beer name, same rule as BeerCheckIn."""
    if not (beer_name or "").strip():
        return ""
    match = match_beer_identity(beer_name)
    if match is not None and match.product is not None:
        return match.product.key
    return _legacy_beer_key(beer_name)


def beer_photo_lookup_keys(*, beer: str = "", beer_name: str = "") -> list[str]:
    """Keys that identify one beer: an explicit key and/or a typed name."""
    keys: list[str] = []
    if beer.strip():
        keys.append(beer.strip()[:100])
    if beer_name.strip():
        for key in (beer_photo_key(beer_name), _legacy_beer_key(beer_name)):
            if key and key not in keys:
                keys.append(key)
    return keys


def visible_beer_photos(
    viewer: Account,
    *,
    friend_ids: set[int],
    blocked_ids: set[int],
    beer_keys: list[str],
) -> QuerySet[BeerPhoto]:
    """Photos of the beers in ``beer_keys`` that ``viewer`` may see."""
    friend_ids = set(friend_ids) - set(blocked_ids)
    shared = Q(account_id__in=friend_ids, visibility__in=BEER_PHOTO_SHARED_VISIBILITIES)
    public = Q(visibility=BeerPhoto.Visibility.PUBLIC) & ~(
        Q(account__nickname__isnull=True) | Q(account__nickname="")
    )
    of_beer = BeerPhoto.objects.filter(beer_key__in=beer_keys)
    others = (
        of_beer.filter(shared | public)
        .filter(account__status=Account.Status.ACTIVE, account__ghost_mode=False)
        .exclude(account=viewer)
        .exclude(account_id__in=blocked_ids)
    )
    return of_beer.filter(Q(account=viewer) | Q(pk__in=others.values("pk")))


def visible_beer_photo_count(viewer: Account, *, beer: str = "", beer_name: str = "") -> int:
    """How many photos of one beer ``viewer`` may see (for the beer detail)."""
    from pubs.api.views import _accepted_friend_ids, _blocked_account_ids

    keys = beer_photo_lookup_keys(beer=beer, beer_name=beer_name)
    if not keys:
        return 0
    return (
        visible_beer_photos(
            viewer,
            friend_ids=set(_accepted_friend_ids(viewer)),
            blocked_ids=_blocked_account_ids(viewer),
            beer_keys=keys,
        ).count()
    )

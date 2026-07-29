"""Stable identity helpers shared by pub data models and API views."""

import re
from dataclasses import dataclass

_IDENTITY_SPACE_RE = re.compile(r"\s+")


def normalize_pub_name(name: str) -> str:
    """Normalize a pub name using the established amenity identity rules."""
    return _IDENTITY_SPACE_RE.sub(" ", (name or "").strip().casefold())


def pub_identity_key(cache_key: str, name: str) -> str:
    """Return the established per-business identity inside a geohash cell."""
    normalized_name = normalize_pub_name(name)
    return f"{cache_key}::{normalized_name}" if normalized_name else cache_key


@dataclass(frozen=True, slots=True)
class ResolvedPubIdentity:
    """Canonical display identity plus every retained source identity."""

    canonical_id: str | None
    cache_key: str
    name: str
    lat: float | None
    lng: float | None
    city: str
    external_id: str
    aliases: tuple[tuple[str, str], ...]

    @property
    def cache_keys(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(cache_key for cache_key, _ in self.aliases))


def resolve_pub_identity(
    cache_key: str,
    name: str,
    *,
    lat: float | None = None,
    lng: float | None = None,
    city: str = "",
    external_id: str = "",
) -> ResolvedPubIdentity:
    """Resolve an old or current identity without changing historical rows.

    Model imports stay local because ``pubs.models`` itself imports the pure
    normalization helpers from this module.
    """
    return resolve_pub_identities(
        [
            {
                "cache_key": cache_key,
                "name": name,
                "lat": lat,
                "lng": lng,
                "city": city,
                "external_id": external_id,
            }
        ]
    )[0]


def resolve_pub_identities(entries: list[dict]) -> list[ResolvedPubIdentity]:
    """Bulk variant used by nearby/detail reads to avoid one query per pub."""
    from pubs.models import PubAlias

    prepared = [
        {
            **entry,
            "name_key": normalize_pub_name(str(entry.get("name") or "")),
        }
        for entry in entries
    ]
    cache_keys = {
        str(entry.get("cache_key") or "")
        for entry in prepared
        if entry.get("cache_key")
    }
    aliases = list(
        PubAlias.objects.select_related("canonical_pub")
        .filter(
            cache_key__in=cache_keys,
            active=True,
            canonical_pub__active=True,
        )
        .order_by("-is_primary", "id")
    )
    aliases_by_identity = {
        (alias.cache_key, alias.name_key): alias for alias in aliases
    }
    canonical_ids = {alias.canonical_pub_id for alias in aliases}
    members_by_canonical: dict[int, list[tuple[str, str]]] = {}
    for cache_key, name_key, canonical_id in (
        PubAlias.objects.filter(
            canonical_pub_id__in=canonical_ids,
            active=True,
        )
        .order_by("-is_primary", "id")
        .values_list("cache_key", "name_key", "canonical_pub_id")
    ):
        members_by_canonical.setdefault(canonical_id, []).append(
            (cache_key, name_key)
        )

    resolved: list[ResolvedPubIdentity] = []
    for entry in prepared:
        cache_key = str(entry.get("cache_key") or "")
        name = str(entry.get("name") or "")
        name_key = entry["name_key"]
        alias = aliases_by_identity.get((cache_key, name_key))
        if alias is None:
            resolved.append(
                ResolvedPubIdentity(
                    canonical_id=None,
                    cache_key=cache_key,
                    name=name,
                    lat=entry.get("lat"),
                    lng=entry.get("lng"),
                    city=str(entry.get("city") or ""),
                    external_id=str(entry.get("external_id") or ""),
                    aliases=((cache_key, name_key),) if cache_key else (),
                )
            )
            continue
        canonical = alias.canonical_pub
        resolved.append(
            ResolvedPubIdentity(
                canonical_id=str(canonical.public_id),
                cache_key=canonical.cache_key,
                name=canonical.name,
                lat=canonical.lat,
                lng=canonical.lng,
                city=canonical.city,
                external_id=canonical.external_id,
                aliases=tuple(members_by_canonical[canonical.pk]),
            )
        )
    return resolved

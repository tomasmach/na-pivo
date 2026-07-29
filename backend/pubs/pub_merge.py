"""Non-destructive pub merge planning and application."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import transaction

from pubs.identity import normalize_pub_name, pub_identity_key
from pubs.models import (
    CanonicalPub,
    PubAlias,
    PubDirectory,
    PubMergeAudit,
    UserAddedPub,
)


@dataclass(frozen=True, slots=True)
class PubMergeIdentity:
    cache_key: str
    name: str
    lat: float
    lng: float
    city: str = ""
    country: str = ""
    external_id: str = ""

    @property
    def name_key(self) -> str:
        return normalize_pub_name(self.name)


@dataclass(frozen=True, slots=True)
class PubMergePlan:
    source: PubMergeIdentity
    target: PubMergeIdentity
    canonical: PubMergeIdentity
    affected_rows: dict[str, int]
    source_directory_ids: tuple[int, ...]
    source_user_added_ids: tuple[int, ...]

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["source_directory_ids"] = list(self.source_directory_ids)
        data["source_user_added_ids"] = list(self.source_user_added_ids)
        data["mode"] = "dry-run"
        data["destructive_changes"] = False
        return data


def _matching_catalog_rows(
    model: type[PubDirectory] | type[UserAddedPub],
    *,
    cache_key: str,
    name: str,
):
    name_key = normalize_pub_name(name)
    return [
        row
        for row in model.objects.filter(cache_key=cache_key)
        if normalize_pub_name(row.name) == name_key
    ]


def _representative(
    *,
    cache_key: str,
    name: str,
    lat: float | None,
    lng: float | None,
    city: str,
    country: str,
    external_id: str,
) -> PubMergeIdentity:
    directory_rows = _matching_catalog_rows(
        PubDirectory,
        cache_key=cache_key,
        name=name,
    )
    user_rows = _matching_catalog_rows(
        UserAddedPub,
        cache_key=cache_key,
        name=name,
    )
    candidates = [*user_rows, *directory_rows]
    if not candidates:
        raise ValidationError(
            f"No catalog pub matches {name!r} in cache key {cache_key!r}."
        )
    row = candidates[0]
    resolved_lat = lat if lat is not None else row.lat
    resolved_lng = lng if lng is not None else row.lng
    resolved_city = city or (row.city or "")
    resolved_country = country or (
        directory_rows[0].country if directory_rows else ""
    )
    resolved_external_id = external_id
    if not resolved_external_id and user_rows:
        resolved_external_id = user_rows[0].google_place_id or ""
    return PubMergeIdentity(
        cache_key=cache_key,
        name=name,
        lat=resolved_lat,
        lng=resolved_lng,
        city=resolved_city,
        country=resolved_country,
        external_id=resolved_external_id,
    )


def _affected_row_counts(source: PubMergeIdentity) -> dict[str, int]:
    """Count rows that will remain retained behind the source alias."""
    counts: dict[str, int] = {}
    source_identity = pub_identity_key(source.cache_key, source.name)
    skipped_models = {CanonicalPub, PubAlias, PubMergeAudit}
    for model in apps.get_app_config("pubs").get_models():
        if model in skipped_models:
            continue
        field_names = {field.name for field in model._meta.fields}
        query = None
        if "pub_identity_key" in field_names:
            query = model.objects.filter(pub_identity_key=source_identity)
        elif "cache_key" in field_names:
            query = model.objects.filter(cache_key=source.cache_key)
        elif "pub_cache_key" in field_names:
            query = model.objects.filter(pub_cache_key=source.cache_key)
        if query is None:
            continue
        if "name" in field_names:
            matching_ids = [
                row.pk
                for row in query.only("pk", "name")
                if normalize_pub_name(row.name) == source.name_key
            ]
            count = len(matching_ids)
        elif "pub_name" in field_names:
            matching_ids = [
                row.pk
                for row in query.only("pk", "pub_name")
                if normalize_pub_name(row.pub_name) == source.name_key
            ]
            count = len(matching_ids)
        else:
            count = query.count()
        if count:
            counts[model._meta.label] = count
    return dict(sorted(counts.items()))


def build_pub_merge_plan(
    *,
    source_cache_key: str,
    source_name: str,
    target_cache_key: str,
    target_name: str,
    canonical_name: str | None = None,
    canonical_lat: float | None = None,
    canonical_lng: float | None = None,
    canonical_city: str = "",
    canonical_country: str = "",
    canonical_external_id: str = "",
) -> PubMergePlan:
    if (
        source_cache_key == target_cache_key
        and normalize_pub_name(source_name) == normalize_pub_name(target_name)
    ):
        raise ValidationError("Source and target identities are identical.")

    source = _representative(
        cache_key=source_cache_key,
        name=source_name,
        lat=None,
        lng=None,
        city="",
        country="",
        external_id="",
    )
    target = _representative(
        cache_key=target_cache_key,
        name=target_name,
        lat=None,
        lng=None,
        city="",
        country="",
        external_id="",
    )
    canonical = PubMergeIdentity(
        cache_key=target.cache_key,
        name=canonical_name or target.name,
        lat=canonical_lat if canonical_lat is not None else target.lat,
        lng=canonical_lng if canonical_lng is not None else target.lng,
        city=canonical_city or target.city,
        country=canonical_country or target.country,
        external_id=canonical_external_id or target.external_id,
    )
    source_directory_ids = tuple(
        row.pk
        for row in _matching_catalog_rows(
            PubDirectory,
            cache_key=source.cache_key,
            name=source.name,
        )
        if row.active
    )
    source_user_added_ids = tuple(
        row.pk
        for row in _matching_catalog_rows(
            UserAddedPub,
            cache_key=source.cache_key,
            name=source.name,
        )
        if row.active
    )
    if not source_directory_ids and not source_user_added_ids:
        raise ValidationError("The source pub is already inactive or has no active row.")

    return PubMergePlan(
        source=source,
        target=target,
        canonical=canonical,
        affected_rows=_affected_row_counts(source),
        source_directory_ids=source_directory_ids,
        source_user_added_ids=source_user_added_ids,
    )


def _ensure_alias(
    *,
    canonical: CanonicalPub,
    identity: PubMergeIdentity,
    is_primary: bool,
) -> PubAlias:
    existing = (
        PubAlias.objects.select_for_update()
        .filter(cache_key=identity.cache_key, name_key=identity.name_key)
        .first()
    )
    if existing is not None and existing.canonical_pub_id != canonical.pk:
        raise ValidationError(
            f"Identity {identity.name!r} [{identity.cache_key}] already belongs "
            "to a different canonical pub."
        )
    alias, _ = PubAlias.objects.update_or_create(
        cache_key=identity.cache_key,
        name_key=identity.name_key,
        defaults={
            "canonical_pub": canonical,
            "name": identity.name,
            "lat": identity.lat,
            "lng": identity.lng,
            "is_primary": is_primary,
            "active": True,
        },
    )
    return alias


@transaction.atomic
def apply_pub_merge_plan(
    plan: PubMergePlan,
    *,
    actor: str,
    reason: str,
) -> PubMergeAudit:
    """Apply only aliases and soft deactivation; never delete or re-key data."""
    if not actor.strip():
        raise ValidationError("Actor is required for the merge audit.")
    if not reason.strip():
        raise ValidationError("Reason is required for the merge audit.")

    canonical, created = CanonicalPub.objects.select_for_update().get_or_create(
        cache_key=plan.canonical.cache_key,
        name_key=plan.canonical.name_key,
        defaults={
            "name": plan.canonical.name,
            "lat": plan.canonical.lat,
            "lng": plan.canonical.lng,
            "city": plan.canonical.city,
            "country": plan.canonical.country,
            "external_id": plan.canonical.external_id,
            "active": True,
        },
    )
    if not created:
        canonical.name = plan.canonical.name
        canonical.lat = plan.canonical.lat
        canonical.lng = plan.canonical.lng
        canonical.city = plan.canonical.city
        canonical.country = plan.canonical.country
        canonical.external_id = plan.canonical.external_id
        canonical.active = True
        canonical.save()

    _ensure_alias(canonical=canonical, identity=plan.target, is_primary=True)
    _ensure_alias(canonical=canonical, identity=plan.source, is_primary=False)

    directory_ids = list(
        PubDirectory.objects.select_for_update()
        .filter(pk__in=plan.source_directory_ids, active=True)
        .values_list("pk", flat=True)
    )
    user_added_ids = list(
        UserAddedPub.objects.select_for_update()
        .filter(pk__in=plan.source_user_added_ids, active=True)
        .values_list("pk", flat=True)
    )
    PubDirectory.objects.filter(pk__in=directory_ids).update(active=False)
    UserAddedPub.objects.filter(pk__in=user_added_ids).update(active=False)

    return PubMergeAudit.objects.create(
        canonical_pub=canonical,
        source_cache_key=plan.source.cache_key,
        source_name=plan.source.name,
        target_cache_key=plan.target.cache_key,
        target_name=plan.target.name,
        actor=actor.strip(),
        reason=reason.strip(),
        affected_rows=plan.affected_rows,
        deactivated_directory_ids=directory_ids,
        deactivated_user_added_ids=user_added_ids,
    )


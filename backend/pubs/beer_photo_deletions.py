"""Durable storage cleanup for deleted account-owned media files."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from django.db import transaction
from django.utils import timezone

from pubs.models import Account, BeerPhoto, BeerPhotoFileDeletion

logger = logging.getLogger("pubs.beer_photo_deletions")


def enqueue_beer_photo_file_deletion(
    photo: BeerPhoto,
    *,
    account: Account | None,
) -> int | None:
    """Persist the storage name before its ``BeerPhoto`` row is removed."""

    image_name = photo.image.name if photo.image else ""
    if not image_name:
        return None
    cleanup, _created = BeerPhotoFileDeletion.objects.update_or_create(
        image_name=image_name,
        defaults={
            "account": account,
            "client_id": photo.client_id,
            "photo_public_id": photo.public_id,
            "file_kind": BeerPhotoFileDeletion.FileKind.BEER_PHOTO,
        },
    )
    return cleanup.pk


def enqueue_account_avatar_file_deletion(account: Account) -> int | None:
    """Persist an avatar storage name before its owning account is removed."""

    image_name = account.avatar.name if account.avatar else ""
    if not image_name:
        return None
    cleanup, _created = BeerPhotoFileDeletion.objects.update_or_create(
        image_name=image_name,
        defaults={
            "account": account,
            "client_id": None,
            "photo_public_id": None,
            "file_kind": BeerPhotoFileDeletion.FileKind.AVATAR,
        },
    )
    return cleanup.pk


def retry_beer_photo_file_deletion(cleanup_id: int) -> bool:
    """Try one idempotent storage delete, retaining the outbox row on failure."""

    cleanup = BeerPhotoFileDeletion.objects.filter(pk=cleanup_id).first()
    if cleanup is None:
        return True

    storage_field = (
        Account._meta.get_field("avatar")
        if cleanup.file_kind == BeerPhotoFileDeletion.FileKind.AVATAR
        else BeerPhoto._meta.get_field("image")
    )
    try:
        storage_field.storage.delete(cleanup.image_name)
    except Exception as exc:  # noqa: BLE001 -- storage backends expose heterogeneous errors
        BeerPhotoFileDeletion.objects.filter(pk=cleanup.pk).update(
            last_attempted_at=timezone.now()
        )
        logger.warning(
            "account media file cleanup failed (%s)",
            type(exc).__name__,
            extra={"cleanup_id": cleanup.pk, "file_kind": cleanup.file_kind},
        )
        return False

    # If two workers raced, either one may have already removed the row. A
    # missing storage object is also a successful, idempotent deletion.
    BeerPhotoFileDeletion.objects.filter(pk=cleanup.pk).delete()
    return True


def retry_beer_photo_file_deletions(cleanup_ids: Iterable[int]) -> bool:
    """Attempt every supplied cleanup and report whether all completed."""

    all_deleted = True
    for cleanup_id in dict.fromkeys(cleanup_ids):
        if not retry_beer_photo_file_deletion(cleanup_id):
            all_deleted = False
    return all_deleted


def schedule_beer_photo_file_deletions(cleanup_ids: Iterable[int]) -> None:
    """Run media cleanup after the outer transaction commits, retaining failures."""

    queued_ids = tuple(dict.fromkeys(cleanup_ids))
    if not queued_ids:
        return

    def _cleanup_after_commit() -> None:
        try:
            retry_beer_photo_file_deletions(queued_ids)
        except Exception as exc:  # noqa: BLE001 -- the durable outbox remains retryable
            logger.warning(
                "account media post-commit cleanup could not run (%s)",
                type(exc).__name__,
                extra={"cleanup_count": len(queued_ids)},
            )

    transaction.on_commit(_cleanup_after_commit)

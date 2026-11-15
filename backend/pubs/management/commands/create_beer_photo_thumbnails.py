"""Create list thumbnails for beer photos stored before thumbnails existed."""

import logging

from django.core.management.base import BaseCommand

from pubs.models import BeerPhoto
from pubs.photos import BeerPhotoError, beer_photo_thumbnail, store_beer_photo_thumbnail

logger = logging.getLogger("pubs.beer_photo_thumbnails")


class Command(BaseCommand):
    help = "Create missing list thumbnails for stored beer photos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum number of thumbnails created per run.",
        )

    def handle(self, *args, **options):
        limit = max(1, int(options["limit"]))
        missing = BeerPhoto.objects.filter(thumbnail="").exclude(image="").order_by("pk")
        created = failed = 0
        for photo in missing.iterator():
            if created >= limit:
                break
            if create_thumbnail(photo):
                created += 1
            else:
                failed += 1
        if created or failed:
            self.stdout.write(
                self.style.SUCCESS(f"Created {created} beer photo thumbnails; {failed} failed.")
            )


def create_thumbnail(photo: BeerPhoto) -> bool:
    try:
        with photo.image.open("rb") as stored:
            content = beer_photo_thumbnail(stored.read())
        store_beer_photo_thumbnail(photo, content)
    except (BeerPhotoError, OSError) as exc:
        logger.warning(
            "beer photo thumbnail failed (%s)",
            type(exc).__name__,
            extra={"photo_id": photo.pk},
        )
        return False
    if BeerPhoto.objects.filter(pk=photo.pk, thumbnail="").update(thumbnail=photo.thumbnail.name):
        return True
    if not BeerPhoto.objects.filter(pk=photo.pk).exists():
        photo.thumbnail.storage.delete(photo.thumbnail.name)
    return False

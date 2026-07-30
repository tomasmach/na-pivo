from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from pubs.models import ClientEvent


@pytest.mark.django_db
def test_prune_client_events_respects_retention_and_batch_size(settings):
    settings.CLIENT_EVENT_RETENTION_DAYS = 90
    old_ids = []
    for _ in range(2):
        event = ClientEvent.objects.create(event=ClientEvent.Event.SCREEN_VIEWED)
        ClientEvent.objects.filter(pk=event.pk).update(
            created_at=timezone.now() - timedelta(days=91)
        )
        old_ids.append(event.pk)
    recent = ClientEvent.objects.create(event=ClientEvent.Event.APP_OPEN)

    out = StringIO()
    call_command("prune_client_events", "--batch-size", "1", stdout=out)

    assert ClientEvent.objects.filter(pk__in=old_ids).count() == 1
    assert ClientEvent.objects.filter(pk=recent.pk).exists()
    assert "Deleted 1 client events" in out.getvalue()


@pytest.mark.django_db
def test_prune_client_events_dry_run_does_not_delete(settings):
    settings.CLIENT_EVENT_RETENTION_DAYS = 90
    event = ClientEvent.objects.create(event=ClientEvent.Event.SCREEN_VIEWED)
    ClientEvent.objects.filter(pk=event.pk).update(
        created_at=timezone.now() - timedelta(days=91)
    )

    out = StringIO()
    call_command("prune_client_events", "--dry-run", stdout=out)

    assert ClientEvent.objects.filter(pk=event.pk).exists()
    assert "1 client events are older than 90 days" in out.getvalue()

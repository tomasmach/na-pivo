from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from threading import Barrier
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import close_old_connections, connection
from django.db.models import QuerySet
from django.utils import timezone

from pubs.models import EnrichTask, PubHours

pytestmark = pytest.mark.django_db

CAP_ERROR = (
    "firmy: daily request cap of 2000 exceeded — not making further requests today."
)


def make_task(key="test1234", **overrides):
    fields = {
        "cache_key": key, "name": "QA pub", "lat": 50, "lng": 14,
        "done": False, "attempts": 3, "max_attempts": 3, "error": CAP_ERROR,
        "last_attempt_at": timezone.now(),
    }
    return EnrichTask.objects.create(**(fields | overrides))


def recover(*args):
    out = StringIO()
    call_command("recover_hours_budget_tasks", *args, stdout=out)
    return out.getvalue()


def test_default_only_previews_and_apply_preserves_history_and_pub_data():
    task = make_task()
    pub = PubHours.objects.create(
        cache_key=task.cache_key, name=task.name, lat=task.lat, lng=task.lng,
        fetched_at=timezone.now(), opening_hours_raw="Mo-Su 10:00-23:00", status="ok",
    )
    original_task = EnrichTask.objects.values().get(pk=task.pk)
    original_pub = PubHours.objects.values().get(pk=pub.pk)
    with patch("requests.Session.get") as request:
        assert "1 task(s) eligible; no changes" in recover()
        assert EnrichTask.objects.values().get(pk=task.pk) == original_task
        assert "Recovered 1 task(s)" in recover("--apply")
        assert EnrichTask.objects.values().get(pk=task.pk) == original_task | {"attempts": 2}
        assert PubHours.objects.values().get(pk=pub.pk) == original_pub
        assert "Recovered 0 task(s)" in recover("--apply")
    request.assert_not_called()


@pytest.mark.parametrize("overrides", [
    {"done": True},
    {"attempts": 2},
    {"attempts": 4},
    {"max_attempts": 0, "attempts": 0},
    {"error": "Unexpected error: network unavailable"},
    {"error": "Unexpected error: " + CAP_ERROR},
    {"error": CAP_ERROR + " more detail"},
    {"error": None},
])
def test_recovery_excludes_other_states_and_real_failures(overrides):
    task = make_task(**overrides)
    original = EnrichTask.objects.values().get(pk=task.pk)
    assert "Recovered 0 task(s)" in recover("--apply")
    assert EnrichTask.objects.values().get(pk=task.pk) == original


def test_recovery_is_bounded():
    make_task("first123")
    make_task("second12")
    assert "Recovered 1 task(s)" in recover("--apply", "--limit", "1")
    assert EnrichTask.objects.filter(attempts=2).count() == 1
    assert EnrichTask.objects.filter(attempts=3).count() == 1


@pytest.mark.parametrize("limit", ["0", "-1", "10001"])
def test_recovery_rejects_invalid_limits(limit):
    with pytest.raises(CommandError):
        recover("--apply", "--limit", limit)


@pytest.mark.parametrize("new_state", [
    {"done": True}, {"error": "Unexpected error: network unavailable"}, {"attempts": 2},
])
def test_recovery_rechecks_predicate_after_select(new_state):
    task = make_task()
    original_update = QuerySet.update

    def raced_update(queryset, **kwargs):
        original_update(EnrichTask.objects.filter(pk=task.pk), **new_state)
        return original_update(queryset, **kwargs)

    with patch.object(QuerySet, "update", raced_update):
        assert "Recovered 0 task(s)" in recover("--apply")
    task.refresh_from_db()
    assert task.attempts == new_state.get("attempts", 3)


@pytest.mark.django_db(transaction=True)
def test_concurrent_recovery_only_restores_one_attempt():
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent guarded UPDATE is verified against PostgreSQL.")
    task = make_task()
    selected = Barrier(2)
    original_update = QuerySet.update

    def raced_update(queryset, **kwargs):
        selected.wait(timeout=10)
        return original_update(queryset, **kwargs)

    def worker():
        close_old_connections()
        try:
            return recover("--apply")
        finally:
            close_old_connections()

    with patch.object(QuerySet, "update", raced_update), ThreadPoolExecutor(2) as pool:
        outputs = list(pool.map(lambda _: worker(), range(2)))
    assert sorted(outputs) == [
        "Recovered 0 task(s); no external requests made.\n",
        "Recovered 1 task(s); no external requests made.\n",
    ]
    task.refresh_from_db()
    assert task.attempts == 2

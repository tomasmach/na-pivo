"""Database-backed DRF throttles shared by every web worker."""

from __future__ import annotations

import hashlib
import hmac
import math
from datetime import UTC, datetime

from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework.throttling import ScopedRateThrottle

from pubs.models import ApiRateLimitBucket


class SharedScopedRateThrottle(ScopedRateThrottle):
    """A fixed-window scoped throttle whose counters live in the database."""

    def _identity_hash(self, request) -> str:
        if request.user and request.user.is_authenticated:
            identity = f"account:{request.user.pk}"
        else:
            identity = f"network:{self.get_ident(request)}"
        return hmac.new(
            str(settings.SECRET_KEY).encode(),
            identity.encode(),
            hashlib.sha256,
        ).hexdigest()

    def allow_request(self, request, view) -> bool:
        self.scope = getattr(view, self.scope_attr, None)
        if not self.scope:
            return True

        self.rate = self.get_rate()
        if self.rate is None:
            return True
        self.num_requests, self.duration = self.parse_rate(self.rate)

        now = timezone.now()
        window_epoch = int(now.timestamp()) // self.duration * self.duration
        self._wait_seconds = max(
            1,
            math.ceil(window_epoch + self.duration - now.timestamp()),
        )
        if self.num_requests <= 0:
            return False
        window_started_at = datetime.fromtimestamp(window_epoch, tz=UTC)
        identity_hash = self._identity_hash(request)

        table = connection.ops.quote_name(ApiRateLimitBucket._meta.db_table)
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {table}
                    (scope, identity_hash, window_started_at, request_count, updated_at)
                VALUES (%s, %s, %s, 1, %s)
                ON CONFLICT (scope, identity_hash, window_started_at)
                DO UPDATE SET
                    request_count = {table}.request_count + 1,
                    updated_at = EXCLUDED.updated_at
                WHERE {table}.request_count < %s
                RETURNING request_count
                """,
                [self.scope, identity_hash, window_started_at, now, self.num_requests],
            )
            admitted = cursor.fetchone() is not None

        return admitted

    def wait(self) -> int:
        return self._wait_seconds

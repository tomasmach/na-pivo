from datetime import timedelta

from django.utils import timezone

CLIENT_FUTURE_GRACE = timedelta(minutes=10)


def bounded_client_time(value, *, now=None, future_grace=timedelta(0)):
    """Clamp impossible future clocks while preserving useful offline ordering."""
    now = now or timezone.now()
    if value is None:
        return now
    return min(value, now + future_grace)

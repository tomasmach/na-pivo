"""Dates on public pages as ``<time datetime>``, so a crawler or an AI reads the day a label like "včera" means."""

from __future__ import annotations

from datetime import date, datetime

from django.utils import timezone
from django.utils.html import conditional_escape, format_html
from django.utils.safestring import SafeString, mark_safe


def time_tag(moment: date | datetime, label: str) -> SafeString:
    if isinstance(moment, datetime):
        iso = timezone.localtime(moment).isoformat(timespec="minutes")
    else:
        iso = moment.isoformat()
    return format_html('<time datetime="{}">{}</time>', iso, label)


def with_times(text: str, **values) -> SafeString:
    """A translated sentence with ``time_tag`` values in it; the sentence and plain values are escaped."""

    return mark_safe(conditional_escape(text) % {key: conditional_escape(value) for key, value in values.items()})

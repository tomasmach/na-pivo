"""Template tags of the web: ``{% load web %}``.

``{% web_url "web-pubs-city" city="praha" %}``  path in the language being rendered
``{% icon "map-pin" %}``                         inline lucide icon (``class`` adds classes)
``{% asset "np.css" %}``                         versioned URL of a web file
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

from django import template
from django.utils.html import escape
from django.utils.safestring import SafeString, mark_safe

from pubs.web.assets import asset_url
from pubs.web.routes import web_reverse

register = template.Library()
_ICONS = Path(__file__).resolve().parent.parent / "web" / "icons"


@register.simple_tag
def web_url(name: str, **kwargs) -> str:
    return web_reverse(name, **kwargs)


@cache
def _icon_body(name: str) -> str:
    path = _ICONS / f"{name}.svg"
    if not name.replace("-", "").isalnum() or not path.is_file():
        raise template.TemplateSyntaxError(f"Unknown icon {name!r}; add it to pubs/web/icons/")
    return path.read_text().strip()


@register.simple_tag
def icon(name: str, cls: str = "", label: str = "") -> SafeString:
    """Lucide icon. Decorative unless ``label`` gives it a name."""

    a11y = f'role="img" aria-label="{escape(label)}"' if label else 'aria-hidden="true"'
    classes = escape(f"np-icon {cls}".strip())
    return mark_safe(
        f'<svg class="{classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" {a11y}>'
        f"{_icon_body(name)}</svg>"
    )


@register.simple_tag
def asset(name: str) -> str:
    return asset_url(name)

"""Addresses of the web: Czech without a prefix, English under /en/.

Every page is registered twice from one line, as ``<name>`` (Czech) and
``<name>-en`` (English, ``lang="en"`` passed to the view). Links are built with
``web_reverse`` or the ``{% web_url %}`` tag, which pick the variant for the
language being rendered. The older pages (``home``, ``beer-prices``, ``beer``…)
follow the same naming, so the tag reaches them too.
"""

from __future__ import annotations

from django.urls import NoReverseMatch, URLPattern, path, reverse

from pubs.i18n import current_locale

EN_SUFFIX = "-en"


def bilingual(cs: str, en: str, view, name: str) -> list[URLPattern]:
    """The Czech and English address of one page."""

    return [
        path(cs, view, name=name),
        path(en, view, {"lang": "en"}, name=f"{name}{EN_SUFFIX}"),
    ]


def base_name(url_name: str) -> str:
    return url_name.removesuffix(EN_SUFFIX)


def web_reverse(name: str, lang: str | None = None, **kwargs) -> str:
    """Path of a page in the given language (default: the one being rendered)."""

    lang = lang or current_locale()
    name = base_name(name)
    if lang == "en":
        try:
            return reverse(f"{name}{EN_SUFFIX}", kwargs=kwargs or None)
        except NoReverseMatch:
            pass
    return reverse(name, kwargs=kwargs or None)

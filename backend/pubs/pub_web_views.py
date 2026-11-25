"""na-pivo.cz/h/<geohash-8>?n=<name>, the pub link the released apps share.

The link now leads to the pub's web page; the ``n`` hint picks the pub when two
share one geohash cell. The apps read the same link themselves, so its shape
never changes.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse

from pubs.i18n import current_locale
from pubs.web.pubs_views import missing_pub_page, pub_share_redirect


def pub_share_landing(request: HttpRequest, key: str) -> HttpResponse:
    return pub_share_redirect(request, key) or missing_pub_page(request, lang=current_locale())

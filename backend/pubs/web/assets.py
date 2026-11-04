"""Files the web pages load: stylesheets, scripts, fonts and the map library, all served by us.

Production serves nothing from /static/, so these come through ``web_asset`` the
same way the home page serves its files. The content hash in the URL lets a
browser keep a file for a year and still pick up a new deploy.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from django.http import Http404, HttpRequest, HttpResponse

ROOT = Path(__file__).resolve().parent.parent / "static" / "pubs" / "web"
_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".woff2": "font/woff2",
    ".webp": "image/webp",
}
_CSS_URL = re.compile(r'url\("([a-z0-9.-]+)"\)')


def _versioned(name: str, body: bytes) -> str:
    return f"/web/{name}?v={hashlib.sha256(body).hexdigest()[:10]}"


def _load() -> tuple[dict[str, bytes], dict[str, str]]:
    bodies = {
        path.name: path.read_bytes()
        for path in sorted(ROOT.iterdir())
        if path.is_file() and path.suffix in _CONTENT_TYPES
    }
    urls = {name: _versioned(name, body) for name, body in bodies.items() if not name.endswith(".css")}
    for name, body in list(bodies.items()):
        if name.endswith(".css"):
            # The stylesheet names its fonts by bare file name; point them at the versioned URLs.
            css = _CSS_URL.sub(lambda m: f'url("{urls.get(m.group(1), m.group(1))}")', body.decode())
            bodies[name] = css.encode()
            urls[name] = _versioned(name, bodies[name])
    return bodies, urls


# Only files present at startup can be served; a URL name is looked up, never joined onto a path.
_BODIES, URLS = _load()


def asset_url(name: str) -> str:
    """Versioned URL of a web file, e.g. ``asset_url("np.css")``."""

    return URLS[name]


def web_asset(_request: HttpRequest, filename: str) -> HttpResponse:
    body = _BODIES.get(filename)
    if body is None:
        raise Http404
    response = HttpResponse(body, content_type=_CONTENT_TYPES[Path(filename).suffix])
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

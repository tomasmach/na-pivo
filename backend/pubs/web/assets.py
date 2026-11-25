"""Files the web pages load: stylesheets, scripts, fonts and the map library, all served by us.

Production serves nothing from /static/, so these come through ``web_asset`` the
same way the home page serves its files. The content hash in the URL lets a
browser keep a file for a year and still pick up a new deploy.
"""

from __future__ import annotations

import gzip
import hashlib
import re
from compression import zstd
from pathlib import Path

from django.http import Http404, HttpRequest, HttpResponse

ROOT = Path(__file__).resolve().parent.parent / "static" / "pubs" / "web"
_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".woff2": "font/woff2",
    ".webp": "image/webp",
    ".avif": "image/avif",
}
_TEXT = (".css", ".js", ".mjs")
_CSS_URL = re.compile(r'url\("([a-z0-9.-]+)"\)')
# A page blocks on every stylesheet it links, so each kind of page gets np.css and
# its own styles as one file. ``{% stylesheet "pubs.css" %}`` picks np+pubs.css.
STYLESHEETS = (
    ("account.css",),
    ("account.css", "diary.css"),
    ("account.css", "pubs.css"),
    ("delete-account.css",),
    ("diary.css",),
    ("invite.css",),
    ("public-pages.css",),
    ("pubs.css",),
    ("reskin.css",),
)


def _versioned(name: str, body: bytes) -> str:
    return f"/web/{name}?v={hashlib.sha256(body).hexdigest()[:10]}"


def stylesheet_name(names: tuple[str, ...]) -> str:
    return "+".join(("np", *(name.removesuffix(".css") for name in names))) + ".css" if names else "np.css"


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
    for names in STYLESHEETS:
        bodies[stylesheet_name(names)] = b"\n".join(bodies[name] for name in ("np.css", *names))
    for name, body in bodies.items():
        if name.endswith(".css"):
            urls[name] = _versioned(name, body)
    return bodies, urls


def _compressed(bodies: dict[str, bytes]) -> dict[str, dict[str, bytes]]:
    """Each script and stylesheet packed once at startup, not again on every request."""

    return {
        name: {"zstd": zstd.compress(body, level=19), "gzip": gzip.compress(body, 9, mtime=0)}
        for name, body in bodies.items()
        if name.endswith(_TEXT)
    }


# Only files present at startup can be served; a URL name is looked up, never joined onto a path.
_BODIES, URLS = _load()
_PACKED = _compressed(_BODIES)


def asset_url(name: str) -> str:
    """Versioned URL of a web file, e.g. ``asset_url("np.css")``."""

    return URLS[name]


def _accepted(header: str) -> set[str]:
    accepted = set()
    for part in header.lower().split(","):
        coding, _, params = part.strip().partition(";")
        if params.replace(" ", "") not in ("q=0", "q=0.0", "q=0.00", "q=0.000"):
            accepted.add(coding.strip())
    return accepted


def web_asset(request: HttpRequest, filename: str) -> HttpResponse:
    body = _BODIES.get(filename)
    if body is None:
        raise Http404
    encoding = ""
    packed = _PACKED.get(filename)
    if packed:
        accepted = _accepted(request.headers.get("Accept-Encoding", ""))
        encoding = next((coding for coding in packed if coding in accepted), "")
        if encoding:
            body = packed[encoding]
    response = HttpResponse(body, content_type=_CONTENT_TYPES[Path(filename).suffix])
    if packed:
        response.headers["Vary"] = "Accept-Encoding"
    if encoding:
        # Already packed, so the gzip middleware leaves it alone.
        response.headers["Content-Encoding"] = encoding
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

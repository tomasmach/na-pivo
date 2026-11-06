"""Read the whole sitemap the way a crawler does: the index, then every file it lists."""

from __future__ import annotations

import re


def sitemap_xml(client) -> str:
    index = client.get("/sitemap.xml").content.decode()
    files = re.findall(r"<loc>https?://[^/]+(/sitemap-[a-z]+-\d+\.xml)</loc>", index)
    return "".join(client.get(path).content.decode() for path in files)

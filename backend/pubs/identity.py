"""Stable identity helpers shared by pub data models and API views."""

import re

_IDENTITY_SPACE_RE = re.compile(r"\s+")


def normalize_pub_name(name: str) -> str:
    """Normalize a pub name using the established amenity identity rules."""
    return _IDENTITY_SPACE_RE.sub(" ", (name or "").strip().casefold())


def pub_identity_key(cache_key: str, name: str) -> str:
    """Return the established per-business identity inside a geohash cell."""
    normalized_name = normalize_pub_name(name)
    return f"{cache_key}::{normalized_name}" if normalized_name else cache_key

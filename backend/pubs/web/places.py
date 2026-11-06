"""Names of places as people say them: the town and not its post office, Prague in English."""

from __future__ import annotations

import re

# Geocoders name the post office: "Louny 1" is in Louny. In Prague and Plzeň the number is the district.
_POST_OFFICE = re.compile(r"^(\D*\S)\s+\d{1,2}$")
_NUMBERED_DISTRICTS = ("Praha", "Plzeň")


def municipality(name: str) -> str:
    """The town behind a post office name: "Louny 1" is Louny, "Praha 7" stays a district."""

    name = " ".join((name or "").split())
    match = _POST_OFFICE.match(name)
    if match and match.group(1) not in _NUMBERED_DISTRICTS:
        return match.group(1)
    return name

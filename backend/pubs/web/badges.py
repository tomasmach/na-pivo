"""Badge levels for the web profile.

The server sends raw badge values (``derive_account_badge_progress``) and the
app owns the thresholds in ``src/profile/badgeModel.ts`` plus the new look's
"Večer s partou" in ``src/newlook/screens/profil/profilModel.ts``. The web has
no TypeScript, so the table is copied here in the app's order;
``test_web_diary.py`` reads both files and fails when they drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils.translation import gettext_lazy as _

_ROMAN = ["I", "II", "III", "IV"]


@dataclass(frozen=True)
class Badge:
    key: str
    progress: str
    tiers: tuple[int, ...]
    icon: str
    name: str
    secret: bool = False
    slots: bool = False


BADGES: tuple[Badge, ...] = (
    Badge("pubs", "distinct_pubs", (5, 25, 50, 100), "map", _("Poutník")),
    Badge("regular", "max_pub_visits", (5, 10, 25, 50), "landmark", _("Štamgast")),
    Badge("cities", "distinct_cities", (3, 10, 25), "globe", _("Cestovatel")),
    Badge("ratings", "ratings", (1, 10, 25, 50), "star", _("Recenzent")),
    Badge("weeks", "best_week_streak", (4, 12, 26, 52), "calendar-check", _("Týden co týden")),
    Badge("weekdays", "beer_weekdays", (7,), "calendar-days", _("Celý týden"), slots=True),
    Badge("months", "beer_months", (12,), "calendar", _("Kolo roku"), slots=True),
    Badge("tasted", "distinct_beers", (10, 25, 50, 100), "flask-conical", _("Ochutnávač")),
    Badge("softDrinks", "soft_drinks", (1, 10, 25), "beer-off", _("Řidič")),
    Badge("beers", "beers", (1, 10, 100, 500), "beer", _("Čárkař")),
    Badge("bottles", "bottled_beers", (25,), "beer", _("Lahváčový filozof"), secret=True),
    Badge("cans", "canned_beers", (25,), "beer", _("Plechovkáč"), secret=True),
    Badge("friends", "friends", (1, 5, 10, 20), "users", _("Parta")),
    Badge("photos", "photos", (1, 10, 50), "camera", _("Fotograf")),
    Badge("contest", "contest_wins", (1, 3, 10), "trophy", _("FotoPivař")),
    Badge("partyEvenings", "party_evenings", (5, 10, 25, 50), "party-popper", _("Večer s partou")),
    Badge("mapped", "mapped_pubs", (10, 25, 50, 100), "map-pinned", _("Kartograf")),
    Badge("firstMaps", "first_mapped_pubs", (1, 5, 20), "map-pin-plus", _("Prvomapér")),
    Badge("completed", "completed_pubs", (1, 5, 20), "circle-check", _("Pořádkumil")),
    Badge("facts", "facts", (25, 100, 500), "lightbulb", _("Pivní detektiv")),
    Badge("outsidePub", "outside_pub_drinks", (1,), "house", _("Chatař")),
    Badge("outdoors", "outdoors_drinks", (1,), "tent", _("Pod širákem")),
    Badge("beerDay", "beer_day_fridays", (1,), "hop", _("Den piva")),
    Badge("nightOwl", "after_midnight_drinks", (1,), "moon", _("Noční sova"), secret=True),
    Badge("christmasEve", "christmas_eves", (1,), "trees", _("Štědrý den")),
    Badge("newYearsEve", "new_years_eves", (1,), "sparkles", _("Silvestr")),
    Badge("lunch", "lunch_beers", (1,), "clock-3", _("Pivo k obědu"), secret=True),
)


def earned_badges(progress: dict) -> tuple[list[dict], int]:
    """Earned badges, highest level first, and how many badges exist."""

    earned = []
    for badge in BADGES:
        raw = progress.get(badge.progress, 0)
        value = len(raw) if badge.slots else int(raw or 0)
        tier = sum(1 for threshold in badge.tiers if value >= threshold)
        if tier == 0:
            continue
        tiered = len(badge.tiers) > 1
        earned.append(
            {
                "key": badge.key,
                "icon": badge.icon,
                "name": f"{badge.name} {_ROMAN[tier - 1]}" if tiered else str(badge.name),
                "tier": tier,
            }
        )
    earned.sort(key=lambda b: -b["tier"])
    return earned, len(BADGES)

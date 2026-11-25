"""The signed-in diary read model: one account's DrinkLog folded into nights.

A night is one drinking day (``pubs.api.stats.drinking_day``, 04:00 cutoff in
Europe/Prague) across every pub of that day, the same lens the app's new look
uses (``src/newlook/screens/stamgast/eveningData.ts`` ``nightsOf``). An evening
in the profile numbers is one pub on one drinking day, exactly like
``/v1/me/stats`` ``total_evenings``. Everything here reads; writes go through
``/v1/drinks`` and ``/v1/pub-visits`` from the browser.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta

from django.db.models import Count, Q

from pubs.api.stats import drinking_day, resolve_stats_timezone
from pubs.models import (
    Account,
    BeerCheckIn,
    BeerPhoto,
    DrinkLog,
    Friendship,
    PartyEveningMember,
    PublishedNight,
)

_, TZ = resolve_stats_timezone(None)
# The app's tempo chart stops after twelve hours.
_TEMPO_MAX_HOURS = 12
# Beers logged in one go (no "Do" time) sit a minute apart; that is no time at the table.
MIN_TABLE_MINUTES = 15
# The backend keeps five pub names per published night (``PublishedNightRequestSerializer``).
_MAX_PUB_NAMES = 5


@dataclass
class Drink:
    client_id: str
    at: datetime
    name: str
    drink_type: str
    price_czk: int | None
    volume_ml: int | None
    serving_type: str
    place_key: str
    place_name: str
    place_context: str
    city: str
    lat: float | None
    lng: float | None
    external_id: str
    party_evening_id: int | None

    @property
    def is_beer(self) -> bool:
        return self.drink_type == DrinkLog.DrinkType.BEER

    @property
    def in_pub(self) -> bool:
        return self.place_context == DrinkLog.PlaceContext.PUB

    @property
    def local(self) -> datetime:
        return self.at.astimezone(TZ)


@dataclass
class Stop:
    key: str
    name: str
    in_pub: bool
    first: datetime
    last: datetime
    beers: int = 0


@dataclass
class Night:
    day: date
    drinks: list[Drink] = field(default_factory=list)
    stops: list[Stop] = field(default_factory=list)

    @property
    def beers(self) -> int:
        return sum(1 for drink in self.drinks if drink.is_beer)

    @property
    def spent_czk(self) -> int:
        return sum(drink.price_czk or 0 for drink in self.drinks)

    @property
    def priced(self) -> bool:
        return any(drink.price_czk is not None for drink in self.drinks)

    @property
    def start(self) -> datetime:
        return self.drinks[0].at

    @property
    def end(self) -> datetime:
        return self.drinks[-1].at

    @property
    def minutes(self) -> int:
        return max(0, round((self.end - self.start).total_seconds() / 60))

    @property
    def pub_keys(self) -> set[str]:
        return {stop.key for stop in self.stops if stop.in_pub}


def day_start(day: date) -> datetime:
    """The UTC instant a drinking day begins (04:00 Prague)."""

    return datetime.combine(day, time(hour=4), tzinfo=TZ).astimezone(UTC)


def today() -> date:
    return drinking_day(datetime.now(UTC))


def place_key(cache_key: str | None, place_context: str) -> str:
    # The app keys an outside evening "ctx:<context>" so it never counts as a pub.
    return cache_key if cache_key else f"ctx:{place_context}"


def load_drinks(account: Account, start: date | None = None, end: date | None = None) -> list[Drink]:
    """The account's drinks on drinking days ``start``..``end`` (inclusive), oldest first."""

    rows = DrinkLog.objects.filter(account=account)
    if start is not None:
        rows = rows.filter(drank_at__gte=day_start(start))
    if end is not None:
        rows = rows.filter(drank_at__lt=day_start(end + timedelta(days=1)))
    fields = (
        "client_id", "drank_at", "beer_name", "drink_type", "price_czk", "volume_ml", "serving_type",
        "cache_key", "name", "place_context", "city", "lat", "lng", "external_id", "party_evening_id",
    )
    drinks = []
    for row in rows.order_by("drank_at", "id").values_list(*fields):
        (client_id, at, beer, kind, price, volume, serving, cache_key, pub, context, city, lat, lng, ext, party) = row
        drinks.append(
            Drink(
                client_id=str(client_id),
                at=at.astimezone(UTC),
                name=beer,
                drink_type=kind,
                price_czk=price,
                volume_ml=volume,
                serving_type=serving,
                place_key=place_key(cache_key, context),
                place_name=pub if cache_key else "",
                place_context=context,
                city=city,
                lat=lat,
                lng=lng,
                external_id=ext,
                party_evening_id=party,
            )
        )
    return drinks


def nights_of(drinks: list[Drink]) -> list[Night]:
    """Nights, newest first. Stops follow the order of their first drink."""

    by_day: dict[date, Night] = {}
    for drink in drinks:
        day = drinking_day(drink.at)
        night = by_day.setdefault(day, Night(day=day))
        night.drinks.append(drink)
    for night in by_day.values():
        night.drinks.sort(key=lambda d: d.at)
        stops: dict[str, Stop] = {}
        for drink in night.drinks:
            stop = stops.get(drink.place_key)
            if stop is None:
                stop = stops[drink.place_key] = Stop(
                    key=drink.place_key, name=drink.place_name, in_pub=drink.in_pub, first=drink.at, last=drink.at
                )
            stop.last = drink.at
            stop.name = drink.place_name or stop.name
            stop.beers += int(drink.is_beer)
        night.stops = sorted(stops.values(), key=lambda s: s.first)
    return sorted(by_day.values(), key=lambda n: n.day, reverse=True)


def distinct_pubs(nights: list[Night]) -> int:
    return len(set().union(*(night.pub_keys for night in nights))) if nights else 0


def top_pub(nights: list[Night]) -> tuple[str, int] | None:
    """The pub of the most nights, as the app's diary record tile counts it."""

    counts: Counter[str] = Counter()
    names: dict[str, str] = {}
    for night in nights:
        for stop in night.stops:
            if stop.in_pub:
                counts[stop.key] += 1
                names.setdefault(stop.key, stop.name)
    if not counts:
        return None
    key, times = counts.most_common(1)[0]
    return names[key], times


def beer_tally(drinks: list[Drink]) -> list[tuple[str, int, Drink]]:
    """Beers by how often they were logged, most first, named as first counted."""

    tally: dict[str, list] = {}
    for drink in drinks:
        if not drink.is_beer:
            continue
        key = drink.name.strip().casefold()
        entry = tally.get(key)
        if entry is None:
            tally[key] = [drink.name.strip(), 1, drink]
        else:
            entry[1] += 1
            if drink.at > entry[2].at:
                entry[2] = drink
    return sorted(((n, c, d) for n, c, d in tally.values()), key=lambda e: (-e[1], -e[2].at.timestamp()))


def hourly_tempo(night: Night) -> list[tuple[int, int]]:
    """Beers per clock hour from the first beer's hour to the last drink, like the app."""

    beers = [drink for drink in night.drinks if drink.is_beer]
    if not beers:
        return []
    start = night.start.astimezone(TZ).replace(minute=0, second=0, microsecond=0)
    hours = min(_TEMPO_MAX_HOURS, int((night.end - start).total_seconds() // 3600) + 1)
    out = []
    for i in range(hours):
        frm = start + timedelta(hours=i)
        count = sum(1 for d in beers if frm <= d.at < frm + timedelta(hours=1))
        out.append(((frm.astimezone(TZ)).hour, count))
    return out


def companions(account: Account, nights: list[Night]) -> dict[date, list[dict]]:
    """Who shared a party table with the account on each night.

    Only explicit shared tables count (``DrinkLog.party_evening``): a friend's
    private visit to the same pub is not something this page may reveal. Ghost
    mode, a block either way and an opt-out of sharing drinks hide the same
    things here as at the table in the app.
    """
    from pubs.api.party_views import _blocked_account_ids

    by_evening: dict[int, set[date]] = {}
    for night in nights:
        for drink in night.drinks:
            if drink.party_evening_id:
                by_evening.setdefault(drink.party_evening_id, set()).add(night.day)
    if not by_evening:
        return {}
    members = list(
        PartyEveningMember.objects.filter(
            evening_id__in=by_evening, account__status=Account.Status.ACTIVE, account__ghost_mode=False
        )
        .exclude(account=account)
        .exclude(account_id__in=_blocked_account_ids(account))
        .select_related("account")
    )
    beers = {
        (row["party_evening_id"], row["account_id"]): row["n"]
        for row in DrinkLog.objects.filter(
            party_evening_id__in=by_evening,
            drink_type=DrinkLog.DrinkType.BEER,
            account__share_drinks_with_parta=True,
        )
        .exclude(account=account)
        .values("party_evening_id", "account_id")
        .annotate(n=Count("id"))
    }
    out: dict[date, dict[int, dict]] = {}
    for member in members:
        person = member.account
        for day in by_evening[member.evening_id]:
            entry = out.setdefault(day, {}).setdefault(
                person.pk,
                {
                    "name": person.display_name or person.nickname or "",
                    "handle": f"@{person.nickname}" if person.nickname else "",
                    "beers": 0,
                },
            )
            entry["beers"] += beers.get((member.evening_id, person.pk), 0)
    return {day: sorted(people.values(), key=lambda p: -p["beers"]) for day, people in out.items()}


def night_photos(account: Account, night: Night) -> list[BeerPhoto]:
    return list(
        BeerPhoto.objects.filter(
            account=account,
            taken_at__gte=day_start(night.day),
            taken_at__lt=day_start(night.day + timedelta(days=1)),
        ).order_by("taken_at")[:12]
    )


def friend_count(account: Account) -> int:
    return Friendship.objects.filter(
        Q(requester=account) | Q(recipient=account), status=Friendship.Status.ACCEPTED
    ).count()


def my_ratings(account: Account) -> dict[str, float]:
    """My latest rating of each beer, keyed by the lower-cased name the tally uses."""

    ratings: dict[str, float] = {}
    for name, rating in (
        BeerCheckIn.objects.filter(account=account, rating__isnull=False)
        .order_by("checked_in_at")
        .values_list("beer_name", "rating")
    ):
        ratings[name.strip().casefold()] = float(rating)
    return ratings


def publish_payload(night: Night) -> dict:
    """The ``POST /v1/nights`` body of one night, built like ``buildNightSummary`` in the app.

    Counts, pub names, city and length only: no prices, GPS or single beers.
    The caller adds ``visibility`` and ``updated_at``.
    """

    counts = Counter(drink.drink_type for drink in night.drinks)
    names: list[str] = []
    for stop in night.stops:
        name = stop.name.strip()[:80]
        if stop.in_pub and name and name not in names and len(names) < _MAX_PUB_NAMES:
            names.append(name)
    payload = {
        # The app's key for the same night, so either side updates one post.
        "client_id": f"night-{night.day.isoformat()}",
        "drinking_day": night.day.isoformat(),
        "started_at": night.start.isoformat(),
        "ended_at": night.end.isoformat(),
        "beer_count": counts[DrinkLog.DrinkType.BEER],
        "wine_count": counts[DrinkLog.DrinkType.WINE],
        "soft_drink_count": counts[DrinkLog.DrinkType.SOFT_DRINK],
        "shot_count": counts[DrinkLog.DrinkType.SHOT],
        "pub_names": names,
        "city": next((drink.city for drink in night.drinks if drink.in_pub and drink.city), "")[:120],
    }
    if night.minutes >= MIN_TABLE_MINUTES:
        payload["duration_minutes"] = night.minutes
    return payload


def published_nights(account: Account, days: list[date]) -> dict[date, PublishedNight]:
    return {night.drinking_day: night for night in PublishedNight.objects.filter(account=account, drinking_day__in=days)}

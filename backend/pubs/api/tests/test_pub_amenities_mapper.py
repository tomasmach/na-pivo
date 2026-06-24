"""
Tests for the Mapér gamification layer on "Zmapuj hospodu" (§7).

Covers the server-authoritative XP write path on PUT /v1/pub-amenities/votes:

  * first-fact XP paid exactly once per (account, cache_key, amenity_key) row;
  * idempotency — a flip, a re-vote of the same value, and a retract-then-revote
    all pay 0 (awarded_xp gate);
  * the one-time first-mapper bonus, paid only to the aggregate's immutable
    first_mapper;
  * confirm XP for later voters (diminishing reward);
  * the pub-complete bonus, paid once when the account brings a pub to 100%;
  * F()-incremented AccountUsageStats counters;
  * the derived level/title ladder boundaries;
  * the additive GET /v1/account/me ``mapper`` block + the five Mapér achievement
    booleans at/below/above their thresholds;
  * the daily distinct-pub soft cap suppressing only the first-mapper bonus;
  * ``xp_awarded`` present + correct on the PUT response;
  * no breaking change to the existing /account/me fields.

The XP constants under test are the env defaults (settings.MAPER_XP_*): first_fact
15, first_mapper_bonus 25, confirm 5, pub_complete_bonus 30.
"""

from __future__ import annotations

import pytest
from django.conf import settings
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from pubs.enrichment import geohash8
from pubs.models import (
    Account,
    AccountUsageStats,
    AmenityKind,
    PubAmenity,
    PubAmenityVote,
)

_DEVICE_A = "3f8b1c2e-4d5a-6789-0abc-def012345678"
_DEVICE_B = "11112222-3333-4444-5555-666677778888"
_DEVICE_C = "99998888-7777-6666-5555-444433332222"
_NAME = "U Černého vola"
_LAT = 50.0885
_LNG = 14.3984
_KEY = geohash8(_LAT, _LNG)

# A second, geographically distinct pub (different geohash-8 cell).
_LAT2 = 49.1951
_LNG2 = 16.6068
_NAME2 = "Pivnice U Čápa"
_KEY2 = geohash8(_LAT2, _LNG2)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient, device_id: str = _DEVICE_A) -> str:
    resp = client.post("/v1/account", data={"device_id": device_id}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    return resp.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _vote(**overrides):
    data = {
        "name": _NAME,
        "lat": _LAT,
        "lng": _LNG,
        "city": "Praha",
        "external_id": "mapy:12345",
        "amenity_key": "seating_garden",
        "value": "yes",
        "client_updated_at": "2026-06-23T18:30:00+02:00",
        "taxonomy_version": 1,
    }
    data.update(overrides)
    return data


def _put(client, token, *votes):
    return client.put(
        "/v1/pub-amenities/votes",
        data={"votes": list(votes)},
        format="json",
        **_auth(token),
    )


def _stats(device_id: str) -> AccountUsageStats:
    account = Account.objects.get(device_id=device_id)
    return AccountUsageStats.objects.get(account=account)


def _pub_amenity_status(amenity_key: str, cache_key: str = _KEY) -> str:
    return PubAmenity.objects.get(cache_key=cache_key, amenity_key=amenity_key).status


# ---------------------------------------------------------------------------
# First-fact + first-mapper XP
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_first_mapper_earns_first_fact_plus_bonus(client):
    token = _register(client)
    resp = _put(client, token, _vote())
    result = resp.json()["results"][0]

    # First mapper of a fresh amenity: first_fact (15) + first_mapper_bonus (25).
    assert result["was_first_map"] is True
    assert result["xp_awarded"] == 40

    stats = _stats(_DEVICE_A)
    assert stats.mapper_xp == 40
    assert stats.first_mapper_count == 1
    assert stats.amenity_votes_count == 1
    assert stats.mapped_pubs_count == 1  # first amenity on this pub
    assert stats.completed_pubs_count == 0

    # The awarded XP is recorded on the row (idempotency gate).
    vote = PubAmenityVote.objects.get()
    assert vote.awarded_xp == 40

    # The envelope mapper snapshot reflects the durable total.
    mapper = resp.json()["mapper"]
    assert mapper["xp"] == 40
    assert mapper["level"] == 1
    assert mapper["title"] == "Nováček"
    assert mapper["xp_into_level"] == 40
    assert mapper["xp_for_next_level"] == 50


@pytest.mark.django_db
def test_put_envelope_crosses_level_boundary(client):
    """The PUT-response ``mapper`` snapshot derives level/title from the durable
    total exactly like GET /account/me (both call maper_progress). Two first-maps
    (40 + 40 = 80 XP) cross level 1 → 2, so the envelope must report level 2 /
    Všímálek with progress matching the durable total — pinning the PUT envelope
    to the same derivation as GET (it must NOT hardcode level 1 or compute off
    the single xp_awarded)."""
    token = _register(client)

    first = _put(
        client, token, _vote(amenity_key="seating_garden", value="yes", client_updated_at="2026-06-23T18:00:00+02:00")
    )
    # 40 XP → still level 1.
    assert first.json()["mapper"]["level"] == 1

    second = _put(
        client, token, _vote(amenity_key="practical_wifi", value="yes", client_updated_at="2026-06-23T18:01:00+02:00")
    )
    mapper = second.json()["mapper"]
    # 80 XP total → level 2 (threshold 50). The PUT snapshot uses the same ``xp``
    # key as the GET /me block — the two endpoints never disagree.
    assert mapper["xp"] == 80
    assert mapper["level"] == 2
    assert mapper["title"] == "Všímálek"
    assert mapper["xp_into_level"] == 30  # 80 - 50
    assert mapper["xp_for_next_level"] == 100  # 150 - 50


@pytest.mark.django_db
def test_first_fact_paid_once_then_flip_pays_zero(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:30:00+02:00"))

    # Flip yes->no: LWW applies, but awarded_xp>0 so XP is 0.
    resp = _put(client, token, _vote(value="no", client_updated_at="2026-06-23T19:30:00+02:00"))
    result = resp.json()["results"][0]
    assert result["applied"] is True
    assert result["xp_awarded"] == 0

    stats = _stats(_DEVICE_A)
    assert stats.mapper_xp == 40  # unchanged
    assert stats.amenity_votes_count == 1
    assert PubAmenityVote.objects.get().awarded_xp == 40


@pytest.mark.django_db
def test_revote_same_value_pays_zero(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:30:00+02:00"))
    resp = _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T20:30:00+02:00"))
    assert resp.json()["results"][0]["xp_awarded"] == 0
    assert _stats(_DEVICE_A).mapper_xp == 40


@pytest.mark.django_db
def test_retract_then_revote_does_not_refarm(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:30:00+02:00"))
    assert _stats(_DEVICE_A).mapper_xp == 40

    # Retract (value: null) — never pays, never claws back.
    retract = _put(client, token, _vote(value=None, client_updated_at="2026-06-23T19:00:00+02:00"))
    assert retract.json()["results"][0]["xp_awarded"] == 0
    assert _stats(_DEVICE_A).mapper_xp == 40
    assert PubAmenityVote.objects.count() == 0

    # Re-vote after retraction: the durable AmenityXpLedger row for this
    # (account, cache_key, amenity_key) survived the hard delete, so the base XP
    # gate is already tripped and the revote pays 0 — retract-then-revote NEVER
    # re-pays (§7.3). mapper_xp stays at the original 40.
    revote = _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T20:00:00+02:00"))
    result = revote.json()["results"][0]
    assert result["was_first_map"] is False
    assert result["xp_awarded"] == 0
    assert _stats(_DEVICE_A).mapper_xp == 40


@pytest.mark.django_db
def test_retract_keeps_lifetime_counters(client):
    """Lifetime-achievement model (§7.3): retracting a vote recomputes the public
    aggregate away but NEVER decrements the account's stored XP or its monotonic
    counters — guarded for BOTH retract paths (PUT value:null AND the DELETE
    endpoint). A future "decrement on retract" regression must fail here."""
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T18:30:00+02:00"))

    def _counters():
        s = _stats(_DEVICE_A)
        return (s.mapper_xp, s.amenity_votes_count, s.mapped_pubs_count, s.first_mapper_count)

    assert _counters() == (40, 1, 1, 1)

    # (a) Retract via PUT value:null — vote row gone, counters untouched.
    _put(client, token, _vote(value=None, client_updated_at="2026-06-23T19:00:00+02:00"))
    assert PubAmenityVote.objects.count() == 0
    assert _counters() == (40, 1, 1, 1)

    # (b) Re-vote (pays 0, ledger tripped), then retract via the DELETE endpoint.
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T20:00:00+02:00"))
    resp = client.delete(f"/v1/pub-amenities/votes/{_KEY}/seating_garden", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["deleted"] is True
    assert PubAmenityVote.objects.count() == 0
    assert _counters() == (40, 1, 1, 1)


# ---------------------------------------------------------------------------
# Confirm XP for later voters; first-mapper bonus only to the first
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_confirm_xp_for_later_voters_and_bonus_only_for_first(client):
    token_a = _register(client, _DEVICE_A)
    token_b = _register(client, _DEVICE_B)

    a = _put(client, token_a, _vote(value="yes", client_updated_at="2026-06-23T18:00:00+02:00"))
    assert a.json()["results"][0]["was_first_map"] is True
    assert a.json()["results"][0]["xp_awarded"] == 40  # 15 + 25

    # Second voter confirms: confirm (5), NO first-mapper bonus.
    b = _put(client, token_b, _vote(value="yes", client_updated_at="2026-06-23T18:05:00+02:00"))
    result = b.json()["results"][0]
    assert result["was_first_map"] is False
    assert result["xp_awarded"] == settings.MAPER_XP_CONFIRM

    assert _stats(_DEVICE_A).mapper_xp == 40
    assert _stats(_DEVICE_A).first_mapper_count == 1
    assert _stats(_DEVICE_B).mapper_xp == 5
    assert _stats(_DEVICE_B).first_mapper_count == 0

    # first_mapper on the aggregate stays the first account.
    assert PubAmenity.objects.get().first_mapper == Account.objects.get(device_id=_DEVICE_A)


@pytest.mark.django_db
def test_mapped_pubs_count_increments_per_distinct_pub(client):
    token = _register(client)
    # Two amenities on the SAME pub → mapped_pubs_count counts the pub once.
    _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value="yes", client_updated_at="2026-06-23T18:00:00+02:00"),
    )
    _put(
        client,
        token,
        _vote(amenity_key="practical_wifi", value="yes", client_updated_at="2026-06-23T18:01:00+02:00"),
    )
    assert _stats(_DEVICE_A).mapped_pubs_count == 1

    # A vote on a different pub bumps it to 2.
    _put(
        client,
        token,
        _vote(
            name=_NAME2,
            lat=_LAT2,
            lng=_LNG2,
            amenity_key="seating_garden",
            value="yes",
            client_updated_at="2026-06-23T18:02:00+02:00",
        ),
    )
    assert _stats(_DEVICE_A).mapped_pubs_count == 2


# ---------------------------------------------------------------------------
# Pub-complete bonus
# ---------------------------------------------------------------------------


def _map_all_amenities(client, token, *, value="yes", base_minute=0, **pub):
    """Vote ``value`` on every active amenity for one pub from one account."""
    keys = list(AmenityKind.objects.filter(active=True).values_list("key", flat=True))
    last = None
    for i, key in enumerate(keys):
        last = _put(
            client,
            token,
            _vote(
                amenity_key=key,
                value=value,
                client_updated_at=f"2026-06-23T1{base_minute}:{i:02d}:00+02:00",
                **pub,
            ),
        )
    return last


@pytest.mark.django_db
def test_pub_complete_bonus_paid_once_at_100pct(client):
    token_a = _register(client, _DEVICE_A)
    token_b = _register(client, _DEVICE_B)
    token_c = _register(client, _DEVICE_C)

    # Need AMENITY_MIN_VOTES (3) agreeing voters per amenity for status != unknown.
    _map_all_amenities(client, token_a, base_minute=0)
    _map_all_amenities(client, token_b, base_minute=1)
    # Before C, no amenity has 3 votes → pub is NOT complete, no bonus yet.
    assert _stats(_DEVICE_A).completed_pubs_count == 0

    # C is the third agreeing voter; their LAST amenity flips the pub to 100%.
    keys = list(AmenityKind.objects.filter(active=True).values_list("key", flat=True))
    completed = False
    for i, key in enumerate(keys):
        resp = _put(
            client,
            token_c,
            _vote(amenity_key=key, value="yes", client_updated_at=f"2026-06-23T13:{i:02d}:00+02:00"),
        )
        xp = resp.json()["results"][0]["xp_awarded"]
        if i < len(keys) - 1:
            assert xp == settings.MAPER_XP_CONFIRM  # confirm only
        else:
            # The final amenity completes the pub: confirm (5) + complete (30).
            assert xp == settings.MAPER_XP_CONFIRM + settings.MAPER_XP_PUB_COMPLETE_BONUS
            completed = True
    assert completed

    c_stats = _stats(_DEVICE_C)
    assert c_stats.completed_pubs_count == 1
    # A/B never cast the completing vote → no complete bonus.
    assert _stats(_DEVICE_A).completed_pubs_count == 0
    assert _stats(_DEVICE_B).completed_pubs_count == 0

    # A later flip/re-vote does NOT re-pay the complete bonus.
    resp = _put(
        client,
        token_c,
        _vote(amenity_key=keys[0], value="no", client_updated_at="2026-06-23T14:00:00+02:00"),
    )
    assert resp.json()["results"][0]["xp_awarded"] == 0
    assert _stats(_DEVICE_C).completed_pubs_count == 1


@pytest.mark.django_db
def test_completion_via_recross_does_not_repay_bonus(client):
    """Crossing INTO 100% again (after dropping below) NEVER re-pays the bonus.

    C completes a pub (earns the +pub_complete_bonus once). C then retracts one
    amenity — dropping it below AMENITY_MIN_VOTES so the pub is no longer 100% —
    and re-votes it, re-crossing into completion. Because completion is gated on
    a DURABLE per-(account, pub) marker (NOT the live _pub_is_complete check),
    the re-cross pays 0 complete-bonus and completed_pubs_count stays 1. A
    regression moving the completeness check outside the durable gate would
    re-farm the 30 XP here.
    """
    token_a = _register(client, _DEVICE_A)
    token_b = _register(client, _DEVICE_B)
    token_c = _register(client, _DEVICE_C)

    _map_all_amenities(client, token_a, base_minute=0)
    _map_all_amenities(client, token_b, base_minute=1)
    _map_all_amenities(client, token_c, base_minute=2)  # C completes the pub here

    assert _stats(_DEVICE_C).completed_pubs_count == 1
    c_xp_after_complete = _stats(_DEVICE_C).mapper_xp

    keys = list(AmenityKind.objects.filter(active=True).values_list("key", flat=True))
    target = keys[0]

    # C retracts the target amenity → only A,B remain (2 votes < MIN_VOTES) so the
    # aggregate falls to UNKNOWN and the pub is no longer 100%.
    _put(client, token_c, _vote(amenity_key=target, value=None, client_updated_at="2026-06-23T15:00:00+02:00"))
    assert _pub_amenity_status(target) == PubAmenity.Status.UNKNOWN

    # C re-votes it → 3 votes again, the amenity returns to YES and the pub is
    # complete again. This re-cross must NOT re-pay the bonus (durable marker).
    recross = _put(
        client, token_c, _vote(amenity_key=target, value="yes", client_updated_at="2026-06-23T16:00:00+02:00")
    )
    assert recross.json()["results"][0]["xp_awarded"] == 0  # base gated by ledger + completion gated by marker
    assert _stats(_DEVICE_C).completed_pubs_count == 1
    assert _stats(_DEVICE_C).mapper_xp == c_xp_after_complete


# ---------------------------------------------------------------------------
# Daily distinct-pub cap suppresses only the first-mapper bonus
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_daily_cap_suppresses_first_mapper_bonus_only(client, settings):
    settings.AMENITY_MAX_PUBS_PER_DAY = 0  # every first-touch is "over" the cap
    token = _register(client)

    resp = _put(client, token, _vote())
    result = resp.json()["results"][0]
    # First map over the cap: first_fact (15) still pays, bonus (25) suppressed.
    assert result["was_first_map"] is True
    assert result["xp_awarded"] == settings.MAPER_XP_FIRST_FACT

    stats = _stats(_DEVICE_A)
    assert stats.mapper_xp == settings.MAPER_XP_FIRST_FACT
    # The first-mapper COUNTER still bumps (the map happened); only XP is blunted.
    assert stats.first_mapper_count == 1


@pytest.mark.django_db
def test_daily_cap_does_not_4xx(client, settings):
    settings.AMENITY_MAX_PUBS_PER_DAY = 0
    token = _register(client)
    resp = _put(client, token, _vote())
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"][0]["applied"] is True


@pytest.mark.django_db
def test_daily_cap_boundary_suppresses_only_over_cap_pub(client, settings):
    """The cap is on DISTINCT pubs first-touched today, strict ``>`` boundary.

    With a cap of 1: the FIRST distinct pub's first-map pays the full
    first_fact + first_mapper_bonus (40); only the SECOND distinct pub's
    first-map is over the cap, paying first_fact (15) alone — while the
    first_mapper_count still bumps for both (the map happened, only the XP
    bonus is blunted).
    """
    settings.AMENITY_MAX_PUBS_PER_DAY = 1
    token = _register(client)

    # 1st distinct pub: at the cap (count == 1, not > 1) → full bonus.
    first = _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value="yes", client_updated_at="2026-06-23T18:00:00+02:00"),
    )
    r1 = first.json()["results"][0]
    assert r1["was_first_map"] is True
    assert r1["xp_awarded"] == settings.MAPER_XP_FIRST_FACT + settings.MAPER_XP_FIRST_MAPPER_BONUS

    # 2nd distinct pub: over the cap (count == 2 > 1) → bonus suppressed.
    second = _put(
        client,
        token,
        _vote(
            name=_NAME2,
            lat=_LAT2,
            lng=_LNG2,
            amenity_key="seating_garden",
            value="yes",
            client_updated_at="2026-06-23T18:01:00+02:00",
        ),
    )
    r2 = second.json()["results"][0]
    assert r2["was_first_map"] is True
    assert r2["xp_awarded"] == settings.MAPER_XP_FIRST_FACT  # bonus blunted

    stats = _stats(_DEVICE_A)
    # Both first-maps happened → the counter bumps twice regardless of suppression.
    assert stats.first_mapper_count == 2
    assert stats.mapper_xp == (
        settings.MAPER_XP_FIRST_FACT + settings.MAPER_XP_FIRST_MAPPER_BONUS
        + settings.MAPER_XP_FIRST_FACT
    )


@pytest.mark.django_db
def test_daily_cap_counts_distinct_pubs_not_votes(client, settings):
    """Mapping multiple amenities on the SAME pub consumes one cap unit.

    With a cap of 1, a first map then a SECOND first-map on a DIFFERENT amenity
    of the SAME pub must both pay the full bonus — the cap counts distinct
    cache_keys, not vote rows.
    """
    settings.AMENITY_MAX_PUBS_PER_DAY = 1
    token = _register(client)

    a = _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value="yes", client_updated_at="2026-06-23T18:00:00+02:00"),
    )
    b = _put(
        client,
        token,
        _vote(amenity_key="practical_wifi", value="yes", client_updated_at="2026-06-23T18:01:00+02:00"),
    )
    # Both are first-maps of fresh amenities on the SAME pub → both get the bonus.
    assert a.json()["results"][0]["xp_awarded"] == (
        settings.MAPER_XP_FIRST_FACT + settings.MAPER_XP_FIRST_MAPPER_BONUS
    )
    assert b.json()["results"][0]["xp_awarded"] == (
        settings.MAPER_XP_FIRST_FACT + settings.MAPER_XP_FIRST_MAPPER_BONUS
    )
    # One distinct pub → mapped_pubs_count is 1.
    assert _stats(_DEVICE_A).mapped_pubs_count == 1


@pytest.mark.django_db
def test_daily_cap_marker_survives_retract_all_votes(client, settings):
    settings.AMENITY_MAX_PUBS_PER_DAY = 1
    token = _register(client)

    first = _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value="yes", client_updated_at="2026-06-23T18:00:00+02:00"),
    )
    _put(
        client,
        token,
        _vote(amenity_key="seating_garden", value=None, client_updated_at="2026-06-23T18:01:00+02:00"),
    )
    second = _put(
        client,
        token,
        _vote(
            name=_NAME2,
            lat=_LAT2,
            lng=_LNG2,
            amenity_key="seating_garden",
            value="yes",
            client_updated_at="2026-06-23T18:02:00+02:00",
        ),
    )

    assert first.json()["results"][0]["xp_awarded"] == (
        settings.MAPER_XP_FIRST_FACT + settings.MAPER_XP_FIRST_MAPPER_BONUS
    )
    assert second.json()["results"][0]["xp_awarded"] == settings.MAPER_XP_FIRST_FACT
    assert _stats(_DEVICE_A).mapped_pubs_count == 2


# ---------------------------------------------------------------------------
# Ignored / stale / retract paths never pay
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_unknown_key_pays_zero_and_no_stats_row(client):
    token = _register(client)
    resp = _put(client, token, _vote(amenity_key="totally_unknown_key"))
    result = resp.json()["results"][0]
    assert result["ignored_unknown_amenity"] is True
    assert result["xp_awarded"] == 0
    # No XP write happened.
    account = Account.objects.get(device_id=_DEVICE_A)
    stats = AccountUsageStats.objects.filter(account=account).first()
    assert stats is None or stats.mapper_xp == 0


@pytest.mark.django_db
def test_stale_write_pays_zero(client):
    token = _register(client)
    _put(client, token, _vote(value="yes", client_updated_at="2026-06-23T19:00:00+02:00"))
    before = _stats(_DEVICE_A).mapper_xp
    resp = _put(client, token, _vote(value="no", client_updated_at="2026-06-23T10:00:00+02:00"))
    assert resp.json()["results"][0]["xp_awarded"] == 0
    assert _stats(_DEVICE_A).mapper_xp == before


# ---------------------------------------------------------------------------
# GET /account/me mapper block + achievement booleans
# ---------------------------------------------------------------------------


def _me(client, token):
    resp = client.get("/v1/account/me", **_auth(token))
    assert resp.status_code == status.HTTP_200_OK, resp.content
    return resp.json()


@pytest.mark.django_db
def test_account_me_mapper_block_shape(client):
    token = _register(client)
    _put(client, token, _vote())  # 40 XP, 1 first-map, 1 mapped pub

    body = _me(client, token)
    mapper = body["mapper"]
    # Derived progress (40 XP → level 1, Nováček).
    assert mapper["xp"] == 40
    assert mapper["level"] == 1
    assert mapper["title"] == "Nováček"
    assert mapper["xp_into_level"] == 40
    assert mapper["xp_for_next_level"] == 50
    # Raw counters (locked canonical wire names, §7.2).
    assert mapper["distinct_mapped_pubs"] == 1
    assert mapper["amenity_votes_count"] == 1
    assert mapper["first_mapper_count"] == 1
    assert mapper["completed_pubs_count"] == 0
    # The level ladder is exactly the 5-rung table.
    assert mapper["levels"] == [
        {"level": 1, "title": "Nováček", "xp": 0},
        {"level": 2, "title": "Všímálek", "xp": 50},
        {"level": 3, "title": "Štamgast", "xp": 150},
        {"level": 4, "title": "Znalec", "xp": 400},
        {"level": 5, "title": "Hospodský mudrc", "xp": 900},
    ]
    # xp_rules exposes the four env-default constants.
    assert mapper["xp_rules"] == {
        "first_fact": 15,
        "first_mapper_bonus": 25,
        "confirm": 5,
        "pub_complete_bonus": 30,
    }


@pytest.mark.django_db
def test_account_me_mapper_block_empty_for_never_voted(client):
    token = _register(client)
    body = _me(client, token)
    mapper = body["mapper"]
    assert mapper["xp"] == 0
    assert mapper["level"] == 1
    assert mapper["title"] == "Nováček"
    assert mapper["xp_into_level"] == 0
    assert mapper["xp_for_next_level"] == 50
    assert mapper["distinct_mapped_pubs"] == 0
    assert mapper["first_mapper_count"] == 0


@pytest.mark.django_db
def test_account_me_no_breaking_change_to_existing_fields(client):
    token = _register(client)
    body = _me(client, token)
    # The released-app fields must all still be present (additive contract).
    for key in (
        "id",
        "device_id",
        "nickname",
        "stats",
        "achievements",
        "usage",
        "subscription",
        "settings",
    ):
        assert key in body, key
    # The original three achievement booleans are untouched.
    for key in ("first_ten", "regular", "reviewer"):
        assert key in body["achievements"]
    # The original five stat fields are untouched (the mapper counters live in
    # the mapper block, NOT the stats block).
    assert set(body["stats"]) == {
        "total_beers",
        "distinct_pubs",
        "ratings_count",
        "total_spent_czk",
        "max_visits_to_one_pub",
    }


def _set_counters(device_id, **counters):
    account = Account.objects.get(device_id=device_id)
    stats, _ = AccountUsageStats.objects.get_or_create(account=account)
    for field, value in counters.items():
        setattr(stats, field, value)
    stats.save()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "counters,expected",
    [
        # first_map: first_mapper_count >= 1
        ({"first_mapper_count": 0}, {"first_map": False}),
        ({"first_mapper_count": 1}, {"first_map": True}),
        # explorer: mapped_pubs_count >= 10
        ({"mapped_pubs_count": 9}, {"explorer": False, "cartographer": False}),
        ({"mapped_pubs_count": 10}, {"explorer": True, "cartographer": False}),
        # cartographer: mapped_pubs_count >= 25
        ({"mapped_pubs_count": 24}, {"explorer": True, "cartographer": False}),
        ({"mapped_pubs_count": 25}, {"explorer": True, "cartographer": True}),
        # completionist: completed_pubs_count >= 1
        ({"completed_pubs_count": 0}, {"completionist": False}),
        ({"completed_pubs_count": 1}, {"completionist": True}),
        # fact_machine: amenity_votes_count >= 100
        ({"amenity_votes_count": 99}, {"fact_machine": False}),
        ({"amenity_votes_count": 100}, {"fact_machine": True}),
    ],
)
def test_mapper_achievement_thresholds(client, counters, expected):
    token = _register(client)
    _set_counters(_DEVICE_A, **counters)
    achievements = _me(client, token)["achievements"]
    for key, want in expected.items():
        assert achievements[key] is want, (key, counters)


# ---------------------------------------------------------------------------
# Account merge re-sums the Mapér counters
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_merge_sums_mapper_counters_into_target(client):
    from pubs.accounts import _merge_usage_stats

    source = Account.objects.create(device_id=_DEVICE_A)
    target = Account.objects.create(device_id=_DEVICE_B)
    AccountUsageStats.objects.create(
        account=source,
        mapper_xp=70,
        mapped_pubs_count=3,
        first_mapper_count=2,
        amenity_votes_count=8,
        completed_pubs_count=1,
    )
    AccountUsageStats.objects.create(
        account=target,
        mapper_xp=200,
        mapped_pubs_count=5,
        first_mapper_count=4,
        amenity_votes_count=20,
        completed_pubs_count=2,
    )

    _merge_usage_stats(source, target)

    merged = AccountUsageStats.objects.get(account=target)
    assert merged.mapper_xp == 270
    assert merged.mapped_pubs_count == 8
    assert merged.first_mapper_count == 6
    assert merged.amenity_votes_count == 28
    assert merged.completed_pubs_count == 3
    # The source stats row is consumed.
    assert not AccountUsageStats.objects.filter(account=source).exists()


@pytest.mark.django_db
def test_merge_moves_source_stats_when_target_has_none(client):
    from pubs.accounts import _merge_usage_stats

    source = Account.objects.create(device_id=_DEVICE_A)
    target = Account.objects.create(device_id=_DEVICE_B)
    AccountUsageStats.objects.create(account=source, mapper_xp=55, first_mapper_count=1)

    _merge_usage_stats(source, target)

    moved = AccountUsageStats.objects.get(account=target)
    assert moved.mapper_xp == 55
    assert moved.first_mapper_count == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "xp,level,title,into,nxt",
    [
        (0, 1, "Nováček", 0, 50),
        (49, 1, "Nováček", 49, 50),
        (50, 2, "Všímálek", 0, 100),
        (149, 2, "Všímálek", 99, 100),
        (150, 3, "Štamgast", 0, 250),
        (399, 3, "Štamgast", 249, 250),
        (400, 4, "Znalec", 0, 500),
        (899, 4, "Znalec", 499, 500),
        (900, 5, "Hospodský mudrc", 0, None),
    ],
)
def test_mapper_level_title_boundaries(client, xp, level, title, into, nxt):
    token = _register(client)
    _set_counters(_DEVICE_A, mapper_xp=xp)
    mapper = _me(client, token)["mapper"]
    assert mapper["level"] == level
    assert mapper["title"] == title
    assert mapper["xp_into_level"] == into
    assert mapper["xp_for_next_level"] == nxt

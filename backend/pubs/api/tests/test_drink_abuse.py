from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from pubs.models import (
    Account,
    AccountUsageStats,
    BeerBrand,
    BeerProduct,
    DrinkLog,
    PartyEvening,
    PartyEveningMember,
    PubBeerBrand,
    PubBeerProduct,
    PubCommunityData,
)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def _register(client: APIClient) -> tuple[str, Account]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["token"], Account.objects.get(public_id=response.json()["id"])


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _payload(*, drank_at, client_id=None, party_code=None) -> dict:
    payload = {
        "client_id": str(client_id or uuid.uuid4()),
        "name": "U Zlatého tygra",
        "lat": 50.0876,
        "lng": 14.4214,
        "drink_type": "beer",
        "beer": {"name": "Pilsner Urquell", "price_czk": 65, "volume_ml": 500},
        "drank_at": drank_at.isoformat(),
    }
    if party_code is not None:
        payload["party_code"] = party_code
    return payload


def _drink(
    account: Account,
    drank_at,
    *,
    drink_type=DrinkLog.DrinkType.BEER,
    is_suspect=False,
    suspect_reason="",
) -> DrinkLog:
    return DrinkLog.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key="u2fkbn1z",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        drink_type=drink_type,
        beer_name="Pilsner Urquell" if drink_type == DrinkLog.DrinkType.BEER else "Kofola",
        price_czk=65 if drink_type == DrinkLog.DrinkType.BEER else 49,
        volume_ml=500 if drink_type == DrinkLog.DrinkType.BEER else 400,
        drank_at=drank_at,
        is_suspect=is_suspect,
        suspect_reason=suspect_reason,
    )


def _yesterday_noon():
    local_now = timezone.localtime(timezone.now())
    return (local_now - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)


@pytest.mark.django_db
def test_future_drank_at_is_clamped_to_now(client, monkeypatch):
    fixed_now = timezone.now().replace(microsecond=0)
    token, _account = _register(client)
    monkeypatch.setattr("pubs.api.views.dj_timezone.now", lambda: fixed_now)

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=fixed_now + timedelta(minutes=11)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    drink = DrinkLog.objects.get()
    assert drink.drank_at == fixed_now
    assert drink.is_suspect is False


@pytest.mark.django_db
def test_drink_older_than_backdate_window_is_flagged(client):
    token, _account = _register(client)

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=timezone.now() - timedelta(days=61)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    drink = DrinkLog.objects.get()
    assert drink.is_suspect is True
    assert drink.suspect_reason == "backdated"


@pytest.mark.django_db
def test_twenty_first_beer_is_daily_cap_but_twentieth_is_not(client):
    token, account = _register(client)
    start = _yesterday_noon()
    for index in range(19):
        _drink(account, start + timedelta(minutes=30 * index))

    twentieth = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=30 * 19)),
        format="json",
        **_auth(token),
    )
    twenty_first = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=30 * 20)),
        format="json",
        **_auth(token),
    )

    assert twentieth.status_code == status.HTTP_201_CREATED
    assert twenty_first.status_code == status.HTTP_201_CREATED
    # Additive contract: non-hard-limited responses stay limited=False.
    assert twentieth.json()["limited"] is False
    assert twenty_first.json()["limited"] is False
    newest = list(DrinkLog.objects.order_by("drank_at"))[19:]
    assert [(row.is_suspect, row.suspect_reason) for row in newest] == [
        (False, ""),
        (True, "daily_cap"),
    ]


@pytest.mark.django_db
def test_daily_beer_limit_uses_the_0400_drinking_day(client, settings):
    settings.DRINK_DAILY_FLAG_CAP = 3
    token, account = _register(client)
    # Keep the 04:00 boundary in the past even when this suite runs shortly
    # after midnight. Otherwise the API correctly clamps the final 04:00 row
    # from the future to "now", putting it back into the previous drinking day.
    late_evening = (_yesterday_noon() - timedelta(days=1)).replace(hour=23)
    _drink(account, late_evening)
    _drink(account, late_evening + timedelta(hours=3))
    before_id = uuid.uuid4()

    before_cutoff = client.post(
        "/v1/drinks",
        data=_payload(
            drank_at=late_evening + timedelta(hours=4),
            client_id=before_id,
        ),
        format="json",
        **_auth(token),
    )
    after_cutoff = client.post(
        "/v1/drinks",
        data=_payload(drank_at=late_evening + timedelta(hours=5)),
        format="json",
        **_auth(token),
    )

    assert before_cutoff.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.get(client_id=before_id).suspect_reason == "daily_cap"
    assert after_cutoff.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.latest("drank_at").is_suspect is False


@pytest.mark.django_db
def test_ninth_beer_in_burst_is_flagged_but_spread_beers_are_not(client):
    token, account = _register(client)
    base = _yesterday_noon()
    for index in range(8):
        _drink(account, base + timedelta(seconds=index))
    burst_response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=base + timedelta(seconds=8)),
        format="json",
        **_auth(token),
    )
    assert burst_response.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.latest("drank_at").suspect_reason == "burst"

    other_token, other = _register(client)
    for index in range(8):
        _drink(other, base + timedelta(minutes=11 * index))
    spread_response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=base + timedelta(minutes=11 * 8)),
        format="json",
        **_auth(other_token),
    )
    assert spread_response.status_code == status.HTTP_201_CREATED
    spread_drink = DrinkLog.objects.filter(account=other).latest("drank_at")
    assert spread_drink.is_suspect is False
    assert spread_drink.suspect_reason == ""


@pytest.mark.django_db
def test_forty_first_drink_is_preserved_privately_and_hard_limited(client):
    token, account = _register(client)
    start = _yesterday_noon()
    for index in range(40):
        _drink(account, start + timedelta(minutes=20 * index))
    stats, _ = AccountUsageStats.objects.get_or_create(account=account)
    stats.pivar_xp = 123
    stats.save(update_fields=["pivar_xp"])
    client_id = uuid.uuid4()

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=20 * 40), client_id=client_id),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    body = response.json()
    assert body["accepted"] is True
    assert body["duplicate"] is False
    assert body["limited"] is True
    assert body["menu_updated"] is False
    assert body["pivar"]["xp_awarded"] == 0
    # No Pivař XP moved.
    assert AccountUsageStats.objects.get(account=account).pivar_xp == 123
    # No community menu merge: the private record never touched shared data.
    assert PubCommunityData.objects.count() == 0

    # The private diary keeps the row, flagged with the stable hard-cap reason.
    assert DrinkLog.objects.filter(account=account).count() == 41
    last = DrinkLog.objects.get(account=account, client_id=client_id)
    assert last.is_suspect is True
    assert last.suspect_reason == "daily_hard_cap"

    # Offline reconciliation (GET /v1/drinks) and the real account export
    # both carry the hard-limited row.
    listed = client.get("/v1/drinks", **_auth(token))
    assert listed.status_code == status.HTTP_200_OK
    ids = {item["client_id"] for item in listed.json()["drinks"]}
    assert str(client_id) in ids

    exported = client.get("/v1/account/export", **_auth(token))
    assert exported.status_code == status.HTTP_200_OK
    export_ids = {row["client_id"] for row in exported.json()["drinks"]}
    assert str(client_id) in export_ids
    exported_row = next(row for row in exported.json()["drinks"] if row["client_id"] == str(client_id))
    assert exported_row["is_suspect"] is True
    assert exported_row["suspect_reason"] == "daily_hard_cap"

    # Duplicate retry of the same hard-limited client_id changes nothing.
    xp_after_first = AccountUsageStats.objects.get(account=account).pivar_xp
    retry = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=20 * 40), client_id=client_id),
        format="json",
        **_auth(token),
    )
    assert retry.status_code == status.HTTP_200_OK
    retry_body = retry.json()
    assert retry_body["duplicate"] is True
    assert retry_body["limited"] is True
    assert retry_body["menu_updated"] is False
    assert retry_body["pivar"]["xp_awarded"] == 0
    assert DrinkLog.objects.filter(account=account).count() == 41
    last.refresh_from_db()
    assert last.is_suspect is True
    assert last.suspect_reason == "daily_hard_cap"
    assert AccountUsageStats.objects.get(account=account).pivar_xp == xp_after_first
    assert PubCommunityData.objects.count() == 0


@pytest.mark.django_db
def test_hard_limited_drink_never_links_to_party_evening(client):
    token, account = _register(client)
    start = _yesterday_noon()
    # 39 private rows leave the account exactly one drink below the hard cap.
    for index in range(39):
        _drink(account, start + timedelta(minutes=20 * index))
    assert DrinkLog.objects.filter(account=account).count() == 39

    # One open evening spanning BOTH requests below: its 24h entry window
    # covers every drank_at used here, so any non-link is caused by the cap,
    # not by an expired join code.
    evening = PartyEvening.objects.create(
        host=account,
        client_id=uuid.uuid4(),
        join_code="PRAH24",
        pub_name="U Zlatého tygra",
        pub_city="Praha",
        started_at=start,
    )
    PartyEveningMember.objects.create(evening=evening, account=account)

    # Control: the 40th drink inside the open evening links normally.
    control_client_id = uuid.uuid4()
    control = client.post(
        "/v1/drinks",
        data=_payload(
            drank_at=start + timedelta(minutes=20 * 39),
            client_id=control_client_id,
            party_code="PRAH24",
        ),
        format="json",
        **_auth(token),
    )
    assert control.status_code == status.HTTP_201_CREATED
    assert control.json()["limited"] is False
    assert DrinkLog.objects.filter(account=account).count() == 40
    control_row = DrinkLog.objects.get(account=account, client_id=control_client_id)
    assert control_row.party_evening_id == evening.pk

    xp_before = AccountUsageStats.objects.get(account=account).pivar_xp
    limited_client_id = uuid.uuid4()

    # The 41st drink hits the hard cap even though the same table is open:
    # it stays private and never joins the shared evening.
    limited = client.post(
        "/v1/drinks",
        data=_payload(
            drank_at=start + timedelta(minutes=20 * 40),
            client_id=limited_client_id,
            party_code="PRAH24",
        ),
        format="json",
        **_auth(token),
    )

    assert limited.status_code == status.HTTP_201_CREATED
    assert limited.json()["limited"] is True
    row = DrinkLog.objects.get(account=account, client_id=limited_client_id)
    assert row.is_suspect is True
    assert row.suspect_reason == "daily_hard_cap"
    assert row.party_evening_id is None
    assert AccountUsageStats.objects.get(account=account).pivar_xp == xp_before


@pytest.mark.django_db
def test_pub_and_non_pub_beers_share_daily_flag_and_hard_cap(client):
    token, account = _register(client)
    start = _yesterday_noon()
    for index in range(20):
        drink = _drink(account, start + timedelta(minutes=20 * index))
        if index % 2:
            DrinkLog.objects.filter(pk=drink.pk).update(
                cache_key=None,
                name="",
                lat=None,
                lng=None,
                place_context=DrinkLog.PlaceContext.OUTDOORS,
            )

    twenty_first = client.post(
        "/v1/drinks",
        data={
            "client_id": str(uuid.uuid4()),
            "place_context": "private",
            "drink_type": "beer",
            "beer": {"name": "Pilsner Urquell", "volume_ml": 500},
            "drank_at": (start + timedelta(minutes=20 * 20)).isoformat(),
        },
        format="json",
        **_auth(token),
    )
    assert twenty_first.status_code == status.HTTP_201_CREATED
    assert DrinkLog.objects.latest("drank_at").suspect_reason == "daily_cap"

    for index in range(21, 40):
        _drink(account, start + timedelta(minutes=20 * index))
    forty_first = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=20 * 40)),
        format="json",
        **_auth(token),
    )
    assert forty_first.status_code == status.HTTP_201_CREATED
    assert forty_first.json()["limited"] is True
    assert forty_first.json()["menu_updated"] is False
    assert DrinkLog.objects.filter(account=account).count() == 41
    assert DrinkLog.objects.latest("drank_at").suspect_reason == "daily_hard_cap"


@pytest.mark.django_db
def test_non_beers_do_not_consume_beer_fair_play_limits(client):
    token, account = _register(client)
    base = _yesterday_noon()
    for index in range(20):
        _drink(
            account,
            base + timedelta(seconds=index),
            drink_type=DrinkLog.DrinkType.SOFT_DRINK,
        )

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=base + timedelta(seconds=20)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    drink = DrinkLog.objects.latest("created_at")
    assert drink.is_suspect is False
    assert drink.suspect_reason == ""


@pytest.mark.django_db
def test_burst_cannot_be_bypassed_with_descending_timestamps(client):
    token, account = _register(client)
    base = _yesterday_noon()
    for index in range(8):
        _drink(account, base + timedelta(seconds=20 - index))

    response = client.post(
        "/v1/drinks",
        data=_payload(drank_at=base + timedelta(seconds=12)),
        format="json",
        **_auth(token),
    )

    assert response.status_code == status.HTTP_201_CREATED
    drink = DrinkLog.objects.latest("created_at")
    assert drink.is_suspect is True
    assert drink.suspect_reason == "burst"


@pytest.mark.django_db
def test_duplicate_retry_does_not_recompute_or_change_flags(client):
    token, account = _register(client)
    client_id = uuid.uuid4()
    old_time = timezone.now() - timedelta(days=61)
    first = client.post(
        "/v1/drinks",
        data=_payload(drank_at=old_time, client_id=client_id),
        format="json",
        **_auth(token),
    )
    assert first.status_code == status.HTTP_201_CREATED
    DrinkLog.objects.filter(account=account).update(is_suspect=True, suspect_reason="manual")

    retry = client.post(
        "/v1/drinks",
        data=_payload(drank_at=timezone.now(), client_id=client_id),
        format="json",
        **_auth(token),
    )

    assert retry.status_code == status.HTTP_200_OK
    assert retry.json()["duplicate"] is True
    # A normal duplicate stays limited=False in the additive contract.
    assert retry.json()["limited"] is False
    assert DrinkLog.objects.filter(account=account).count() == 1
    drink = DrinkLog.objects.get(account=account)
    assert drink.is_suspect is True
    assert drink.suspect_reason == "manual"


@pytest.mark.django_db
def test_patch_on_hard_limited_drink_never_publishes_brand_index(client):
    token, account = _register(client)
    start = _yesterday_noon()
    for index in range(40):
        _drink(account, start + timedelta(minutes=20 * index))
    client_id = uuid.uuid4()
    limited = client.post(
        "/v1/drinks",
        data=_payload(drank_at=start + timedelta(minutes=20 * 40), client_id=client_id),
        format="json",
        **_auth(token),
    )
    assert limited.status_code == status.HTTP_201_CREATED
    assert limited.json()["limited"] is True

    patched = client.patch(
        f"/v1/drinks/{client_id}",
        data={"beer_name": "Velkopopovický Kozel 11°"},
        format="json",
        **_auth(token),
    )

    assert patched.status_code == status.HTTP_200_OK
    assert patched.json() == {"updated": True}
    # The private diary row updates normally.
    drink = DrinkLog.objects.get(account=account, client_id=client_id)
    assert drink.beer_name == "Velkopopovický Kozel 11°"
    assert drink.beer_brand_key == "velkopopovicky-kozel"
    assert drink.beer_product_key == "velkopopovicky-kozel-11"
    # A suspect row never publishes a public brand/product index.
    assert PubBeerBrand.objects.count() == 0
    assert PubBeerProduct.objects.count() == 0


@pytest.mark.django_db
def test_suspect_row_does_not_keep_old_index_active_after_patch(client):
    token, account = _register(client)
    brand = BeerBrand.objects.get(key="pilsner-urquell")
    product = BeerProduct.objects.get(key="pilsner-urquell")
    common = dict(
        account=account,
        cache_key="u2fkbn1z",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        beer_name="Pilsner Urquell",
        beer_brand=brand,
        beer_brand_key=brand.key,
        beer_brand_name=brand.name,
        beer_product=product,
        beer_product_key=product.key,
        beer_product_name=product.name,
        price_czk=65,
        volume_ml=500,
        drank_at=_yesterday_noon(),
    )
    legit = DrinkLog.objects.create(client_id=uuid.uuid4(), **common)
    DrinkLog.objects.create(
        client_id=uuid.uuid4(),
        is_suspect=True,
        suspect_reason="daily_hard_cap",
        **common,
    )
    PubBeerBrand.objects.create(
        cache_key="u2fkbn1z",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        brand=brand,
        brand_key=brand.key,
        brand_name=brand.name,
        source=PubBeerBrand.Source.DRINK,
        account=account,
    )
    PubBeerProduct.objects.create(
        cache_key="u2fkbn1z",
        name="U Zlatého tygra",
        lat=50.0876,
        lng=14.4214,
        brand=brand,
        product=product,
        brand_key=brand.key,
        brand_name=brand.name,
        product_key=product.key,
        product_name=product.name,
        source=PubBeerProduct.Source.DRINK,
        account=account,
    )

    patched = client.patch(
        f"/v1/drinks/{legit.client_id}",
        data={"beer_name": "Velkopopovický Kozel 11°"},
        format="json",
        **_auth(token),
    )

    assert patched.status_code == status.HTTP_200_OK
    # The suspect row must not keep the old public index active.
    pub_brand = PubBeerBrand.objects.get(cache_key="u2fkbn1z", brand_key="pilsner-urquell")
    pub_product = PubBeerProduct.objects.get(cache_key="u2fkbn1z", product_key="pilsner-urquell")
    assert pub_brand.active is False
    assert pub_product.active is False

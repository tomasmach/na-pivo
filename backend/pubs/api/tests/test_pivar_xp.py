from __future__ import annotations

import io
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from pubs.api.views import _drink_pivar_award, _increment_pivar_xp
from pubs.models import Account, AccountUsageStats, BeerBrand, DrinkLog, PubVisit

PRAGUE = ZoneInfo("Europe/Prague")


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def _isolated_runtime(tmp_path, settings):
    cache.clear()
    settings.MEDIA_ROOT = str(tmp_path / "media")
    settings.DRINK_BACKDATE_FLAG_DAYS = 3650
    settings.DRINK_FUTURE_GRACE_MINUTES = 999999999
    settings.DRINK_DAILY_FLAG_CAP = 100
    settings.DRINK_BURST_LIMIT = 100
    yield
    cache.clear()


def _register(client: APIClient) -> tuple[str, Account]:
    response = client.post(
        "/v1/account",
        data={"device_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == 201, response.content
    return response.json()["token"], Account.objects.get(public_id=response.json()["id"])


def _auth(token: str) -> dict[str, str]:
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


def _drink(
    client: APIClient,
    token: str,
    *,
    drank_at: datetime,
    client_id: uuid.UUID | None = None,
    place_context: str = "private",
    beer_name: str = "Neznámý domácí ležák",
    lat: float = 50.08,
    lng: float = 14.42,
):
    payload = {
        "client_id": str(client_id or uuid.uuid4()),
        "place_context": place_context,
        "beer": {"name": beer_name, "volume_ml": 500},
        "drank_at": drank_at.isoformat(),
    }
    if place_context == "pub":
        payload.update(
            {
                "name": f"Hospoda {lat:.3f}",
                "lat": lat,
                "lng": lng,
                "city": "Praha",
                "beer": {
                    "name": beer_name,
                    "price_czk": 60,
                    "volume_ml": 500,
                },
            }
        )
    return client.post("/v1/drinks", data=payload, format="json", **_auth(token))


def _photo_upload(taken_at: datetime, client_id: uuid.UUID | None = None):
    image = Image.new("RGB", (16, 16), (210, 160, 40))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return {
        "client_id": str(client_id or uuid.uuid4()),
        "taken_at": taken_at.isoformat(),
        "image": SimpleUploadedFile("beer.jpg", buffer.getvalue(), content_type="image/jpeg"),
    }


@pytest.mark.django_db
def test_evening_extra_beer_cap_and_0400_boundary(client):
    token, account = _register(client)
    start = datetime(2026, 6, 1, 18, tzinfo=PRAGUE)

    awards = []
    for index in range(7):
        response = _drink(client, token, drank_at=start + timedelta(minutes=index * 30))
        assert response.status_code == 201, response.content
        awards.append(response.json()["pivar"]["xp_awarded"])

    before_boundary = _drink(
        client,
        token,
        drank_at=datetime(2026, 6, 2, 3, 59, tzinfo=PRAGUE),
    )
    at_boundary = _drink(
        client,
        token,
        drank_at=datetime(2026, 6, 2, 4, 0, tzinfo=PRAGUE),
    )

    assert awards == [45, 2, 2, 2, 2, 2, 0]
    assert before_boundary.json()["pivar"]["xp_awarded"] == 0
    assert at_boundary.json()["pivar"]["xp_awarded"] == 20
    assert AccountUsageStats.objects.get(account=account).pivar_xp == 75


@pytest.mark.django_db
def test_new_pub_brand_and_context_first_award_once(client):
    token, _ = _register(client)
    first_day = datetime(2026, 6, 3, 18, tzinfo=PRAGUE)
    next_day = first_day + timedelta(days=1)

    first = _drink(
        client,
        token,
        drank_at=first_day,
        place_context="pub",
        beer_name="Pilsner Urquell",
    )
    repeat = _drink(
        client,
        token,
        drank_at=next_day,
        place_context="pub",
        beer_name="Pilsner Urquell",
    )
    new_pub = _drink(
        client,
        token,
        drank_at=next_day + timedelta(minutes=30),
        place_context="pub",
        beer_name="Pilsner Urquell",
        lat=50.09,
        lng=14.43,
    )
    new_brand = _drink(
        client,
        token,
        drank_at=next_day + timedelta(minutes=60),
        place_context="pub",
        beer_name="Budvar",
        lat=50.09,
        lng=14.43,
    )
    context_first = _drink(
        client,
        token,
        drank_at=next_day + timedelta(minutes=90),
        place_context="outdoors",
    )
    context_repeat = _drink(
        client,
        token,
        drank_at=next_day + timedelta(minutes=120),
        place_context="outdoors",
    )

    assert [
        row.json()["pivar"]["xp_awarded"]
        for row in [first, repeat, new_pub, new_brand, context_first, context_repeat]
    ] == [75, 20, 42, 17, 27, 2]


@pytest.mark.django_db
def test_prior_pub_visit_suppresses_new_pub_bonus(client):
    token, account = _register(client)
    occurred_at = datetime(2026, 6, 4, 18, tzinfo=PRAGUE)
    lat, lng = 50.08, 14.42
    first = _drink(
        client,
        token,
        drank_at=occurred_at,
        place_context="pub",
        beer_name="Pilsner Urquell",
        lat=lat,
        lng=lng,
    )
    cache_key = DrinkLog.objects.get().cache_key
    DrinkLog.objects.all().delete()
    AccountUsageStats.objects.filter(account=account).update(pivar_xp=0)
    PubVisit.objects.create(
        account=account,
        client_id=uuid.uuid4(),
        cache_key=cache_key,
        name="Navštívená hospoda",
        lat=lat,
        lng=lng,
        started_at=occurred_at - timedelta(days=1),
        client_updated_at=occurred_at - timedelta(days=1),
    )

    after_visit = _drink(
        client,
        token,
        drank_at=occurred_at,
        place_context="pub",
        beer_name="Pilsner Urquell",
        lat=lat,
        lng=lng,
    )

    assert first.json()["pivar"]["xp_awarded"] == 75
    assert after_visit.json()["pivar"]["xp_awarded"] == 35


@pytest.mark.django_db
def test_pivar_award_uses_at_most_five_added_queries(client):
    _, account = _register(client)
    stats, _ = AccountUsageStats.objects.get_or_create(account=account)
    brand = BeerBrand.objects.get(key="pilsner-urquell")
    occurred_at = datetime(2026, 6, 4, 18, tzinfo=PRAGUE)

    with transaction.atomic():
        account = Account.objects.select_for_update().get(pk=account.pk)
        with CaptureQueriesContext(connection) as queries:
            award = _drink_pivar_award(
                account=account,
                drank_at=occurred_at,
                is_suspect=False,
                drink_type=DrinkLog.DrinkType.BEER,
                cache_key="u2fkbn12",
                beer_brand=brand,
                place_context=DrinkLog.PlaceContext.PUB,
            )
            _increment_pivar_xp(account, award)

    assert len(queries) <= 5
    stats.refresh_from_db()
    assert stats.pivar_xp == 75


@pytest.mark.django_db
def test_suspect_and_duplicate_never_increment_xp(client, settings):
    token, account = _register(client)
    settings.DRINK_BACKDATE_FLAG_DAYS = 1
    client_id = uuid.uuid4()
    suspect = _drink(
        client,
        token,
        drank_at=timezone.now() - timedelta(days=10),
        client_id=client_id,
        place_context="pub",
        beer_name="Pilsner Urquell",
    )
    replay = _drink(
        client,
        token,
        drank_at=timezone.now() - timedelta(days=10),
        client_id=client_id,
        place_context="pub",
        beer_name="Pilsner Urquell",
    )

    assert suspect.status_code == 201
    assert suspect.json()["pivar"]["xp_awarded"] == 0
    assert replay.status_code == 200
    assert replay.json()["pivar"]["xp_awarded"] == 0
    assert AccountUsageStats.objects.get(account=account).pivar_xp == 0


@pytest.mark.django_db
def test_account_me_contains_full_pivar_block(client):
    token, _ = _register(client)
    response = client.get("/v1/account/me", **_auth(token))

    pivar = response.json()["pivar"]
    assert pivar["xp"] == 0
    assert pivar["title"] == "Zelenáč"
    assert len(pivar["levels"]) == 7
    assert pivar["xp_rules"] == {
        "evening": 20,
        "new_pub": 40,
        "new_brand": 15,
        "extra_beer": 2,
        "extra_beer_daily_cap": 5,
        "context_first": 25,
        "photo": 10,
        "checkin": 5,
    }


@pytest.mark.django_db
def test_photo_and_checkin_award_only_first_event_of_day(client):
    token, account = _register(client)
    occurred_at = datetime(2026, 6, 5, 20, tzinfo=PRAGUE)

    first_photo = client.post("/v1/beer-photos", data=_photo_upload(occurred_at), **_auth(token))
    second_photo = client.post(
        "/v1/beer-photos", data=_photo_upload(occurred_at + timedelta(hours=1)), **_auth(token)
    )
    first_checkin_id = uuid.uuid4()
    checkin_payload = {
        "client_id": str(first_checkin_id),
        "beer_name": "Plzeň 12",
        "checked_in_at": occurred_at.isoformat(),
    }
    first_checkin = client.post(
        "/v1/beer-checkins", data=checkin_payload, format="json", **_auth(token)
    )
    second_checkin = client.post(
        "/v1/beer-checkins",
        data={
            **checkin_payload,
            "client_id": str(uuid.uuid4()),
            "checked_in_at": (occurred_at + timedelta(hours=2)).isoformat(),
        },
        format="json",
        **_auth(token),
    )
    replay = client.post("/v1/beer-checkins", data=checkin_payload, format="json", **_auth(token))

    assert [first_photo.status_code, second_photo.status_code] == [201, 201]
    assert [first_checkin.status_code, second_checkin.status_code, replay.status_code] == [
        201,
        201,
        200,
    ]
    assert AccountUsageStats.objects.get(account=account).pivar_xp == 15


@pytest.mark.django_db
def test_backfill_reproduces_live_mixed_history_and_dry_run(client, capsys):
    token, account = _register(client)
    first_day = datetime(2026, 6, 6, 18, tzinfo=PRAGUE)
    _drink(client, token, drank_at=first_day)
    _drink(client, token, drank_at=first_day + timedelta(hours=1))
    _drink(
        client,
        token,
        drank_at=first_day + timedelta(days=1),
        place_context="pub",
        beer_name="Pilsner Urquell",
    )
    client.post("/v1/beer-photos", data=_photo_upload(first_day), **_auth(token))
    client.post(
        "/v1/beer-checkins",
        data={
            "client_id": str(uuid.uuid4()),
            "beer_name": "Plzeň 12",
            "checked_in_at": first_day.isoformat(),
        },
        format="json",
        **_auth(token),
    )
    stats = AccountUsageStats.objects.get(account=account)
    live_total = stats.pivar_xp
    stats.pivar_xp = 0
    stats.save(update_fields=["pivar_xp"])

    call_command("backfill_pivar_xp", "--dry-run")
    stats.refresh_from_db()
    assert stats.pivar_xp == 0
    assert f"{account.public_id}: {live_total} XP" in capsys.readouterr().out

    call_command("backfill_pivar_xp")
    stats.refresh_from_db()
    assert stats.pivar_xp == live_total

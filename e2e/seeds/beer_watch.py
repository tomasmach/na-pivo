"""Synthetic beer-watch fixtures and a read-only oracle of captured pushes."""

import os
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from pubs.beer_catalog import sync_pub_beer_indexes_for_menu
from pubs.models import (
    Account,
    BeerBrand,
    BeerProduct,
    BeerTapEvent,
    BeerWatch,
    BeerWatchPush,
    EmailCredential,
    PubCommunityData,
    PushDevice,
)

from e2e.backend import push_outbox
from e2e.seeds import base

WATCHED = ("E2E Hlídaná 12°", "E2E Druhá 11°")


def seed():
    base.seed()
    now = timezone.now()
    primary = Account.objects.get(nickname="E2EPivar")
    second = Account.objects.create(
        device_id="e2e-second",
        nickname="E2EKamos",
        display_name="E2EKamos",
        ugc_terms_version=settings.UGC_POLICY_VERSION,
        ugc_terms_accepted_at=now,
        quorum_trusted_at=now - timedelta(days=3),
    )
    EmailCredential.objects.create(
        account=second,
        email=f"second-{os.environ['NA_PIVO_E2E_EMAIL']}",
        password=make_password(os.environ["NA_PIVO_E2E_PASSWORD"]),
        email_verified=True,
    )
    brand = BeerBrand.objects.create(key="e2e-pivovar", name="E2E Pivovar")
    for key, name in zip(("e2e-hlidana-12", "e2e-druha-11"), WATCHED, strict=True):
        BeerProduct.objects.create(
            key=key, brand=brand, brand_key=brand.key, brand_name=brand.name, name=name
        )
    # The watched beers already pour at the second pub, so the user can find
    # them there; this pub is history and never triggers an alert.
    menu = PubCommunityData.objects.get(name="E2E Druhá hospoda")
    menu.beers = [{"name": name, "price_czk": 49, "volume_ml": 500} for name in WATCHED]
    menu.save()
    sync_pub_beer_indexes_for_menu(
        cache_key=menu.cache_key,
        data={"name": menu.name, "lat": menu.lat, "lng": menu.lng, "city": menu.city},
        beers=menu.beers,
        source="community",
        account=None,
    )
    # The app never registers a real Expo token in local E2E; the backend
    # sends to this synthetic device and the outbox captures the message.
    PushDevice.objects.create(
        account=primary,
        push_token="ExponentPushToken[e2e-primary-device]",
        platform="ios",
        permission_status="granted",
        enabled=True,
        locale="cs",
    )


def observe():
    return {
        "watches": sorted(
            BeerWatch.objects.filter(account__nickname="E2EPivar").values_list(
                "product__name", flat=True
            )
        ),
        "radiusM": Account.objects.get(nickname="E2EPivar").beer_watch_radius_m,
        "locationSet": Account.objects.filter(
            nickname="E2EPivar", beer_watch_located_at__isnull=False
        ).exists(),
        "events": [
            {
                "pub": event.pub_name,
                "beer": event.product.name,
                "contributor": event.contributor.nickname,
                "fannedOut": event.fanned_out_at is not None,
            }
            for event in BeerTapEvent.objects.select_related("product", "contributor").order_by("pk")
        ],
        "deliveries": list(
            BeerWatchPush.objects.order_by("pk").values(
                "account__nickname", "event__pub_name", "event__product__name"
            )
        ),
        "pushes": [
            {"body": message["body"], "kind": message["data"]["kind"], "pub": message["data"]["name"]}
            for message in push_outbox.messages
        ],
    }

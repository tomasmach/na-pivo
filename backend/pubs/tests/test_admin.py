from types import SimpleNamespace

import pytest
from django.contrib import admin

from pubs.enrichment import geohash8
from pubs.models import UserAddedPub


@pytest.mark.django_db
def test_user_added_pub_admin_recomputes_cache_key_after_coordinate_edit():
    pub = UserAddedPub.objects.create(
        client_id="9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
        cache_key=geohash8(50.0812, 14.4182),
        name="Hospoda U Komunity",
        lat=50.0812,
        lng=14.4182,
    )
    pub.lat = 49.1951
    pub.lng = 16.6068
    form = SimpleNamespace(changed_data=["lat", "lng"])

    admin.site._registry[UserAddedPub].save_model(None, pub, form, change=True)

    pub.refresh_from_db()
    assert pub.cache_key == geohash8(49.1951, 16.6068)

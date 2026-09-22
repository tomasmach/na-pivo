"""Nearby pub joins must keep stable IDs and same-cell businesses distinct."""

import pytest

from pubs.api.views import (
    _filter_items_by_amenity_signals,
    _with_missing_pub_signal_items,
    _with_pub_signal_items,
)


def _item(name, *, lat=50.0812, lng=14.4182, external_id=None):
    item = {"name": name, "position": {"lat": lat, "lon": lng}}
    if external_id:
        item["id"] = external_id
    return item


@pytest.mark.parametrize(
    ("provider", "signal", "same_pub"),
    [
        (
            _item("Pilsner Pub", external_id="stable:a"),
            _item("Other Name", lat=49, external_id="stable:a"),
            True,
        ),
        (
            _item("Pilsner Pub", external_id="stable:a"),
            _item("Pilsner Pub", external_id="stable:b"),
            False,
        ),
        (_item("Pilsner Pub"), _item("Pilsner Pub", external_id="stable:b"), True),
        (_item("Pilsner Pub", external_id="stable:a"), _item("Pilsner Pub"), True),
        (
            _item("Pilsner Pub", external_id="stable:a"),
            _item("Pilsner Pub", external_id="mapy:50.08120,14.41820"),
            True,
        ),
        (_item("Pilsner Pub"), _item("Aquarium Whale"), False),
        (_item("Pilsner Pub"), _item("Pilsner Pub", lat=49), False),
    ],
)
def test_all_nearby_joins_preserve_pub_identity(provider, signal, same_pub):
    assert _with_missing_pub_signal_items([signal], [provider]) == (
        [provider] if same_pub else [provider, signal]
    )
    assert _with_pub_signal_items([signal], [provider]) == (
        [signal] if same_pub else [signal, provider]
    )
    assert _filter_items_by_amenity_signals([provider], [signal]) == (
        [provider] if same_pub else []
    )


def test_nearby_joins_keep_source_order_and_repeated_unmatched_signals():
    first = _item("First Pub")
    second = _item("Second Pub", lat=50.09)
    third = _item("Third Pub", lat=50.10)
    second_signal = dict(second)
    new_signal = _item("New Pub", lat=49)
    providers = [first, second, third]
    signals = [second_signal, new_signal, new_signal]

    assert _with_missing_pub_signal_items(signals, providers) == [
        first,
        second,
        third,
        new_signal,
        new_signal,
    ]
    assert _with_pub_signal_items(signals, providers) == [
        second_signal,
        new_signal,
        new_signal,
        first,
        third,
    ]
    assert _filter_items_by_amenity_signals(providers, signals) == [second]

import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _isolate_django_cache_between_tests():
    """Do not let request throttles or cached API rows leak across test cases."""

    cache.clear()
    yield
    cache.clear()

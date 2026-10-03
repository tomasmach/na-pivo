"""Reserve the primary credential for registration through the native UI."""

from e2e.seeds import base, identity

from pubs.models import Account


def seed():
    base.seed()
    Account.objects.get(nickname="E2EPivar").delete()
    identity.seed_observers()


def observe():
    return identity.observe()

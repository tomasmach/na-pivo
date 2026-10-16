"""Reserve the primary credential for registration through the native UI."""

from pubs.models import Account

from e2e.seeds import base, identity


def seed():
    base.seed()
    Account.objects.get(nickname="E2EPivar").delete()
    identity.seed_observers()


def observe():
    return identity.observe()

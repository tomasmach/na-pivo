"""Only a real NOWAIT lock conflict may be reported as a lock conflict.

The account merge and the account purge both wrap ``select_for_update(nowait=True)``
in ``except DatabaseError`` so a genuine conflict turns into a clean 409 instead
of a deadlock. That net catches more than it should: with a connection pool in
front of Postgres, an overloaded pool raises ``psycopg_pool.PoolTimeout``, which
is an ``OperationalError`` and therefore a ``DatabaseError`` as well. Telling a
user "someone else changed your account, log in again" because the server ran
out of connections is the sort of confident lie that once left someone locked
out of their account.
"""

import psycopg
import psycopg_pool
from django.db import OperationalError

from pubs.accounts import is_row_lock_conflict


def as_django_error(cause: BaseException) -> OperationalError:
    """Rebuild how Django re-raises a driver error: wrapped, cause attached."""
    error = OperationalError(str(cause))
    error.__cause__ = cause
    return error


def test_losing_a_race_for_a_row_lock_is_still_a_lock_conflict():
    # What NOWAIT raises, and the deadlock the lock ordering exists to avoid.
    # Both mean "another writer got here first", which is what the 409 says.
    for cause in (
        psycopg.errors.LockNotAvailable("could not obtain lock on row in relation"),
        psycopg.errors.DeadlockDetected("deadlock detected"),
    ):
        assert is_row_lock_conflict(as_django_error(cause)) is True


def test_pool_timeout_is_not_a_lock_conflict():
    cause = psycopg_pool.PoolTimeout("couldn't get a connection after 10.00 sec")

    assert isinstance(cause, psycopg.OperationalError)
    assert is_row_lock_conflict(as_django_error(cause)) is False


def test_other_database_failures_are_not_lock_conflicts():
    for cause in (
        psycopg.errors.AdminShutdown("terminating connection due to administrator command"),
        psycopg.errors.QueryCanceled("canceling statement due to statement timeout"),
        psycopg.errors.UndefinedColumn("column does not exist"),
    ):
        assert is_row_lock_conflict(as_django_error(cause)) is False


def test_error_without_a_driver_cause_is_not_a_lock_conflict():
    assert is_row_lock_conflict(OperationalError("no cause at all")) is False

package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NearbyCacheReducerTest {
    @Test
    fun `first nearby pub becomes nearest when target is missing`() {
        val next = reduceNearbyCache(
            current = state(),
            pubs = listOf(pubA, pubA, pubB),
            fetchedAt = FETCHED_AT,
        )

        assertEquals(listOf(pubA, pubB), next.nearbyPubs)
        assertEquals(TargetState(TargetSelection.NEAREST, pubA), next.target)
        assertEquals(FETCHED_AT, next.nearbyFetchedAt)
        assertFalse(next.isStale)
    }

    @Test
    fun `nearest target follows new area and clears on genuine empty`() {
        val moved = reduceNearbyCache(
            current = state(
                target = TargetState(TargetSelection.NEAREST, pubA),
                nearbyPubs = listOf(pubA),
            ),
            pubs = listOf(pubB),
            fetchedAt = FETCHED_AT,
        )

        assertEquals(TargetState(TargetSelection.NEAREST, pubB), moved.target)

        val empty = reduceNearbyCache(
            current = moved,
            pubs = emptyList(),
            fetchedAt = LATER_FETCHED_AT,
        )

        assertTrue(empty.nearbyPubs.isEmpty())
        assertNull(empty.target)
        assertEquals(LATER_FETCHED_AT, empty.nearbyFetchedAt)
        assertFalse(empty.isStale)
    }

    @Test
    fun `manual target survives new and empty nearby results`() {
        val manual = TargetState(TargetSelection.MANUAL, pubA)
        val moved = reduceNearbyCache(
            current = state(target = manual, nearbyPubs = listOf(pubA)),
            pubs = listOf(pubB),
            fetchedAt = FETCHED_AT,
        )
        val empty = reduceNearbyCache(
            current = moved,
            pubs = emptyList(),
            fetchedAt = LATER_FETCHED_AT,
        )

        assertEquals(manual, moved.target)
        assertEquals(manual, empty.target)
        assertTrue(empty.nearbyPubs.isEmpty())
    }

    @Test
    fun `offline keeps cached pubs and target as stale fallback`() {
        val target = TargetState(TargetSelection.NEAREST, pubA)
        val current = state(
            target = target,
            nearbyPubs = listOf(pubA, pubB),
        )

        val offline = reduceNearbyOffline(current)

        assertEquals(current.nearbyPubs, offline.nearbyPubs)
        assertEquals(target, offline.target)
        assertEquals(current.nearbyFetchedAt, offline.nearbyFetchedAt)
        assertTrue(offline.isStale)
    }

    private fun state(
        target: TargetState? = null,
        nearbyPubs: List<PubRef> = emptyList(),
    ): PersistedState = PersistedState(
        actorId = "wear-test",
        accountEpoch = "account-test",
        target = target,
        nearbyPubs = nearbyPubs,
        nearbyFetchedAt = "2026-07-30T20:00:00Z",
        isStale = true,
    )

    companion object {
        private const val FETCHED_AT = "2026-07-30T21:00:00Z"
        private const val LATER_FETCHED_AT = "2026-07-30T22:00:00Z"
        private val pubA = PubRef(
            pubKey = "u2fkbn4f",
            name = "U Zlatého tygra",
            latitude = 50.08706,
            longitude = 14.41786,
        )
        private val pubB = PubRef(
            pubKey = "u2fkbn4g",
            name = "Lokál",
            latitude = 50.088,
            longitude = 14.42,
        )
    }
}

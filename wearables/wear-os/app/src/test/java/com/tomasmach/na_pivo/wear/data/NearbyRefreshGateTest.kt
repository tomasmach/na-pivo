package com.tomasmach.na_pivo.wear.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NearbyRefreshGateTest {
    @Test
    fun `offline cached result retries only after cooldown`() {
        val gate = NearbyRefreshGate(retryCooldownMillis = 30_000)

        assertTrue(gate.startAttempt("prague", hasCachedPubs = true, nowMillis = 1_000))
        gate.finishAttempt(retryRequired = true)

        assertFalse(gate.startAttempt("prague", hasCachedPubs = true, nowMillis = 30_999))
        assertTrue(gate.startAttempt("prague", hasCachedPubs = true, nowMillis = 31_000))
    }

    @Test
    fun `successful cached result stays quiet in same cell`() {
        val gate = NearbyRefreshGate(retryCooldownMillis = 30_000)

        assertTrue(gate.startAttempt("prague", hasCachedPubs = true, nowMillis = 1_000))
        gate.finishAttempt(retryRequired = false)

        assertFalse(gate.startAttempt("prague", hasCachedPubs = true, nowMillis = 301_000))
    }

    @Test
    fun `new cell bypasses retry cooldown`() {
        val gate = NearbyRefreshGate(retryCooldownMillis = 30_000)

        assertTrue(gate.startAttempt("prague-a", hasCachedPubs = true, nowMillis = 1_000))
        gate.finishAttempt(retryRequired = true)

        assertTrue(gate.startAttempt("prague-b", hasCachedPubs = true, nowMillis = 1_001))
    }

    @Test
    fun `empty result is retried without hammering`() {
        val gate = NearbyRefreshGate(retryCooldownMillis = 30_000)

        assertTrue(gate.startAttempt("prague", hasCachedPubs = false, nowMillis = 1_000))
        gate.finishAttempt(retryRequired = true)

        assertFalse(gate.startAttempt("prague", hasCachedPubs = false, nowMillis = 2_000))
        assertTrue(gate.startAttempt("prague", hasCachedPubs = false, nowMillis = 31_000))
    }
}

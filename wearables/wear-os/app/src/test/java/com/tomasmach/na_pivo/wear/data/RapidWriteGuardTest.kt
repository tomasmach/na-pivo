package com.tomasmach.na_pivo.wear.data

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RapidWriteGuardTest {
    @Test
    fun `first write is accepted and immediate second is rejected`() {
        val guard = RapidWriteGuard(1_200)
        assertTrue(guard.tryAcquire(10_000))
        assertFalse(guard.tryAcquire(10_001))
        assertTrue(guard.tryAcquire(11_200))
    }

    @Test
    fun `concurrent taps can acquire at most one write`() {
        val guard = RapidWriteGuard(1_200)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val results = (1..8).map {
                pool.submit<Boolean> {
                    start.await()
                    guard.tryAcquire(10_000)
                }
            }
            start.countDown()
            assertEquals(1, results.count { it.get() })
        } finally {
            pool.shutdownNow()
        }
    }
}

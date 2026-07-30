package com.tomasmach.na_pivo.wear.sync

import com.tomasmach.na_pivo.wear.domain.PendingEnvelope
import com.tomasmach.na_pivo.wear.domain.PersistedState
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class DataLayerTransportTest {
    @Test
    fun `retry keeps the command identity but changes its transport nonce`() {
        val pending = PendingEnvelope(
            messageId = "11111111-1111-4111-8111-111111111111",
            path = DataPaths.command("11111111-1111-4111-8111-111111111111"),
            json = """{"type":"clear_target"}""",
            createdAt = "2026-07-30T19:00:00Z",
        )

        val first = transportPayload(pending)
        val retry = transportPayload(pending)

        assertEquals(pending.messageId, first.messageId)
        assertEquals(first.messageId, retry.messageId)
        assertArrayEquals(first.envelope, retry.envelope)
        assertNotEquals(first.transportNonce, retry.transportNonce)
    }

    @Test
    fun `flush resolves the authoritative persisted state instead of delayed visible state`() =
        runTest {
            val delayedVisible = PersistedState(
                actorId = "wearos-test",
                accountEpoch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                initialized = true,
            )
            val pending = PendingEnvelope(
                messageId = "22222222-2222-4222-8222-222222222222",
                path = DataPaths.command("22222222-2222-4222-8222-222222222222"),
                json = """{"kind":"command"}""",
                createdAt = "2026-07-30T19:01:00Z",
            )
            val authoritative = delayedVisible.copy(outbox = listOf(pending))
            var authoritativeReads = 0

            val resolved = resolveFlushState(supplied = null) {
                authoritativeReads += 1
                authoritative
            }

            assertEquals(1, authoritativeReads)
            assertEquals(listOf(pending), resolved.outbox)
        }
}

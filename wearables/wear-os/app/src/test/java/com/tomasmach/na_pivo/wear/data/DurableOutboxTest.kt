package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.sync.DataPaths
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DurableOutboxTest {
    @Test
    fun `two offline commands retain separate DataItems and acknowledging one keeps the other`() {
        val initial = PersistedState(
            actorId = "wearos-test",
            accountEpoch = "83d78467-da0d-4bed-9d75-d99a5e50c63b",
            initialized = true,
        )
        val firstId = "11111111-1111-4111-8111-111111111111"
        val secondId = "22222222-2222-4222-8222-222222222222"
        val first = DurableOutbox.enqueue(
            initial,
            JSONObject().put("type", "clear_target"),
            messageId = firstId,
            createdAt = "2026-07-30T19:00:00Z",
        )
        val second = DurableOutbox.enqueue(
            first,
            JSONObject().put("type", "close_evening")
                .put("eveningId", "33333333-3333-4333-8333-333333333333")
                .put("closedAt", "2026-07-30T19:01:00Z"),
            messageId = secondId,
            createdAt = "2026-07-30T19:01:00Z",
        )

        assertEquals(2, second.outbox.size)
        assertEquals(DataPaths.command(firstId), second.outbox[0].path)
        assertEquals(DataPaths.command(secondId), second.outbox[1].path)
        assertNotEquals(second.outbox[0].path, second.outbox[1].path)

        val (afterAck, removed) = DurableOutbox.acknowledge(second, setOf(firstId))
        assertEquals(setOf(firstId), removed.map { it.messageId }.toSet())
        assertEquals(listOf(secondId), afterAck.outbox.map { it.messageId })
        assertTrue(DataPaths.isCommand(afterAck.outbox.single().path))
    }

    @Test
    fun `acks are also uniquely addressed`() {
        val first = DataPaths.ack("11111111-1111-4111-8111-111111111111")
        val second = DataPaths.ack("22222222-2222-4222-8222-222222222222")
        assertNotEquals(first, second)
        assertTrue(DataPaths.isAck(first))
        assertTrue(DataPaths.isAck(second))
    }

    @Test
    fun `outbox never silently drops older unacknowledged commands`() {
        val initial = PersistedState(
            actorId = "wearos-test",
            accountEpoch = "83d78467-da0d-4bed-9d75-d99a5e50c63b",
            initialized = true,
        )
        val queued = (1..300).fold(initial) { state, index ->
            DurableOutbox.enqueue(
                state,
                JSONObject().put("type", "clear_target"),
                messageId = "00000000-0000-4000-8000-${index.toString().padStart(12, '0')}",
                createdAt = "2026-07-30T19:00:00Z",
            )
        }
        assertEquals(300, queued.outbox.size)
        assertEquals(
            "00000000-0000-4000-8000-000000000001",
            queued.outbox.first().messageId,
        )
    }
}

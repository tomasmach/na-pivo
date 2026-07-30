package com.tomasmach.napivo.wearablebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeContractTest {
  @Test
  fun `status payload exactly matches TypeScript bridge contract`() {
    val payload = buildTransportStatus(
      supported = true,
      paired = true,
      reachable = false,
      pendingCommands = 2,
      lastReceivedAt = null,
      lastSentAt = "2026-07-30T20:00:00Z",
    )

    assertEquals(
      setOf(
        "supported",
        "paired",
        "reachable",
        "pendingCommands",
        "lastReceivedAt",
        "lastSentAt",
      ),
      payload.keys,
    )
    assertEquals(true, payload["supported"])
    assertEquals(true, payload["paired"])
    assertEquals(false, payload["reachable"])
    assertEquals(2, payload["pendingCommands"])
    assertNull(payload["lastReceivedAt"])
    assertEquals("2026-07-30T20:00:00Z", payload["lastSentAt"])
  }

  @Test
  fun `durable DataItem paths are unique per message`() {
    val first = "11111111-1111-4111-8111-111111111111"
    val second = "22222222-2222-4222-8222-222222222222"
    assertNotEquals(DataPaths.command(first), DataPaths.command(second))
    assertNotEquals(DataPaths.ack(first), DataPaths.ack(second))
    assertTrue(DataPaths.isCommand(DataPaths.command(first)))
  }
}

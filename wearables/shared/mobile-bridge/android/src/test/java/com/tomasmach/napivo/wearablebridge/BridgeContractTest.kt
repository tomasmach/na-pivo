package com.tomasmach.napivo.wearablebridge

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
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

  @Test
  fun `pending provisional command can rebind to the latest phone epoch and wake`() {
    val provisionalEpoch = "11111111-1111-4111-8111-111111111111"
    val phoneEpoch = "22222222-2222-4222-8222-222222222222"
    val existing = pendingCommandIdentity(commandEnvelope(provisionalEpoch))
    val rebound = pendingCommandIdentity(commandEnvelope(phoneEpoch))

    assertTrue(
      canReplacePendingProvisionalCommand(
        existing = existing,
        incoming = rebound,
        latestPhoneAccountEpoch = phoneEpoch,
      ),
    )
  }

  @Test
  fun `pending provisional command cannot change payload under the same message id`() {
    val provisionalEpoch = "11111111-1111-4111-8111-111111111111"
    val phoneEpoch = "22222222-2222-4222-8222-222222222222"
    val existing = pendingCommandIdentity(commandEnvelope(provisionalEpoch))
    val changedPayload = pendingCommandIdentity(
      commandEnvelope(phoneEpoch, drinkName = "Jiný drink"),
    )

    assertFalse(
      canReplacePendingProvisionalCommand(
        existing = existing,
        incoming = changedPayload,
        latestPhoneAccountEpoch = phoneEpoch,
      ),
    )
  }

  @Test
  fun `all inbox store instances share one process transaction lock`() {
    val firstEntered = CountDownLatch(1)
    val releaseFirst = CountDownLatch(1)
    val secondStarted = CountDownLatch(1)
    val secondEntered = CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(2)

    try {
      val first = executor.submit {
        WearableInboxProcessLock.transaction {
          firstEntered.countDown()
          assertTrue(releaseFirst.await(2, TimeUnit.SECONDS))
        }
      }
      assertTrue(firstEntered.await(2, TimeUnit.SECONDS))

      val second = executor.submit {
        secondStarted.countDown()
        WearableInboxProcessLock.transaction {
          secondEntered.countDown()
        }
      }
      assertTrue(secondStarted.await(2, TimeUnit.SECONDS))
      assertFalse(secondEntered.await(100, TimeUnit.MILLISECONDS))

      releaseFirst.countDown()
      assertTrue(secondEntered.await(2, TimeUnit.SECONDS))
      first.get(2, TimeUnit.SECONDS)
      second.get(2, TimeUnit.SECONDS)
    } finally {
      releaseFirst.countDown()
      executor.shutdownNow()
    }
  }

  @Test
  fun `snapshot reset never clears the durable command inbox`() {
    assertEquals(
      setOf(
        WearableInboxStore.KEY_LAST_SNAPSHOT,
        WearableInboxStore.KEY_SNAPSHOT_METADATA,
        WearableInboxStore.KEY_BRIDGE_ACTOR_ID,
        WearableInboxStore.KEY_BRIDGE_ACTOR_SEQUENCE,
        WearableInboxStore.KEY_LAST_ACK_SEQUENCE,
        WearableInboxStore.KEY_LAST_SENT_AT,
      ),
      WearableInboxStore.snapshotPrivateKeys(),
    )
    assertFalse(
      WearableInboxStore.snapshotPrivateKeys().contains(WearableInboxStore.KEY_COMMANDS),
    )
    assertFalse(
      WearableInboxStore.snapshotPrivateKeys().contains(WearableInboxStore.KEY_ORDER),
    )
    assertFalse(
      WearableInboxStore.snapshotPrivateKeys().contains(
        WearableInboxStore.KEY_LAST_RECEIVED_AT,
      ),
    )
    assertFalse(
      WearableInboxStore.snapshotPrivateKeys().contains(
        WearableInboxStore.KEY_STATE_DELETE_PENDING,
      ),
    )
    assertFalse(
      WearableInboxStore.snapshotPrivateKeys().contains(
        WearableInboxStore.KEY_ACKNOWLEDGED_ACTOR_LEDGER,
      ),
    )
  }

  @Test
  fun `native acknowledgements use an independent anonymous actor stream`() {
    val snapshotActorId = "phone-11111111-1111-4111-8111-111111111111"
    val bridgeActorId = "phone-bridge-22222222-2222-4222-8222-222222222222"

    val first = nextBridgeActorCursor(
      storedActorId = null,
      storedActorSequence = 42,
      actorIdFactory = { bridgeActorId },
    )
    val second = nextBridgeActorCursor(
      storedActorId = first.actorId,
      storedActorSequence = first.actorSequence,
      actorIdFactory = { error("A valid bridge actor must be reused") },
    )

    assertNotEquals(snapshotActorId, first.actorId)
    assertEquals(bridgeActorId, first.actorId)
    assertEquals(1L, first.actorSequence)
    assertEquals(bridgeActorId, second.actorId)
    assertEquals(2L, second.actorSequence)
  }

  @Test
  fun `cleared or exhausted bridge actor rotates and restarts at one`() {
    val firstActorId = "phone-bridge-11111111-1111-4111-8111-111111111111"
    val replacementActorId = "phone-bridge-22222222-2222-4222-8222-222222222222"

    val afterClear = nextBridgeActorCursor(
      storedActorId = null,
      storedActorSequence = 0,
      actorIdFactory = { replacementActorId },
    )
    val afterExhaustion = nextBridgeActorCursor(
      storedActorId = firstActorId,
      storedActorSequence = Long.MAX_VALUE,
      actorIdFactory = { replacementActorId },
    )

    assertEquals(BridgeActorCursor(replacementActorId, 1), afterClear)
    assertEquals(BridgeActorCursor(replacementActorId, 1), afterExhaustion)
  }

  @Test
  fun `acknowledgement ledger advances through contiguous actor sequences`() {
    val accountEpoch = "11111111-1111-4111-8111-111111111111"
    val ledger = AcknowledgedActorLedger.record(
      rawLedger = null,
      acknowledgedCommands = listOf(
        acknowledgedIdentity(accountEpoch, actorSequence = 2),
        acknowledgedIdentity(accountEpoch, actorSequence = 1),
      ),
    )

    assertEquals(
      mapOf("wearos-provisional" to 2L),
      AcknowledgedActorLedger.acknowledgedActorSequences(ledger, accountEpoch),
    )
  }

  @Test
  fun `acknowledgement ledger retains a gap until the missing sequence arrives`() {
    val accountEpoch = "11111111-1111-4111-8111-111111111111"
    val withGap = AcknowledgedActorLedger.record(
      rawLedger = null,
      acknowledgedCommands = listOf(
        acknowledgedIdentity(accountEpoch, actorSequence = 1),
        acknowledgedIdentity(accountEpoch, actorSequence = 3),
      ),
    )
    assertEquals(
      mapOf("wearos-provisional" to 1L),
      AcknowledgedActorLedger.acknowledgedActorSequences(withGap, accountEpoch),
    )

    val closedGap = AcknowledgedActorLedger.record(
      rawLedger = withGap,
      acknowledgedCommands = listOf(
        acknowledgedIdentity(accountEpoch, actorSequence = 2),
      ),
    )
    assertEquals(
      mapOf("wearos-provisional" to 3L),
      AcknowledgedActorLedger.acknowledgedActorSequences(closedGap, accountEpoch),
    )
  }

  @Test
  fun `snapshot reset key policy preserves acknowledged actor watermarks`() {
    val accountEpoch = "11111111-1111-4111-8111-111111111111"
    val ledger = AcknowledgedActorLedger.record(
      rawLedger = null,
      acknowledgedCommands = listOf(acknowledgedIdentity(accountEpoch, 1)),
    )
    val persistedValues = mutableMapOf(
      WearableInboxStore.KEY_LAST_SNAPSHOT to "private snapshot",
      WearableInboxStore.KEY_ACKNOWLEDGED_ACTOR_LEDGER to ledger,
    )

    WearableInboxStore.snapshotPrivateKeys().forEach(persistedValues::remove)

    assertNull(persistedValues[WearableInboxStore.KEY_LAST_SNAPSHOT])
    assertEquals(
      mapOf("wearos-provisional" to 1L),
      AcknowledgedActorLedger.acknowledgedActorSequences(
        persistedValues[WearableInboxStore.KEY_ACKNOWLEDGED_ACTOR_LEDGER],
        accountEpoch,
      ),
    )
  }

  @Test
  fun `acknowledgement identity is derived only from the owned inbox envelope`() {
    val accountEpoch = "11111111-1111-4111-8111-111111111111"
    val messageId = "33333333-3333-4333-8333-333333333333"
    val envelope = commandEnvelope(accountEpoch)

    assertNotNull(acknowledgedCommandIdentity(envelope, messageId))
    assertNull(
      acknowledgedCommandIdentity(
        envelope,
        "99999999-9999-4999-8999-999999999999",
      ),
    )
    assertNull(
      acknowledgedCommandIdentity(
        JSONObject(envelope).put("actorSequence", 1.5).toString(),
        messageId,
      ),
    )
  }

  @Test
  fun `clear linearly wins after an in flight state publish`() = runBlocking {
    val publishEntered = CompletableDeferred<Unit>()
    val releasePublish = CompletableDeferred<Unit>()
    val clearEntered = CompletableDeferred<Unit>()
    val order = mutableListOf<String>()

    val publish = async(Dispatchers.Default) {
      StatePathProcessCoordinator.transaction {
        order += "publish-start"
        publishEntered.complete(Unit)
        releasePublish.await()
        order += "publish-end"
      }
    }
    withTimeout(2_000) { publishEntered.await() }

    val clear = async(Dispatchers.Default) {
      StatePathProcessCoordinator.transaction {
        order += "clear"
        clearEntered.complete(Unit)
      }
    }
    assertNull(withTimeoutOrNull(100) { clearEntered.await() })

    releasePublish.complete(Unit)
    withTimeout(2_000) {
      publish.await()
      clear.await()
      clearEntered.await()
    }
    assertEquals(listOf("publish-start", "publish-end", "clear"), order)
  }

  private fun commandEnvelope(
    accountEpoch: String,
    drinkName: String = "Pilsner Urquell 12°",
  ): String = JSONObject()
    .put("protocolVersion", 1)
    .put("messageId", "33333333-3333-4333-8333-333333333333")
    .put("accountEpoch", accountEpoch)
    .put("actorId", "wearos-provisional")
    .put("actorKind", "wearos")
    .put("actorSequence", 1)
    .put("baseRevision", 0)
    .put("sentAt", "2026-07-30T20:00:00Z")
    .put("kind", "command")
    .put(
      "payload",
      JSONObject().put(
        "command",
        JSONObject()
          .put("type", "start_evening_and_add_drink")
          .put("eveningId", "44444444-4444-4444-8444-444444444444")
          .put(
            "drink",
            JSONObject()
              .put("id", "55555555-5555-4555-8555-555555555555")
              .put("name", drinkName),
          ),
      ),
    )
    .toString()

  private fun acknowledgedIdentity(
    accountEpoch: String,
    actorSequence: Long,
  ): AcknowledgedCommandIdentity = AcknowledgedCommandIdentity(
    accountEpoch = accountEpoch,
    actorId = "wearos-provisional",
    actorSequence = actorSequence,
  )
}

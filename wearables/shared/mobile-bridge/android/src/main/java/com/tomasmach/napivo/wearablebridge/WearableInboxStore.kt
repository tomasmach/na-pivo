package com.tomasmach.napivo.wearablebridge

import android.content.Context
import java.time.Instant
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal data class BridgeActorCursor(
  val actorId: String,
  val actorSequence: Long,
)

internal fun nextBridgeActorCursor(
  storedActorId: String?,
  storedActorSequence: Long,
  actorIdFactory: () -> String = {
    "phone-bridge-${UUID.randomUUID().toString().lowercase()}"
  },
): BridgeActorCursor {
  val canContinue =
    isAnonymousBridgeActorId(storedActorId) &&
      storedActorSequence in 0 until Long.MAX_VALUE
  val actorId = if (canContinue) {
    checkNotNull(storedActorId)
  } else {
    actorIdFactory().also {
      require(isAnonymousBridgeActorId(it))
    }
  }
  val previousSequence = if (canContinue) storedActorSequence else 0
  return BridgeActorCursor(
    actorId = actorId,
    actorSequence = previousSequence + 1,
  )
}

private fun isAnonymousBridgeActorId(value: String?): Boolean {
  if (value == null || !value.startsWith("phone-bridge-")) return false
  val uuid = value.removePrefix("phone-bridge-")
  return runCatching { UUID.fromString(uuid).toString().lowercase() == uuid }.getOrDefault(false)
}

internal class WearableInboxStore(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences(
    PREFERENCES,
    Context.MODE_PRIVATE,
  )

  fun persistCommandBeforeDispatch(envelopeJson: String): Boolean =
    WearableInboxProcessLock.transaction {
      val envelope = JSONObject(envelopeJson)
      require(envelope.optInt("protocolVersion") == 1)
      require(envelope.optString("kind") == "command")
      val messageId = envelope.requireMessageId()

      val commands = readCommands()
      val order = readOrder()
      val existingJson = commands.optString(messageId).takeIf { it.isNotBlank() }
      if (existingJson != null) {
        val expectedEpoch =
          latestSnapshotAccountEpoch() ?: return@transaction false
        val replacementAllowed = runCatching {
          canReplacePendingProvisionalCommand(
            existing = pendingCommandIdentity(existingJson),
            incoming = pendingCommandIdentity(envelopeJson),
            latestPhoneAccountEpoch = expectedEpoch,
          )
        }.getOrDefault(false)
        if (!replacementAllowed) return@transaction false
        commands.put(messageId, envelopeJson)
      } else {
        commands.put(messageId, envelopeJson)
        order.put(messageId)
      }
      check(
        preferences.edit()
          .putString(KEY_COMMANDS, commands.toString())
          .putString(KEY_ORDER, order.toString())
          .putString(KEY_LAST_RECEIVED_AT, Instant.now().toString())
          .commit(),
      )
      true
    }

  fun pendingCommands(): List<String> = WearableInboxProcessLock.transaction {
    val commands = readCommands()
    val order = readOrder()
    buildList {
      for (index in 0 until order.length()) {
        val messageId = order.optString(index)
        commands.optString(messageId).takeIf { it.isNotBlank() }?.let(::add)
      }
    }
  }

  fun pendingCount(): Int = WearableInboxProcessLock.transaction {
    readCommands().length()
  }

  fun acknowledge(messageIds: Set<String>) = WearableInboxProcessLock.transaction {
    if (messageIds.isEmpty()) return@transaction
    val commands = readCommands()
    val acknowledgedCommands = messageIds.mapNotNull { messageId ->
      commands.optString(messageId)
        .takeIf { it.isNotBlank() }
        ?.let { acknowledgedCommandIdentity(it, messageId) }
    }
    val rawLedger = preferences.getString(KEY_ACKNOWLEDGED_ACTOR_LEDGER, null)
    val nextLedger = if (acknowledgedCommands.isEmpty()) {
      rawLedger
    } else {
      AcknowledgedActorLedger.record(rawLedger, acknowledgedCommands)
    }
    messageIds.forEach(commands::remove)
    val oldOrder = readOrder()
    val newOrder = JSONArray()
    for (index in 0 until oldOrder.length()) {
      oldOrder.optString(index)
        .takeIf { it.isNotBlank() && !messageIds.contains(it) }
        ?.let(newOrder::put)
    }
    val editor = preferences.edit()
      .putString(KEY_COMMANDS, commands.toString())
      .putString(KEY_ORDER, newOrder.toString())
    nextLedger?.let {
      editor.putString(KEY_ACKNOWLEDGED_ACTOR_LEDGER, it)
    }
    check(editor.commit())
  }

  fun acknowledgedActorSequences(accountEpoch: String): Map<String, Long> =
    WearableInboxProcessLock.transaction {
      AcknowledgedActorLedger.acknowledgedActorSequences(
        preferences.getString(KEY_ACKNOWLEDGED_ACTOR_LEDGER, null),
        accountEpoch,
      )
  }

  fun storeSnapshotMetadata(envelopeJson: String) =
    WearableInboxProcessLock.transaction {
      val envelope = JSONObject(envelopeJson)
      require(envelope.optInt("protocolVersion") == 1)
      require(envelope.optString("kind") == "state_snapshot")
      val payload = envelope.getJSONObject("payload")
      val metadata = JSONObject()
        .put("accountEpoch", envelope.getString("accountEpoch"))
        .put("actorId", envelope.getString("actorId"))
        .put("actorSequence", envelope.getLong("actorSequence"))
        .put("revision", payload.getLong("revision"))
      check(
        preferences.edit()
          .putString(KEY_LAST_SNAPSHOT, envelopeJson)
          .putString(KEY_SNAPSHOT_METADATA, metadata.toString())
          .commit(),
      )
    }

  fun clearSnapshot() = WearableInboxProcessLock.transaction {
    val editor = preferences.edit()
    snapshotPrivateKeys().forEach(editor::remove)
    editor.putBoolean(KEY_STATE_DELETE_PENDING, true)
    check(editor.commit())
  }

  fun stateDeletionPending(): Boolean = WearableInboxProcessLock.transaction {
    preferences.getBoolean(KEY_STATE_DELETE_PENDING, false)
  }

  fun markStateDeletionCompleted() = WearableInboxProcessLock.transaction {
    check(preferences.edit().remove(KEY_STATE_DELETE_PENDING).commit())
  }

  fun lastSnapshot(): String? = WearableInboxProcessLock.transaction {
    preferences.getString(KEY_LAST_SNAPSHOT, null)?.takeIf { it.isNotBlank() }
  }

  fun markSent() = WearableInboxProcessLock.transaction {
    check(
      preferences.edit()
        .putString(KEY_LAST_SENT_AT, Instant.now().toString())
        .commit(),
    )
  }

  fun markPeerSeen() = WearableInboxProcessLock.transaction {
    check(preferences.edit().putBoolean(KEY_HAS_SEEN_PEER, true).commit())
  }

  fun hasSeenPeer(): Boolean = WearableInboxProcessLock.transaction {
    preferences.getBoolean(KEY_HAS_SEEN_PEER, false)
  }

  fun lastReceivedAt(): String? = WearableInboxProcessLock.transaction {
    preferences.getString(KEY_LAST_RECEIVED_AT, null)
  }

  fun lastSentAt(): String? = WearableInboxProcessLock.transaction {
    preferences.getString(KEY_LAST_SENT_AT, null)
  }

  fun nextAckMetadata(): AckMetadata = WearableInboxProcessLock.transaction {
    val raw = preferences.getString(KEY_SNAPSHOT_METADATA, null)
      ?: error("Publish a state snapshot before acknowledging watch commands.")
    val metadata = JSONObject(raw)
    val bridgeActor = nextBridgeActorCursor(
      storedActorId = preferences.getString(KEY_BRIDGE_ACTOR_ID, null),
      storedActorSequence = preferences.getLong(KEY_BRIDGE_ACTOR_SEQUENCE, 0),
    )
    check(
      preferences.edit()
        .putString(KEY_BRIDGE_ACTOR_ID, bridgeActor.actorId)
        .putLong(KEY_BRIDGE_ACTOR_SEQUENCE, bridgeActor.actorSequence)
        .remove(KEY_LAST_ACK_SEQUENCE)
        .commit(),
    )
    AckMetadata(
      accountEpoch = metadata.getString("accountEpoch"),
      actorId = bridgeActor.actorId,
      actorSequence = bridgeActor.actorSequence,
      revision = metadata.getLong("revision"),
    )
  }

  private fun readCommands(): JSONObject = runCatching {
    JSONObject(preferences.getString(KEY_COMMANDS, "{}") ?: "{}")
  }.getOrElse { JSONObject() }

  private fun readOrder(): JSONArray = runCatching {
    JSONArray(preferences.getString(KEY_ORDER, "[]") ?: "[]")
  }.getOrElse { JSONArray() }

  private fun latestSnapshotAccountEpoch(): String? = runCatching {
    JSONObject(
      preferences.getString(KEY_SNAPSHOT_METADATA, null)
        ?: return@runCatching null,
    ).optString("accountEpoch").takeIf { it.isNotBlank() }
  }.getOrNull()

  data class AckMetadata(
    val accountEpoch: String,
    val actorId: String,
    val actorSequence: Long,
    val revision: Long,
  )

  companion object {
    private const val PREFERENCES = "na_pivo_wearable_bridge_v1"
    internal const val KEY_COMMANDS = "commands"
    internal const val KEY_ORDER = "order"
    internal const val KEY_LAST_SNAPSHOT = "last_snapshot"
    internal const val KEY_SNAPSHOT_METADATA = "snapshot_metadata"
    internal const val KEY_BRIDGE_ACTOR_ID = "bridge_actor_id"
    internal const val KEY_BRIDGE_ACTOR_SEQUENCE = "bridge_actor_sequence"
    // Removed after upgrading from the original shared snapshot/ACK actor stream.
    internal const val KEY_LAST_ACK_SEQUENCE = "last_ack_sequence"
    internal const val KEY_LAST_RECEIVED_AT = "last_received_at"
    internal const val KEY_LAST_SENT_AT = "last_sent_at"
    internal const val KEY_HAS_SEEN_PEER = "has_seen_peer"
    internal const val KEY_STATE_DELETE_PENDING = "state_delete_pending"
    internal const val KEY_ACKNOWLEDGED_ACTOR_LEDGER = "acknowledged_actor_ledger"

    internal fun snapshotPrivateKeys(): Set<String> = setOf(
      KEY_LAST_SNAPSHOT,
      KEY_SNAPSHOT_METADATA,
      KEY_BRIDGE_ACTOR_ID,
      KEY_BRIDGE_ACTOR_SEQUENCE,
      KEY_LAST_ACK_SEQUENCE,
      KEY_LAST_SENT_AT,
    )
  }
}

internal object WearableInboxProcessLock {
  private val lock = Any()

  fun <T> transaction(block: () -> T): T = synchronized(lock, block)
}

private fun JSONObject.requireMessageId(): String =
  getString("messageId").also { require(it.isNotBlank()) }

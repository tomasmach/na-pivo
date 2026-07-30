package com.tomasmach.napivo.wearablebridge

import android.content.Context
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

internal class WearableInboxStore(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences(
    PREFERENCES,
    Context.MODE_PRIVATE,
  )

  @Synchronized
  fun persistCommandBeforeDispatch(envelopeJson: String): Boolean {
    val envelope = JSONObject(envelopeJson)
    require(envelope.optInt("protocolVersion") == 1)
    require(envelope.optString("kind") == "command")
    val messageId = envelope.requireMessageId()

    val commands = readCommands()
    if (commands.has(messageId)) return false
    commands.put(messageId, envelopeJson)
    val order = readOrder()
    order.put(messageId)
    check(
      preferences.edit()
        .putString(KEY_COMMANDS, commands.toString())
        .putString(KEY_ORDER, order.toString())
        .putString(KEY_LAST_RECEIVED_AT, Instant.now().toString())
        .commit(),
    )
    return true
  }

  @Synchronized
  fun pendingCommands(): List<String> {
    val commands = readCommands()
    val order = readOrder()
    return buildList {
      for (index in 0 until order.length()) {
        val messageId = order.optString(index)
        commands.optString(messageId).takeIf { it.isNotBlank() }?.let(::add)
      }
    }
  }

  @Synchronized
  fun pendingCount(): Int = readCommands().length()

  @Synchronized
  fun acknowledge(messageIds: Set<String>) {
    if (messageIds.isEmpty()) return
    val commands = readCommands()
    messageIds.forEach(commands::remove)
    val oldOrder = readOrder()
    val newOrder = JSONArray()
    for (index in 0 until oldOrder.length()) {
      oldOrder.optString(index)
        .takeIf { it.isNotBlank() && !messageIds.contains(it) }
        ?.let(newOrder::put)
    }
    check(
      preferences.edit()
        .putString(KEY_COMMANDS, commands.toString())
        .putString(KEY_ORDER, newOrder.toString())
        .commit(),
    )
  }

  @Synchronized
  fun storeSnapshotMetadata(envelopeJson: String) {
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

  @Synchronized
  fun lastSnapshot(): String? =
    preferences.getString(KEY_LAST_SNAPSHOT, null)?.takeIf { it.isNotBlank() }

  @Synchronized
  fun markSent() {
    check(
      preferences.edit()
        .putString(KEY_LAST_SENT_AT, Instant.now().toString())
        .commit(),
    )
  }

  @Synchronized
  fun markPeerSeen() {
    check(preferences.edit().putBoolean(KEY_HAS_SEEN_PEER, true).commit())
  }

  @Synchronized
  fun hasSeenPeer(): Boolean = preferences.getBoolean(KEY_HAS_SEEN_PEER, false)

  @Synchronized
  fun lastReceivedAt(): String? = preferences.getString(KEY_LAST_RECEIVED_AT, null)

  @Synchronized
  fun lastSentAt(): String? = preferences.getString(KEY_LAST_SENT_AT, null)

  @Synchronized
  fun nextAckMetadata(): AckMetadata {
    val raw = preferences.getString(KEY_SNAPSHOT_METADATA, null)
      ?: error("Publish a state snapshot before acknowledging watch commands.")
    val metadata = JSONObject(raw)
    val sequence = maxOf(
      metadata.getLong("actorSequence"),
      preferences.getLong(KEY_LAST_ACK_SEQUENCE, 0),
    ) + 1
    check(preferences.edit().putLong(KEY_LAST_ACK_SEQUENCE, sequence).commit())
    return AckMetadata(
      accountEpoch = metadata.getString("accountEpoch"),
      actorId = metadata.getString("actorId"),
      actorSequence = sequence,
      revision = metadata.getLong("revision"),
    )
  }

  private fun readCommands(): JSONObject = runCatching {
    JSONObject(preferences.getString(KEY_COMMANDS, "{}") ?: "{}")
  }.getOrElse { JSONObject() }

  private fun readOrder(): JSONArray = runCatching {
    JSONArray(preferences.getString(KEY_ORDER, "[]") ?: "[]")
  }.getOrElse { JSONArray() }

  data class AckMetadata(
    val accountEpoch: String,
    val actorId: String,
    val actorSequence: Long,
    val revision: Long,
  )

  companion object {
    private const val PREFERENCES = "na_pivo_wearable_bridge_v1"
    private const val KEY_COMMANDS = "commands"
    private const val KEY_ORDER = "order"
    private const val KEY_LAST_SNAPSHOT = "last_snapshot"
    private const val KEY_SNAPSHOT_METADATA = "snapshot_metadata"
    private const val KEY_LAST_ACK_SEQUENCE = "last_ack_sequence"
    private const val KEY_LAST_RECEIVED_AT = "last_received_at"
    private const val KEY_LAST_SENT_AT = "last_sent_at"
    private const val KEY_HAS_SEEN_PEER = "has_seen_peer"
  }
}

private fun JSONObject.requireMessageId(): String =
  getString("messageId").also { require(it.isNotBlank()) }

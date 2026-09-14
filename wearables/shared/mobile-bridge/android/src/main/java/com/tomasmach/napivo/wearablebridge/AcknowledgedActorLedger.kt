package com.tomasmach.napivo.wearablebridge

import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal data class AcknowledgedCommandIdentity(
  val accountEpoch: String,
  val actorId: String,
  val actorSequence: Long,
)

internal object AcknowledgedActorLedger {
  private const val VERSION = 1
  private const val MAX_ACTOR_ENTRIES = 128
  private const val MAX_SPARSE_SEQUENCES = 128
  private const val MAX_SAFE_SEQUENCE = 9_007_199_254_740_991L

  fun record(
    rawLedger: String?,
    acknowledgedCommands: Collection<AcknowledgedCommandIdentity>,
  ): String {
    val entries = decode(rawLedger).toMutableList()
    acknowledgedCommands
      .mapNotNull(::normalizedIdentity)
      .groupBy { it.accountEpoch to it.actorId }
      .forEach { (key, commands) ->
        val existingIndex = entries.indexOfLast {
          it.accountEpoch == key.first && it.actorId == key.second
        }
        val existing = if (existingIndex >= 0) {
          entries.removeAt(existingIndex)
        } else {
          Entry(
            accountEpoch = key.first,
            actorId = key.second,
            acknowledgedThrough = 0,
            sparseSequences = emptySet(),
          )
        }
        val sparse = (
          existing.sparseSequences +
            commands.map(AcknowledgedCommandIdentity::actorSequence)
          )
          .filterTo(sortedSetOf()) {
            it > existing.acknowledgedThrough && it <= MAX_SAFE_SEQUENCE
          }
        var acknowledgedThrough = existing.acknowledgedThrough
        while (
          acknowledgedThrough < MAX_SAFE_SEQUENCE &&
          sparse.remove(acknowledgedThrough + 1)
        ) {
          acknowledgedThrough += 1
        }
        entries += existing.copy(
          acknowledgedThrough = acknowledgedThrough,
          sparseSequences = sparse.take(MAX_SPARSE_SEQUENCES).toSet(),
        )
      }

    return encode(entries.takeLast(MAX_ACTOR_ENTRIES))
  }

  fun acknowledgedActorSequences(
    rawLedger: String?,
    accountEpoch: String,
  ): Map<String, Long> {
    val canonicalEpoch = canonicalUuidString(accountEpoch) ?: return emptyMap()
    return buildMap {
      decode(rawLedger)
        .filter {
          it.accountEpoch == canonicalEpoch && it.acknowledgedThrough > 0
        }
        .forEach { entry ->
          put(
            entry.actorId,
            maxOf(get(entry.actorId) ?: 0, entry.acknowledgedThrough),
          )
        }
    }
  }

  private fun decode(rawLedger: String?): List<Entry> {
    if (rawLedger.isNullOrBlank()) return emptyList()
    return runCatching {
      val root = JSONObject(rawLedger)
      if (root.opt("version") != VERSION) return@runCatching emptyList()
      val encodedEntries = root.optJSONArray("entries") ?: return@runCatching emptyList()
      val firstIndex = maxOf(0, encodedEntries.length() - MAX_ACTOR_ENTRIES)
      buildList<Entry> {
        for (index in firstIndex until encodedEntries.length()) {
          val encoded = encodedEntries.optJSONObject(index) ?: continue
          val accountEpoch = encoded.optString("accountEpoch")
          val actorId = encoded.optString("actorId")
          val acknowledgedThrough = strictLong(encoded.opt("acknowledgedThrough"))
            ?: continue
          if (
            !isValidAccountEpoch(accountEpoch) ||
            !isValidActorId(actorId) ||
            acknowledgedThrough !in 0..MAX_SAFE_SEQUENCE
          ) {
            continue
          }
          val sparse = sortedSetOf<Long>()
          val encodedSparse = encoded.optJSONArray("sparseSequences") ?: JSONArray()
          for (
            sparseIndex in 0 until minOf(
              encodedSparse.length(),
              MAX_SPARSE_SEQUENCES,
            )
          ) {
            val sequence = strictLong(encodedSparse.opt(sparseIndex)) ?: continue
            if (sequence > acknowledgedThrough && sequence <= MAX_SAFE_SEQUENCE) {
              sparse += sequence
            }
          }
          removeAll {
            it.accountEpoch == accountEpoch && it.actorId == actorId
          }
          add(
            Entry(
              accountEpoch = accountEpoch,
              actorId = actorId,
              acknowledgedThrough = acknowledgedThrough,
              sparseSequences = sparse,
            ),
          )
        }
      }
    }.getOrDefault(emptyList())
  }

  private fun encode(entries: List<Entry>): String {
    val encodedEntries = JSONArray()
    entries.forEach { entry ->
      encodedEntries.put(
        JSONObject()
          .put("accountEpoch", entry.accountEpoch)
          .put("actorId", entry.actorId)
          .put("acknowledgedThrough", entry.acknowledgedThrough)
          .put("sparseSequences", JSONArray(entry.sparseSequences.sorted())),
      )
    }
    return JSONObject()
      .put("version", VERSION)
      .put("entries", encodedEntries)
      .toString()
  }

  private fun normalizedIdentity(
    identity: AcknowledgedCommandIdentity,
  ): AcknowledgedCommandIdentity? {
    val canonicalEpoch = canonicalUuidString(identity.accountEpoch) ?: return null
    if (
      !isValidActorId(identity.actorId) ||
      identity.actorSequence !in 1..MAX_SAFE_SEQUENCE
    ) {
      return null
    }
    return identity.copy(accountEpoch = canonicalEpoch)
  }

  private fun isValidAccountEpoch(value: String): Boolean =
    canonicalUuidString(value) == value

  private fun isValidActorId(value: String): Boolean =
    value.length in 1..128 &&
      value.all { character ->
        character in '0'..'9' ||
          character in 'A'..'Z' ||
          character in 'a'..'z' ||
          character == '-' ||
          character == '_' ||
          character == '.' ||
          character == ':'
      }

  private data class Entry(
    val accountEpoch: String,
    val actorId: String,
    val acknowledgedThrough: Long,
    val sparseSequences: Set<Long>,
  )
}

internal fun acknowledgedCommandIdentity(
  envelopeJson: String,
  expectedMessageId: String,
): AcknowledgedCommandIdentity? = runCatching {
  val envelope = JSONObject(envelopeJson)
  val messageId = canonicalUuidString(envelope.optString("messageId"))
    ?: return@runCatching null
  val ownedMessageId = canonicalUuidString(expectedMessageId)
    ?: return@runCatching null
  val rawSequence = envelope.opt("actorSequence")
  val sequence = when (rawSequence) {
    is Int -> rawSequence.toLong()
    is Long -> rawSequence
    else -> return@runCatching null
  }
  if (
    envelope.opt("protocolVersion") != 1 ||
    envelope.optString("kind") != "command" ||
    envelope.optString("actorKind") !in setOf("watchos", "wearos") ||
    messageId != ownedMessageId ||
    sequence <= 0 ||
    envelope.optJSONObject("payload") == null
  ) {
    return@runCatching null
  }
  AcknowledgedCommandIdentity(
    accountEpoch = canonicalUuidString(envelope.optString("accountEpoch"))
      ?: return@runCatching null,
    actorId = envelope.optString("actorId"),
    actorSequence = sequence,
  )
}.getOrNull()

private fun canonicalUuidString(value: String): String? =
  value
    .takeIf { it.length == 36 }
    ?.let { raw ->
      runCatching { UUID.fromString(raw).toString().lowercase() }.getOrNull()
    }

private fun strictLong(value: Any?): Long? = when (value) {
  is Int -> value.toLong()
  is Long -> value
  else -> null
}

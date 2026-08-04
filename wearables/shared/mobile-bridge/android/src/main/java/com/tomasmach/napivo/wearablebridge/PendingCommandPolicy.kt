package com.tomasmach.napivo.wearablebridge

import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

internal data class PendingCommandIdentity(
  val messageId: String,
  val accountEpoch: String,
  val immutableEnvelope: String,
)

internal fun pendingCommandIdentity(envelopeJson: String): PendingCommandIdentity {
  val envelope = JSONObject(envelopeJson)
  require(envelope.optInt("protocolVersion") == 1)
  require(envelope.optString("kind") == "command")
  val messageId = envelope.getString("messageId").trim().lowercase(Locale.ROOT)
  val accountEpoch = envelope.getString("accountEpoch").trim().lowercase(Locale.ROOT)
  require(messageId.isNotEmpty())
  require(accountEpoch.isNotEmpty())
  return PendingCommandIdentity(
    messageId = messageId,
    accountEpoch = accountEpoch,
    immutableEnvelope = canonicalObject(envelope, excludedKeys = setOf("accountEpoch")),
  )
}

internal fun canReplacePendingProvisionalCommand(
  existing: PendingCommandIdentity,
  incoming: PendingCommandIdentity,
  latestPhoneAccountEpoch: String,
): Boolean {
  val expectedEpoch = latestPhoneAccountEpoch.trim().lowercase(Locale.ROOT)
  return expectedEpoch.isNotEmpty() &&
    incoming.messageId == existing.messageId &&
    incoming.accountEpoch == expectedEpoch &&
    existing.accountEpoch != expectedEpoch &&
    incoming.immutableEnvelope == existing.immutableEnvelope
}

private fun canonicalObject(
  value: JSONObject,
  excludedKeys: Set<String> = emptySet(),
): String = value.keys()
  .asSequence()
  .filterNot(excludedKeys::contains)
  .sorted()
  .joinToString(prefix = "{", postfix = "}") { key ->
    "${JSONObject.quote(key)}:${canonicalValue(value.opt(key))}"
  }

private fun canonicalArray(value: JSONArray): String =
  (0 until value.length()).joinToString(prefix = "[", postfix = "]") { index ->
    canonicalValue(value.opt(index))
  }

private fun canonicalValue(value: Any?): String = when (value) {
  null, JSONObject.NULL -> "null"
  is JSONObject -> canonicalObject(value)
  is JSONArray -> canonicalArray(value)
  is String -> JSONObject.quote(value)
  is Number, is Boolean -> value.toString()
  else -> JSONObject.quote(value.toString())
}

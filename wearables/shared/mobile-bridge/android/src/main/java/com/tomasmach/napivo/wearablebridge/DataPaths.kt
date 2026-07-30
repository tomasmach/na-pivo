package com.tomasmach.napivo.wearablebridge

internal object DataPaths {
  const val STATE = "/na-pivo/v1/state"
  private const val COMMAND_PREFIX = "/na-pivo/v1/command"
  private const val ACK_PREFIX = "/na-pivo/v1/ack"

  fun command(messageId: String): String = "$COMMAND_PREFIX/${safe(messageId)}"
  fun ack(messageId: String): String = "$ACK_PREFIX/${safe(messageId)}"
  fun isCommand(path: String): Boolean = path.startsWith("$COMMAND_PREFIX/")

  private fun safe(messageId: String): String {
    require(messageId.isNotBlank())
    require(messageId.none { it == '/' || it == '?' || it == '#' })
    return messageId
  }
}

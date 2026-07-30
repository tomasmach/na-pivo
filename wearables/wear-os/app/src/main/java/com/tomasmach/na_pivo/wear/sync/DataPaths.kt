package com.tomasmach.na_pivo.wear.sync

object DataPaths {
    const val ROOT = "/na-pivo/v1"
    const val STATE = "$ROOT/state"
    const val COMMAND_PREFIX = "$ROOT/command"
    const val ACK_PREFIX = "$ROOT/ack"

    fun command(messageId: String): String = "$COMMAND_PREFIX/${safeMessageId(messageId)}"

    fun ack(messageId: String): String = "$ACK_PREFIX/${safeMessageId(messageId)}"

    fun isState(path: String): Boolean = path == STATE

    fun isAck(path: String): Boolean = path.startsWith("$ACK_PREFIX/")

    fun isCommand(path: String): Boolean = path.startsWith("$COMMAND_PREFIX/")

    private fun safeMessageId(messageId: String): String {
        require(messageId.isNotBlank())
        require(messageId.none { it == '/' || it == '?' || it == '#' })
        return messageId
    }
}

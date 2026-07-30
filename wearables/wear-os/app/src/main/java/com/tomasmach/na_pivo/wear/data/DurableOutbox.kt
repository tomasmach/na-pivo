package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.PendingEnvelope
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.sync.DataPaths
import java.time.Instant
import java.util.UUID
import org.json.JSONObject

object DurableOutbox {
    fun enqueue(
        state: PersistedState,
        command: JSONObject,
        messageId: String = UUID.randomUUID().toString(),
        createdAt: String = Instant.now().toString(),
    ): PersistedState {
        val nextSequence = state.actorSequence + 1
        val pending = PendingEnvelope(
            messageId = messageId,
            path = DataPaths.command(messageId),
            json = JsonCodec.commandEnvelope(
                state = state,
                messageId = messageId,
                sequence = nextSequence,
                sentAt = createdAt,
                command = command,
            ),
            createdAt = createdAt,
        )
        return state.copy(
            actorSequence = nextSequence,
            outbox = state.outbox + pending,
        )
    }

    fun acknowledge(
        state: PersistedState,
        acknowledgedMessageIds: Set<String>,
    ): Pair<PersistedState, Set<PendingEnvelope>> {
        val removed = state.outbox
            .filter { acknowledgedMessageIds.contains(it.messageId) }
            .toSet()
        val remaining = state.outbox.filterNot {
            acknowledgedMessageIds.contains(it.messageId)
        }
        return state.copy(outbox = remaining) to removed
    }
}

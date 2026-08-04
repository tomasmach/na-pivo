package com.tomasmach.na_pivo.wear.data

import android.os.SystemClock
import com.tomasmach.na_pivo.wear.domain.Ack
import com.tomasmach.na_pivo.wear.domain.DrinkChoice
import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.EveningState
import com.tomasmach.na_pivo.wear.domain.EveningStatus
import com.tomasmach.na_pivo.wear.domain.OperationResult
import com.tomasmach.na_pivo.wear.domain.PendingEnvelope
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.RemoteSnapshot
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState
import com.tomasmach.na_pivo.wear.domain.drinkingDayKey
import com.tomasmach.na_pivo.wear.domain.isConcreteDrinkName
import com.tomasmach.na_pivo.wear.domain.validVolume
import com.tomasmach.na_pivo.wear.sync.DataPaths
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import org.json.JSONObject

internal data class RemoteSnapshotResult(
    val state: PersistedState,
    val applied: Boolean,
)

internal fun reduceRemoteSnapshot(
    current: PersistedState,
    snapshot: RemoteSnapshot,
): RemoteSnapshotResult {
    if (current.processedRemoteIds.contains(snapshot.messageId)) {
        return RemoteSnapshotResult(current, false)
    }

    val accountChanged = current.accountEpoch != snapshot.accountEpoch
    val isFirstPairing = accountChanged && current.lastPhoneContactAt == null

    if (accountChanged && current.outbox.isNotEmpty() && !isFirstPairing) {
        return RemoteSnapshotResult(
            current.copy(
                syncConflict = "Na telefonu je jiný účet. Čekající zápisy zůstaly v hodinkách.",
                accountConflictEpoch = snapshot.accountEpoch,
                isStale = true,
                processedRemoteIds = boundedProcessedRemoteIds(
                    current.processedRemoteIds + snapshot.messageId,
                ),
            ),
            false,
        )
    }

    if (!accountChanged && snapshot.revision < current.revision) {
        return RemoteSnapshotResult(
            current.copy(
                processedRemoteIds = boundedProcessedRemoteIds(
                    current.processedRemoteIds + snapshot.messageId,
                ),
            ),
            false,
        )
    }

    val baseline = if (accountChanged) {
        PersistedState(
            actorId =
                if (isFirstPairing) current.actorId
                else "wearos-${UUID.randomUUID().toString().take(8)}",
            accountEpoch = snapshot.accountEpoch,
            actorSequence = if (isFirstPairing) current.actorSequence else 0,
            outbox =
                if (isFirstPairing) rebindOutbox(current.outbox, snapshot.accountEpoch)
                else emptyList(),
            initialized = current.initialized,
        )
    } else {
        current
    }
    val reconciled = WearSyncReducer.reconcileSnapshot(baseline, snapshot)
    return RemoteSnapshotResult(
        reconciled.copy(
            accountEpoch = snapshot.accountEpoch,
            processedRemoteIds = boundedProcessedRemoteIds(
                baseline.processedRemoteIds + snapshot.messageId,
            ),
            accountConflictEpoch = null,
        ),
        true,
    )
}

private fun rebindOutbox(
    outbox: List<PendingEnvelope>,
    accountEpoch: String,
): List<PendingEnvelope> = outbox.map { pending ->
    val envelope = JSONObject(pending.json)
    require(envelope.optInt("protocolVersion") == 1)
    require(envelope.optString("kind") == "command")
    require(envelope.optString("messageId") == pending.messageId)
    pending.copy(
        json = envelope
            .put("accountEpoch", accountEpoch)
            .toString(),
    )
}

private fun boundedProcessedRemoteIds(ids: Set<String>): Set<String> =
    ids.toList().takeLast(500).toSet()

class WearRepository(
    private val store: WearStateStore,
    applicationScope: CoroutineScope,
) {
    val state: StateFlow<PersistedState> = store.states.stateIn(
        scope = applicationScope,
        started = SharingStarted.Eagerly,
        initialValue = PersistedState.fresh(),
    )

    private val rapidWriteGuard = RapidWriteGuard(HARD_REPEAT_GUARD_MS)

    suspend fun initialize(): PersistedState = store.initialize()

    suspend fun authoritativeState(): PersistedState = store.read()

    suspend fun selectTarget(pub: PubRef, selection: TargetSelection = TargetSelection.MANUAL) {
        store.update { current ->
            if (current.accountConflictEpoch != null) return@update current to Unit
            val target = TargetState(selection, pub)
            val command = JSONObject()
                .put("type", "set_target")
                .put("target", JsonCodec.targetToJson(target))
            val next = current.copy(target = target, syncConflict = null).appendCommand(command)
            next to Unit
        }
    }

    suspend fun clearTarget() {
        store.update { current ->
            if (current.accountConflictEpoch != null) return@update current to Unit
            val next = current.copy(target = null).appendCommand(
                JSONObject().put("type", "clear_target"),
            )
            next to Unit
        }
    }

    suspend fun cacheNearby(pubs: List<PubRef>, fetchedAt: Instant = Instant.now()) {
        store.update { current ->
            reduceNearbyCache(current, pubs, fetchedAt.toString()) to Unit
        }
    }

    suspend fun markNearbyStale() {
        store.update { current -> reduceNearbyOffline(current) to Unit }
    }

    suspend fun addDrink(pub: PubRef, drink: DrinkSpec): OperationResult {
        if (!isConcreteDrinkName(drink.name)) {
            return OperationResult(false, message = "Vyber konkrétní drink.")
        }
        if (!validVolume(drink.drinkType, drink.volumeMl) || drink.priceCzk !in 1..1000) {
            return OperationResult(false, message = "Objem nebo cena nesedí.")
        }

        val elapsed = SystemClock.elapsedRealtime()
        if (!rapidWriteGuard.tryAcquire(elapsed)) {
            return OperationResult(false, message = "Klid, jeden stačí.")
        }

        val result = store.update { current ->
            if (current.accountConflictEpoch != null) {
                current to OperationResult(
                    false,
                    message = "Nejdřív srovnej účet s telefonem.",
                )
            } else if (current.activeEvening?.drinks?.any { it.id == drink.id } == true ||
                current.otherEvenings.any { evening -> evening.drinks.any { it.id == drink.id } }
            ) {
                current to OperationResult(false, message = "Tenhle už tam je.")
            } else {
                val active = current.activeEvening
                val samePub = active?.pub?.pubKey == pub.pubKey
                val now = Instant.now().toString()
                val dayKey = drinkingDayKey()
                var working = current
                val nextEvening: EveningState

                if (active != null && samePub && active.status == EveningStatus.ACTIVE) {
                    nextEvening = active.copy(drinks = active.drinks + drink)
                    val command = JSONObject()
                        .put("type", "add_drink")
                        .put("eveningId", active.eveningId)
                        .put("drink", JsonCodec.drinkToJson(drink))
                    working = working.copy(activeEvening = nextEvening).appendCommand(command)
                } else {
                    if (active != null) {
                        val closed = active.copy(closedAt = now, status = EveningStatus.CLOSED)
                        working = working.copy(
                            activeEvening = null,
                            otherEvenings = (listOf(closed) + working.otherEvenings)
                                .distinctBy { it.eveningId }
                                .take(10),
                        ).appendCommand(
                            JSONObject()
                                .put("type", "close_evening")
                                .put("eveningId", active.eveningId)
                                .put("closedAt", now),
                        )
                    }
                    nextEvening = EveningState(
                        eveningId = UUID.randomUUID().toString(),
                        pub = pub,
                        drinkingDayKey = dayKey,
                        startedAt = drink.recordedAt,
                        drinks = listOf(drink),
                    )
                    val command = JSONObject()
                        .put("type", "start_evening_and_add_drink")
                        .put("eveningId", nextEvening.eveningId)
                        .put("pub", JsonCodec.pubToJson(pub))
                        .put("drinkingDayKey", dayKey)
                        .put("drink", JsonCodec.drinkToJson(drink))
                    working = working.copy(activeEvening = nextEvening).appendCommand(command)
                }

                val recent = (listOf(DrinkChoice.fromDrink(drink)) + working.recentDrinks)
                    .distinctBy { it.choiceId }
                    .take(20)
                working.copy(
                    activeEvening = nextEvening,
                    target = TargetState(TargetSelection.MANUAL, pub),
                    recentDrinks = recent,
                    syncConflict = null,
                ) to OperationResult(true, drink)
            }
        }
        if (!result.applied) rapidWriteGuard.release(elapsed)
        return result
    }

    suspend fun repeatLast(): OperationResult {
        val current = authoritativeState()
        val evening = current.activeEvening
            ?: return OperationResult(false, message = "Nejdřív si něco dej.")
        val last = evening.lastDrink
            ?: return OperationResult(false, message = "Není co zopakovat.")
        return addDrink(
            pub = evening.pub,
            drink = DrinkSpec.create(
                name = last.name,
                drinkType = last.drinkType,
                volumeMl = last.volumeMl,
                priceCzk = last.priceCzk,
                servingType = last.servingType,
            ),
        )
    }

    suspend fun removeDrink(drinkId: String, reason: String = "correction"): OperationResult =
        store.update { current ->
            if (current.accountConflictEpoch != null) {
                return@update current to OperationResult(
                    false,
                    message = "Nejdřív srovnej účet s telefonem.",
                )
            }
            val active = current.activeEvening
            val target = active?.drinks?.firstOrNull { it.id == drinkId }
            if (active == null || target == null || active.removedDrinkIds.contains(drinkId)) {
                current to OperationResult(false, message = "Ten už je pryč.")
            } else {
                val removedIds = active.removedDrinkIds + drinkId
                val remaining = active.drinks.filterNot { removedIds.contains(it.id) }
                var working = current.copy(
                    activeEvening = active.copy(removedDrinkIds = removedIds),
                ).appendCommand(
                    JSONObject()
                        .put("type", "remove_drink")
                        .put("eveningId", active.eveningId)
                        .put("drinkId", drinkId)
                        .put("reason", if (reason == "undo") "undo" else "correction"),
                )

                if (remaining.isEmpty()) {
                    val closedAt = Instant.now().toString()
                    working = working.copy(activeEvening = null).appendCommand(
                        JSONObject()
                            .put("type", "close_evening")
                            .put("eveningId", active.eveningId)
                            .put("closedAt", closedAt),
                    )
                }
                working to OperationResult(true, target)
            }
        }

    suspend fun closeEvening(): Boolean = store.update { current ->
        if (current.accountConflictEpoch != null) return@update current to false
        val active = current.activeEvening
        if (active == null) {
            current to false
        } else {
            val closedAt = Instant.now().toString()
            val next = WearSyncReducer.closeEvening(current, closedAt)!!.appendCommand(
                JSONObject()
                    .put("type", "close_evening")
                    .put("eveningId", active.eveningId)
                    .put("closedAt", closedAt),
            )
            next to true
        }
    }

    suspend fun resolveEveningConflict(): Boolean {
        val activeEveningId = authoritativeState().activeEvening?.eveningId
            ?: return false
        return resolveEveningConflict(activeEveningId)
    }

    suspend fun resolveEveningConflict(activeEveningId: String): Boolean = store.update { current ->
        if (current.accountConflictEpoch != null) return@update current to false
        val resolvedAt = Instant.now().toString()
        val resolved = WearSyncReducer.resolveEveningConflict(
            current = current,
            activeEveningId = activeEveningId,
            resolvedAt = resolvedAt,
        )
        if (resolved == null) {
            current to false
        } else {
            resolved.appendCommand(
                JSONObject()
                    .put("type", "resolve_evening_conflict")
                    .put("activeEveningId", activeEveningId),
            ) to true
        }
    }

    suspend fun applyRemoteSnapshot(snapshot: RemoteSnapshot): Boolean = store.update { current ->
        reduceRemoteSnapshot(current, snapshot).let { it.state to it.applied }
    }

    suspend fun applyAck(ack: Ack): Set<PendingEnvelope> = store.update { current ->
        if (ack.accountEpoch != current.accountEpoch) {
            current to emptySet()
        } else {
            val (acknowledged, removed) = DurableOutbox.acknowledge(
                current,
                ack.acknowledgedMessageIds,
            )
            val next = acknowledged.copy(
                revision = maxOf(current.revision, ack.revision),
                lastPhoneContactAt = Instant.now().toString(),
                processedRemoteIds = boundedProcessedRemoteIds(
                    current.processedRemoteIds + ack.messageId,
                ),
                syncConflict =
                    if (acknowledged.conflictingEveningIds.isEmpty()) null
                    else acknowledged.syncConflict,
                accountConflictEpoch =
                    if (acknowledged.outbox.isEmpty()) null
                    else acknowledged.accountConflictEpoch,
            )
            next to removed
        }
    }

    suspend fun replaceForDebug(state: PersistedState) {
        store.update { state.copy(initialized = true) to Unit }
    }

    private fun PersistedState.appendCommand(command: JSONObject): PersistedState {
        return DurableOutbox.enqueue(this, command)
    }

    companion object {
        const val COMMAND_PATH = DataPaths.COMMAND_PREFIX
        const val SNAPSHOT_PATH = DataPaths.STATE
        const val ACK_PATH = DataPaths.ACK_PREFIX
        private const val HARD_REPEAT_GUARD_MS = 1_200L
    }
}

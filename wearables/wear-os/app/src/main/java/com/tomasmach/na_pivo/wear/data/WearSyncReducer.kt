package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.DrinkChoice
import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.EveningState
import com.tomasmach.na_pivo.wear.domain.EveningStatus
import com.tomasmach.na_pivo.wear.domain.PendingEnvelope
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.RemoteSnapshot
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState
import java.time.Instant
import org.json.JSONObject

/**
 * Rebuilds the visible watch state from a phone snapshot and then reapplies every
 * unacknowledged local command. The outbox is the durable source of truth for
 * optimistic watch mutations until the phone acknowledges each message.
 */
object WearSyncReducer {
    fun reconcileSnapshot(
        current: PersistedState,
        snapshot: RemoteSnapshot,
    ): PersistedState {
        val pending = parsePending(current.outbox, current.accountEpoch)
        val currentEvenings = (
            listOfNotNull(current.activeEvening) + current.otherEvenings
        ).associateBy { it.eveningId }
        val remoteOther = snapshot.otherEvenings.associateBy { it.eveningId }
        val working = WorkingState(
            target = snapshot.target ?: current.target.takeIf { pending.isNotEmpty() },
            active = snapshot.activeEvening,
            other = linkedMapOf(),
        )

        snapshot.otherEvenings.forEach { evening ->
            working.other[evening.eveningId] = evening
        }
        current.otherEvenings.forEach { evening ->
            working.other[evening.eveningId] =
                working.other[evening.eveningId]
                    ?.let { remote -> mergeEvening(remote, evening, remote.status) }
                    ?: evening
        }

        val remoteActive = working.active
        if (remoteActive != null) {
            val locallyClosed = current.otherEvenings.firstOrNull {
                it.eveningId == remoteActive.eveningId && it.status == EveningStatus.CLOSED
            }
            if (locallyClosed != null) {
                working.other[remoteActive.eveningId] =
                    mergeEvening(remoteActive, locallyClosed, EveningStatus.CLOSED)
                working.active = null
            }
        }

        val localActive = current.activeEvening
        when {
            localActive == null -> Unit
            working.active == null -> {
                if (pending.referencesEvening(localActive.eveningId) ||
                    current.conflictingEveningIds.contains(localActive.eveningId)
                ) {
                    working.active = localActive
                    working.other.remove(localActive.eveningId)
                }
            }
            working.active?.eveningId == localActive.eveningId -> {
                working.active = mergeEvening(
                    working.active!!,
                    localActive,
                    working.active!!.status,
                )
                working.other.remove(localActive.eveningId)
            }
            equivalentEvening(working.active!!, localActive) -> {
                val canonical = working.active!!
                working.aliases[localActive.eveningId] = canonical.eveningId
                working.active = mergeEvening(canonical, localActive, canonical.status)
                working.other.remove(localActive.eveningId)
            }
            remoteOther[localActive.eveningId]?.status == EveningStatus.CLOSED &&
                !pending.referencesEvening(localActive.eveningId) -> Unit
            else -> {
                val phoneActive = working.active!!
                working.active = localActive.copy(status = EveningStatus.CONFLICT)
                working.other[phoneActive.eveningId] =
                    phoneActive.copy(status = EveningStatus.CONFLICT)
                working.other.remove(localActive.eveningId)
                working.setConflict(localActive.eveningId, phoneActive.eveningId)
            }
        }

        if (working.conflictingEveningIds.isEmpty()) {
            val unresolvedCurrentBranches = current.conflictingEveningIds
                .distinct()
                .filter { id ->
                    val snapshotBranch =
                        snapshot.activeEvening?.takeIf { it.eveningId == id }
                            ?: snapshot.otherEvenings.firstOrNull { it.eveningId == id }
                    snapshotBranch?.status != EveningStatus.CLOSED &&
                        working.find(id)?.status != EveningStatus.CLOSED
                }
            if (unresolvedCurrentBranches.size >= 2) {
                working.conflictingEveningIds = unresolvedCurrentBranches
            }
        }

        pending.forEach { command ->
            working.apply(command, currentEvenings)
        }

        val validConflictIds = working.conflictingEveningIds
            .distinct()
            .filter { id ->
                val evening = working.find(id)
                evening != null && evening.status != EveningStatus.CLOSED
            }
        working.conflictingEveningIds =
            if (validConflictIds.size >= 2) validConflictIds else emptyList()

        if (working.conflictingEveningIds.isNotEmpty()) {
            working.conflictingEveningIds.forEach { id ->
                working.updateEvening(id) { it.copy(status = EveningStatus.CONFLICT) }
            }
        }

        val prioritizedOtherIds = (
            working.conflictingEveningIds + working.other.keys
        ).distinct()
        val otherEvenings = prioritizedOtherIds
            .asSequence()
            .filterNot { it == working.active?.eveningId }
            .mapNotNull(working.other::get)
            .take(10)
            .toList()

        val hasPendingTarget = pending.any { it.type == "set_target" || it.type == "clear_target" }
        val targetConflict =
            hasPendingTarget &&
                current.target?.selection == TargetSelection.MANUAL &&
                snapshot.target?.selection == TargetSelection.MANUAL &&
                current.target.pub.pubKey != snapshot.target.pub.pubKey
        val conflictCopy = when {
            working.conflictingEveningIds.isNotEmpty() ->
                "Na telefonu běží jiný večer. Vyber, který platí."
            targetConflict ->
                "Cíl se změnil na obou zařízeních. Vyber ho znovu."
            else -> null
        }

        return current.copy(
            revision = maxOf(current.revision, snapshot.revision),
            target = working.target,
            activeEvening = working.active,
            otherEvenings = otherEvenings,
            nearbyPubs =
                if (snapshot.nearbyPubs.isNotEmpty()) snapshot.nearbyPubs.take(10)
                else current.nearbyPubs,
            recentDrinks = mergeDrinkDefinitions(current.recentDrinks, snapshot.recentDrinks),
            frequentDrinks = mergeDrinkDefinitions(
                current.frequentDrinks,
                snapshot.frequentDrinks,
            ),
            menuDrinks = mergeDrinkDefinitions(current.menuDrinks, snapshot.menuDrinks, 40),
            conflictingEveningIds = working.conflictingEveningIds,
            isStale = snapshot.isStale,
            lastPhoneContactAt = snapshot.lastPhoneContactAt ?: Instant.now().toString(),
            syncConflict = conflictCopy,
        )
    }

    fun closeEvening(
        current: PersistedState,
        closedAt: String,
    ): PersistedState? {
        val active = current.activeEvening ?: return null
        val closed = active.copy(closedAt = closedAt, status = EveningStatus.CLOSED)
        val remainingConflictIds = current.conflictingEveningIds
            .filterNot { it == active.eveningId }
        val alternative = remainingConflictIds
            .asSequence()
            .mapNotNull(current::eveningById)
            .firstOrNull { it.status != EveningStatus.CLOSED }
        val nextActive = alternative?.copy(status = EveningStatus.ACTIVE)
        val histories = (
            listOf(closed) +
                current.otherEvenings.filterNot {
                    it.eveningId == active.eveningId ||
                        it.eveningId == alternative?.eveningId
                }
        ).distinctBy { it.eveningId }.take(10)

        return current.copy(
            activeEvening = nextActive,
            // Finishing an evening must not discard the compass target.
            target = current.target,
            otherEvenings = histories,
            conflictingEveningIds = emptyList(),
            syncConflict = null,
        )
    }

    fun resolveEveningConflict(
        current: PersistedState,
        activeEveningId: String,
        resolvedAt: String,
    ): PersistedState? {
        val selected = current.eveningById(activeEveningId)
            ?.takeIf { it.status != EveningStatus.CLOSED }
            ?: return null
        val branchIds = (
            current.conflictingEveningIds +
                listOfNotNull(current.activeEvening?.eveningId)
        ).distinct()
        if (branchIds.size < 2 && selected.status != EveningStatus.CONFLICT) return null

        val displaced = branchIds
            .filterNot { it == selected.eveningId }
            .mapNotNull(current::eveningById)
            .map { branch ->
                branch.copy(
                    status = EveningStatus.CLOSED,
                    closedAt = branch.closedAt ?: resolvedAt,
                )
            }
        val untouched = current.otherEvenings.filterNot { candidate ->
            candidate.eveningId == selected.eveningId ||
                displaced.any { it.eveningId == candidate.eveningId }
        }
        return current.copy(
            activeEvening = selected.copy(status = EveningStatus.ACTIVE, closedAt = null),
            otherEvenings = (displaced + untouched)
                .distinctBy { it.eveningId }
                .take(10),
            conflictingEveningIds = emptyList(),
            syncConflict = null,
        )
    }

    private data class ParsedCommand(
        val type: String,
        val json: JSONObject,
        val sequence: Long,
        val sourceIndex: Int,
        val createdAt: String,
    )

    private class WorkingState(
        var target: TargetState?,
        var active: EveningState?,
        val other: LinkedHashMap<String, EveningState>,
        val aliases: MutableMap<String, String> = mutableMapOf(),
        var conflictingEveningIds: List<String> = emptyList(),
    ) {
        fun find(eveningId: String): EveningState? {
            val resolvedId = resolveId(eveningId)
            return active?.takeIf { it.eveningId == resolvedId } ?: other[resolvedId]
        }

        fun updateEvening(
            eveningId: String,
            transform: (EveningState) -> EveningState,
        ): Boolean {
            val resolvedId = resolveId(eveningId)
            val currentActive = active
            if (currentActive?.eveningId == resolvedId) {
                active = transform(currentActive)
                return true
            }
            val currentOther = other[resolvedId] ?: return false
            other[resolvedId] = transform(currentOther)
            return true
        }

        fun resolveId(eveningId: String): String {
            var resolved = eveningId
            val visited = mutableSetOf<String>()
            while (aliases[resolved] != null && visited.add(resolved)) {
                resolved = aliases.getValue(resolved)
            }
            return resolved
        }

        fun setConflict(firstId: String, secondId: String) {
            conflictingEveningIds = (
                conflictingEveningIds + firstId + secondId
            ).distinct()
        }

        fun apply(
            command: ParsedCommand,
            currentEvenings: Map<String, EveningState>,
        ) {
            when (command.type) {
                "set_target" -> {
                    val targetJson = command.json.optJSONObject("target") ?: return
                    target = runCatching { JsonCodec.targetFromJson(targetJson) }.getOrNull()
                        ?: return
                }
                "clear_target" -> target = null
                "start_evening_and_add_drink" -> applyStart(command)
                "add_drink" -> applyAdd(command, currentEvenings)
                "remove_drink" -> applyRemove(command, currentEvenings)
                "close_evening" -> applyClose(command, currentEvenings)
                "resolve_evening_conflict" -> {
                    val selectedId = command.json.optString("activeEveningId")
                        .takeIf { it.isNotBlank() }
                        ?: return
                    selectConflictBranch(selectedId, command.createdAt)
                }
            }
        }

        private fun applyStart(command: ParsedCommand) {
            val eveningId = command.json.optString("eveningId").takeIf { it.isNotBlank() }
                ?: return
            val pub = command.json.optJSONObject("pub")
                ?.let { runCatching { JsonCodec.pubFromJson(it) }.getOrNull() }
                ?: return
            val dayKey = command.json.optString("drinkingDayKey").takeIf { it.isNotBlank() }
                ?: return
            val drink = command.json.optJSONObject("drink")
                ?.let { runCatching { JsonCodec.drinkFromJson(it) }.getOrNull() }
                ?: return
            val currentActive = active
            when {
                currentActive == null -> {
                    val existing = other.remove(eveningId)
                    active = (existing ?: EveningState(
                        eveningId = eveningId,
                        pub = pub,
                        drinkingDayKey = dayKey,
                        startedAt = drink.recordedAt,
                    )).withDrink(drink).copy(status = EveningStatus.ACTIVE, closedAt = null)
                }
                currentActive.eveningId == eveningId -> {
                    active = currentActive.withDrink(drink)
                }
                currentActive.pub.pubKey == pub.pubKey &&
                    currentActive.drinkingDayKey == dayKey -> {
                    aliases[eveningId] = currentActive.eveningId
                    active = currentActive.withDrink(drink)
                }
                else -> {
                    val branch = (
                        other[eveningId] ?: EveningState(
                            eveningId = eveningId,
                            pub = pub,
                            drinkingDayKey = dayKey,
                            startedAt = drink.recordedAt,
                        )
                    ).withDrink(drink).copy(status = EveningStatus.CONFLICT)
                    active = currentActive.copy(status = EveningStatus.CONFLICT)
                    other[eveningId] = branch
                    setConflict(currentActive.eveningId, eveningId)
                }
            }
            target = TargetState(TargetSelection.MANUAL, pub)
        }

        private fun applyAdd(
            command: ParsedCommand,
            currentEvenings: Map<String, EveningState>,
        ) {
            val eveningId = command.json.optString("eveningId").takeIf { it.isNotBlank() }
                ?: return
            val drink = command.json.optJSONObject("drink")
                ?.let { runCatching { JsonCodec.drinkFromJson(it) }.getOrNull() }
                ?: return
            ensureEvening(eveningId, currentEvenings)
            updateEvening(eveningId) { it.withDrink(drink) }
            find(eveningId)?.let { evening ->
                target = TargetState(TargetSelection.MANUAL, evening.pub)
            }
        }

        private fun applyRemove(
            command: ParsedCommand,
            currentEvenings: Map<String, EveningState>,
        ) {
            val eveningId = command.json.optString("eveningId").takeIf { it.isNotBlank() }
                ?: return
            val drinkId = command.json.optString("drinkId").takeIf { it.isNotBlank() }
                ?: return
            ensureEvening(eveningId, currentEvenings)
            updateEvening(eveningId) { evening ->
                evening.copy(removedDrinkIds = evening.removedDrinkIds + drinkId)
            }
        }

        private fun applyClose(
            command: ParsedCommand,
            currentEvenings: Map<String, EveningState>,
        ) {
            val eveningId = command.json.optString("eveningId").takeIf { it.isNotBlank() }
                ?: return
            val closedAt = command.json.optString("closedAt").takeIf { it.isNotBlank() }
                ?: command.createdAt
            ensureEvening(eveningId, currentEvenings)
            val resolvedId = resolveId(eveningId)
            val closing = find(resolvedId) ?: return
            val closed = closing.copy(status = EveningStatus.CLOSED, closedAt = closedAt)
            if (active?.eveningId == resolvedId) {
                active = null
            }
            other[resolvedId] = closed
            val alternatives = conflictingEveningIds
                .filterNot { it == resolvedId }
                .map(::resolveId)
                .distinct()
            val nextActive = alternatives
                .asSequence()
                .mapNotNull { id -> other[id] }
                .firstOrNull { it.status != EveningStatus.CLOSED }
            if (active == null && nextActive != null) {
                other.remove(nextActive.eveningId)
                active = nextActive.copy(status = EveningStatus.ACTIVE, closedAt = null)
            }
            conflictingEveningIds = emptyList()
        }

        private fun ensureEvening(
            eveningId: String,
            currentEvenings: Map<String, EveningState>,
        ) {
            if (find(eveningId) != null) return
            val source = currentEvenings[eveningId] ?: return
            if (active == null && source.status != EveningStatus.CLOSED) {
                active = source
            } else {
                other[eveningId] = source
            }
        }

        private fun selectConflictBranch(
            selectedId: String,
            resolvedAt: String,
        ) {
            val selected = find(selectedId)
                ?.takeIf { it.status != EveningStatus.CLOSED }
                ?: return
            val branchIds = (
                conflictingEveningIds + listOfNotNull(active?.eveningId)
            ).distinct()
            branchIds
                .filterNot { it == selected.eveningId }
                .forEach { branchId ->
                    val branch = find(branchId) ?: return@forEach
                    if (active?.eveningId == branch.eveningId) active = null
                    other[branch.eveningId] = branch.copy(
                        status = EveningStatus.CLOSED,
                        closedAt = branch.closedAt ?: resolvedAt,
                    )
                }
            other.remove(selected.eveningId)
            active = selected.copy(status = EveningStatus.ACTIVE, closedAt = null)
            conflictingEveningIds = emptyList()
        }
    }

    private fun parsePending(
        outbox: List<PendingEnvelope>,
        accountEpoch: String,
    ): List<ParsedCommand> = outbox.mapIndexedNotNull { index, pending ->
        runCatching {
            val root = JSONObject(pending.json)
            if (root.optString("kind") != "command" ||
                root.optString("accountEpoch") != accountEpoch
            ) {
                return@runCatching null
            }
            val command = root.optJSONObject("payload")
                ?.optJSONObject("command")
                ?: return@runCatching null
            val type = command.optString("type").takeIf { it.isNotBlank() }
                ?: return@runCatching null
            ParsedCommand(
                type = type,
                json = command,
                sequence = root.optLong("actorSequence", Long.MAX_VALUE),
                sourceIndex = index,
                createdAt = pending.createdAt,
            )
        }.getOrNull()
    }.sortedWith(compareBy<ParsedCommand> { it.sequence }.thenBy { it.sourceIndex })

    private fun List<ParsedCommand>.referencesEvening(eveningId: String): Boolean = any {
        when (it.type) {
            "start_evening_and_add_drink",
            "add_drink",
            "remove_drink",
            "close_evening",
            -> it.json.optString("eveningId") == eveningId
            "resolve_evening_conflict" ->
                it.json.optString("activeEveningId") == eveningId
            else -> false
        }
    }

    private fun mergeEvening(
        primary: EveningState,
        secondary: EveningState,
        status: EveningStatus,
    ): EveningState = primary.copy(
        drinks = (primary.drinks + secondary.drinks).distinctBy { it.id },
        removedDrinkIds = primary.removedDrinkIds + secondary.removedDrinkIds,
        closedAt =
            if (status == EveningStatus.CLOSED) primary.closedAt ?: secondary.closedAt
            else primary.closedAt,
        status = status,
    )

    private fun EveningState.withDrink(drink: DrinkSpec): EveningState =
        if (drinks.any { it.id == drink.id }) this
        else copy(drinks = drinks + drink)

    private fun equivalentEvening(first: EveningState, second: EveningState): Boolean =
        first.pub.pubKey == second.pub.pubKey &&
            first.drinkingDayKey == second.drinkingDayKey

    private fun mergeDrinkDefinitions(
        local: List<DrinkChoice>,
        remote: List<DrinkChoice>,
        limit: Int = 20,
    ): List<DrinkChoice> = (remote + local)
        .distinctBy { it.choiceId }
        .take(limit)
}

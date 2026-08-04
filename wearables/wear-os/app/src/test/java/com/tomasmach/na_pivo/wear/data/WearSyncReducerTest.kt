package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.DrinkChoice
import com.tomasmach.na_pivo.wear.domain.DrinkType
import com.tomasmach.na_pivo.wear.domain.EveningState
import com.tomasmach.na_pivo.wear.domain.EveningStatus
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.RemoteSnapshot
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WearSyncReducerTest {
    @Test
    fun `closing an evening keeps the selected compass target`() {
        val target = TargetState(TargetSelection.MANUAL, pubA)
        val current = state(
            target = target,
            activeEvening = eveningA,
        )

        val closed = requireNotNull(
            WearSyncReducer.closeEvening(current, "2026-07-30T21:00:00Z"),
        )

        assertEquals(target, closed.target)
        assertNull(closed.activeEvening)
        assertEquals(EveningStatus.CLOSED, closed.otherEvenings.single().status)
    }

    @Test
    fun `pending close is replayed over a stale active snapshot without clearing target`() {
        val target = TargetState(TargetSelection.MANUAL, pubA)
        val pendingClose = enqueue(
            state(target = target),
            JSONObject()
                .put("type", "close_evening")
                .put("eveningId", eveningA.eveningId)
                .put("closedAt", "2026-07-30T21:00:00Z"),
            messageId = "11111111-1111-4111-8111-111111111111",
        )

        val reconciled = WearSyncReducer.reconcileSnapshot(
            pendingClose,
            snapshot(activeEvening = eveningA),
        )

        assertNull(reconciled.activeEvening)
        assertEquals(target, reconciled.target)
        assertEquals(EveningStatus.CLOSED, reconciled.otherEvenings.single().status)
        assertEquals(
            "2026-07-30T21:00:00Z",
            reconciled.otherEvenings.single().closedAt,
        )
    }

    @Test
    fun `pending remove is replayed over a stale snapshot containing the drink`() {
        val pendingRemove = enqueue(
            state(activeEvening = eveningA),
            JSONObject()
                .put("type", "remove_drink")
                .put("eveningId", eveningA.eveningId)
                .put("drinkId", drinkA.id)
                .put("reason", "undo"),
            messageId = "22222222-2222-4222-8222-222222222222",
        )

        val reconciled = WearSyncReducer.reconcileSnapshot(
            pendingRemove,
            snapshot(activeEvening = eveningA),
        )

        val active = requireNotNull(reconciled.activeEvening)
        assertTrue(active.removedDrinkIds.contains(drinkA.id))
        assertTrue(active.visibleDrinks.isEmpty())
    }

    @Test
    fun `pending target commands are replayed by actor sequence over stale target`() {
        val targetA = TargetState(TargetSelection.MANUAL, pubA)
        val targetB = TargetState(TargetSelection.MANUAL, pubB)
        val targetC = TargetState(TargetSelection.MANUAL, pubC)
        val first = enqueue(
            state(target = targetA),
            JSONObject()
                .put("type", "set_target")
                .put("target", JsonCodec.targetToJson(targetB)),
            messageId = "33333333-3333-4333-8333-333333333333",
        )
        val second = enqueue(
            first.copy(target = targetB),
            JSONObject()
                .put("type", "set_target")
                .put("target", JsonCodec.targetToJson(targetC)),
            messageId = "44444444-4444-4444-8444-444444444444",
        )
        val reversedOutbox = second.copy(
            target = targetC,
            outbox = second.outbox.reversed(),
        )

        val reconciled = WearSyncReducer.reconcileSnapshot(
            reversedOutbox,
            snapshot(target = targetA),
        )

        assertEquals(pubC.pubKey, reconciled.target?.pub?.pubKey)
    }

    @Test
    fun `different active evenings persist both branches and either branch can win`() {
        val local = eveningA
        val remote = eveningB
        val conflicted = WearSyncReducer.reconcileSnapshot(
            state(activeEvening = local),
            snapshot(activeEvening = remote),
        )

        assertEquals(local.eveningId, conflicted.activeEvening?.eveningId)
        assertEquals(
            listOf(local.eveningId, remote.eveningId),
            conflicted.conflictingEveningIds,
        )
        assertEquals(
            setOf(local.eveningId, remote.eveningId),
            conflicted.eveningConflictBranches.map { it.eveningId }.toSet(),
        )
        assertTrue(
            conflicted.eveningConflictBranches.all {
                it.status == EveningStatus.CONFLICT
            },
        )

        val restored = JsonCodec.decodeState(JsonCodec.encodeState(conflicted))
        assertEquals(conflicted.conflictingEveningIds, restored.conflictingEveningIds)
        assertEquals(
            setOf(local.eveningId, remote.eveningId),
            restored.eveningConflictBranches.map { it.eveningId }.toSet(),
        )

        val conflictAfterAnotherStaleSnapshot = WearSyncReducer.reconcileSnapshot(
            restored,
            snapshot(activeEvening = local),
        )
        assertEquals(
            setOf(local.eveningId, remote.eveningId),
            conflictAfterAnotherStaleSnapshot.eveningConflictBranches
                .map { it.eveningId }
                .toSet(),
        )

        val remoteWins = requireNotNull(
            WearSyncReducer.resolveEveningConflict(
                restored,
                remote.eveningId,
                "2026-07-30T21:05:00Z",
            ),
        )
        assertEquals(remote.eveningId, remoteWins.activeEvening?.eveningId)
        assertEquals(
            EveningStatus.CLOSED,
            remoteWins.otherEvenings.single { it.eveningId == local.eveningId }.status,
        )
        assertTrue(remoteWins.conflictingEveningIds.isEmpty())

        val localWins = requireNotNull(
            WearSyncReducer.resolveEveningConflict(
                conflicted,
                local.eveningId,
                "2026-07-30T21:05:00Z",
            ),
        )
        assertEquals(local.eveningId, localWins.activeEvening?.eveningId)
        assertEquals(
            EveningStatus.CLOSED,
            localWins.otherEvenings.single { it.eveningId == remote.eveningId }.status,
        )
    }

    @Test
    fun `older same-account snapshot cannot regress durable domain state`() {
        val secondDrink = drinkA.copy(
            id = "ffffffff-ffff-4fff-8fff-ffffffffffff",
            recordedAt = "2026-07-30T20:10:00Z",
        )
        val currentEvening = eveningA.copy(drinks = listOf(drinkA, secondDrink))
        val current = state(
            target = TargetState(TargetSelection.MANUAL, pubA),
            activeEvening = currentEvening,
        ).copy(
            revision = 5,
            recentDrinks = listOf(DrinkChoice.fromDrink(secondDrink)),
            lastPhoneContactAt = "2026-07-30T20:11:00Z",
        )
        val staleSnapshot = snapshot(
            target = TargetState(TargetSelection.MANUAL, pubB),
            activeEvening = eveningB,
        ).copy(
            messageId = "12121212-1212-4212-8212-121212121212",
            revision = 3,
            recentDrinks = listOf(DrinkChoice.fromDrink(eveningB.drinks.single())),
        )

        val result = reduceRemoteSnapshot(current, staleSnapshot)

        assertFalse(result.applied)
        assertEquals(5, result.state.revision)
        assertEquals(current.target, result.state.target)
        assertEquals(current.activeEvening, result.state.activeEvening)
        assertEquals(current.otherEvenings, result.state.otherEvenings)
        assertEquals(current.recentDrinks, result.state.recentDrinks)
        assertTrue(result.state.processedRemoteIds.contains(staleSnapshot.messageId))
    }

    @Test
    fun `pending account switch keeps old commands until the old phone account returns`() {
        val pendingMessageId = "10101010-1010-4010-8010-101010101010"
        val current = enqueue(
            state(
                target = TargetState(TargetSelection.MANUAL, pubA),
                activeEvening = eveningA,
            ).copy(lastPhoneContactAt = "2026-07-30T20:00:00Z"),
            JSONObject()
                .put("type", "add_drink")
                .put("eveningId", eveningA.eveningId)
                .put("drink", JsonCodec.drinkToJson(drinkA)),
            pendingMessageId,
        )
        val newEpoch = "11111111-2222-4333-8444-555555555555"
        val otherAccount = snapshot(activeEvening = eveningB).copy(
            messageId = "11111111-2222-4333-8444-666666666666",
            accountEpoch = newEpoch,
            revision = 7,
        )

        val blocked = reduceRemoteSnapshot(current, otherAccount)

        assertFalse(blocked.applied)
        assertEquals(current.accountEpoch, blocked.state.accountEpoch)
        assertEquals(listOf(pendingMessageId), blocked.state.outbox.map { it.messageId })
        assertEquals(eveningA, blocked.state.activeEvening)
        assertEquals(newEpoch, blocked.state.accountConflictEpoch)
        assertEquals(
            newEpoch,
            JsonCodec.decodeState(JsonCodec.encodeState(blocked.state)).accountConflictEpoch,
        )

        val originalAccountReturns = snapshot(activeEvening = eveningA).copy(
            messageId = "11111111-2222-4333-8444-777777777777",
            revision = current.revision,
        )
        val recovered = reduceRemoteSnapshot(blocked.state, originalAccountReturns)

        assertTrue(recovered.applied)
        assertNull(recovered.state.accountConflictEpoch)
        assertEquals(listOf(pendingMessageId), recovered.state.outbox.map { it.messageId })
    }

    @Test
    fun `empty-outbox account switch starts clean with a new actor stream`() {
        val oldChoice = DrinkChoice.fromDrink(drinkA)
        val newDrink = eveningB.drinks.single()
        val newChoice = DrinkChoice.fromDrink(newDrink)
        val current = state(
            target = TargetState(TargetSelection.MANUAL, pubA),
            activeEvening = eveningA,
        ).copy(
            actorSequence = 42,
            revision = 9,
            otherEvenings = listOf(eveningA.copy(status = EveningStatus.CLOSED)),
            nearbyPubs = listOf(pubA),
            recentDrinks = listOf(oldChoice),
            frequentDrinks = listOf(oldChoice),
            menuDrinks = listOf(oldChoice),
            processedRemoteIds = setOf("abababab-abab-4bab-8bab-abababababab"),
            lastPhoneContactAt = "2026-07-30T20:00:00Z",
        )
        val newEpoch = "13131313-1313-4313-8313-131313131313"
        val incoming = snapshot(
            target = TargetState(TargetSelection.MANUAL, pubB),
            activeEvening = null,
        ).copy(
            messageId = "14141414-1414-4414-8414-141414141414",
            accountEpoch = newEpoch,
            revision = 2,
            nearbyPubs = listOf(pubB),
            recentDrinks = listOf(newChoice),
            frequentDrinks = listOf(newChoice),
            menuDrinks = listOf(newChoice),
        )

        val result = reduceRemoteSnapshot(current, incoming)

        assertTrue(result.applied)
        assertNotEquals(current.actorId, result.state.actorId)
        assertTrue(result.state.actorId.startsWith("wearos-"))
        assertEquals(0, result.state.actorSequence)
        assertEquals(newEpoch, result.state.accountEpoch)
        assertEquals(2, result.state.revision)
        assertNull(result.state.activeEvening)
        assertTrue(result.state.otherEvenings.isEmpty())
        assertEquals(listOf(pubB), result.state.nearbyPubs)
        assertEquals(listOf(newChoice), result.state.recentDrinks)
        assertEquals(listOf(newChoice), result.state.frequentDrinks)
        assertEquals(listOf(newChoice), result.state.menuDrinks)
        assertEquals(setOf(incoming.messageId), result.state.processedRemoteIds)
    }

    @Test
    fun `round trip account switches mint independent actor streams`() {
        val epochA = accountEpoch
        val epochB = "19191919-1919-4919-8919-191919191919"
        val contactedA = state(activeEvening = null).copy(
            actorId = "wearos-account-a",
            actorSequence = 7,
            revision = 5,
            lastPhoneContactAt = "2026-07-30T20:00:00Z",
        )
        val snapshotB = snapshot().copy(
            messageId = "20202020-2020-4020-8020-202020202020",
            accountEpoch = epochB,
            revision = 1,
            lastPhoneContactAt = "2026-07-30T20:05:00Z",
        )

        val switchedToB = reduceRemoteSnapshot(contactedA, snapshotB).state

        assertNotEquals(contactedA.actorId, switchedToB.actorId)
        assertEquals(0, switchedToB.actorSequence)

        val usedOnB = switchedToB.copy(
            actorSequence = 3,
            lastPhoneContactAt = "2026-07-30T20:10:00Z",
        )
        val snapshotA = snapshot().copy(
            messageId = "21212121-2121-4121-8121-212121212121",
            accountEpoch = epochA,
            revision = 6,
            lastPhoneContactAt = "2026-07-30T20:11:00Z",
        )

        val returnedToA = reduceRemoteSnapshot(usedOnB, snapshotA).state

        assertNotEquals(contactedA.actorId, returnedToA.actorId)
        assertNotEquals(switchedToB.actorId, returnedToA.actorId)
        assertEquals(0, returnedToA.actorSequence)
        assertEquals(epochA, returnedToA.accountEpoch)
    }

    @Test
    fun `first phone snapshot rebinds an unpaired outbox without losing commands`() {
        val localEpoch = "15151515-1515-4515-8515-151515151515"
        val phoneEpoch = "16161616-1616-4616-8616-161616161616"
        val messageId = "17171717-1717-4717-8717-171717171717"
        val local = DurableOutbox.enqueue(
            PersistedState(
                actorId = "wearos-first-pair",
                accountEpoch = localEpoch,
                activeEvening = eveningA,
                initialized = true,
            ),
            JSONObject()
                .put("type", "start_evening_and_add_drink")
                .put("eveningId", eveningA.eveningId)
                .put("pub", JsonCodec.pubToJson(eveningA.pub))
                .put("drinkingDayKey", eveningA.drinkingDayKey)
                .put("drink", JsonCodec.drinkToJson(drinkA)),
            messageId = messageId,
            createdAt = drinkA.recordedAt,
        )
        val firstPhoneSnapshot = snapshot().copy(
            messageId = "18181818-1818-4818-8818-181818181818",
            accountEpoch = phoneEpoch,
            revision = 4,
            lastPhoneContactAt = "2026-07-30T20:15:00Z",
        )

        val result = reduceRemoteSnapshot(local, firstPhoneSnapshot)

        assertTrue(result.applied)
        assertEquals(phoneEpoch, result.state.accountEpoch)
        assertEquals(local.actorId, result.state.actorId)
        assertEquals(local.actorSequence, result.state.actorSequence)
        assertEquals(messageId, result.state.outbox.single().messageId)
        assertEquals(
            phoneEpoch,
            JSONObject(result.state.outbox.single().json).getString("accountEpoch"),
        )
        assertEquals(eveningA.eveningId, result.state.activeEvening?.eveningId)
        assertEquals(listOf(drinkA), result.state.activeEvening?.visibleDrinks)
    }

    private fun enqueue(
        current: PersistedState,
        command: JSONObject,
        messageId: String,
    ): PersistedState = DurableOutbox.enqueue(
        current,
        command,
        messageId = messageId,
        createdAt = "2026-07-30T20:30:00Z",
    )

    private fun state(
        target: TargetState? = null,
        activeEvening: EveningState? = null,
    ): PersistedState = PersistedState(
        actorId = "wearos-test",
        accountEpoch = accountEpoch,
        target = target,
        activeEvening = activeEvening,
        initialized = true,
    )

    private fun snapshot(
        target: TargetState? = null,
        activeEvening: EveningState? = null,
    ): RemoteSnapshot = RemoteSnapshot(
        messageId = "99999999-9999-4999-8999-999999999999",
        accountEpoch = accountEpoch,
        revision = 1,
        target = target,
        activeEvening = activeEvening,
        otherEvenings = emptyList(),
        nearbyPubs = emptyList(),
        recentDrinks = emptyList(),
        frequentDrinks = emptyList(),
        menuDrinks = emptyList(),
        isStale = true,
        lastPhoneContactAt = "2026-07-30T20:31:00Z",
    )

    private companion object {
        const val accountEpoch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

        val pubA = PubRef(
            pubKey = "u2fkbn",
            name = "U Zlatého tygra",
            latitude = 50.0868,
            longitude = 14.4182,
        )
        val pubB = PubRef(
            pubKey = "u2fkbp",
            name = "U Pinkasů",
            latitude = 50.0825,
            longitude = 14.4233,
        )
        val pubC = PubRef(
            pubKey = "u2fkbr",
            name = "Lokál Dlouhááá",
            latitude = 50.0904,
            longitude = 14.4255,
        )
        val drinkA = DrinkSpec(
            id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name = "Pilsner Urquell",
            drinkType = DrinkType.BEER,
            volumeMl = 500,
            priceCzk = 72,
            recordedAt = "2026-07-30T20:00:00Z",
        )
        val eveningA = EveningState(
            eveningId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            pub = pubA,
            drinkingDayKey = "2026-07-30",
            startedAt = drinkA.recordedAt,
            drinks = listOf(drinkA),
        )
        val eveningB = EveningState(
            eveningId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            pub = pubB,
            drinkingDayKey = "2026-07-30",
            startedAt = "2026-07-30T20:05:00Z",
            drinks = listOf(
                DrinkSpec(
                    id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    name = "Kofola originál",
                    drinkType = DrinkType.SOFT_DRINK,
                    volumeMl = 400,
                    priceCzk = 49,
                    recordedAt = "2026-07-30T20:05:00Z",
                ),
            ),
        )
    }
}

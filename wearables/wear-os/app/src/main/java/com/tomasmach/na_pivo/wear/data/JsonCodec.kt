package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.Ack
import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.DrinkChoice
import com.tomasmach.na_pivo.wear.domain.DrinkType
import com.tomasmach.na_pivo.wear.domain.EveningState
import com.tomasmach.na_pivo.wear.domain.EveningStatus
import com.tomasmach.na_pivo.wear.domain.PendingEnvelope
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.RemoteSnapshot
import com.tomasmach.na_pivo.wear.domain.ServingType
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState
import org.json.JSONArray
import org.json.JSONObject

object JsonCodec {
    fun encodeState(state: PersistedState): String = JSONObject().apply {
        put("actorId", state.actorId)
        put("accountEpoch", state.accountEpoch)
        put("actorSequence", state.actorSequence)
        put("revision", state.revision)
        putNullable("target", state.target?.let(::targetToJson))
        putNullable("activeEvening", state.activeEvening?.let(::eveningToJson))
        put("otherEvenings", JSONArray(state.otherEvenings.map(::eveningToJson)))
        put("nearbyPubs", JSONArray(state.nearbyPubs.map(::pubToJson)))
        putNullable("nearbyFetchedAt", state.nearbyFetchedAt)
        put("recentDrinks", JSONArray(state.recentDrinks.map(::choiceToJson)))
        put("frequentDrinks", JSONArray(state.frequentDrinks.map(::choiceToJson)))
        put("menuDrinks", JSONArray(state.menuDrinks.map(::choiceToJson)))
        put("outbox", JSONArray(state.outbox.map(::pendingToJson)))
        put("processedRemoteIds", JSONArray(state.processedRemoteIds.toList()))
        put("conflictingEveningIds", JSONArray(state.conflictingEveningIds.distinct()))
        put("isStale", state.isStale)
        putNullable("lastPhoneContactAt", state.lastPhoneContactAt)
        putNullable("syncConflict", state.syncConflict)
        putNullable("accountConflictEpoch", state.accountConflictEpoch)
        put("initialized", state.initialized)
    }.toString()

    fun decodeState(value: String): PersistedState {
        val json = JSONObject(value)
        return PersistedState(
            actorId = json.requireString("actorId"),
            accountEpoch = json.requireString("accountEpoch"),
            actorSequence = json.optLong("actorSequence", 0),
            revision = json.optLong("revision", 0),
            target = json.optObject("target")?.let(::targetFromJson),
            activeEvening = json.optObject("activeEvening")?.let(::eveningFromJson),
            otherEvenings = json.optArray("otherEvenings").mapObjects(::eveningFromJson),
            nearbyPubs = json.optArray("nearbyPubs").mapObjects(::pubFromJson).take(10),
            nearbyFetchedAt = json.optNullableString("nearbyFetchedAt"),
            recentDrinks = json.optArray("recentDrinks").mapObjects(::choiceFromJson).take(20),
            frequentDrinks = json.optArray("frequentDrinks").mapObjects(::choiceFromJson).take(20),
            menuDrinks = json.optArray("menuDrinks").mapObjects(::choiceFromJson).take(40),
            outbox = json.optArray("outbox").mapObjects(::pendingFromJson),
            processedRemoteIds = json.optArray("processedRemoteIds")
                .stringSet()
                .toList()
                .takeLast(500)
                .toSet(),
            conflictingEveningIds = json.optArray("conflictingEveningIds")
                .stringList()
                .distinct()
                .take(10),
            isStale = json.optBoolean("isStale", true),
            lastPhoneContactAt = json.optNullableString("lastPhoneContactAt"),
            syncConflict = json.optNullableString("syncConflict"),
            accountConflictEpoch = json.optNullableString("accountConflictEpoch"),
            initialized = json.optBoolean("initialized", false),
        )
    }

    fun commandEnvelope(
        state: PersistedState,
        messageId: String,
        sequence: Long,
        sentAt: String,
        command: JSONObject,
    ): String = commonEnvelope(
        state = state,
        messageId = messageId,
        sequence = sequence,
        sentAt = sentAt,
        kind = "command",
        payload = JSONObject().put("command", command),
    ).toString()

    fun ackEnvelope(
        state: PersistedState,
        messageId: String,
        sequence: Long,
        sentAt: String,
        acknowledgedIds: Collection<String>,
    ): String = commonEnvelope(
        state = state,
        messageId = messageId,
        sequence = sequence,
        sentAt = sentAt,
        kind = "ack",
        payload = JSONObject()
            .put("acknowledgedMessageIds", JSONArray(acknowledgedIds.toList()))
            .put("revision", state.revision),
    ).toString()

    private fun commonEnvelope(
        state: PersistedState,
        messageId: String,
        sequence: Long,
        sentAt: String,
        kind: String,
        payload: JSONObject,
    ): JSONObject = JSONObject()
        .put("protocolVersion", 1)
        .put("messageId", messageId)
        .put("accountEpoch", state.accountEpoch)
        .put("actorId", state.actorId)
        .put("actorKind", "wearos")
        .put("actorSequence", sequence)
        .put("baseRevision", state.revision)
        .put("sentAt", sentAt)
        .put("kind", kind)
        .put("payload", payload)

    fun parseKind(bytes: ByteArray): String? = runCatching {
        JSONObject(bytes.toString(Charsets.UTF_8)).optString("kind").takeIf { it.isNotBlank() }
    }.getOrNull()

    fun decodeSnapshot(bytes: ByteArray): RemoteSnapshot {
        val root = JSONObject(bytes.toString(Charsets.UTF_8))
        require(root.getInt("protocolVersion") == 1)
        require(root.getString("kind") == "state_snapshot")
        val payload = root.getJSONObject("payload")
        return RemoteSnapshot(
            messageId = root.requireString("messageId"),
            accountEpoch = root.requireString("accountEpoch"),
            revision = payload.getLong("revision"),
            target = payload.optObject("target")?.let(::targetFromJson),
            activeEvening = payload.optObject("activeEvening")?.let(::eveningFromJson),
            otherEvenings = payload.optArray("otherEvenings").mapObjects(::eveningFromJson).take(10),
            nearbyPubs = payload.optArray("nearbyPubs").mapObjects(::pubFromJson).take(10),
            recentDrinks = payload.optArray("recentDrinks").mapObjects(::choiceFromJson).take(20),
            frequentDrinks = payload.optArray("frequentDrinks").mapObjects(::choiceFromJson).take(20),
            menuDrinks = payload.optArray("menuDrinks").mapObjects(::choiceFromJson).take(40),
            isStale = payload.optBoolean("isStale", false),
            lastPhoneContactAt = payload.optNullableString("lastPhoneContactAt"),
        )
    }

    fun decodeAck(bytes: ByteArray): Ack {
        val root = JSONObject(bytes.toString(Charsets.UTF_8))
        require(root.getInt("protocolVersion") == 1)
        require(root.getString("kind") == "ack")
        val payload = root.getJSONObject("payload")
        return Ack(
            messageId = root.requireString("messageId"),
            accountEpoch = root.requireString("accountEpoch"),
            acknowledgedMessageIds = payload.getJSONArray("acknowledgedMessageIds").stringSet(),
            revision = payload.getLong("revision"),
        )
    }

    fun pubToJson(pub: PubRef): JSONObject = JSONObject()
        .put("pubKey", pub.pubKey)
        .put("name", pub.name)
        .put("latitude", pub.latitude)
        .put("longitude", pub.longitude)
        .apply {
            putNullable("city", pub.city)
            putNullable("externalId", pub.externalId)
        }

    fun pubFromJson(json: JSONObject): PubRef = PubRef(
        pubKey = json.requireString("pubKey"),
        name = json.requireString("name"),
        latitude = json.getDouble("latitude"),
        longitude = json.getDouble("longitude"),
        city = json.optNullableString("city"),
        externalId = json.optNullableString("externalId"),
    )

    fun drinkToJson(drink: DrinkSpec): JSONObject = JSONObject()
        .put("id", drink.id)
        .put("name", drink.name)
        .put("drinkType", drink.drinkType.wireName)
        .put("volumeMl", drink.volumeMl)
        .put("priceCzk", drink.priceCzk)
        .put("servingType", drink.servingType.wireName)
        .put("recordedAt", drink.recordedAt)

    fun drinkFromJson(json: JSONObject): DrinkSpec = DrinkSpec(
        id = json.requireString("id"),
        name = json.requireString("name"),
        drinkType = DrinkType.fromWire(json.optString("drinkType")),
        volumeMl = json.getInt("volumeMl"),
        priceCzk = json.getInt("priceCzk"),
        servingType = ServingType.fromWire(json.optString("servingType")),
        recordedAt = json.requireString("recordedAt"),
    )

    fun choiceToJson(choice: DrinkChoice): JSONObject = JSONObject()
        .put("choiceId", choice.choiceId)
        .put("name", choice.name)
        .put("drinkType", choice.drinkType.wireName)
        .putNullable("volumeMl", choice.volumeMl)
        .putNullable("priceCzk", choice.priceCzk)
        .put("servingType", choice.servingType.wireName)

    fun choiceFromJson(json: JSONObject): DrinkChoice = DrinkChoice(
        // `id` keeps persisted pre-v1 development data readable, but it is
        // never reused as a drink fact id when the choice is selected.
        choiceId = json.optNullableString("choiceId")
            ?: json.optNullableString("id")
            ?: "legacy:${json.requireString("name").lowercase()}",
        name = json.requireString("name"),
        drinkType = DrinkType.fromWire(json.optString("drinkType")),
        volumeMl = json.optNullableInt("volumeMl"),
        priceCzk = json.optNullableInt("priceCzk"),
        servingType = ServingType.fromWire(json.optString("servingType")),
    )

    fun targetToJson(target: TargetState): JSONObject = JSONObject()
        .put("selection", target.selection.wireName)
        .put("pub", pubToJson(target.pub))

    fun targetFromJson(json: JSONObject): TargetState = TargetState(
        selection = TargetSelection.fromWire(json.optString("selection")),
        pub = pubFromJson(json.getJSONObject("pub")),
    )

    fun eveningToJson(evening: EveningState): JSONObject = JSONObject()
        .put("eveningId", evening.eveningId)
        .put("pub", pubToJson(evening.pub))
        .put("drinkingDayKey", evening.drinkingDayKey)
        .put("startedAt", evening.startedAt)
        .putNullable("closedAt", evening.closedAt)
        .put("status", evening.status.wireName)
        .put("drinks", JSONArray(evening.drinks.map(::drinkToJson)))
        .put("removedDrinkIds", JSONArray(evening.removedDrinkIds.toList()))

    fun eveningFromJson(json: JSONObject): EveningState = EveningState(
        eveningId = json.requireString("eveningId"),
        pub = pubFromJson(json.getJSONObject("pub")),
        drinkingDayKey = json.requireString("drinkingDayKey"),
        startedAt = json.requireString("startedAt"),
        closedAt = json.optNullableString("closedAt"),
        status = EveningStatus.fromWire(json.optString("status")),
        drinks = json.optArray("drinks").mapObjects(::drinkFromJson),
        removedDrinkIds = json.optArray("removedDrinkIds").stringSet(),
    )

    private fun pendingToJson(pending: PendingEnvelope): JSONObject = JSONObject()
        .put("messageId", pending.messageId)
        .put("path", pending.path)
        .put("json", pending.json)
        .put("createdAt", pending.createdAt)

    private fun pendingFromJson(json: JSONObject): PendingEnvelope = PendingEnvelope(
        messageId = json.requireString("messageId"),
        path = json.requireString("path"),
        json = json.requireString("json"),
        createdAt = json.requireString("createdAt"),
    )
}

private fun JSONObject.requireString(key: String): String =
    getString(key).also { require(it.isNotBlank()) }

private fun JSONObject.putNullable(key: String, value: Any?): JSONObject =
    put(key, value ?: JSONObject.NULL)

private fun JSONObject.optNullableString(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() } else null

private fun JSONObject.optNullableInt(key: String): Int? =
    if (has(key) && !isNull(key)) getInt(key) else null

private fun JSONObject.optObject(key: String): JSONObject? =
    if (has(key) && !isNull(key)) optJSONObject(key) else null

private fun JSONObject.optArray(key: String): JSONArray =
    optJSONArray(key) ?: JSONArray()

private fun <T> JSONArray.mapObjects(mapper: (JSONObject) -> T): List<T> = buildList {
    for (index in 0 until length()) {
        optJSONObject(index)?.let { value -> runCatching { mapper(value) }.getOrNull()?.let(::add) }
    }
}

private fun JSONArray.stringSet(): Set<String> = buildSet {
    for (index in 0 until length()) {
        optString(index).takeIf { it.isNotBlank() }?.let(::add)
    }
}

private fun JSONArray.stringList(): List<String> = buildList {
    for (index in 0 until length()) {
        optString(index).takeIf { it.isNotBlank() }?.let(::add)
    }
}

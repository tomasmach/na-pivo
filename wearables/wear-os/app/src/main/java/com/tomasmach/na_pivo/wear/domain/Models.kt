package com.tomasmach.na_pivo.wear.domain

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID

enum class DrinkType(val wireName: String, val czechName: String) {
    BEER("beer", "Pivo"),
    SOFT_DRINK("soft_drink", "Nealko"),
    WINE("wine", "Víno"),
    SHOT("shot", "Panák");

    companion object {
        fun fromWire(value: String?): DrinkType =
            entries.firstOrNull { it.wireName == value } ?: BEER
    }
}

enum class ServingType(val wireName: String) {
    UNKNOWN("unknown"),
    DRAFT("draft"),
    BOTTLE("bottle"),
    CAN("can"),
    PLASTIC_BOTTLE("plastic_bottle"),
    OTHER("other");

    companion object {
        fun fromWire(value: String?): ServingType =
            entries.firstOrNull { it.wireName == value } ?: UNKNOWN
    }
}

enum class TargetSelection(val wireName: String) {
    MANUAL("manual"),
    NEAREST("nearest");

    companion object {
        fun fromWire(value: String?): TargetSelection =
            entries.firstOrNull { it.wireName == value } ?: NEAREST
    }
}

enum class EveningStatus(val wireName: String) {
    ACTIVE("active"),
    CLOSED("closed"),
    CONFLICT("conflict");

    companion object {
        fun fromWire(value: String?): EveningStatus =
            entries.firstOrNull { it.wireName == value } ?: ACTIVE
    }
}

data class PubRef(
    val pubKey: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val city: String? = null,
    val externalId: String? = null,
)

data class DrinkSpec(
    val id: String,
    val name: String,
    val drinkType: DrinkType,
    val volumeMl: Int,
    val priceCzk: Int,
    val servingType: ServingType = ServingType.UNKNOWN,
    val recordedAt: String,
) {
    val descriptor: String
        get() = "${drinkType.czechName.lowercase()} · ${formatVolume(volumeMl)} · $priceCzk Kč"

    companion object {
        fun create(
            name: String,
            drinkType: DrinkType,
            volumeMl: Int,
            priceCzk: Int,
            servingType: ServingType = ServingType.UNKNOWN,
            now: Instant = Instant.now(),
        ): DrinkSpec = DrinkSpec(
            id = UUID.randomUUID().toString(),
            name = name.trim().take(80),
            drinkType = drinkType,
            volumeMl = volumeMl,
            priceCzk = priceCzk,
            servingType = servingType,
            recordedAt = now.toString(),
        )
    }
}

data class DrinkChoice(
    val choiceId: String,
    val name: String,
    val drinkType: DrinkType,
    val volumeMl: Int?,
    val priceCzk: Int?,
    val servingType: ServingType = ServingType.UNKNOWN,
) {
    val descriptor: String
        get() = listOfNotNull(
            drinkType.czechName.lowercase(),
            volumeMl?.let(::formatVolume),
            priceCzk?.let { "$it Kč" },
        ).joinToString(" · ")

    companion object {
        fun fromDrink(drink: DrinkSpec): DrinkChoice = DrinkChoice(
            choiceId =
                "local:${drink.name.lowercase()}:${drink.drinkType.wireName}:" +
                    "${drink.volumeMl}:${drink.priceCzk}",
            name = drink.name,
            drinkType = drink.drinkType,
            volumeMl = drink.volumeMl,
            priceCzk = drink.priceCzk,
            servingType = drink.servingType,
        )
    }
}

data class TargetState(
    val selection: TargetSelection,
    val pub: PubRef,
)

data class EveningState(
    val eveningId: String,
    val pub: PubRef,
    val drinkingDayKey: String,
    val startedAt: String,
    val closedAt: String? = null,
    val status: EveningStatus = EveningStatus.ACTIVE,
    val drinks: List<DrinkSpec> = emptyList(),
    val removedDrinkIds: Set<String> = emptySet(),
) {
    val visibleDrinks: List<DrinkSpec>
        get() = drinks.filterNot { removedDrinkIds.contains(it.id) }

    val beerCount: Int
        get() = visibleDrinks.count { it.drinkType == DrinkType.BEER }

    val otherCounts: Map<DrinkType, Int>
        get() = visibleDrinks
            .filter { it.drinkType != DrinkType.BEER }
            .groupingBy { it.drinkType }
            .eachCount()

    val totalCzk: Int
        get() = visibleDrinks.sumOf { it.priceCzk }

    val lastDrink: DrinkSpec?
        get() = visibleDrinks.maxByOrNull { it.recordedAt }
}

data class PendingEnvelope(
    val messageId: String,
    val path: String,
    val json: String,
    val createdAt: String,
)

data class PersistedState(
    val actorId: String,
    val accountEpoch: String,
    val actorSequence: Long = 0,
    val revision: Long = 0,
    val target: TargetState? = null,
    val activeEvening: EveningState? = null,
    val otherEvenings: List<EveningState> = emptyList(),
    val nearbyPubs: List<PubRef> = emptyList(),
    val nearbyFetchedAt: String? = null,
    val recentDrinks: List<DrinkChoice> = emptyList(),
    val frequentDrinks: List<DrinkChoice> = emptyList(),
    val menuDrinks: List<DrinkChoice> = emptyList(),
    val outbox: List<PendingEnvelope> = emptyList(),
    val processedRemoteIds: Set<String> = emptySet(),
    val conflictingEveningIds: List<String> = emptyList(),
    val isStale: Boolean = true,
    val lastPhoneContactAt: String? = null,
    val syncConflict: String? = null,
    val accountConflictEpoch: String? = null,
    val initialized: Boolean = false,
) {
    fun eveningById(eveningId: String): EveningState? =
        activeEvening?.takeIf { it.eveningId == eveningId }
            ?: otherEvenings.firstOrNull { it.eveningId == eveningId }

    val eveningConflictBranches: List<EveningState>
        get() = conflictingEveningIds
            .distinct()
            .mapNotNull(::eveningById)

    companion object {
        fun fresh(): PersistedState = PersistedState(
            actorId = "wearos-${UUID.randomUUID().toString().take(8)}",
            accountEpoch = UUID.randomUUID().toString(),
        )
    }
}

data class RemoteSnapshot(
    val messageId: String,
    val accountEpoch: String,
    val revision: Long,
    val target: TargetState?,
    val activeEvening: EveningState?,
    val otherEvenings: List<EveningState>,
    val nearbyPubs: List<PubRef>,
    val recentDrinks: List<DrinkChoice>,
    val frequentDrinks: List<DrinkChoice>,
    val menuDrinks: List<DrinkChoice>,
    val isStale: Boolean,
    val lastPhoneContactAt: String?,
)

data class Ack(
    val messageId: String,
    val accountEpoch: String,
    val acknowledgedMessageIds: Set<String>,
    val revision: Long,
)

data class GeoReading(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
)

data class CompassReading(
    val distanceMeters: Double?,
    val bearingDegrees: Float?,
    val arrowRotationDegrees: Float?,
)

enum class ConnectivityState {
    CONNECTED,
    DISCONNECTED,
    UNKNOWN,
}

data class OperationResult(
    val applied: Boolean,
    val drink: DrinkSpec? = null,
    val needsRapidConfirmation: Boolean = false,
    val message: String? = null,
)

fun formatVolume(volumeMl: Int): String =
    when {
        volumeMl == 1000 -> "1 l"
        volumeMl % 100 == 0 -> "${volumeMl / 1000.0}".replace('.', ',') + " l"
        else -> "$volumeMl ml"
    }

fun drinkingDayKey(now: ZonedDateTime = ZonedDateTime.now(ZoneId.systemDefault())): String =
    now.minusHours(4).toLocalDate().toString()

fun validVolume(type: DrinkType, volumeMl: Int): Boolean =
    when (type) {
        DrinkType.SHOT -> volumeMl in 10..200
        DrinkType.BEER, DrinkType.WINE, DrinkType.SOFT_DRINK -> volumeMl in 10..3000
    }

private val genericDrinkNames = setOf(
    "beer",
    "drink",
    "napoj",
    "nealko",
    "neco",
    "něco",
    "nápoj",
    "panak",
    "panák",
    "pivo",
    "shot",
    "vino",
    "víno",
)

fun isConcreteDrinkName(name: String): Boolean {
    val normalized = name.trim().lowercase()
    return normalized.length in 1..80 && normalized !in genericDrinkNames
}

package com.tomasmach.na_pivo.wear.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tomasmach.na_pivo.wear.data.DurableOutbox
import com.tomasmach.na_pivo.wear.domain.DrinkChoice
import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.DrinkType
import com.tomasmach.na_pivo.wear.domain.EveningState
import com.tomasmach.na_pivo.wear.domain.EveningStatus
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.ServingType
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState
import com.tomasmach.na_pivo.wear.surface.EveningSurfaceController
import com.tomasmach.na_pivo.wear.wearApplication
import java.time.Instant
import kotlinx.coroutines.launch
import org.json.JSONObject

class DebugScenarioReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val pending = goAsync()
        val scenario = intent.getStringExtra(EXTRA_SCENARIO).orEmpty()
        val app = context.wearApplication
        app.container.applicationScope.launch {
            try {
                val state = DebugFixtures.state(scenario)
                app.container.repository.replaceForDebug(state)
                EveningSurfaceController.refresh(context, state)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION = "com.tomasmach.na_pivo.DEBUG_WEAR_SCENARIO"
        const val EXTRA_SCENARIO = "scenario"
    }
}

private object DebugFixtures {
    private val tiger = PubRef(
        pubKey = "u2fkbn4f",
        name = "U Zlatého tygra",
        latitude = 50.08706,
        longitude = 14.41786,
        city = "Praha",
        externalId = "debug-tiger",
    )
    private val bear = PubRef(
        pubKey = "u2fkbj4y",
        name = "U Medvídků",
        latitude = 50.08225,
        longitude = 14.41812,
        city = "Praha",
        externalId = "debug-bear",
    )
    private val pubThree = PubRef(
        pubKey = "u2fkbq8q",
        name = "Lokál Dlouhááá",
        latitude = 50.09045,
        longitude = 14.42556,
        city = "Praha",
        externalId = "debug-local",
    )
    private val pilsner = drink(
        id = "10000000-0000-4000-8000-000000000001",
        name = "Pilsner Urquell 12°",
        type = DrinkType.BEER,
        volumeMl = 500,
        priceCzk = 68,
        time = "2026-07-30T18:00:00Z",
    )
    private val kofola = drink(
        id = "10000000-0000-4000-8000-000000000002",
        name = "Kofola Original",
        type = DrinkType.SOFT_DRINK,
        volumeMl = 300,
        priceCzk = 49,
        time = "2026-07-30T18:30:00Z",
    )
    private val wine = drink(
        id = "10000000-0000-4000-8000-000000000003",
        name = "Veltlínské zelené",
        type = DrinkType.WINE,
        volumeMl = 200,
        priceCzk = 74,
        time = "2026-07-29T18:30:00Z",
    )
    private val shot = drink(
        id = "10000000-0000-4000-8000-000000000004",
        name = "Becherovka",
        type = DrinkType.SHOT,
        volumeMl = 40,
        priceCzk = 59,
        time = "2026-07-29T19:30:00Z",
    )

    fun state(scenario: String): PersistedState {
        val base = PersistedState(
            actorId = "wearos-debug",
            accountEpoch = "83d78467-da0d-4bed-9d75-d99a5e50c63b",
            revision = 10,
            nearbyPubs = listOf(tiger, bear, pubThree),
            nearbyFetchedAt = Instant.now().toString(),
            recentDrinks = listOf(pilsner, kofola, wine, shot).map(DrinkChoice::fromDrink),
            frequentDrinks = listOf(pilsner, kofola).map(DrinkChoice::fromDrink),
            menuDrinks = listOf(
                DrinkChoice(
                    choiceId = "menu:u2fkbn4f:kozel-11:500",
                    name = "Kozel 11°",
                    drinkType = DrinkType.BEER,
                    volumeMl = 500,
                    priceCzk = null,
                    servingType = ServingType.DRAFT,
                ),
                DrinkChoice(
                    choiceId = "menu:u2fkbn4f:birrell:500",
                    name = "Birell Pomelo & Grep",
                    drinkType = DrinkType.SOFT_DRINK,
                    volumeMl = 500,
                    priceCzk = 52,
                    servingType = ServingType.BOTTLE,
                ),
            ),
            isStale = false,
            initialized = true,
        )
        return when (scenario) {
            "empty" -> base.copy(nearbyPubs = emptyList(), isStale = true)
            "manual_target" -> base.copy(
                target = TargetState(TargetSelection.MANUAL, tiger),
            )
            "active" -> active(base)
            "change_pub" -> active(base).copy(
                target = TargetState(TargetSelection.MANUAL, bear),
            )
            "pending" -> {
                val withEvening = active(base)
                DurableOutbox.enqueue(
                    withEvening,
                    JSONObject()
                        .put("type", "set_target")
                        .put(
                            "target",
                            JSONObject()
                                .put("selection", "manual")
                                .put(
                                    "pub",
                                    JSONObject()
                                        .put("pubKey", pubThree.pubKey)
                                        .put("name", pubThree.name)
                                        .put("latitude", pubThree.latitude)
                                        .put("longitude", pubThree.longitude),
                                ),
                        ),
                    messageId = "30000000-0000-4000-8000-000000000001",
                    createdAt = "2026-07-30T20:00:00Z",
                ).copy(isStale = true)
            }
            "conflict" -> {
                val local = active(base)
                val remote = EveningState(
                    eveningId = "40000000-0000-4000-8000-000000000002",
                    pub = bear,
                    drinkingDayKey = "2026-07-30",
                    startedAt = wine.recordedAt,
                    status = EveningStatus.CONFLICT,
                    drinks = listOf(wine, shot),
                )
                local.copy(
                    activeEvening = local.activeEvening?.copy(status = EveningStatus.CONFLICT),
                    otherEvenings = listOf(remote),
                    conflictingEveningIds = listOf(
                        local.activeEvening!!.eveningId,
                        remote.eveningId,
                    ),
                    syncConflict = "Na hodinkách a telefonu běží jiný večer.",
                    isStale = true,
                )
            }
            "nearest", "reset", "" -> base
            else -> base
        }
    }

    private fun active(base: PersistedState): PersistedState = base.copy(
        target = TargetState(TargetSelection.MANUAL, tiger),
        activeEvening = EveningState(
            eveningId = "40000000-0000-4000-8000-000000000001",
            pub = tiger,
            drinkingDayKey = "2026-07-30",
            startedAt = pilsner.recordedAt,
            drinks = listOf(
                pilsner,
                pilsner.copy(
                    id = "10000000-0000-4000-8000-000000000005",
                    recordedAt = "2026-07-30T18:20:00Z",
                ),
                kofola,
            ),
        ),
    )

    private fun drink(
        id: String,
        name: String,
        type: DrinkType,
        volumeMl: Int,
        priceCzk: Int,
        time: String,
    ): DrinkSpec = DrinkSpec(
        id = id,
        name = name,
        drinkType = type,
        volumeMl = volumeMl,
        priceCzk = priceCzk,
        servingType = if (type == DrinkType.BEER) ServingType.DRAFT else ServingType.UNKNOWN,
        recordedAt = time,
    )
}

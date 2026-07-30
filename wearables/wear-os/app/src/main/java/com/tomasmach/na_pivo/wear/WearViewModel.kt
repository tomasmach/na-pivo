package com.tomasmach.na_pivo.wear

import android.app.Application
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tomasmach.na_pivo.wear.data.NearbyResult
import com.tomasmach.na_pivo.wear.data.NearbyRefreshGate
import com.tomasmach.na_pivo.wear.data.bearingDegrees
import com.tomasmach.na_pivo.wear.data.haversineMeters
import com.tomasmach.na_pivo.wear.domain.CompassReading
import com.tomasmach.na_pivo.wear.domain.ConnectivityState
import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.DrinkType
import com.tomasmach.na_pivo.wear.domain.GeoReading
import com.tomasmach.na_pivo.wear.domain.OperationResult
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.ServingType
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.sensors.LocationHeadingController
import com.tomasmach.na_pivo.wear.surface.EveningSurfaceController
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class WearUiState(
    val persisted: PersistedState,
    val location: GeoReading?,
    val headingDegrees: Float?,
    val connectivity: ConnectivityState,
    val effectiveTarget: PubRef?,
    val compass: CompassReading,
    val busy: Boolean,
    val notice: String?,
    val undoDrinkId: String?,
    val rapidDrink: DrinkSpec?,
) {
    val activeEvening get() = persisted.activeEvening
    val nearbyPubs get() = persisted.nearbyPubs
}

class WearViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as NaPivoWearApplication
    private val repository = app.container.repository
    private val locationHeading = LocationHeadingController(application)

    private val busy = MutableStateFlow(false)
    private val notice = MutableStateFlow<String?>(null)
    private val undoDrinkId = MutableStateFlow<String?>(null)
    private val rapidDrink = MutableStateFlow<DrinkSpec?>(null)

    private var selectedRapidPub: PubRef? = null
    private var undoTimer: Job? = null
    private var nearbyRetryTimer: Job? = null
    private var nearbyRetryRequired = false
    private var isForeground = false
    private val nearbyRefreshGate = NearbyRefreshGate()

    val uiState: StateFlow<WearUiState> = combine(
        repository.state,
        locationHeading.location,
        locationHeading.heading,
        app.container.transport.connectivity,
        busy,
        notice,
        undoDrinkId,
        rapidDrink,
    ) { values ->
        @Suppress("UNCHECKED_CAST")
        val persisted = values[0] as PersistedState
        val location = values[1] as GeoReading?
        val heading = values[2] as Float?
        val connectivity = values[3] as ConnectivityState
        val target = persisted.target?.pub ?: persisted.nearbyPubs.firstOrNull()
        val compass = compassReading(location, heading, target)
        WearUiState(
            persisted = persisted,
            location = location,
            headingDegrees = heading,
            connectivity = connectivity,
            effectiveTarget = target,
            compass = compass,
            busy = values[4] as Boolean,
            notice = values[5] as String?,
            undoDrinkId = values[6] as String?,
            rapidDrink = values[7] as DrinkSpec?,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        WearUiState(
            persisted = PersistedState.fresh(),
            location = null,
            headingDegrees = null,
            connectivity = ConnectivityState.UNKNOWN,
            effectiveTarget = null,
            compass = CompassReading(null, null, null),
            busy = false,
            notice = null,
            undoDrinkId = null,
            rapidDrink = null,
        ),
    )

    init {
        viewModelScope.launch {
            repository.initialize()
            app.container.transport.updateConnectivity()
            app.container.transport.flushOutbox()
        }
        viewModelScope.launch {
            locationHeading.location.collect { reading ->
                if (reading != null) maybeRefreshNearby(reading)
            }
        }
    }

    fun hasLocationPermission(): Boolean = locationHeading.hasLocationPermission()

    fun onForeground() {
        isForeground = true
        locationHeading.start()
        if (nearbyRetryRequired) {
            locationHeading.location.value?.let(::scheduleNearbyRetry)
        }
        viewModelScope.launch {
            app.container.transport.updateConnectivity()
            app.container.transport.flushOutbox()
        }
    }

    fun onBackground() {
        isForeground = false
        nearbyRetryTimer?.cancel()
        nearbyRetryTimer = null
        locationHeading.stop()
    }

    fun onLocationPermissionResult(granted: Boolean) {
        if (granted) {
            locationHeading.start()
        } else {
            showNotice("Bez polohy ukážu poslední známý cíl.")
        }
    }

    fun onNotificationPermissionDenied() {
        showNotice("Oznámení vypnutá.")
    }

    fun refreshEveningSurfaces() {
        viewModelScope.launch {
            EveningSurfaceController.refresh(
                getApplication(),
                repository.authoritativeState(),
            )
        }
    }

    fun retryAccountSync() {
        viewModelScope.launch {
            val current = app.container.transport.flushOutbox()
            EveningSurfaceController.refresh(getApplication(), current)
            showNotice("Na telefonu přepni původní účet. Zápisy držím.")
        }
    }

    fun choosePub(pub: PubRef) {
        viewModelScope.launch {
            repository.selectTarget(pub, TargetSelection.MANUAL)
            flushAndRefresh()
            showNotice("Mířím na vybranou hospodu.")
        }
    }

    fun addDrink(
        pub: PubRef,
        drink: DrinkSpec,
        skipRapidCheck: Boolean = false,
        onDone: (OperationResult) -> Unit = {},
    ) {
        val last = repository.state.value.activeEvening?.lastDrink
        if (!skipRapidCheck &&
            drink.drinkType != DrinkType.SOFT_DRINK &&
            last != null &&
            Duration.between(
                runCatching { Instant.parse(last.recordedAt) }.getOrDefault(Instant.EPOCH),
                Instant.now(),
            ).toMinutes() < RAPID_WINDOW_MINUTES
        ) {
            rapidDrink.value = drink
            selectedRapidPub = pub
            return
        }
        viewModelScope.launch {
            busy.value = true
            val result = repository.addDrink(pub, drink)
            busy.value = false
            if (result.applied && result.drink != null) {
                rapidDrink.value = null
                selectedRapidPub = null
                showUndo(result.drink.id)
                hapticSuccess()
                flushAndRefresh()
                showNotice("Zapsáno. Na zdraví!")
            } else {
                result.message?.let(::showNotice)
            }
            onDone(result)
        }
    }

    fun repeatLast(onDone: (OperationResult) -> Unit = {}) {
        val current = repository.state.value
        val active = current.activeEvening
        val last = active?.lastDrink
        if (active == null || last == null) {
            showNotice("Není co zopakovat.")
            return
        }
        addDrink(
            pub = active.pub,
            drink = DrinkSpec.create(
                name = last.name,
                drinkType = last.drinkType,
                volumeMl = last.volumeMl,
                priceCzk = last.priceCzk,
                servingType = last.servingType,
            ),
            onDone = onDone,
        )
    }

    fun confirmRapid(onDone: (OperationResult) -> Unit = {}) {
        val drink = rapidDrink.value ?: return
        val pub = selectedRapidPub ?: repository.state.value.activeEvening?.pub ?: return
        addDrink(pub, drink, skipRapidCheck = true, onDone = onDone)
    }

    fun cancelRapid() {
        rapidDrink.value = null
        selectedRapidPub = null
    }

    fun undo() {
        val drinkId = undoDrinkId.value ?: return
        undoTimer?.cancel()
        undoDrinkId.value = null
        viewModelScope.launch {
            val result = repository.removeDrink(drinkId, "undo")
            if (result.applied) {
                hapticTick()
                flushAndRefresh()
                showNotice("Vráceno. Nic se neděje.")
            }
        }
    }

    fun removeDrink(drinkId: String) {
        viewModelScope.launch {
            val result = repository.removeDrink(drinkId)
            if (result.applied) {
                hapticTick()
                flushAndRefresh()
                showNotice("Pryč. Stane se.")
            } else {
                result.message?.let(::showNotice)
            }
        }
    }

    fun closeEvening(onDone: () -> Unit = {}) {
        viewModelScope.launch {
            busy.value = true
            val closed = repository.closeEvening()
            busy.value = false
            if (closed) {
                hapticSuccess()
                flushAndRefresh()
                showNotice("Dopito. Dobrou cestu domů.")
                onDone()
            }
        }
    }

    fun keepThisEvening() {
        val eveningId = repository.state.value.activeEvening?.eveningId ?: return
        chooseConflictEvening(eveningId)
    }

    fun chooseConflictEvening(eveningId: String) {
        viewModelScope.launch {
            if (repository.resolveEveningConflict(eveningId)) {
                hapticTick()
                flushAndRefresh()
                showNotice("Platí vybraný večer. Druhý zůstane zvlášť.")
            }
        }
    }

    fun clearNotice() {
        notice.value = null
    }

    fun injectDebug(location: GeoReading?, heading: Float?) {
        locationHeading.injectForDebug(location, heading)
    }

    private suspend fun maybeRefreshNearby(reading: GeoReading) {
        val cell = "${round3(reading.latitude)}:${round3(reading.longitude)}"
        if (!nearbyRefreshGate.startAttempt(
                cell = cell,
                hasCachedPubs = repository.state.value.nearbyPubs.isNotEmpty(),
                nowMillis = SystemClock.elapsedRealtime(),
            )
        ) {
            return
        }
        nearbyRetryTimer?.cancel()
        nearbyRetryTimer = null
        when (val result = withContext(Dispatchers.IO) {
            app.container.nearbyPubClient.fetchNearby(reading)
        }) {
            is NearbyResult.Success -> {
                repository.cacheNearby(result.pubs)
                finishNearbyAttempt(
                    retryRequired = result.pubs.isEmpty(),
                    reading = reading,
                )
            }
            NearbyResult.Empty -> {
                repository.cacheNearby(emptyList())
                finishNearbyAttempt(retryRequired = true, reading = reading)
                showNotice("Tady kolem nic vhodného nevidím.")
            }
            NearbyResult.Offline -> {
                finishNearbyAttempt(retryRequired = true, reading = reading)
                repository.markNearbyStale()
                if (repository.state.value.nearbyPubs.isEmpty()) {
                    showNotice("Bez signálu. Cíl můžeš převzít z telefonu.")
                }
            }
        }
    }

    private fun finishNearbyAttempt(
        retryRequired: Boolean,
        reading: GeoReading,
    ) {
        nearbyRefreshGate.finishAttempt(retryRequired)
        nearbyRetryRequired = retryRequired
        if (retryRequired) {
            scheduleNearbyRetry(reading)
        }
    }

    private fun scheduleNearbyRetry(fallbackReading: GeoReading) {
        if (!isForeground) return
        nearbyRetryTimer?.cancel()
        nearbyRetryTimer = viewModelScope.launch {
            delay(NearbyRefreshGate.DEFAULT_RETRY_COOLDOWN_MILLIS)
            if (!isForeground) return@launch
            val reading = locationHeading.location.value ?: fallbackReading
            nearbyRetryTimer = null
            maybeRefreshNearby(reading)
        }
    }

    private suspend fun flushAndRefresh() {
        val current = app.container.transport.flushOutbox()
        EveningSurfaceController.refresh(getApplication(), current)
    }

    private fun showUndo(drinkId: String) {
        undoTimer?.cancel()
        undoDrinkId.value = drinkId
        undoTimer = viewModelScope.launch {
            delay(UNDO_WINDOW_MS)
            if (undoDrinkId.value == drinkId) undoDrinkId.value = null
        }
    }

    private fun showNotice(message: String) {
        notice.value = message
        viewModelScope.launch {
            delay(3_000)
            if (notice.value == message) notice.value = null
        }
    }

    private fun hapticSuccess() = vibrate(55)
    private fun hapticTick() = vibrate(25)

    private fun vibrate(milliseconds: Long) {
        val context = getApplication<Application>()
        val vibrator =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Vibrator::class.java)
            }
        vibrator?.vibrate(
            VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE),
        )
    }

    private fun compassReading(
        location: GeoReading?,
        heading: Float?,
        target: PubRef?,
    ): CompassReading {
        if (location == null || target == null) return CompassReading(null, null, null)
        val bearing = bearingDegrees(
            location.latitude,
            location.longitude,
            target.latitude,
            target.longitude,
        )
        return CompassReading(
            distanceMeters = haversineMeters(
                location.latitude,
                location.longitude,
                target.latitude,
                target.longitude,
            ),
            bearingDegrees = bearing,
            arrowRotationDegrees = heading?.let { (bearing - it + 360f) % 360f },
        )
    }

    private fun round3(value: Double): Double = kotlin.math.round(value * 1_000.0) / 1_000.0

    companion object {
        private const val UNDO_WINDOW_MS = 6_000L
        private const val RAPID_WINDOW_MINUTES = 5L
    }
}

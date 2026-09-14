package com.tomasmach.na_pivo.wear.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.tomasmach.na_pivo.wear.domain.PersistedState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private val Context.wearDataStore by preferencesDataStore(name = "na_pivo_wear_state")

class WearStateStore(context: Context) {
    private val dataStore = context.applicationContext.wearDataStore
    private val mutationMutex = Mutex()

    val states: Flow<PersistedState> = dataStore.data.map { preferences ->
        preferences[STATE_KEY]
            ?.let { encoded -> runCatching { JsonCodec.decodeState(encoded) }.getOrNull() }
            ?: PersistedState.fresh()
    }

    suspend fun initialize(): PersistedState = update { current ->
        if (current.initialized) {
            current to current
        } else {
            val initialized = current.copy(initialized = true)
            initialized to initialized
        }
    }

    suspend fun read(): PersistedState = states.first()

    suspend fun <T> update(
        transform: (PersistedState) -> Pair<PersistedState, T>,
    ): T = mutationMutex.withLock {
        var result: T? = null
        dataStore.edit { preferences ->
            val current = preferences[STATE_KEY]
                ?.let { encoded -> runCatching { JsonCodec.decodeState(encoded) }.getOrNull() }
                ?: PersistedState.fresh()
            val (next, transformedResult) = transform(current)
            preferences[STATE_KEY] = JsonCodec.encodeState(next)
            result = transformedResult
        }
        @Suppress("UNCHECKED_CAST")
        result as T
    }

    companion object {
        private val STATE_KEY = stringPreferencesKey("state.v1")
    }
}

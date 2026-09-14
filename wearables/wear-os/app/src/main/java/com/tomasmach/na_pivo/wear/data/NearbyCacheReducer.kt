package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.TargetState

internal fun reduceNearbyCache(
    current: PersistedState,
    pubs: List<PubRef>,
    fetchedAt: String,
): PersistedState {
    val nearbyPubs = pubs.distinctBy { it.pubKey }.take(10)
    val target = when (current.target?.selection) {
        TargetSelection.MANUAL -> current.target
        TargetSelection.NEAREST, null ->
            nearbyPubs.firstOrNull()?.let {
                TargetState(TargetSelection.NEAREST, it)
            }
    }
    return current.copy(
        target = target,
        nearbyPubs = nearbyPubs,
        nearbyFetchedAt = fetchedAt,
        isStale = false,
    )
}

internal fun reduceNearbyOffline(current: PersistedState): PersistedState =
    current.copy(isStale = true)

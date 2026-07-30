package com.tomasmach.na_pivo.wear.data

internal class NearbyRefreshGate(
    private val retryCooldownMillis: Long = DEFAULT_RETRY_COOLDOWN_MILLIS,
) {
    private var lastCell: String? = null
    private var lastAttemptAtMillis: Long? = null
    private var retryRequired = false

    fun startAttempt(
        cell: String,
        hasCachedPubs: Boolean,
        nowMillis: Long,
    ): Boolean {
        if (cell == lastCell) {
            if (hasCachedPubs && !retryRequired) return false

            val lastAttempt = lastAttemptAtMillis
            if (lastAttempt != null && nowMillis - lastAttempt < retryCooldownMillis) {
                return false
            }
        }

        lastCell = cell
        lastAttemptAtMillis = nowMillis
        return true
    }

    fun finishAttempt(retryRequired: Boolean) {
        this.retryRequired = retryRequired
    }

    companion object {
        const val DEFAULT_RETRY_COOLDOWN_MILLIS = 30_000L
    }
}

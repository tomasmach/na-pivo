package com.tomasmach.na_pivo.wear.data

class RapidWriteGuard(private val windowMs: Long) {
    private var lastAcceptedElapsedMs: Long? = null

    @Synchronized
    fun tryAcquire(elapsedMs: Long): Boolean {
        val previous = lastAcceptedElapsedMs
        if (previous != null && elapsedMs - previous < windowMs) return false
        lastAcceptedElapsedMs = elapsedMs
        return true
    }

    @Synchronized
    fun release(elapsedMs: Long) {
        if (lastAcceptedElapsedMs == elapsedMs) lastAcceptedElapsedMs = null
    }
}

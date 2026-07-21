package com.napivo.beerliveactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.max

internal object BeerLiveActivityNotification {
  const val ACTION_DISMISSED = "com.napivo.beerliveactivity.DISMISSED"
  const val ACTION_ADD_BEER = "com.napivo.beerliveactivity.ADD_BEER"
  const val EXTRA_SESSION_ID = "sessionId"

  private const val CHANNEL_ID = "beer_live_activity_v1"
  private const val NOTIFICATION_ID = 2401
  private const val PREFERENCES_NAME = "beer_live_activity"
  private const val ACTIVE_SESSION_KEY = "activeSessionId"
  private const val DISMISSED_SESSION_KEY = "dismissedSessionId"
  private const val BEER_COUNT_KEY = "beerCount"
  private const val PUB_NAME_KEY = "pubName"
  private const val TOTAL_PRICE_KEY = "totalPrice"
  private const val LATEST_BEER_NAME_KEY = "latestBeerName"
  private const val PENDING_ADDS_KEY = "pendingAdds"
  private const val FLAG_PROMOTED_ONGOING = 0x00040000
  private const val AMBER = 0xFFFFB300.toInt()

  @Synchronized
  fun startOrUpdate(context: Context, payload: BeerLiveActivityPayload): Map<String, Any?> {
    validate(payload)

    val preferences = preferences(context)
    val dismissedSessionId = preferences.getString(DISMISSED_SESSION_KEY, null)
    if (dismissedSessionId == payload.sessionId) {
      return getStatus(context)
    }

    if (preferences.getString(ACTIVE_SESSION_KEY, null) != payload.sessionId) {
      preferences.edit().remove(DISMISSED_SESSION_KEY).apply()
    }

    val notificationManager = NotificationManagerCompat.from(context)
    if (!notificationManager.areNotificationsEnabled()) {
      return getStatus(context)
    }

    createChannel(context)
    val storedCount = preferences.getInt(BEER_COUNT_KEY, 0)
    val hasUnacknowledgedAdds = getPendingAdds(context).any { it["sessionId"] == payload.sessionId }
    val preserveNativeCount =
      preferences.getString(ACTIVE_SESSION_KEY, null) == payload.sessionId &&
        hasUnacknowledgedAdds &&
        payload.beerCount < storedCount
    val state = NotificationState(
      sessionId = payload.sessionId,
      pubName = payload.pubName,
      beerCount = if (preserveNativeCount) storedCount else payload.beerCount,
      totalPrice = if (preserveNativeCount) "" else payload.totalPrice,
      latestBeerName = payload.latestBeerName
    )
    persistState(context, state)
    notificationManager.notify(NOTIFICATION_ID, buildNotification(context, state))
    return getStatus(context)
  }

  @Synchronized
  fun end(context: Context): Map<String, Any?> {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    preferences(context).edit()
      .remove(ACTIVE_SESSION_KEY)
      .remove(DISMISSED_SESSION_KEY)
      .remove(BEER_COUNT_KEY)
      .remove(PUB_NAME_KEY)
      .remove(TOTAL_PRICE_KEY)
      .remove(LATEST_BEER_NAME_KEY)
      .apply()
    return getStatus(context)
  }

  @Synchronized
  fun markDismissed(context: Context, sessionId: String) {
    val preferences = preferences(context)
    if (preferences.getString(ACTIVE_SESSION_KEY, null) != sessionId) return

    preferences.edit()
      .remove(ACTIVE_SESSION_KEY)
      .putString(DISMISSED_SESSION_KEY, sessionId)
      .apply()
  }

  @Synchronized
  fun addBeer(context: Context, sessionId: String) {
    val preferences = preferences(context)
    if (preferences.getString(ACTIVE_SESSION_KEY, null) != sessionId) return
    if (activeNotification(context) == null) return

    val state = readState(context) ?: return
    if (state.beerCount == Int.MAX_VALUE) return
    val pendingAdds = readPendingAdds(context).toMutableList()
    pendingAdds += PendingAdd(
      id = UUID.randomUUID().toString(),
      sessionId = sessionId,
      createdAt = System.currentTimeMillis()
    )
    val updatedState = state.copy(
      beerCount = state.beerCount + 1,
      // The native action does not know the selected beer's price. Hide the
      // now-stale total until JS applies the event and publishes fresh data.
      totalPrice = ""
    )

    val stored = preferences.edit()
      .putString(PENDING_ADDS_KEY, serializePendingAdds(pendingAdds))
      .putInt(BEER_COUNT_KEY, updatedState.beerCount)
      .putString(TOTAL_PRICE_KEY, updatedState.totalPrice)
      .commit()
    if (!stored) return

    NotificationManagerCompat.from(context).notify(
      NOTIFICATION_ID,
      buildNotification(context, updatedState)
    )
  }

  @Synchronized
  fun getPendingAdds(context: Context): List<Map<String, Any>> =
    readPendingAdds(context).map { pendingAdd ->
      mapOf(
        "id" to pendingAdd.id,
        "sessionId" to pendingAdd.sessionId,
        "createdAt" to pendingAdd.createdAt
      )
    }

  @Synchronized
  fun ackPendingAdds(context: Context, ids: List<String>) {
    if (ids.isEmpty()) return
    val acknowledged = ids.toSet()
    val remaining = readPendingAdds(context).filterNot { it.id in acknowledged }
    val acknowledgedOnDisk = preferences(context).edit()
      .putString(PENDING_ADDS_KEY, serializePendingAdds(remaining))
      .commit()
    check(acknowledgedOnDisk) { "Could not acknowledge pending beer additions" }
  }

  fun getStatus(context: Context): Map<String, Any?> {
    val manager = NotificationManagerCompat.from(context)
    val activeNotification = activeNotification(context)
    val preferences = preferences(context)
    val activeSessionId = preferences.getString(ACTIVE_SESSION_KEY, null)
    val dismissedSessionId = preferences.getString(DISMISSED_SESSION_KEY, null)
    val active = activeNotification != null
    val promoted = activeNotification?.let {
      (it.flags and FLAG_PROMOTED_ONGOING) != 0
    } ?: false

    // AndroidX performs the exact platform/app-op check and returns false on
    // Android versions that do not implement promoted ongoing notifications.
    val liveUpdatesAllowed = manager.canPostPromotedNotifications()
    return mapOf(
      "active" to active,
      "dismissed" to (!active && dismissedSessionId != null),
      "sessionId" to if (active) activeSessionId else dismissedSessionId,
      "notificationsEnabled" to manager.areNotificationsEnabled(),
      "liveUpdatesSupported" to (Build.VERSION.SDK_INT >= 36),
      "liveUpdatesAllowed" to liveUpdatesAllowed,
      "presentation" to when {
        promoted -> "live-update"
        active -> "notification"
        else -> "none"
      }
    )
  }

  private fun buildNotification(
    context: Context,
    state: NotificationState
  ): Notification {
    val countLabel = beerCountLabel(state.beerCount)
    val detail = notificationDetail(state)
    val progressStyle = NotificationCompat.ProgressStyle()
      .setProgressIndeterminate(true)
      .addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(100).setColor(AMBER)
      )

    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.beer_live_activity_notification)
      .setColor(AMBER)
      .setContentTitle(countLabel)
      .setContentText(detail)
      .setSubText(state.latestBeerName.trim().takeIf { it.isNotEmpty() }?.take(80)?.let {
        "Naposledy: $it"
      } ?: "Na pivo")
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setShowWhen(false)
      .setShortCriticalText(shortCountLabel(state.beerCount))
      .setStyle(progressStyle)
      .setContentIntent(contentIntent(context))
      .setDeleteIntent(deleteIntent(context, state.sessionId))
      .addAction(
        NotificationCompat.Action.Builder(
          R.drawable.beer_live_activity_notification,
          "+ pivo",
          addBeerIntent(context, state.sessionId)
        ).build()
      )
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setOngoing(true)
      .setAutoCancel(false)
      .setRequestPromotedOngoing(true)
      .build()
  }

  private fun contentIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("napivo://beer"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      NOTIFICATION_ID,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun deleteIntent(context: Context, sessionId: String): PendingIntent {
    val intent = Intent(context, BeerLiveActivityActionReceiver::class.java)
      .setAction(ACTION_DISMISSED)
      .putExtra(EXTRA_SESSION_ID, sessionId)
    return PendingIntent.getBroadcast(
      context,
      NOTIFICATION_ID,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun addBeerIntent(context: Context, sessionId: String): PendingIntent {
    val intent = Intent(context, BeerLiveActivityActionReceiver::class.java)
      .setAction(ACTION_ADD_BEER)
      .putExtra(EXTRA_SESSION_ID, sessionId)
    return PendingIntent.getBroadcast(
      context,
      NOTIFICATION_ID + 1,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun createChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Počítání piv",
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = "Průběžný počet piv během večera"
      enableVibration(false)
      setSound(null, null)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
  }

  private fun activeNotification(context: Context): Notification? {
    val manager = context.getSystemService(NotificationManager::class.java)
    return try {
      manager.activeNotifications
        .firstOrNull { it.id == NOTIFICATION_ID }
        ?.notification
    } catch (_: SecurityException) {
      null
    }
  }

  private fun notificationDetail(state: NotificationState): String {
    val pubName = state.pubName.trim().takeIf { it.isNotEmpty() }?.take(80)
    val price = state.totalPrice.trim().takeIf { it.isNotEmpty() }?.take(40)
    return listOfNotNull(pubName, price).joinToString(" • ").ifEmpty { "Večer běží" }
  }

  private fun persistState(context: Context, state: NotificationState) {
    val stored = preferences(context).edit()
      .putString(ACTIVE_SESSION_KEY, state.sessionId)
      .putInt(BEER_COUNT_KEY, state.beerCount)
      .putString(PUB_NAME_KEY, state.pubName)
      .putString(TOTAL_PRICE_KEY, state.totalPrice)
      .putString(LATEST_BEER_NAME_KEY, state.latestBeerName)
      .commit()
    check(stored) { "Could not persist beer live activity state" }
  }

  private fun readState(context: Context): NotificationState? {
    val preferences = preferences(context)
    val sessionId = preferences.getString(ACTIVE_SESSION_KEY, null)
      ?.takeIf { it.isNotBlank() }
      ?: return null
    return NotificationState(
      sessionId = sessionId,
      pubName = preferences.getString(PUB_NAME_KEY, "").orEmpty(),
      beerCount = preferences.getInt(BEER_COUNT_KEY, 0),
      totalPrice = preferences.getString(TOTAL_PRICE_KEY, "").orEmpty(),
      latestBeerName = preferences.getString(LATEST_BEER_NAME_KEY, "").orEmpty()
    )
  }

  private fun readPendingAdds(context: Context): List<PendingAdd> {
    val raw = preferences(context).getString(PENDING_ADDS_KEY, null) ?: return emptyList()
    return try {
      val json = JSONArray(raw)
      buildList {
        for (index in 0 until json.length()) {
          val item = json.optJSONObject(index) ?: continue
          val id = item.optString("id").takeIf { it.isNotBlank() } ?: continue
          val sessionId = item.optString("sessionId").takeIf { it.isNotBlank() } ?: continue
          val createdAt = item.optLong("createdAt", 0L).takeIf { it > 0L } ?: continue
          add(PendingAdd(id, sessionId, createdAt))
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun serializePendingAdds(pendingAdds: List<PendingAdd>): String {
    val json = JSONArray()
    pendingAdds.forEach { pendingAdd ->
      json.put(
        JSONObject()
          .put("id", pendingAdd.id)
          .put("sessionId", pendingAdd.sessionId)
          .put("createdAt", pendingAdd.createdAt)
      )
    }
    return json.toString()
  }

  private fun beerCountLabel(count: Int): String = when (count) {
    1 -> "1 pivo"
    in 2..4 -> "$count piva"
    else -> "$count piv"
  }

  private fun shortCountLabel(count: Int): String {
    val label = beerCountLabel(count)
    return if (label.length <= 7) label else max(count, 0).toString()
  }

  private fun validate(payload: BeerLiveActivityPayload) {
    require(payload.sessionId.isNotBlank()) { "sessionId must not be blank" }
    require(payload.beerCount >= 0) { "beerCount must be non-negative" }
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  private data class NotificationState(
    val sessionId: String,
    val pubName: String,
    val beerCount: Int,
    val totalPrice: String,
    val latestBeerName: String
  )

  private data class PendingAdd(
    val id: String,
    val sessionId: String,
    val createdAt: Long
  )
}

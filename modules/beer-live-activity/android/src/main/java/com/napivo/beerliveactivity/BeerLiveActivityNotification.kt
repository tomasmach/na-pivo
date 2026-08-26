package com.napivo.beerliveactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

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
  private const val REPEAT_BEER_NAME_KEY = "repeatBeerName"
  private const val REPEAT_BEER_PRICE_CZK_KEY = "repeatBeerPriceCzk"
  private const val REPEAT_BEER_VOLUME_ML_KEY = "repeatBeerVolumeMl"
  private const val REPEAT_BEER_SERVING_TYPE_KEY = "repeatBeerServingType"
  private const val PENDING_ADDS_KEY = "pendingAdds"
  private const val FLAG_PROMOTED_ONGOING = 0x00040000
  // Warm taproom palette mirrored from the iOS Live Activity: a glowing amber
  // tally on a dark, toasted-malt surface.
  private const val AMBER = 0xFFFFB84D.toInt()
  private const val AMBER_TRACK = 0x30FFB84D
  private const val TILE_SURFACE = 0xFF2E1C0D.toInt()
  // The progress track fills like a glass over the course of an evening. A full
  // bar reads as "a proper night out" rather than a hard limit on counting.
  private const val PROGRESS_TOTAL = 100
  private const val PROGRESS_BEER_CAP = 10

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
      latestBeerName = payload.latestBeerName,
      repeatBeerName = payload.repeatBeerName,
      repeatBeerPriceCzk = payload.repeatBeerPriceCzk,
      repeatBeerVolumeMl = payload.repeatBeerVolumeMl,
      repeatBeerServingType = payload.repeatBeerServingType
    )
    persistState(context, state)
    notificationManager.notify(NOTIFICATION_ID, buildNotification(context, state))
    return getStatus(context)
  }

  @Synchronized
  fun end(context: Context): Map<String, Any?> {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    val cleared = preferences(context).edit()
      .remove(ACTIVE_SESSION_KEY)
      .remove(DISMISSED_SESSION_KEY)
      .remove(BEER_COUNT_KEY)
      .remove(PUB_NAME_KEY)
      .remove(TOTAL_PRICE_KEY)
      .remove(LATEST_BEER_NAME_KEY)
      .remove(REPEAT_BEER_NAME_KEY)
      .remove(REPEAT_BEER_PRICE_CZK_KEY)
      .remove(REPEAT_BEER_VOLUME_ML_KEY)
      .remove(REPEAT_BEER_SERVING_TYPE_KEY)
      // Account-boundary callers must never leave an action from the previous
      // session for the next account to reconcile. This synchronized commit is
      // atomic with addBeer() and ackPendingAdds().
      .remove(PENDING_ADDS_KEY)
      .commit()
    check(cleared) { "Could not clear beer live activity state" }
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
      createdAt = System.currentTimeMillis(),
      beerName = state.repeatBeerName,
      priceCzk = state.repeatBeerPriceCzk,
      volumeMl = state.repeatBeerVolumeMl,
      servingType = state.repeatBeerServingType
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
    BeerCountReminderRescheduler.reschedule(context, sessionId)
  }

  @Synchronized
  fun getPendingAdds(context: Context): List<Map<String, Any>> =
    readPendingAdds(context).map { pendingAdd ->
      buildMap {
        put("id", pendingAdd.id)
        put("sessionId", pendingAdd.sessionId)
        put("createdAt", pendingAdd.createdAt)
        pendingAdd.beerName?.let { put("beerName", it) }
        pendingAdd.priceCzk?.let { put("priceCzk", it) }
        pendingAdd.volumeMl?.let { put("volumeMl", it) }
        pendingAdd.servingType?.let { put("servingType", it) }
      }
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

  @Synchronized
  fun clearPendingAdds(context: Context) {
    val cleared = preferences(context).edit()
      .remove(PENDING_ADDS_KEY)
      .commit()
    check(cleared) { "Could not clear pending beer additions" }
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
    val detail = notificationDetail(context, state)
    // A golden glass that fills as the evening goes on: a solid amber run over a
    // faint amber remainder, so every added beer visibly extends the fill. No
    // tracker icon: a small white mug badge reads as a stray square at this size.
    val filled = progressFill(state.beerCount)
    val progressStyle = NotificationCompat.ProgressStyle()
      .setProgress(filled)
      .addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(filled).setColor(AMBER)
      )
    if (filled < PROGRESS_TOTAL) {
      progressStyle.addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(PROGRESS_TOTAL - filled).setColor(AMBER_TRACK)
      )
    }

    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.beer_live_activity_notification)
      .setColor(AMBER)
      .setLargeIcon(buildLargeIcon(context))
      .setContentTitle(
        state.pubName.trim().takeIf { it.isNotEmpty() }?.take(80)
          ?: beerCountLabel(context, state.beerCount)
      )
      .setContentText(detail)
      .setSubText(
        state.totalPrice.trim().takeIf { it.isNotEmpty() }
          ?.let { context.getString(R.string.beer_live_activity_total_prefix, it.take(34)) }
          ?: context.getString(R.string.beer_live_activity_night_running)
      )
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setShowWhen(false)
      .setShortCriticalText(shortCountLabel(context, state.beerCount))
      .setStyle(progressStyle)
      .setContentIntent(contentIntent(context))
      .setDeleteIntent(deleteIntent(context, state.sessionId))
      .addAction(
        NotificationCompat.Action.Builder(
          R.drawable.beer_live_activity_add,
          context.getString(R.string.beer_live_activity_add_beer_action),
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
    // Re-creating the channel with the same id refreshes the name and
    // description the system has cached, so a locale switch takes effect.
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.beer_live_activity_channel_name),
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = context.getString(R.string.beer_live_activity_channel_description)
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

  private fun notificationDetail(context: Context, state: NotificationState): String {
    val countLabel = beerCountLabel(context, state.beerCount)
    val latestBeer = state.latestBeerName.trim().takeIf { it.isNotEmpty() }?.take(80)
    return listOfNotNull(countLabel, latestBeer).joinToString(" · ")
  }

  /**
   * Maps the beer count onto the progress track. Clamped to a soft cap so the
   * bar keeps a visible fill from the very first beer and tops out gracefully on
   * a big night instead of implying a hard limit.
   */
  private fun progressFill(beerCount: Int): Int {
    val capped = min(max(beerCount, 1), PROGRESS_BEER_CAP).toFloat() / PROGRESS_BEER_CAP
    return (capped * PROGRESS_TOTAL).roundToInt().coerceIn(8, PROGRESS_TOTAL)
  }

  /**
   * Renders the branded icon tile shown as the notification's large icon: a warm
   * toasted-malt square with a glowing amber mug, echoing the iOS Live Activity's
   * fallback badge so both platforms read as the same product.
   */
  private fun buildLargeIcon(context: Context): Bitmap {
    val size = (context.resources.displayMetrics.density * 56f).roundToInt().coerceAtLeast(96)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val radius = size * 0.28f
    val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TILE_SURFACE }
    canvas.drawRoundRect(0f, 0f, size.toFloat(), size.toFloat(), radius, radius, backgroundPaint)
    ContextCompat.getDrawable(context, R.drawable.beer_live_activity_notification)?.mutate()?.apply {
      setTint(AMBER)
      val inset = (size * 0.27f).roundToInt()
      setBounds(inset, inset, size - inset, size - inset)
      draw(canvas)
    }
    return bitmap
  }

  private fun persistState(context: Context, state: NotificationState) {
    val editor = preferences(context).edit()
      .putString(ACTIVE_SESSION_KEY, state.sessionId)
      .putInt(BEER_COUNT_KEY, state.beerCount)
      .putString(PUB_NAME_KEY, state.pubName)
      .putString(TOTAL_PRICE_KEY, state.totalPrice)
      .putString(LATEST_BEER_NAME_KEY, state.latestBeerName)
      .putString(REPEAT_BEER_NAME_KEY, state.repeatBeerName)
    state.repeatBeerPriceCzk?.let {
      editor.putLong(REPEAT_BEER_PRICE_CZK_KEY, java.lang.Double.doubleToRawLongBits(it))
    } ?: editor.remove(REPEAT_BEER_PRICE_CZK_KEY)
    state.repeatBeerVolumeMl?.let {
      editor.putInt(REPEAT_BEER_VOLUME_ML_KEY, it)
    } ?: editor.remove(REPEAT_BEER_VOLUME_ML_KEY)
    state.repeatBeerServingType?.let {
      editor.putString(REPEAT_BEER_SERVING_TYPE_KEY, it)
    } ?: editor.remove(REPEAT_BEER_SERVING_TYPE_KEY)
    val stored = editor.commit()
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
      latestBeerName = preferences.getString(LATEST_BEER_NAME_KEY, "").orEmpty(),
      repeatBeerName = preferences.getString(REPEAT_BEER_NAME_KEY, "").orEmpty(),
      repeatBeerPriceCzk =
        if (preferences.contains(REPEAT_BEER_PRICE_CZK_KEY)) {
          java.lang.Double.longBitsToDouble(preferences.getLong(REPEAT_BEER_PRICE_CZK_KEY, 0L))
        } else {
          null
        },
      repeatBeerVolumeMl =
        if (preferences.contains(REPEAT_BEER_VOLUME_ML_KEY)) {
          preferences.getInt(REPEAT_BEER_VOLUME_ML_KEY, 0)
        } else {
          null
        },
      repeatBeerServingType = preferences.getString(REPEAT_BEER_SERVING_TYPE_KEY, null)
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
          val beerName = item.optString("beerName").takeIf { it.isNotBlank() }
          val priceCzk =
            if (item.has("priceCzk") && !item.isNull("priceCzk")) item.optDouble("priceCzk") else null
          val volumeMl =
            if (item.has("volumeMl") && !item.isNull("volumeMl")) item.optInt("volumeMl") else null
          val servingType = item.optString("servingType").takeIf { it.isNotBlank() }
          add(PendingAdd(id, sessionId, createdAt, beerName, priceCzk, volumeMl, servingType))
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
          .apply {
            pendingAdd.beerName?.let { put("beerName", it) }
            pendingAdd.priceCzk?.let { put("priceCzk", it) }
            pendingAdd.volumeMl?.let { put("volumeMl", it) }
            pendingAdd.servingType?.let { put("servingType", it) }
          }
      )
    }
    return json.toString()
  }

  private fun beerCountLabel(context: Context, count: Int): String =
    context.resources.getQuantityString(R.plurals.beer_live_activity_beer_count, count, count)

  private fun shortCountLabel(context: Context, count: Int): String {
    val label = beerCountLabel(context, count)
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
    val latestBeerName: String,
    val repeatBeerName: String,
    val repeatBeerPriceCzk: Double?,
    val repeatBeerVolumeMl: Int?,
    val repeatBeerServingType: String?
  )

  private data class PendingAdd(
    val id: String,
    val sessionId: String,
    val createdAt: Long,
    val beerName: String? = null,
    val priceCzk: Double? = null,
    val volumeMl: Int? = null,
    val servingType: String? = null
  )
}

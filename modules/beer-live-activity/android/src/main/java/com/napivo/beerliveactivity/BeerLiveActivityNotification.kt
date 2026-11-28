package com.napivo.beerliveactivity

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.res.ResourcesCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.ceil

internal object BeerLiveActivityNotification {
  const val ACTION_DISMISSED = "com.napivo.beerliveactivity.DISMISSED"
  const val ACTION_ADD_BEER = "com.napivo.beerliveactivity.ADD_BEER"
  const val ACTION_TRANSIT_LEFT = "com.napivo.beerliveactivity.TRANSIT_LEFT"
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
  private const val LATEST_BEER_LABEL_KEY = "latestBeerLabel"
  private const val LATEST_TIME_LABEL_KEY = "latestTimeLabel"
  private const val LATEST_TIME_TEMPLATE_KEY = "latestTimeTemplate"
  private const val REPEAT_BEER_NAME_KEY = "repeatBeerName"
  private const val REPEAT_BEER_PRICE_CZK_KEY = "repeatBeerPriceCzk"
  private const val REPEAT_BEER_VOLUME_ML_KEY = "repeatBeerVolumeMl"
  private const val REPEAT_BEER_SERVING_TYPE_KEY = "repeatBeerServingType"
  private const val PENDING_ADDS_KEY = "pendingAdds"
  private const val LOCALE_KEY = "locale"
  private const val HOME_TRANSIT_LABEL_KEY = "homeTransitLabel"
  private const val HOME_TRANSIT_DEPARTS_AT_KEY = "homeTransitDepartsAtMs"
  private const val HOME_TRANSIT_MISSED_KEY = "homeTransitMissedLabel"
  private const val FLAG_PROMOTED_ONGOING = 0x00040000
  private const val YELLOW = 0xFFFFC400.toInt()
  private const val YELLOW_TRACK = 0x52FFC400
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

    createChannel(context, payload.locale)
    val storedCount = preferences.getInt(BEER_COUNT_KEY, 0)
    val hasUnacknowledgedAdds = getPendingAdds(context).any { it["sessionId"] == payload.sessionId }
    val preserveNativeCount =
      preferences.getString(ACTIVE_SESSION_KEY, null) == payload.sessionId &&
        hasUnacknowledgedAdds &&
        payload.beerCount < storedCount
    val latestTimeLabel =
      if (preserveNativeCount) readState(context)?.latestTimeLabel ?: payload.latestTimeLabel
      else payload.latestTimeLabel
    val state = NotificationState(
      sessionId = payload.sessionId,
      pubName = payload.pubName,
      beerCount = if (preserveNativeCount) storedCount else payload.beerCount,
      totalPrice = if (preserveNativeCount) "" else payload.totalPrice,
      latestBeerName = payload.latestBeerName,
      latestBeerLabel = payload.latestBeerLabel,
      latestTimeLabel = latestTimeLabel,
      latestTimeTemplate = payload.latestTimeTemplate,
      repeatBeerName = payload.repeatBeerName,
      repeatBeerPriceCzk = payload.repeatBeerPriceCzk,
      repeatBeerVolumeMl = payload.repeatBeerVolumeMl,
      repeatBeerServingType = payload.repeatBeerServingType,
      locale = payload.locale,
      homeTransitLabel = payload.homeTransitLabel,
      homeTransitDepartsAtMs = payload.homeTransitDepartsAtMs?.toLong(),
      homeTransitMissedLabel = payload.homeTransitMissedLabel
    )
    persistState(context, state)
    notificationManager.notify(NOTIFICATION_ID, buildNotification(context, state))
    scheduleTransitExpiry(context, state)
    return getStatus(context)
  }

  /** Redraws without the ride home once it left, even while the app sleeps. */
  @Synchronized
  fun dropDepartedTransit(context: Context, sessionId: String) {
    if (preferences(context).getString(ACTIVE_SESSION_KEY, null) != sessionId) return
    if (activeNotification(context) == null) return
    val state = readState(context) ?: return
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, buildNotification(context, state))
  }

  @Synchronized
  fun end(context: Context): Map<String, Any?> {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    context.getSystemService(AlarmManager::class.java)?.cancel(transitExpiryIntent(context, ""))
    preferences(context).edit()
      .remove(ACTIVE_SESSION_KEY)
      .remove(DISMISSED_SESSION_KEY)
      .remove(BEER_COUNT_KEY)
      .remove(PUB_NAME_KEY)
      .remove(TOTAL_PRICE_KEY)
      .remove(LATEST_BEER_NAME_KEY)
      .remove(LATEST_BEER_LABEL_KEY)
      .remove(LATEST_TIME_LABEL_KEY)
      .remove(LATEST_TIME_TEMPLATE_KEY)
      .remove(REPEAT_BEER_NAME_KEY)
      .remove(REPEAT_BEER_PRICE_CZK_KEY)
      .remove(REPEAT_BEER_VOLUME_ML_KEY)
      .remove(REPEAT_BEER_SERVING_TYPE_KEY)
      .remove(HOME_TRANSIT_LABEL_KEY)
      .remove(HOME_TRANSIT_DEPARTS_AT_KEY)
      .remove(HOME_TRANSIT_MISSED_KEY)
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
      totalPrice = "",
      latestTimeLabel = state.latestTimeTemplate.takeIf { it.contains("{time}") }
        ?.replace("{time}", wallClock(state.locale, System.currentTimeMillis()))
        ?: state.latestTimeLabel
    )

    val stored = preferences.edit()
      .putString(PENDING_ADDS_KEY, serializePendingAdds(pendingAdds))
      .putInt(BEER_COUNT_KEY, updatedState.beerCount)
      .putString(TOTAL_PRICE_KEY, updatedState.totalPrice)
      .putString(LATEST_TIME_LABEL_KEY, updatedState.latestTimeLabel)
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
    val strings = Strings.forLocale(state.locale)
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.beer_live_activity_notification)
      .setColor(YELLOW)
      .setContentTitle(
        state.pubName.trim().takeIf { it.isNotEmpty() }?.take(80)
          ?: strings.beerCount(state.beerCount)
      )
      .setContentText(notificationDetail(strings, state))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setShowWhen(false)
      .setContentIntent(contentIntent(context))
      .setDeleteIntent(deleteIntent(context, state.sessionId))
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setOngoing(true)
      .setAutoCancel(false)

    // Android shows a Live Update (status bar chip, full card on a compact lock
    // screen) only for its own templates, so the custom card is the fallback
    // wherever the system or the user does not allow one.
    if (!NotificationManagerCompat.from(context).canPostPromotedNotifications()) {
      return builder
        .setSubText(strings.nightRunning)
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(card(context, state, strings, expanded = false))
        .setCustomBigContentView(card(context, state, strings, expanded = true))
        .setCategory(NotificationCompat.CATEGORY_STATUS)
        .build()
    }

    val filled = progressFill(state.beerCount)
    val progressStyle = NotificationCompat.ProgressStyle()
      .setProgress(filled)
      .addProgressSegment(NotificationCompat.ProgressStyle.Segment(filled).setColor(YELLOW))
    if (filled < PROGRESS_TOTAL) {
      progressStyle.addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(PROGRESS_TOTAL - filled).setColor(YELLOW_TRACK)
      )
    }
    return builder
      .setSubText(state.totalPrice.trim().take(34).ifEmpty { strings.nightRunning })
      .setStyle(progressStyle)
      .setShortCriticalText(shortCountLabel(strings, state.beerCount))
      .addAction(
        NotificationCompat.Action.Builder(
          R.drawable.beer_live_activity_add,
          strings.addBeer,
          addBeerIntent(context, state.sessionId)
        ).build()
      )
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setRequestPromotedOngoing(true)
      .build()
  }

  /** Fills like a glass over the evening and tops out at a soft cap instead of a limit. */
  private fun progressFill(beerCount: Int): Int {
    val capped = beerCount.coerceIn(1, PROGRESS_BEER_CAP).toFloat() / PROGRESS_BEER_CAP
    return (capped * PROGRESS_TOTAL).toInt().coerceIn(8, PROGRESS_TOTAL)
  }

  private fun shortCountLabel(strings: Strings, count: Int): String {
    val label = strings.beerCount(count)
    return if (label.length <= 7) label else count.coerceAtLeast(0).toString()
  }

  /** The iPhone Live Activity card: count, pub with total, latest beer, `+` and the ride home. */
  private fun card(
    context: Context,
    state: NotificationState,
    strings: Strings,
    expanded: Boolean
  ): RemoteViews {
    val views = RemoteViews(
      context.packageName,
      if (expanded) R.layout.beer_live_activity_expanded else R.layout.beer_live_activity_collapsed
    )
    val count = state.beerCount.coerceAtLeast(0)
    views.setImageViewBitmap(R.id.beer_live_activity_count, numeral(context, count.toString()))
    views.setContentDescription(R.id.beer_live_activity_count, strings.beerCount(count))
    views.setTextViewText(
      R.id.beer_live_activity_pub,
      state.pubName.trim().take(80).ifEmpty { strings.beerCount(count) }
    )
    val price = state.totalPrice.trim().take(34)
    views.setTextViewText(R.id.beer_live_activity_price, price)
    views.setViewVisibility(R.id.beer_live_activity_price, if (price.isEmpty()) View.GONE else View.VISIBLE)
    views.setTextViewText(R.id.beer_live_activity_latest, latestLine(state))
    views.setContentDescription(R.id.beer_live_activity_add, strings.addBeerA11y)
    views.setOnClickPendingIntent(R.id.beer_live_activity_add, addBeerIntent(context, state.sessionId))
    if (!expanded) return views

    views.setTextViewText(R.id.beer_live_activity_word, strings.beerWord(count))
    views.setTextViewText(R.id.beer_live_activity_add_label, strings.addBeer)

    val departsAt = homeTransitDepartsAt(state)
    val missed = state.homeTransitMissedLabel.trim().take(80)
    when {
      departsAt != null -> {
        views.setViewVisibility(R.id.beer_live_activity_transit, View.VISIBLE)
        views.setTextViewText(R.id.beer_live_activity_transit_label, state.homeTransitLabel.trim().take(80))
        views.setTextViewText(R.id.beer_live_activity_transit_prefix, strings.transitIn)
        views.setViewVisibility(R.id.beer_live_activity_transit_prefix, View.VISIBLE)
        views.setViewVisibility(R.id.beer_live_activity_transit_countdown, View.VISIBLE)
        views.setChronometer(
          R.id.beer_live_activity_transit_countdown,
          SystemClock.elapsedRealtime() + (departsAt - System.currentTimeMillis()),
          null,
          true
        )
        views.setChronometerCountDown(R.id.beer_live_activity_transit_countdown, true)
      }
      missed.isNotEmpty() -> {
        views.setViewVisibility(R.id.beer_live_activity_transit, View.VISIBLE)
        views.setTextViewText(R.id.beer_live_activity_transit_label, missed)
        views.setViewVisibility(R.id.beer_live_activity_transit_prefix, View.GONE)
        views.setViewVisibility(R.id.beer_live_activity_transit_countdown, View.GONE)
      }
      else -> views.setViewVisibility(R.id.beer_live_activity_transit, View.GONE)
    }
    return views
  }

  /**
   * Notifications cannot use the app's fonts, so the Sofia numeral travels as
   * a white glyph that the layout tints for the light or dark system surface.
   */
  private fun numeral(context: Context, text: String): Bitmap {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = ResourcesCompat.getFont(context, R.font.beer_live_activity_numeral) ?: Typeface.DEFAULT_BOLD
      textSize = context.resources.displayMetrics.density * 96f
      color = Color.WHITE
      letterSpacing = -0.02f
    }
    val bounds = Rect()
    paint.getTextBounds(text, 0, text.length, bounds)
    val width = ceil(paint.measureText(text)).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, bounds.height().coerceAtLeast(1), Bitmap.Config.ALPHA_8)
    Canvas(bitmap).drawText(text, 0f, -bounds.top.toFloat(), paint)
    return bitmap
  }

  private fun latestLine(state: NotificationState): String {
    val beer = state.latestBeerLabel.trim().ifEmpty { state.latestBeerName.trim() }.take(80)
    return listOf(beer, state.latestTimeLabel.trim().take(40))
      .filter { it.isNotEmpty() }
      .joinToString(" · ")
  }

  private fun wallClock(locale: String, epochMs: Long): String =
    DateFormat.getTimeInstance(DateFormat.SHORT, Locale.forLanguageTag(locale)).format(Date(epochMs))

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

  /**
   * Redraws the ride as departed. Allowed in Doze and needs no exact-alarm
   * permission; Android may still deliver it a few minutes late, and the
   * departure time stays in the text meanwhile.
   */
  private fun scheduleTransitExpiry(context: Context, state: NotificationState) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val departsAt = homeTransitDepartsAt(state)
    if (departsAt == null) {
      alarms.cancel(transitExpiryIntent(context, state.sessionId))
      return
    }
    alarms.setAndAllowWhileIdle(
      AlarmManager.RTC_WAKEUP,
      departsAt + 1_000L,
      transitExpiryIntent(context, state.sessionId)
    )
  }

  private fun transitExpiryIntent(context: Context, sessionId: String): PendingIntent {
    val intent = Intent(context, BeerLiveActivityActionReceiver::class.java)
      .setAction(ACTION_TRANSIT_LEFT)
      .putExtra(EXTRA_SESSION_ID, sessionId)
    return PendingIntent.getBroadcast(
      context,
      NOTIFICATION_ID + 2,
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

  private fun createChannel(context: Context, locale: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val strings = Strings.forLocale(locale)
    val manager = context.getSystemService(NotificationManager::class.java)
    // Re-creating the channel with the same id refreshes the name and
    // description the system has cached, so a language switch takes effect.
    val channel = NotificationChannel(
      CHANNEL_ID,
      strings.channelName,
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = strings.channelDescription
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

  private fun notificationDetail(strings: Strings, state: NotificationState): String {
    // The way home matters more than the latest beer once there is one, and
    // after it left the night bus is what is left.
    val second = state.homeTransitLabel.trim().takeIf { homeTransitDepartsAt(state) != null }?.take(80)
      ?: state.homeTransitMissedLabel.trim().takeIf { it.isNotEmpty() }?.take(80)
      ?: latestLine(state).takeIf { it.isNotEmpty() }
    return listOfNotNull(strings.beerCount(state.beerCount), second).joinToString(" · ")
  }

  /** The departure while it is still ahead and has a label to go with it. */
  private fun homeTransitDepartsAt(state: NotificationState): Long? =
    state.homeTransitDepartsAtMs?.takeIf {
      state.homeTransitLabel.isNotBlank() && it > System.currentTimeMillis()
    }

  private fun persistState(context: Context, state: NotificationState) {
    val editor = preferences(context).edit()
      .putString(ACTIVE_SESSION_KEY, state.sessionId)
      .putInt(BEER_COUNT_KEY, state.beerCount)
      .putString(PUB_NAME_KEY, state.pubName)
      .putString(TOTAL_PRICE_KEY, state.totalPrice)
      .putString(LATEST_BEER_NAME_KEY, state.latestBeerName)
      .putString(LATEST_BEER_LABEL_KEY, state.latestBeerLabel)
      .putString(LATEST_TIME_LABEL_KEY, state.latestTimeLabel)
      .putString(LATEST_TIME_TEMPLATE_KEY, state.latestTimeTemplate)
      .putString(REPEAT_BEER_NAME_KEY, state.repeatBeerName)
      .putString(LOCALE_KEY, state.locale)
      .putString(HOME_TRANSIT_LABEL_KEY, state.homeTransitLabel)
      .putString(HOME_TRANSIT_MISSED_KEY, state.homeTransitMissedLabel)
    state.repeatBeerPriceCzk?.let {
      editor.putLong(REPEAT_BEER_PRICE_CZK_KEY, java.lang.Double.doubleToRawLongBits(it))
    } ?: editor.remove(REPEAT_BEER_PRICE_CZK_KEY)
    state.repeatBeerVolumeMl?.let {
      editor.putInt(REPEAT_BEER_VOLUME_ML_KEY, it)
    } ?: editor.remove(REPEAT_BEER_VOLUME_ML_KEY)
    state.repeatBeerServingType?.let {
      editor.putString(REPEAT_BEER_SERVING_TYPE_KEY, it)
    } ?: editor.remove(REPEAT_BEER_SERVING_TYPE_KEY)
    state.homeTransitDepartsAtMs?.let {
      editor.putLong(HOME_TRANSIT_DEPARTS_AT_KEY, it)
    } ?: editor.remove(HOME_TRANSIT_DEPARTS_AT_KEY)
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
      latestBeerLabel = preferences.getString(LATEST_BEER_LABEL_KEY, "").orEmpty(),
      latestTimeLabel = preferences.getString(LATEST_TIME_LABEL_KEY, "").orEmpty(),
      latestTimeTemplate = preferences.getString(LATEST_TIME_TEMPLATE_KEY, "").orEmpty(),
      repeatBeerName = preferences.getString(REPEAT_BEER_NAME_KEY, "").orEmpty(),
      locale = preferences.getString(LOCALE_KEY, "cs").orEmpty(),
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
      repeatBeerServingType = preferences.getString(REPEAT_BEER_SERVING_TYPE_KEY, null),
      homeTransitLabel = preferences.getString(HOME_TRANSIT_LABEL_KEY, "").orEmpty(),
      homeTransitMissedLabel = preferences.getString(HOME_TRANSIT_MISSED_KEY, "").orEmpty(),
      homeTransitDepartsAtMs =
        if (preferences.contains(HOME_TRANSIT_DEPARTS_AT_KEY)) {
          preferences.getLong(HOME_TRANSIT_DEPARTS_AT_KEY, 0L)
        } else {
          null
        }
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

  /** Every word the notification draws, keyed by the app's UI language. */
  private class Strings(
    val channelName: String,
    val channelDescription: String,
    val nightRunning: String,
    val addBeer: String,
    val addBeerA11y: String,
    val transitIn: String,
    val beerWord: (Int) -> String,
    val beerCount: (Int) -> String
  ) {
    companion object {
      private val CS = Strings(
        channelName = "Večer na pivu",
        channelDescription = "Živý počet piv během večera",
        nightRunning = "Večer běží",
        addBeer = "Ještě jedno",
        addBeerA11y = "Přidat stejné pivo",
        transitIn = "za",
        beerWord = { count ->
          when (count) {
            1 -> "pivo"
            in 2..4 -> "piva"
            else -> "piv"
          }
        },
        beerCount = { count ->
          when (count) {
            1 -> "1 pivo"
            in 2..4 -> "$count piva"
            else -> "$count piv"
          }
        }
      )
      private val EN = Strings(
        channelName = "Beer night",
        channelDescription = "Live beer count during the night",
        nightRunning = "Night in progress",
        addBeer = "One more",
        addBeerA11y = "Log the same beer",
        transitIn = "in",
        beerWord = { count -> if (count == 1) "beer" else "beers" },
        beerCount = { count -> if (count == 1) "1 beer" else "$count beers" }
      )

      fun forLocale(locale: String): Strings = if (locale == "en") EN else CS
    }
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
    val latestBeerLabel: String = "",
    val latestTimeLabel: String = "",
    val latestTimeTemplate: String = "",
    val repeatBeerName: String,
    val repeatBeerPriceCzk: Double?,
    val repeatBeerVolumeMl: Int?,
    val repeatBeerServingType: String?,
    val locale: String,
    val homeTransitLabel: String = "",
    val homeTransitDepartsAtMs: Long? = null,
    val homeTransitMissedLabel: String = ""
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

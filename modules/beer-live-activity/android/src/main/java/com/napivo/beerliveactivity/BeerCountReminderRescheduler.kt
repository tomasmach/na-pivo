package com.napivo.beerliveactivity

import android.content.Context
import android.util.Log
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.triggers.TimeIntervalTrigger
import expo.modules.notifications.service.delegates.ExpoSchedulingDelegate

private const val BEER_COUNT_REMINDER_KIND = "beer_count_reminder"
private const val LOG_TAG = "BeerLiveActivity"

/** Moves the Expo local reminder without waking or opening the React Native UI. */
internal object BeerCountReminderRescheduler {
  fun reschedule(context: Context, sessionId: String) {
    runCatching {
      val scheduler = ExpoSchedulingDelegate(context)
      scheduler.getAllScheduledNotifications()
        .filter { request ->
          val data = request.content.body
          data?.optString("kind") == BEER_COUNT_REMINDER_KIND &&
            data.optString("sessionId") == sessionId &&
            request.trigger is TimeIntervalTrigger
        }
        .forEach { request ->
          val previousTrigger = request.trigger as TimeIntervalTrigger
          scheduler.scheduleNotification(
            NotificationRequest(
              request.identifier,
              request.content,
              TimeIntervalTrigger(
                previousTrigger.channelId,
                previousTrigger.timeInterval,
                false
              )
            )
          )
        }
    }.onFailure { error ->
      // Counting stays durable even if a future Expo scheduler implementation
      // can no longer expose or replace its pending request.
      Log.w(LOG_TAG, "Could not move beer count reminder", error)
    }
  }
}

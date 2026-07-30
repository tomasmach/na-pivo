package com.tomasmach.na_pivo.wear.surface

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.tomasmach.na_pivo.wear.MainActivity
import com.tomasmach.na_pivo.wear.R
import com.tomasmach.na_pivo.wear.domain.PersistedState

object EveningSurfaceController {
    fun refresh(context: Context, state: PersistedState) {
        val applicationContext = context.applicationContext
        val active = state.activeEvening
        val lastDrink = active?.lastDrink
        if (active == null || lastDrink == null) {
            applicationContext.getSystemService(NotificationManager::class.java)
                ?.cancel(NOTIFICATION_ID)
        } else {
            createChannel(applicationContext)
            val openApp = PendingIntent.getActivity(
                applicationContext,
                1,
                Intent(applicationContext, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val repeat = PendingIntent.getActivity(
                applicationContext,
                2,
                Intent(applicationContext, RepeatDrinkActivity::class.java)
                    .setAction(RepeatDrinkActivity.ACTION_REPEAT),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val status = Status.Builder()
                .addTemplate("#pub# · #count#")
                .addPart("pub", Status.TextPart(active.pub.name))
                .addPart("count", Status.TextPart("${active.beerCount} piv"))
                .build()
            val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_na_pivo_mono)
                .setContentTitle(active.pub.name)
                .setContentText("${active.beerCount} piv · ${active.totalCzk} Kč")
                .setContentIntent(openApp)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .addAction(
                    R.drawable.ic_na_pivo_mono,
                    "Přidat ${lastDrink.name}",
                    repeat,
                )
            OngoingActivity.Builder(applicationContext, NOTIFICATION_ID, notification)
                .setStaticIcon(R.drawable.ic_na_pivo_mono)
                .setTouchIntent(openApp)
                .setTitle("Na pivo")
                .setStatus(status)
                .build()
                .apply(applicationContext)
            applicationContext.getSystemService(NotificationManager::class.java)
                ?.notify(NOTIFICATION_ID, notification.build())
        }

        TileService.getUpdater(applicationContext).requestUpdate(NaPivoTileService::class.java)
        ComplicationDataSourceUpdateRequester.create(
            applicationContext,
            ComponentName(applicationContext, NaPivoComplicationService::class.java),
        ).requestUpdateAll()
    }

    private fun createChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.notification_channel_description)
            setShowBadge(false)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        }
        context.getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }

    private const val CHANNEL_ID = "active_evening"
    private const val NOTIFICATION_ID = 112
}

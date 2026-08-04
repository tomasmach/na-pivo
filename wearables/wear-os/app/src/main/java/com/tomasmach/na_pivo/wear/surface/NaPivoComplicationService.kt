package com.tomasmach.na_pivo.wear.surface

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationText
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import com.tomasmach.na_pivo.wear.MainActivity
import com.tomasmach.na_pivo.wear.wearApplication

class NaPivoComplicationService : ComplicationDataSourceService() {
    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        buildData(type, "↻2", "Na pivo", preview = true)

    override fun onComplicationRequest(
        request: ComplicationRequest,
        listener: ComplicationRequestListener,
    ) {
        val active = wearApplication.container.repository.state.value.activeEvening
        val value = active?.let { "↻${it.beerCount}" } ?: "→"
        val title = active?.pub?.name ?: "Kompas"
        listener.onComplicationData(
            buildData(request.complicationType, value, title, preview = false),
        )
    }

    private fun buildData(
        type: ComplicationType,
        value: String,
        title: String,
        preview: Boolean,
    ): ComplicationData? {
        val text = PlainComplicationText.Builder(value).build()
        val titleText = PlainComplicationText.Builder(title).build()
        val description: ComplicationText =
            PlainComplicationText.Builder("Na pivo: $title, $value").build()
        val tapAction =
            if (preview) null
            else {
                val active = wearApplication.container.repository.state.value.activeEvening
                val target =
                    if (active?.lastDrink != null) RepeatDrinkActivity::class.java
                    else MainActivity::class.java
                PendingIntent.getActivity(
                    this,
                    4,
                    Intent(this, target).apply {
                        if (target == RepeatDrinkActivity::class.java) {
                            action = RepeatDrinkActivity.ACTION_REPEAT
                        }
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text, description)
                .setTitle(titleText)
                .setTapAction(tapAction)
                .build()

            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(
                PlainComplicationText.Builder("$title · $value · přidat poslední").build(),
                description,
            )
                .setTapAction(tapAction)
                .build()

            else -> null
        }
    }
}

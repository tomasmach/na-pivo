package com.tomasmach.na_pivo.wear.surface

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders as ProtoResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.tomasmach.na_pivo.wear.MainActivity
import com.tomasmach.na_pivo.wear.ui.NaPivoColors
import com.tomasmach.na_pivo.wear.wearApplication

class NaPivoTileService : TileService() {
    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        val state = wearApplication.container.repository.state.value
        val active = state.activeEvening
        val openClass =
            if (active?.lastDrink != null) RepeatDrinkActivity::class.java else MainActivity::class.java
        val action = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(openClass.name)
                    .build(),
            )
            .build()
        val clickable = ModifiersBuilders.Clickable.Builder()
            .setId(if (active == null) "open" else "repeat")
            .setOnClick(action)
            .build()
        val title = active?.pub?.name ?: "Najdi hospodu"
        val count = active?.let { "${it.beerCount} piv" } ?: "Otevřít kompas"
        val total = active?.let { "${it.totalCzk} Kč" } ?: ""
        val cta = active?.lastDrink?.let { "Přidat ${it.name}" } ?: "Na pivo"

        val column = LayoutElementBuilders.Column.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(argb(NaPivoColors.StoutArgb))
                            .build(),
                    )
                    .build(),
            )
            .addContent(tileText(title, 14f, NaPivoColors.FoamArgb))
            .addContent(tileText(count, 24f, NaPivoColors.AmberArgb))
            .addContent(tileText(total, 11f, NaPivoColors.MutedTextArgb))
            .addContent(
                LayoutElementBuilders.Box.Builder()
                    .setWidth(dp(150f))
                    .setHeight(dp(48f))
                    .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                    .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                    .setModifiers(
                        ModifiersBuilders.Modifiers.Builder()
                            .setClickable(clickable)
                            .setBackground(
                                ModifiersBuilders.Background.Builder()
                                    .setColor(argb(NaPivoColors.AmberArgb))
                                    .setCorner(
                                        ModifiersBuilders.Corner.Builder()
                                            .setRadius(dp(24f))
                                            .build(),
                                    )
                                    .build(),
                            )
                            .build(),
                    )
                    .addContent(tileText(cta, 12f, NaPivoColors.StoutArgb))
                    .build(),
            )
            .build()
        val layout = LayoutElementBuilders.Layout.Builder().setRoot(column).build()
        val timeline = TimelineBuilders.Timeline.Builder()
            .addTimelineEntry(
                TimelineBuilders.TimelineEntry.Builder().setLayout(layout).build(),
            )
            .build()
        return Futures.immediateFuture(
            TileBuilders.Tile.Builder()
                .setResourcesVersion(RESOURCES_VERSION)
                .setTileTimeline(timeline)
                .setFreshnessIntervalMillis(60_000)
                .build(),
        )
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ProtoResourceBuilders.Resources> {
        val resources = ProtoResourceBuilders.Resources.Builder()
            .setVersion(RESOURCES_VERSION)
            .build()
        return Futures.immediateFuture(resources)
    }

    private fun tileText(
        text: String,
        sizeSp: Float,
        color: Int,
    ): LayoutElementBuilders.Text = LayoutElementBuilders.Text.Builder()
        .setText(text)
        .setMaxLines(2)
        .setMultilineAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
        .setFontStyle(
            LayoutElementBuilders.FontStyle.Builder()
                .setSize(sp(sizeSp))
                .setColor(argb(color))
                .build(),
        )
        .build()

    companion object {
        private const val RESOURCES_VERSION = "1"
    }
}
